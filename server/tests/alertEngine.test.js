/**
 * The alert engine (lib/alertEngine.js), the alert history it writes
 * (/api/alert-events) and the drivers API (/api/drivers).
 *
 * Flespi is mocked as in flespi.test.js: buildAcl() and the engine both map
 * IMEIs to device ids through it, and server/.env holds a real Master token.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const H = vi.hoisted(() => ({ flespiToken: 'mock-master-token' }))

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => {
    const copy = { ...frozen }
    Object.defineProperty(copy, 'FLESPI_TOKEN', { get: () => H.flespiToken, configurable: true, enumerable: true })
    return copy
  }
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
const { evaluate, evaluateLicence, nightWindow, runAlertPass } = await import('../src/lib/alertEngine.js')
import { auth, resetDb, seedFixture } from './factories.js'
import { clearDeviceCache } from '../src/lib/flespi.js'

const app = createApp()
let fx
/** deviceId -> telemetry the mocked Flespi answers with. */
let telemetry = {}

const NOW = Math.floor(Date.UTC(2026, 9, 30, 10, 0, 0) / 1000) // 14:00 UAE

function installFlespiMock() {
  vi.stubGlobal('fetch', url => {
    const u = String(url)
    const json = body => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    if (u.includes('/gw/devices/all/telemetry/')) {
      return json({
        result: Object.entries(telemetry).map(([id, t]) => ({
          id: Number(id),
          telemetry: Object.fromEntries(Object.entries(t).map(([k, value]) => [k, { value, ts: t.timestamp }])),
        })),
      })
    }
    if (u.includes('/gw/devices/all')) {
      return json({
        result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, configuration: { ident: `86307101123450${i + 1}` } })),
      })
    }
    return json({ result: [] })
  })
}

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  telemetry = {}
  installFlespiMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearDeviceCache()
})

// ── evaluate (pure) ─────────────────────────────────────────────────────────

const tel = (o = {}) => ({ speed: 0, lat: 24.4, lng: 54.4, ignition: true, temperature: null, ts: NOW - 30, ...o })

