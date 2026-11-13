/**
 * Driver history is kept (client, 2026-11-13: "All the drivers names will stay
 * as it is, it will not replace with last one saved"): replacing a vehicle's
 * driver, moving a tag or removing a driver never renames a past trip.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, FLESPI_TOKEN: 'mock-master-token' })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
const { clearDeviceCache } = await import('../src/lib/flespi.js')
const { createDriverHistory, creditAt } = await import('../../src/utils/driverHistory.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
let flespiMessages = {}
/** Every Flespi call the routes made: driver routes must never write to Flespi. */
let flespiWrites = []

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  flespiMessages = {}
  flespiWrites = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const u = String(url)
    if ((init.method ?? 'GET') !== 'GET') flespiWrites.push(`${init.method} ${u}`)
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    let m
    if ((m = /\/gw\/devices\/(\d+)\/messages/.exec(u))) return json({ result: flespiMessages[m[1]] ?? [] })
    if (u.includes('/gw/devices/all')) {
      return json({ result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, configuration: { ident: `86307101123450${i + 1}` } })) })
    }
    return json({ result: [] })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(flespiWrites).toEqual([])
})

const A = () => auth(fx.tokens.bgUserA1a)
const createDriver = body => request(app).post('/api/drivers').set(A()).send({ bgId: fx.bgA1a.id, ...body })
const historyOf = async (token = fx.tokens.bgUserA1a) => (await request(app).get('/api/drivers/history').set(auth(token))).body.data
const sec = d => Math.floor(new Date(d).getTime() / 1000)

describe('replacing a vehicle’s driver', () => {
  it('keeps the old driver on the trips before the swap and the new one after', async () => {
    const ubaid = (await createDriver({ name: 'Ubaid', vehicleId: fx.vehicles.v1.id })).body.data
    // Ubaid's assignment is back-dated so it covers last week.
    await prisma.driverAssignment.updateMany({ where: { driverId: ubaid.id }, data: { startDate: new Date('2026-11-01T00:00:00Z') } })
    const before = sec(Date.now()) - 3600
    const ali = (await createDriver({ name: 'Ali', vehicleId: fx.vehicles.v1.id })).body.data
    const after = sec(Date.now()) + 60

    const h = createDriverHistory(await historyOf())
    expect(h.driver(h.assignedAt(fx.vehicles.v1.id, before)).name).toBe('Ubaid')
    expect(h.driver(h.assignedAt(fx.vehicles.v1.id, after)).name).toBe('Ali')
    expect(h.assignedAt(fx.vehicles.v1.id, sec('2026-10-01'))).toBeNull()
    // Ubaid lost the vehicle, not his history.
    expect((await request(app).get(`/api/drivers/${ubaid.id}`).set(A())).body.data.vehicleId).toBeNull()
    expect(ali.vehicleId).toBe(fx.vehicles.v1.id)
  })
})

