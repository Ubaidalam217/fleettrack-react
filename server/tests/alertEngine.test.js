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
const { customMatches, evaluate, evaluateLicence, episodeRule, nightWindow, refineEpisode, runAlertPass } = await import('../src/lib/alertEngine.js')
import { auth, resetDb, seedFixture } from './factories.js'
import { clearDeviceCache } from '../src/lib/flespi.js'

const app = createApp()
let fx
/** deviceId -> telemetry the mocked Flespi answers with. */
let telemetry = {}
/** What the mocked Flespi answers a /messages read with. */
let flespiMessages = []

const NOW = Math.floor(Date.UTC(2026, 9, 30, 10, 0, 0) / 1000) // 14:00 UAE

function installFlespiMock() {
  vi.stubGlobal('fetch', url => {
    const u = String(url)
    const json = body => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    if (u.includes('/messages')) return json({ result: flespiMessages })
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
  flespiMessages = []
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

  it('Geo Zone fires on the chosen direction: Enter, Exit, or Enter and Exit', () => {
    const fence = { id: 'g1', name: 'Mussafah Depot', shape: 'CIRCLE', centerLat: 24.4, centerLng: 54.4, radius: 500 }
    const ctx = { geofences: [fence] }
    const inside = { inside: { g1: true } }, outside = { inside: { g1: false } }
    const rule = direction => ({ type: 'geofence', params: { geofenceIds: [], direction } })
    const away = tel({ lat: 24.5 })

    expect(evaluate(rule('enter'), tel(), outside, NOW, ctx).fire.message).toBe('Entered Mussafah Depot')
    expect(evaluate(rule('enter'), away, inside, NOW, ctx).fire).toBeNull()
    expect(evaluate(rule('exit'), away, inside, NOW, ctx).fire.message).toBe('Left Mussafah Depot')
    expect(evaluate(rule('exit'), tel(), outside, NOW, ctx).fire).toBeNull()
    expect(evaluate(rule('both'), tel(), outside, NOW, ctx).fire.message).toBe('Entered Mussafah Depot')
    expect(evaluate(rule('both'), away, inside, NOW, ctx).fire.message).toBe('Left Mussafah Depot')
    // The default is both.
    expect(evaluate({ type: 'geofence', params: {} }, away, inside, NOW, ctx).fire.message).toBe('Left Mussafah Depot')
  })

  it('Geo Zone Speed Violation: within the grace is a record, past it an alert, grace 0 at once', () => {
    const zone = { id: 'g1', name: 'Mussafah Depot', shape: 'CIRCLE', centerLat: 24.4, centerLng: 54.4, radius: 500, speedLimitKmh: 40, speedGraceSec: 10 }
    const a = { type: 'geofence_speed', params: { geofenceIds: [] } }
    const ctx = { geofences: [zone] }
    const at = (speed, ts, o = {}) => tel({ speed, ts, ...o })

    // 41 km/h for 8 s, then back to 30: recorded only.
    let r = evaluate(a, at(41, NOW - 20), {}, NOW, ctx)
    expect(r.fire).toBeNull()
    r = evaluate(a, at(44, NOW - 12), r.state, NOW, ctx)
    expect(r.fire).toBeNull()
    r = evaluate(a, at(30, NOW - 5), r.state, NOW, ctx)
    expect(r.fire).toMatchObject({ recordOnly: true, value: 44 })
    expect(r.fire.message).toBe('Over the speed limit in Mussafah Depot for 8 s, within the 10 s grace: 44 km/h (limit 40 km/h)')
    expect(r.state.zones).toEqual({})

    // 41 km/h held for 10 s: an alert, once for the episode.
    r = evaluate(a, at(41, NOW - 30), {}, NOW, ctx)
    r = evaluate(a, at(42, NOW - 20), r.state, NOW, ctx)
    expect(r.fire.recordOnly).toBeUndefined()
    expect(r.fire.message).toBe('Geo Zone speed violation in Mussafah Depot: 42 km/h (limit 40 km/h, over for 10 s)')
    r = evaluate(a, at(50, NOW - 10), r.state, NOW, ctx)
    expect(r.fire).toBeNull()
    // Back under, no extra record for an episode that already alerted.
    expect(evaluate(a, at(20, NOW - 5), r.state, NOW, ctx).fire).toBeNull()

    // A few km/h under the limit is still the same episode (hysteresis).
    r = evaluate(a, at(41, NOW - 30), {}, NOW, ctx)
    r = evaluate(a, at(38, NOW - 25), r.state, NOW, ctx)
    expect(r.fire).toBeNull()
    expect(evaluate(a, at(41, NOW - 20), r.state, NOW, ctx).fire.message).toMatch(/over for 10 s/)

    // Leaving the zone ends the episode too.
    r = evaluate(a, at(60, NOW - 20), {}, NOW, ctx)
    expect(evaluate(a, at(60, NOW - 15, { lat: 24.5 }), r.state, NOW, ctx).fire.message).toMatch(/on one reading, within the 10 s grace/)

    // Grace 0: the first reading over the limit is the violation.
    const strict = { geofences: [{ ...zone, speedGraceSec: 0 }] }
    expect(evaluate(a, at(41, NOW - 20), {}, NOW, strict).fire.message).toBe('Geo Zone speed violation in Mussafah Depot: 41 km/h (limit 40 km/h)')

    // Outside the zone, at the limit, without a limit, or not a chosen zone: nothing.
    expect(evaluate(a, at(90, NOW - 20, { lat: 24.5 }), {}, NOW, strict).fire).toBeNull()
    expect(evaluate(a, at(40, NOW - 20), {}, NOW, strict).fire).toBeNull()
    expect(evaluate(a, at(90, NOW - 20), {}, NOW, { geofences: [{ ...zone, speedLimitKmh: null }] }).fire).toBeNull()
    expect(evaluate({ ...a, params: { geofenceIds: ['other'] } }, at(90, NOW - 20), {}, NOW, strict).fire).toBeNull()
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

  it('Other (custom parameter) fires when the condition becomes true, once, and re-arms when it stops', () => {
    const a = { type: 'custom', params: { parameter: 'external.powersource.voltage', operator: '<', value: '11.5' } }
    const reading = (value, ts = NOW - 30) => tel({ params: { 'external.powersource.voltage': { value, ts } } })
    let r = evaluate(a, reading(12.4), {}, NOW)
    expect(r.fire).toBeNull()
    r = evaluate(a, reading(11.1), r.state, NOW)
    expect(r.fire.message).toBe('external.powersource.voltage = 11.1 (rule: < 11.5)')
    expect(evaluate(a, reading(10.9), r.state, NOW).fire).toBeNull() // still low: no repeat
    r = evaluate(a, reading(12.0), r.state, NOW)
    expect(r.state.met).toBe(false)
    expect(evaluate(a, reading(11.0), r.state, NOW).fire).not.toBeNull()
    // A value the tracker stopped reporting long ago is not evaluated.
    expect(evaluate(a, reading(9, NOW - 3600), {}, NOW).fire).toBeNull()
    expect(evaluate(a, tel(), {}, NOW).fire).toBeNull()
  })

  it('Other rules compare numbers, text and true / false', () => {
    expect(customMatches(true, 'true')).toBe(true)
    expect(customMatches(false, 'true')).toBe(false)
    expect(customMatches(0, 'false')).toBe(true)
    expect(customMatches(100, '>=', '100')).toBe(true)
    expect(customMatches('94000001D9DF0801', '=', '94000001d9df0801')).toBe(true)
    expect(customMatches('94000001D9DF0801', '!=', '94000001D9DF0801')).toBe(false)
    expect(customMatches(true, '=', 'true')).toBe(true)
    expect(customMatches('sensor not found', '>', '3')).toBe(false)
    expect(customMatches(undefined, '>', '3')).toBe(false)
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

  it('narrows the history to a time range and to some devices (Event Occurrence Report)', async () => {
    const at = sec => new Date(sec * 1000)
    const base = { bgId: fx.bgA1a.id, type: 'overspeed', severity: 'High', title: 'Speeding', message: 'x' }
    await prisma.alertEvent.createMany({ data: [
      { ...base, deviceId: 101, occurredAt: at(NOW - 3600) },
      { ...base, deviceId: 101, occurredAt: at(NOW - 60) },
      { ...base, deviceId: 202, occurredAt: at(NOW - 60) },
    ] })
    const get = query => request(app).get('/api/alert-events').query(query).set(auth(fx.tokens.bgUserA1a))

    const recent = await get({ from: at(NOW - 600).toISOString(), to: at(NOW).toISOString(), limit: 2000 })
    expect(recent.status).toBe(200)
    expect(recent.body.data).toHaveLength(2)
    const one = await get({ from: at(NOW - 7200).toISOString(), deviceIds: '101' })
    expect(one.body.data.map(e => e.deviceId)).toEqual([101, 101])
    expect((await get({ deviceIds: '1,x' })).status).toBe(400)
  })

  it('runs an Other rule on the parameter it names', async () => {
    await prisma.alert.create({
      data: { name: 'Towing', type: 'custom', bgId: fx.bgA1a.id, severity: 'High', params: { parameter: 'towing.alarm.status', operator: 'true', value: '' }, allVehicles: true },
    })
    telemetry = { 101: { 'position.speed': 0, 'towing.alarm.status': false, timestamp: NOW - 20 } }
    expect(await runAlertPass(NOW)).toHaveLength(0)
    telemetry = { 101: { 'position.speed': 0, 'towing.alarm.status': true, timestamp: NOW - 10 } }
    const fired = await runAlertPass(NOW + 30)
    expect(fired).toHaveLength(1)
    expect(fired[0]).toMatchObject({ type: 'custom', deviceId: 101 })
    expect(fired[0].message).toMatch(/towing\.alarm\.status = true \(rule: is true\)/)
  })

  it('names the driver whose iButton is in the reader, not the assigned one', async () => {
    await overspeedRule(fx.bgA1a.id)
    await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Assigned Ali', vehicleId: fx.vehicles.v1.id } })
    const tagged = await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Tagged Tariq', ibuttonCode: '94000001D9DF0801' } })
    telemetry = { 101: { 'position.speed': 142, 'ibutton.code': '94000001d9df0801', timestamp: NOW - 20 } }
    const [e] = await runAlertPass(NOW)
    expect(e.message).toMatch(/Driver: Tagged Tariq/)
    expect(e.driverId).toBe(tagged.id)
  })

  it('a Geo Zone speed excursion within the grace is stored already read, outside the cooldown', async () => {
    await prisma.geofence.create({ data: { bgId: fx.bgA1a.id, name: 'Port Zone', kind: 'GEOFENCE', shape: 'CIRCLE', centerLat: 24.4, centerLng: 54.4, radius: 500, speedLimitKmh: 40, speedGraceSec: 60 } })
    await prisma.alert.create({ data: { name: 'Zone speed', type: 'geofence_speed', bgId: fx.bgA1a.id, severity: 'High', params: { geofenceIds: [] }, allVehicles: true } })
    const at = (speed, ts) => ({ 101: { 'position.speed': speed, 'position.latitude': 24.4, 'position.longitude': 54.4, timestamp: ts } })

    telemetry = at(45, NOW - 20)
    expect(await runAlertPass(NOW)).toHaveLength(0)
    telemetry = at(20, NOW + 10)
    const [rec] = await runAlertPass(NOW + 30)
    expect(rec).toMatchObject({ type: 'geofence_speed', severity: 'Low', title: 'Zone speed · recorded', deviceId: 101 })
    expect(rec.readAt).not.toBeNull()

    // Not in the bell; and it does not hold back a real violation that follows.
    const list = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(list.body.unreadCount).toBe(0)
    telemetry = at(50, NOW + 40)
    expect(await runAlertPass(NOW + 60)).toHaveLength(0)
    telemetry = at(52, NOW + 100)
    const [alert] = await runAlertPass(NOW + 120)
    expect(alert).toMatchObject({ severity: 'High', title: 'Zone speed', readAt: null })
    expect(alert.message).toBe('PLATE-1: Geo Zone speed violation in Port Zone: 52 km/h (limit 40 km/h, over for 60 s)')
  })

  it('a temperature slot with no probe (0 °C, 0 % humidity) raises no "below minimum"', async () => {
    await prisma.alert.create({ data: { name: 'Cold chain', type: 'temperature', bgId: fx.bgA1a.id, severity: 'High', minTemp: 2, maxTemp: 8, allVehicles: true } })
    telemetry = { 101: { 'position.speed': 0, 'ble.sensor.temperature.1': 0, 'ble.sensor.humidity.1': 0, timestamp: NOW - 20 } }
    expect(await runAlertPass(NOW)).toHaveLength(0)
    telemetry = { 101: { 'position.speed': 0, 'ble.sensor.temperature.1': 0.5, 'ble.sensor.humidity.1': 60, timestamp: NOW - 10 } }
    // A real 0.5 °C does alert (the fixture's own reefer rule fires too).
    expect((await runAlertPass(NOW + 30)).map(e => e.title)).toContain('Cold chain')
  })

  it('does nothing for an inactive rule', async () => {
    await overspeedRule(fx.bgA1a.id, { status: 'Inactive' })
    telemetry = { 101: { 'position.speed': 150, timestamp: NOW - 20 } }
    expect(await runAlertPass(NOW)).toHaveLength(0)
  })
})

// ── harsh driving (client, 2026-11-10) ──────────────────────────────────────

describe('harsh braking and acceleration rules', () => {
  const at = (t, speed) => ({ 'device.id': 101, timestamp: NOW - 60 + t, 'position.speed': speed, 'position.latitude': 24.4, 'position.longitude': 54.4 })
  // 60 → 45 → 30 km/h a second apart is one stop; 30 → 10 in a second is a second one.
  const recent = new Map([[101, [at(0, 60), at(1, 45), at(2, 30), at(20, 30), at(21, 10), at(40, 12)]]])

  it('raises an event for each hard stop, dated when it began, and never twice', async () => {
    await prisma.alert.create({ data: { name: 'Harsh stop', type: 'harsh_braking', bgId: fx.bgA1a.id, severity: 'Medium', params: { thresholdMs2: 3.5 }, allVehicles: true } })
    const events = await runAlertPass(NOW, { recent })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'harsh_braking', deviceId: 101, value: 4.2, lat: 24.4 })
    expect(events[0].occurredAt.getTime()).toBe((NOW - 60) * 1000)
    expect(events[0].message).toBe('PLATE-1: Harsh braking: 60 → 30 km/h in 2 s (4.2 m/s²)')
    expect(await runAlertPass(NOW + 30, { recent })).toHaveLength(0)
  })

  it('reads launches for an acceleration rule, at its own threshold', async () => {
    await prisma.alert.create({ data: { name: 'Launch', type: 'harsh_acceleration', bgId: fx.bgA1a.id, severity: 'Low', params: { thresholdMs2: 2 }, allVehicles: true } })
    const launch = new Map([[101, [at(0, 0), at(3, 25), at(4, 26)]]]) // 2.3 m/s²
    const [e] = await runAlertPass(NOW, { recent: launch })
    expect(e.message).toMatch(/Harsh acceleration: 0 → 25 km\/h in 3 s/)
  })

  it('takes a threshold between 1.5 and 9 m/s²', async () => {
    const post = body => request(app).post('/api/alerts').set(auth(fx.tokens.bgUserA1a)).send({ bgId: fx.bgA1a.id, allVehicles: true, name: 'h', ...body })
    expect((await post({ type: 'harsh_braking', params: { thresholdMs2: '4' } })).body.data.params).toEqual({ thresholdMs2: 4 })
    expect((await post({ type: 'harsh_acceleration', params: {} })).body.data.params).toEqual({ thresholdMs2: 3.5 })
    expect((await post({ type: 'harsh_braking', params: { thresholdMs2: '12' } })).status).toBe(400)
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

  it('stores an Other rule and checks its parameter, condition and value', async () => {
    const ok = await post({ name: 'Low battery', type: 'custom', params: { parameter: ' external.powersource.voltage ', operator: '<', value: '11.5' } })
    expect(ok.status).toBe(201)
    expect(ok.body.data.params).toEqual({ parameter: 'external.powersource.voltage', operator: '<', value: '11.5' })
    const flag = await post({ name: 'Towing', type: 'custom', params: { parameter: 'towing.alarm.status', operator: 'true', value: 'ignored' } })
    expect(flag.body.data.params.value).toBe('')
    expect((await post({ name: 'x', type: 'custom', params: { parameter: 'bad name!', operator: '>', value: '1' } })).status).toBe(400)
    expect((await post({ name: 'x', type: 'custom', params: { parameter: 'gsm.signal.level', operator: 'like', value: '1' } })).status).toBe(400)
    expect((await post({ name: 'x', type: 'custom', params: { parameter: 'gsm.signal.level', operator: '>', value: 'high' } })).status).toBe(400)
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

  it('stores an iButton code in the form the tracker reports and keeps it to one driver', async () => {
    const a = await create(fx.tokens.bgUserA1a, { bgId: fx.bgA1a.id, name: 'Tagged', ibuttonCode: '94 00 00 01 d9 df 08 01' })
    expect(a.status).toBe(201)
    expect(a.body.data.ibuttonCode).toBe('94000001D9DF0801')
    const clash = await create(fx.tokens.bgUserA1a, { bgId: fx.bgA1a.id, name: 'Other', ibuttonCode: '94000001D9DF0801' })
    expect(clash.status).toBe(409)
    expect(clash.body.error.details).toEqual({ ibuttonCode: 'Already in use' })
    expect((await create(fx.tokens.bgUserA1a, { bgId: fx.bgA1a.id, name: 'X', ibuttonCode: 'not-hex!' })).status).toBe(400)
    expect((await create(fx.tokens.bgUserA1a, { bgId: fx.bgA1a.id, name: 'X', ibuttonCode: '0000000000000000' })).status).toBe(400)
    const cleared = await request(app).put(`/api/drivers/${a.body.data.id}`).set(auth(fx.tokens.bgUserA1a)).send({ name: 'Tagged', ibuttonCode: '' })
    expect(cleared.body.data.ibuttonCode).toBeNull()
  })

  it('shows a sub-user only the drivers of its own vehicles, read-only', async () => {
    await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'On v1', vehicleId: fx.vehicles.v1.id } })
    await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'On v3', vehicleId: fx.vehicles.v3.id } })
    const list = await request(app).get('/api/drivers').set(auth(fx.tokens.subUserA1a))
    expect(list.body.data.map(d => d.name)).toEqual(['On v1'])
    expect((await create(fx.tokens.subUserA1a, { bgId: fx.bgA1a.id, name: 'Nope' })).status).toBe(403)
  })
})

// ── episodes: a violation's start, end, duration and worst reading ─────────

describe('violation episodes', () => {
  it('Over Speed opens an episode, keeps its peak, and returns its end', () => {
    const a = { type: 'overspeed', params: { speedKmh: 120 } }
    let r = evaluate(a, tel({ speed: 130, ts: NOW - 30 }), {}, NOW)
    expect(r.state.ep).toEqual({ at: NOW, since: NOW - 30, peak: 130 })
    r = evaluate(a, tel({ speed: 141, ts: NOW + 30 }), r.state, NOW + 60)
    r = evaluate(a, tel({ speed: 118, ts: NOW + 90 }), r.state, NOW + 120) // inside the 5 km/h band: same episode
    expect(r.end ?? null).toBeNull()
    r = evaluate(a, tel({ speed: 90, ts: NOW + 150 }), r.state, NOW + 180)
    expect(r.end).toEqual({ at: NOW, since: NOW - 30, endTs: NOW + 150, peak: 141 })
    expect(r.state.ep).toBeUndefined()
  })

  it('Idle closes with the time it began, not when it was noticed', () => {
    const a = { type: 'idle', params: { minutes: 10 } }
    let r = evaluate(a, tel({ ts: NOW - 700 }), {}, NOW - 690)
    r = evaluate(a, tel({ ts: NOW - 10 }), r.state, NOW)
    expect(r.fire).not.toBeNull()
    r = evaluate(a, tel({ speed: 30, ts: NOW + 50 }), r.state, NOW + 60)
    expect(r.end).toEqual({ at: NOW, since: NOW - 700, endTs: NOW + 50, peak: null })
  })

  it('Tamper / Battery Tamper / Panic: baseline, start, end — only from a tracker that sends the flag', () => {
    const tamper = { type: 'tamper', params: {} }
    expect(evaluate(tamper, tel(), {}, NOW).fire).toBeNull() // no flag at all
    let r = evaluate(tamper, tel({ tamper: false }), {}, NOW)
    expect(r.fire).toBeNull() // the first sight is the baseline
    r = evaluate(tamper, tel({ tamper: true, ts: NOW + 50 }), r.state, NOW + 60)
    expect(r.fire.message).toBe('Device tamper detected')
    r = evaluate(tamper, tel({ tamper: true, ts: NOW + 110 }), r.state, NOW + 120)
    expect(r.fire).toBeNull()
    r = evaluate(tamper, tel({ tamper: false, ts: NOW + 170 }), r.state, NOW + 180)
    expect(r.end).toEqual({ at: NOW + 60, since: NOW + 50, endTs: NOW + 170, peak: null })

    const battery = { type: 'battery_tamper', params: {} }
    r = evaluate(battery, tel({ power: true }), {}, NOW)
    r = evaluate(battery, tel({ power: false, ts: NOW + 50 }), r.state, NOW + 60) // external power cut
    expect(r.fire.message).toMatch(/Battery tamper/)
    expect(evaluate(battery, tel({ power: true, ts: NOW + 110 }), r.state, NOW + 120).end).toMatchObject({ since: NOW + 50, endTs: NOW + 110 })

    const panic = { type: 'panic', params: {} }
    r = evaluate(panic, tel({ sos: false }), {}, NOW)
    expect(evaluate(panic, tel({ sos: true, ts: NOW + 50 }), r.state, NOW + 60).fire.message).toMatch(/Panic/)
  })

  it('reads the exact start, end and peak off the messages', () => {
    const rule = episodeRule({ type: 'overspeed', params: { speedKmh: 80 } })
    const m = (t, speed) => ({ timestamp: NOW + t, 'position.speed': speed })
    const msgs = [m(0, 60), m(10, 85), { timestamp: NOW + 15 }, m(20, 94), m(30, 78), m(40, 83), m(50, 70), m(60, 90)]
    // Noticed by the pass at +20; the stretch began at +10, held through 78
    // (inside the 5 km/h band) and ended at the first reading under 75.
    expect(refineEpisode(msgs, rule, { since: NOW + 20, endTs: NOW + 55 })).toEqual({ startTs: NOW + 10, endTs: NOW + 50, peak: 94 })

    const flag = episodeRule({ type: 'battery_tamper', params: {} })
    const f = (t, v) => ({ timestamp: NOW + t, 'external.powersource.status': v })
    expect(refineEpisode([f(0, true), f(5, false), f(9, false), f(13, true)], flag, { since: NOW + 9, endTs: NOW + 40 }))
      .toEqual({ startTs: NOW + 5, endTs: NOW + 13, peak: null })
    expect(refineEpisode([], rule, { since: NOW, endTs: NOW + 60 })).toBeNull()
    expect(episodeRule({ type: 'harsh_braking', params: {} })).toBeNull()
  })

  it('the pass fills endedAt / durationSec / peakValue, and the API returns them', async () => {
    await overspeedRule(fx.bgA1a.id)
    const at = (ts, speed) => ({ 'position.speed': speed, 'position.latitude': 24.4, 'position.longitude': 54.4, timestamp: ts })
    telemetry = { 101: at(NOW - 20, 142) }
    const [opened] = await runAlertPass(NOW)
    expect(opened).toMatchObject({ endedAt: null, durationSec: null, peakValue: null })
    telemetry = { 101: at(NOW + 40, 151) }
    await runAlertPass(NOW + 60)
    const open = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(open.body.data[0]).toMatchObject({ endedAt: null, durationSec: null, peakValue: null })

    // Back under the limit; the messages show it began at NOW - 25 and ended at NOW + 95.
    flespiMessages = [
      { 'device.id': 101, timestamp: NOW - 40, 'position.speed': 100 },
      { 'device.id': 101, timestamp: NOW - 25, 'position.speed': 125 },
      { 'device.id': 101, timestamp: NOW + 40, 'position.speed': 153 },
      { 'device.id': 101, timestamp: NOW + 95, 'position.speed': 60 },
    ]
    telemetry = { 101: at(NOW + 100, 60) }
    await runAlertPass(NOW + 120)
    const row = await prisma.alertEvent.findUnique({ where: { id: opened.id } })
    expect(row.occurredAt.getTime()).toBe((NOW - 25) * 1000)
    expect(row.endedAt.getTime()).toBe((NOW + 95) * 1000)
    expect(row).toMatchObject({ durationSec: 120, peakValue: 153 })

    const res = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(res.body.data[0]).toMatchObject({ durationSec: 120, peakValue: 153, endedAt: new Date((NOW + 95) * 1000).toISOString() })
  })

  it('closes from the passes alone when the messages do not show it', async () => {
    await prisma.alert.create({ data: { name: 'Battery cut', type: 'battery_tamper', bgId: fx.bgA1a.id, severity: 'Critical', params: {}, allVehicles: true } })
    telemetry = { 101: { 'external.powersource.status': true, timestamp: NOW - 20 } }
    expect(await runAlertPass(NOW)).toHaveLength(0) // baseline
    telemetry = { 101: { 'external.powersource.status': false, timestamp: NOW + 40 } }
    const [cut] = await runAlertPass(NOW + 60)
    expect(cut).toMatchObject({ type: 'battery_tamper', severity: 'Critical', title: 'Battery cut' })
    telemetry = { 101: { 'external.powersource.status': true, timestamp: NOW + 400 } }
    await runAlertPass(NOW + 420)
    const row = await prisma.alertEvent.findUnique({ where: { id: cut.id } })
    expect(row.occurredAt.getTime()).toBe((NOW + 40) * 1000)
    expect(row).toMatchObject({ durationSec: 360, peakValue: null })
  })

  it('a tracker without the flag never raises Tamper', async () => {
    await prisma.alert.create({ data: { name: 'Tamper', type: 'tamper', bgId: fx.bgA1a.id, severity: 'High', params: {}, allVehicles: true } })
    telemetry = { 101: { 'position.speed': 40, timestamp: NOW - 20 } }
    expect(await runAlertPass(NOW)).toHaveLength(0)
    telemetry = { 101: { 'position.speed': 40, timestamp: NOW + 40 } }
    expect(await runAlertPass(NOW + 60)).toHaveLength(0)
  })

  it('accepts the three new types on a rule', async () => {
    for (const type of ['tamper', 'battery_tamper', 'panic']) {
      const res = await request(app).post('/api/alerts').set(auth(fx.tokens.bgUserA1a)).send({ bgId: fx.bgA1a.id, allVehicles: true, name: type, type, severity: 'High' })
      expect(res.status).toBe(201)
    }
  })
})