describe('evaluate', () => {
  it('Over Speed fires on crossing the limit, once, and re-arms only below limit - 5', () => {
    const a = { type: 'overspeed', params: { speedKmh: 120 } }
    let r = evaluate(a, tel({ speed: 135 }), {}, NOW)
    expect(r.fire.message).toMatch(/135 km\/h \(limit 120/)
    r = evaluate(a, tel({ speed: 140 }), r.state, NOW)
    expect(r.fire).toBeNull()
    r = evaluate(a, tel({ speed: 118 }), r.state, NOW) // inside the hysteresis band
    r = evaluate(a, tel({ speed: 125 }), r.state, NOW)
    expect(r.fire).toBeNull()
    r = evaluate(a, tel({ speed: 100 }), r.state, NOW)
    expect(evaluate(a, tel({ speed: 130 }), r.state, NOW).fire).not.toBeNull()
  })

  it('ignores stale telemetry for speed rules', () => {
    const a = { type: 'overspeed', params: { speedKmh: 120 } }
    expect(evaluate(a, tel({ speed: 150, ts: NOW - 3600 }), {}, NOW).fire).toBeNull()
  })

  it('Idle fires once after the configured minutes with the engine on and the vehicle still', () => {
    const a = { type: 'idle', params: { minutes: 10 } }
    let r = evaluate(a, tel({ ts: NOW - 600 }), {}, NOW - 590)
    expect(r.fire).toBeNull()
    r = evaluate(a, tel({ ts: NOW - 10 }), r.state, NOW)
    expect(r.fire.message).toMatch(/Idling/)
    expect(evaluate(a, tel({ ts: NOW }), r.state, NOW + 60).fire).toBeNull()
    expect(evaluate(a, tel({ speed: 40 }), r.state, NOW).state).toEqual({})
  })

  it('Geofence entry records a baseline first, then fires on the way in only', () => {
    const fence = { id: 'g1', name: 'Mussafah Depot', shape: 'CIRCLE', centerLat: 24.4, centerLng: 54.4, radius: 500 }
    const a = { type: 'geofence_enter', params: { geofenceIds: [] } }
    const outside = tel({ lat: 24.5 })
    let r = evaluate(a, tel(), {}, NOW, { geofences: [fence] })
    expect(r.fire).toBeNull() // already inside at first sight: baseline
    r = evaluate(a, outside, r.state, NOW, { geofences: [fence] })
    expect(r.fire).toBeNull()
    r = evaluate(a, tel(), r.state, NOW, { geofences: [fence] })
    expect(r.fire.message).toBe('Entered Mussafah Depot')
    const exit = { type: 'geofence_exit', params: {} }
    const e = evaluate(exit, outside, { inside: { g1: true } }, NOW, { geofences: [fence] })
    expect(e.fire.message).toBe('Left Mussafah Depot')
  })

  it('Ignition On fires on the change only, never on the first sight', () => {
    const a = { type: 'ignition_on' }
    let r = evaluate(a, tel({ ignition: false }), {}, NOW)
    expect(r.fire).toBeNull()
    r = evaluate(a, tel({ ignition: true }), r.state, NOW)
    expect(r.fire.message).toBe('Ignition switched on')
    expect(evaluate({ type: 'ignition_off' }, tel({ ignition: true }), { ign: false }, NOW).fire).toBeNull()
  })

  it('Offline fires when the tracker has been silent for the minutes, once', () => {
    const a = { type: 'offline', params: { minutes: 60 } }
    const r = evaluate(a, tel({ ts: NOW - 75 * 60 }), {}, NOW)
    expect(r.fire.message).toMatch(/1 h 15 min/)
    expect(evaluate(a, tel({ ts: NOW - 80 * 60 }), r.state, NOW).fire).toBeNull()
  })

  it('Temperature fires outside the bounds and re-arms half a degree inside', () => {
    const a = { type: 'temperature', minTemp: 2, maxTemp: 8 }
    const r = evaluate(a, tel({ temperature: 9.2 }), {}, NOW)
    expect(r.fire.message).toMatch(/above the maximum 8/)
    expect(evaluate(a, tel({ temperature: 7.9 }), r.state, NOW).state.out).toBe(true)
    expect(evaluate(a, tel({ temperature: 7.4 }), r.state, NOW).state.out).toBe(false)
  })

  it('Night Driving fires once per night, across midnight', () => {
    const a = { type: 'night_driving', params: { from: '23:00', to: '05:00', minSpeedKmh: 10 } }
    const at2330 = Math.floor(Date.UTC(2026, 9, 29, 19, 30) / 1000) // 23:30 UAE, 29 Oct
    const at0300 = Math.floor(Date.UTC(2026, 9, 29, 23, 0) / 1000)  // 03:00 UAE, 30 Oct
    expect(nightWindow(at0300, '23:00', '05:00')).toEqual({ inside: true, key: '2026-10-29' })
    const r = evaluate(a, tel({ speed: 60, ts: at2330 }), {}, at2330)
    expect(r.fire).not.toBeNull()
    expect(evaluate(a, tel({ speed: 60, ts: at0300 }), r.state, at0300).fire).toBeNull()
    expect(evaluate(a, tel({ speed: 60 }), {}, NOW).fire).toBeNull() // 14:00
  })

  it('Licence expiry fires entering the warning window and again on expiry', () => {
    const a = { type: 'license_expiry', params: { days: 30 } }
    const d = days => ({ licenseExpiry: new Date(Date.parse('2026-10-30T00:00:00Z') + days * 86400000) })
    let r = evaluateLicence(a, d(45), {}, NOW)
    expect(r.fire).toBeNull()
    r = evaluateLicence(a, d(20), r.state, NOW)
    expect(r.fire.message).toBe('Driving licence expires in 20 days')
    expect(evaluateLicence(a, d(19), r.state, NOW).fire).toBeNull()
    expect(evaluateLicence(a, d(-2), r.state, NOW).fire.message).toBe('Driving licence expired 2 days ago')
  })
})

// ── the pass + history ──────────────────────────────────────────────────────

async function overspeedRule(bgId, extra = {}) {
  return prisma.alert.create({
    data: { name: 'Speeding', type: 'overspeed', bgId, severity: 'High', params: { speedKmh: 120 }, allVehicles: true, ...extra },
  })
}

describe('runAlertPass + /api/alert-events', () => {
  it('raises one event per crossing, names the driver, and scopes the history by BG', async () => {
    await overspeedRule(fx.bgA1a.id)
    await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Ahmed Khan', vehicleId: fx.vehicles.v1.id } })
    telemetry = { 101: { 'position.speed': 142, 'position.latitude': 24.4, 'position.longitude': 54.4, timestamp: NOW - 20 } }

    const first = await runAlertPass(NOW)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ type: 'overspeed', severity: 'High', title: 'Speeding', deviceId: 101 })
    expect(first[0].message).toMatch(/142 km\/h .*Driver: Ahmed Khan/)
    expect(await runAlertPass(NOW + 30)).toHaveLength(0) // still over: no repeat

    const mine = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(mine.status).toBe(200)
    expect(mine.body.data).toHaveLength(1)
    expect(mine.body.unreadCount).toBe(1)
    expect(mine.body.data[0].driver.name).toBe('Ahmed Khan')

    const other = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserB1a))
    expect(other.body.data).toHaveLength(0)

    const read = await request(app).post('/api/alert-events/read').set(auth(fx.tokens.bgUserA1a)).send({})
    expect(read.body.data.updated).toBe(1)
    const after = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(after.body.unreadCount).toBe(0)
  })

  it('does nothing for an inactive rule', async () => {
    await overspeedRule(fx.bgA1a.id, { status: 'Inactive' })
    telemetry = { 101: { 'position.speed': 150, timestamp: NOW - 20 } }
    expect(await runAlertPass(NOW)).toHaveLength(0)
  })
})