describe('removing a driver', () => {
  it('archives a driver with history: hidden from the list, vehicle and tag freed, name kept for its trips', async () => {
    const d = (await createDriver({ name: 'Ubaid', vehicleId: fx.vehicles.v1.id, ibuttonCode: '01AB02CD' })).body.data
    await prisma.driverAssignment.updateMany({ where: { driverId: d.id }, data: { startDate: new Date('2026-11-01T00:00:00Z') } })
    const drove = sec(Date.now()) - 600

    const del = await request(app).delete(`/api/drivers/${d.id}`).set(A())
    expect(del.status).toBe(200)
    expect(del.body.data).toMatchObject({ id: d.id, removed: 'archived' })

    const row = await prisma.driver.findUnique({ where: { id: d.id } })
    expect(row).toMatchObject({ name: 'Ubaid', vehicleId: null, ibuttonCode: null })
    expect(row.deletedAt).not.toBeNull()
    expect(row.deletedBy).toBeTruthy()
    expect((await request(app).get('/api/drivers').set(A())).body.data.map(x => x.id)).not.toContain(d.id)
    expect((await request(app).get('/api/drivers').query({ removed: '1' }).set(A())).body.data.map(x => x.name)).toEqual(['Ubaid'])

    // The trips Ubaid drove — tagged or not — still name him.
    const payload = await historyOf()
    const h = createDriverHistory(payload)
    expect(payload.drivers.find(x => x.id === d.id)).toMatchObject({ name: 'Ubaid', removed: true })
    expect(creditAt(h, { vehicleId: fx.vehicles.v1.id, ts: drove })).toEqual({ driverId: d.id, via: 'assignment' })
    expect(creditAt(h, { vehicleId: fx.vehicles.v1.id, tag: '01AB02CD', ts: drove })).toEqual({ driverId: d.id, via: 'tag' })
    // After the removal nobody is assigned and the tag is nobody's.
    const later = sec(Date.now()) + 60
    expect(creditAt(h, { vehicleId: fx.vehicles.v1.id, ts: later }).driverId).toBeNull()
    expect(creditAt(h, { vehicleId: fx.vehicles.v1.id, tag: '01AB02CD', ts: later }).driverId).toBeNull()

    // The vehicle and the tag can go to someone else; Ubaid's history stays his.
    const next = await createDriver({ name: 'Ali', vehicleId: fx.vehicles.v1.id, ibuttonCode: '01AB02CD' })
    expect(next.status).toBe(201)
    const h2 = createDriverHistory(await historyOf())
    expect(h2.tagHolderAt('01AB02CD', drove)).toBe(d.id)
    expect(h2.tagHolderAt('01AB02CD', sec(Date.now()) + 60)).toBe(next.body.data.id)
    expect(await prisma.driverAssignment.count({ where: { driverId: d.id } })).toBe(1)

    // A removed driver is read-only until restored; restoring brings no vehicle or tag back.
    expect((await request(app).put(`/api/drivers/${d.id}`).set(A()).send({ name: 'Ubaid 2' })).status).toBe(409)
    expect((await request(app).post(`/api/drivers/${d.id}/assignments`).set(A()).send({ vehicleId: fx.vehicles.v2.id, startDate: '2026-11-20' })).status).toBe(409)
    const back = await request(app).post(`/api/drivers/${d.id}/restore`).set(A())
    expect(back.status).toBe(200)
    expect(back.body.data).toMatchObject({ deletedAt: null, vehicleId: null, ibuttonCode: null })
    expect((await request(app).get('/api/drivers').set(A())).body.data.map(x => x.name).sort()).toEqual(['Ali', 'Ubaid'])
  })

  it('ends running Temporary cover now and drops cover that had not begun', async () => {
    const d = (await createDriver({ name: 'Cover' })).body.data
    const base = `/api/drivers/${d.id}/assignments`
    const running = (await request(app).post(base).set(A()).send({ vehicleId: fx.vehicles.v2.id, startDate: '2026-01-01' })).body.data
    const future = (await request(app).post(base).set(A()).send({ vehicleId: fx.vehicles.v2.id, startDate: '2099-01-01', endDate: '2099-01-05' })).body.data
    const past = (await request(app).post(base).set(A()).send({ vehicleId: fx.vehicles.v3.id, startDate: '2026-01-01', endDate: '2026-01-05' })).body.data
    expect((await request(app).delete(`/api/drivers/${d.id}`).set(A())).body.data.removed).toBe('archived')
    const rows = await prisma.driverAssignment.findMany({ where: { driverId: d.id } })
    expect(rows.map(r => r.id).sort()).toEqual([running.id, past.id].sort())
    expect(rows.find(r => r.id === running.id).endDate).not.toBeNull()
    expect(rows.find(r => r.id === past.id).endDate.toISOString().slice(0, 10)).toBe('2026-01-05')
    expect(future.id).toBeTruthy()
  })

  it('deletes a driver with no history at all', async () => {
    const d = (await createDriver({ name: 'Typo' })).body.data
    const del = await request(app).delete(`/api/drivers/${d.id}`).set(A())
    expect(del.body.data).toMatchObject({ id: d.id, removed: 'deleted' })
    expect(await prisma.driver.count({ where: { id: d.id } })).toBe(0)
  })

  it('skips a removed driver in the licence expiry alert', async () => {
    const d = (await createDriver({ name: 'Expiring', vehicleId: fx.vehicles.v1.id, licenseExpiry: '2026-11-20' })).body.data
    const kept = (await createDriver({ name: 'Kept', licenseExpiry: '2026-11-20' })).body.data
    await request(app).delete(`/api/drivers/${d.id}`).set(A())
    await prisma.alert.updateMany({ data: { status: 'Inactive' } })
    await prisma.alert.create({ data: { name: 'Licence', type: 'license_expiry', bgId: fx.bgA1a.id, allVehicles: true, params: { days: 30 } } })
    const { runAlertPass } = await import('../src/lib/alertEngine.js')
    const events = await runAlertPass(sec('2026-11-10T06:00:00Z'))
    expect(events.some(e => e.driverId === kept.id)).toBe(true)
    expect(events.filter(e => e.driverId === d.id)).toEqual([])
  })
})

