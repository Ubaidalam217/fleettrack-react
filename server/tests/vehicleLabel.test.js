/**
 * One name per vehicle (lib/vehicleLabel.js, client 2026-11-16: "Vehicles
 * numbers should be auto updated everywhere"): our plate, fleet no., the Flespi
 * name, the IMEI — and what the API shows next to old alerts and on share links
 * is the vehicle's name now. Flespi is stubbed; nothing here may write to it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, FLESPI_TOKEN: 'mock-master-token' })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { clearDeviceCache } = await import('../src/lib/flespi.js')
const { __clearLocationCache } = await import('../src/routes/locationShares.js')
const { vehicleLabel, currentLabelForDevice } = await import('../src/lib/vehicleLabel.js')
const { deviceName } = await import('../src/lib/flespiDevices.js')
const { default: prisma } = await import('../src/prisma.js')
import { auth, resetDb, seedFixture } from './factories.js'

describe('vehicleLabel', () => {
  it('takes the plate, then the fleet no., then the Flespi name, then the IMEI', () => {
    expect(vehicleLabel({ plateNo: 'AD 12411', fleetNo: 'FL-8', imei: '8646' }, 'Test Bench')).toBe('AD 12411')
    expect(vehicleLabel({ plateNo: '', fleetNo: 'FL-8', imei: '8646' }, 'Test Bench')).toBe('FL-8')
    expect(vehicleLabel({ plateNo: null, fleetNo: '  ', imei: '8646' }, 'Test Bench')).toBe('Test Bench')
    expect(vehicleLabel({ plateNo: null, fleetNo: null, imei: '8646' })).toBe('8646')
    expect(vehicleLabel(null, 'Test Bench')).toBe('Test Bench')
    expect(vehicleLabel(null)).toBe('')
  })

  it('trims, and is what a Flespi device is named after on save', () => {
    expect(vehicleLabel({ plateNo: ' AD 149 ' })).toBe('AD 149')
    expect(deviceName({ plateNo: '', fleetNo: 'FL-2', imei: '1' })).toBe('FL-2')
    expect(deviceName({ plateNo: ' ', fleetNo: '', imei: '863257062083821' })).toBe('863257062083821')
  })
})

describe('the name now, on old alerts and share links', () => {
  const app = createApp()
  let fx
  let writes

  beforeEach(async () => {
    await resetDb()
    fx = await seedFixture()
    clearDeviceCache()
    __clearLocationCache()
    writes = []
    vi.stubGlobal('fetch', async (url, init = {}) => {
      const u = String(url)
      if ((init.method ?? 'GET').toUpperCase() !== 'GET') writes.push(`${init.method} ${u}`)
      const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u.includes('/gw/devices/all')) {
        return json({ result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, name: `Flespi ${i + 1}`, configuration: { ident: `86307101123450${i + 1}` } })) })
      }
      if (/\/gw\/devices\/\d+\/telemetry\//.test(u)) {
        return json({ result: [{ id: 101, telemetry: { 'position.latitude': { value: 24.45, ts: 1 }, 'position.longitude': { value: 54.37, ts: 1 }, timestamp: { value: 1, ts: 1 } } }] })
      }
      return json({ result: [] })
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  const rename = (v, plateNo) => prisma.vehicle.update({ where: { id: v.id }, data: { plateNo } })

  it('GET /api/alert-events carries the vehicle label now, and keeps the message as it was sent', async () => {
    const v1 = fx.vehicles.v1
    await prisma.alertEvent.create({
      data: { bgId: v1.bgId, vehicleId: v1.id, deviceId: 101, type: 'overspeed', severity: 'High', title: 'Speed', message: 'PLATE-1: Over speed: 130 km/h (limit 120 km/h)' },
    })
    await rename(v1, 'AD 99999')
    const res = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(200)
    const [e] = res.body.data
    expect(e.vehicleLabel).toBe('AD 99999')
    expect(e.vehicle.plateNo).toBe('AD 99999')
    expect(e.message).toBe('PLATE-1: Over speed: 130 km/h (limit 120 km/h)')
  })

  it('a vehicle with no plate is labelled by its fleet no.', async () => {
    const v1 = fx.vehicles.v1
    await prisma.vehicle.update({ where: { id: v1.id }, data: { plateNo: null, fleetNo: 'FL-77' } })
    await prisma.alertEvent.create({ data: { bgId: v1.bgId, vehicleId: v1.id, type: 'ignition', severity: 'Low', title: 'Ign', message: 'x' } })
    const res = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(res.body.data[0].vehicleLabel).toBe('FL-77')
  })

  it('a public live-location link shows the vehicle number now', async () => {
    const share = await prisma.locationShare.create({
      data: { token: 'tok_location_aaaaaaaaaaaaaaaaaaaaaa', deviceId: 101, vehicleName: 'Test Bench', expiresAt: new Date(Date.now() + 3_600_000), createdById: fx.users?.bgUserA1a?.id ?? 'someone' },
    })
    const res = await request(app).get(`/api/public/location/${share.token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.vehicleName).toBe('PLATE-1')
    await rename(fx.vehicles.v1, 'AD 12411')
    __clearLocationCache()
    expect((await request(app).get(`/api/public/location/${share.token}`)).body.data.vehicleName).toBe('AD 12411')
  })

  it('a replay link takes the name now only when that vehicle had the tracker then', async () => {
    const make = (token, fromTs) => prisma.replayShare.create({
      data: { token, deviceId: 101, vehicleName: 'Test Bench', fromTs, toTs: fromTs + 3600, expiresAt: new Date(Date.now() + 86_400_000), points: [], pointCount: 0, createdById: 'someone' },
    })
    const later = Math.floor(Date.now() / 1000) + 600 // after v1 was registered
    const earlier = Math.floor(Date.now() / 1000) - 86_400 // before it was
    await make('tok_replay_later_aaaaaaaaaaaaaaaaaaa', later)
    await make('tok_replay_earlier_aaaaaaaaaaaaaaaaa', earlier)
    await rename(fx.vehicles.v1, 'AD 12411')

    expect((await request(app).get('/api/public/replay/tok_replay_later_aaaaaaaaaaaaaaaaaaa')).body.data.vehicleName).toBe('AD 12411')
    // Registered after the replay starts: maybe not the same vehicle, so the stored name.
    expect((await request(app).get('/api/public/replay/tok_replay_earlier_aaaaaaaaaaaaaaaaa')).body.data.vehicleName).toBe('Test Bench')

    // A tracker change recorded after the replay starts: the stored name too.
    await prisma.vehicleMove.create({ data: { bgId: fx.vehicles.v1.bgId, vehicleId: fx.vehicles.v1.id, vehicleLabel: 'AD 12411', imei: fx.vehicles.v1.imei, level: 'device', toName: 'AD 12411', movedAt: new Date((later + 60) * 1000) } })
    expect((await request(app).get('/api/public/replay/tok_replay_later_aaaaaaaaaaaaaaaaaaa')).body.data.vehicleName).toBe('Test Bench')
  })

  it('falls back to the stored name for a device with no registered vehicle', async () => {
    expect(await currentLabelForDevice(999, 'Test Bench')).toBe('Test Bench')
    expect(await currentLabelForDevice(101, 'Test Bench')).toBe('PLATE-1')
  })

  it('never writes to Flespi', async () => {
    await currentLabelForDevice(101, 'x')
    await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(writes).toEqual([])
  })
})