// ── /api/alerts validation of the new fields ────────────────────────────────

describe('POST /api/alerts — engine types', () => {
  const post = body => request(app).post('/api/alerts').set(auth(fx.tokens.bgUserA1a)).send({ bgId: fx.bgA1a.id, allVehicles: true, ...body })

  it('stores a type with its settings, severity and recipients', async () => {
    const res = await post({ name: 'Too fast', type: 'overspeed', severity: 'Critical', params: { speedKmh: '110' }, emails: ['Ops@Example.com'], notify: { inApp: true, email: true } })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ type: 'overspeed', severity: 'Critical', params: { speedKmh: 110 }, emails: ['ops@example.com'] })
  })

  it('rejects a missing limit, an unknown type, and email on with no address', async () => {
    expect((await post({ name: 'x', type: 'overspeed', params: { speedKmh: '' } })).status).toBe(400)
    expect((await post({ name: 'x', type: 'fuel_theft' })).status).toBe(400)
    expect((await post({ name: 'x', type: 'idle', notify: { email: true }, emails: [] })).status).toBe(400)
  })
})

// ── /api/drivers ────────────────────────────────────────────────────────────

describe('/api/drivers', () => {
  const create = (token, body) => request(app).post('/api/drivers').set(auth(token)).send(body)

  it('creates a driver with a licence date and a vehicle, and moves the vehicle on reassignment', async () => {
    const a = await create(fx.tokens.bgUserA1a, { bgId: fx.bgA1a.id, name: 'Ahmed', licenseNo: 'AD-1', licenseExpiry: '2027-03-31', vehicleId: fx.vehicles.v1.id })
    expect(a.status).toBe(201)
    expect(a.body.data).toMatchObject({ name: 'Ahmed', licenseExpiry: '2027-03-31', vehicle: { id: fx.vehicles.v1.id } })

    const b = await create(fx.tokens.bgUserA1a, { bgId: fx.bgA1a.id, name: 'Bilal', vehicleId: fx.vehicles.v1.id })
    expect(b.status).toBe(201)
    expect(b.body.movedFrom).toMatchObject({ name: 'Ahmed' })
    const ahmed = await prisma.driver.findUnique({ where: { id: a.body.data.id } })
    expect(ahmed.vehicleId).toBeNull()
  })

  it('refuses a vehicle of another BG and a bad date', async () => {
    expect((await create(fx.tokens.bgUserA1a, { bgId: fx.bgA1a.id, name: 'X', vehicleId: fx.vehicles.v8.id })).status).toBe(400)
    expect((await create(fx.tokens.bgUserA1a, { bgId: fx.bgA1a.id, name: 'X', licenseExpiry: '31/03/2027' })).status).toBe(400)
  })

  it('shows a sub-user only the drivers of its own vehicles, read-only', async () => {
    await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'On v1', vehicleId: fx.vehicles.v1.id } })
    await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'On v3', vehicleId: fx.vehicles.v3.id } })
    const list = await request(app).get('/api/drivers').set(auth(fx.tokens.subUserA1a))
    expect(list.body.data.map(d => d.name)).toEqual(['On v1'])
    expect((await create(fx.tokens.subUserA1a, { bgId: fx.bgA1a.id, name: 'Nope' })).status).toBe(403)
  })
})