describe('moving a tag', () => {
  it('keeps the old holder on the reads before the move', async () => {
    const a = (await createDriver({ name: 'Ubaid', ibuttonCode: 'BEEF0001' })).body.data
    const before = sec(Date.now()) - 60
    // A first holder owns the tag's earlier reads too (registering an unregistered ID).
    const first = createDriverHistory(await historyOf())
    expect(first.tagHolderAt('BEEF0001', sec('2026-01-01'))).toBe(a.id)

    expect((await request(app).put(`/api/drivers/${a.id}`).set(A()).send({ name: 'Ubaid', ibuttonCode: '' })).status).toBe(200)
    const b = (await createDriver({ name: 'Ali', ibuttonCode: 'BEEF0001' })).body.data
    const after = sec(Date.now()) + 60

    const h = createDriverHistory(await historyOf())
    expect(h.tagHolderAt('BEEF0001', sec('2026-01-01'))).toBe(a.id)
    expect(h.tagHolderAt('BEEF0001', before)).toBe(a.id)
    expect(h.tagHolderAt('BEEF0001', after)).toBe(b.id)
    const rows = await prisma.driverTagHistory.findMany({ where: { code: 'BEEF0001' }, orderBy: { createdAt: 'asc' } })
    expect(rows.map(r => [r.driverId, r.startDate === null, r.endDate === null])).toEqual([[a.id, true, false], [b.id, false, true]])
  })

  it('changing a driver’s own tag closes the old code and opens the new one', async () => {
    const a = (await createDriver({ name: 'Ubaid', ibuttonCode: 'AAAA1111' })).body.data
    await request(app).put(`/api/drivers/${a.id}`).set(A()).send({ name: 'Ubaid', ibuttonCode: 'BBBB2222' })
    await request(app).put(`/api/drivers/${a.id}`).set(A()).send({ name: 'Ubaid renamed', ibuttonCode: 'BBBB2222' })
    const rows = await prisma.driverTagHistory.findMany({ where: { driverId: a.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map(r => [r.code, r.endDate === null])).toEqual([['AAAA1111', false], ['BBBB2222', true]])
  })
})

describe('GET /api/drivers/history', () => {
  it('is scoped: another BG sees none of it; a sub-user sees its vehicles’ drivers, removed ones too', async () => {
    const d = (await createDriver({ name: 'Ubaid', vehicleId: fx.vehicles.v1.id, ibuttonCode: 'CAFE0001' })).body.data
    await createDriver({ name: 'Elsewhere', vehicleId: fx.vehicles.v3.id })
    await request(app).delete(`/api/drivers/${d.id}`).set(A())

    const other = await historyOf(fx.tokens.bgUserB1a)
    expect(other).toEqual({ drivers: [], assignments: [], tags: [] })

    const sub = await historyOf(fx.tokens.subUserA1a)
    expect(sub.drivers.map(x => x.name)).toEqual(['Ubaid'])
    expect(sub.assignments.every(a => [fx.vehicles.v1.id, fx.vehicles.v2.id].includes(a.vehicleId))).toBe(true)
    expect(sub.tags.map(t => t.code)).toEqual(['CAFE0001'])

    const ranged = (await request(app).get('/api/drivers/history').query({ from: '2020-01-01T00:00:00Z', to: '2020-02-01T00:00:00Z' }).set(A())).body.data
    expect(ranged.assignments).toEqual([])
    expect(ranged.tags).toHaveLength(1) // a tag held "since always" overlaps any period
    expect((await request(app).get('/api/drivers/history').query({ from: 'yesterday' }).set(A())).status).toBe(400)
  })
})

describe('Driver Performance', () => {
  const T0 = Math.floor(Date.UTC(2026, 10, 5, 4, 0) / 1000) // 5 Nov 08:00 UAE
  const msg = (dt, o = {}) => ({
    'device.id': 101, timestamp: T0 + dt, 'position.latitude': 24.4 + dt * 0.00008, 'position.longitude': 54.4,
    'position.speed': 40, 'engine.ignition.status': true, ...o,
  })

  it('credits a replaced and then removed driver with the trips they drove', async () => {
    const ubaid = (await createDriver({ name: 'Ubaid', vehicleId: fx.vehicles.v1.id })).body.data
    await prisma.driverAssignment.updateMany({ where: { driverId: ubaid.id }, data: { startDate: new Date('2026-11-01T00:00:00Z') } })
    await createDriver({ name: 'Ali', vehicleId: fx.vehicles.v1.id }) // takes v1 now, after the trips
    await request(app).delete(`/api/drivers/${ubaid.id}`).set(A())
    flespiMessages['101'] = [msg(0), msg(600), msg(660, { 'engine.ignition.status': false, 'position.speed': 0 })]

    const res = await request(app).get('/api/driver-performance')
      .query({ from: new Date((T0 - 3600) * 1000).toISOString(), to: new Date((T0 + 86000) * 1000).toISOString() }).set(A())
    expect(res.status).toBe(200)
    const by = Object.fromEntries(res.body.data.drivers.map(d => [d.name, d]))
    expect(by.Ubaid).toMatchObject({ trips: 1, removed: true, nextExpiry: null })
    expect(by.Ali).toMatchObject({ trips: 0, removed: false })
  })
})
