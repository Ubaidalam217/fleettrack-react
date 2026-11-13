/**
 * Driver Management phases 2-4: assignment history, incidents, the fatigue
 * rule, crediting trips to drivers, and the performance / risk report.
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
const P = await import('../src/lib/driverPerformance.js')
const { createDriverHistory } = await import('../../src/utils/driverHistory.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
/** deviceId -> messages the mocked Flespi returns. */
let flespiMessages = {}

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  flespiMessages = {}
  vi.stubGlobal('fetch', async url => {
    const u = String(url)
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    let m
    if ((m = /\/gw\/devices\/(\d+)\/messages/.exec(u))) return json({ result: flespiMessages[m[1]] ?? [] })
    if (u.includes('/gw/devices/all')) {
      return json({ result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, configuration: { ident: `86307101123450${i + 1}` } })) })
    }
    return json({ result: [] })
  })
})

afterEach(() => vi.unstubAllGlobals())

const A = () => auth(fx.tokens.bgUserA1a)
const createDriver = body => request(app).post('/api/drivers').set(A()).send({ bgId: fx.bgA1a.id, ...body })

describe('assignment history', () => {
  it('opens and closes Primary rows as the vehicle field changes, and when a vehicle is taken over', async () => {
    const a = (await createDriver({ name: 'Ahmed', vehicleId: fx.vehicles.v1.id })).body.data
    let rows = (await request(app).get(`/api/drivers/${a.id}/assignments`).set(A())).body.data
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ role: 'Primary', endDate: null, vehicle: { id: fx.vehicles.v1.id } })

    await request(app).put(`/api/drivers/${a.id}`).set(A()).send({ name: 'Ahmed', vehicleId: fx.vehicles.v2.id })
    rows = (await request(app).get(`/api/drivers/${a.id}/assignments`).set(A())).body.data
    expect(rows.filter(r => r.endDate === null).map(r => r.vehicle.id)).toEqual([fx.vehicles.v2.id])
    expect(rows).toHaveLength(2)

    // Bilal takes v2: Ahmed's open row on it closes.
    await createDriver({ name: 'Bilal', vehicleId: fx.vehicles.v2.id })
    rows = (await request(app).get(`/api/drivers/${a.id}/assignments`).set(A())).body.data
    expect(rows.every(r => r.endDate !== null)).toBe(true)
  })

  it('adds, ends and removes a Temporary assignment; refuses one for a suspended driver', async () => {
    const d = (await createDriver({ name: 'Cover' })).body.data
    const base = `/api/drivers/${d.id}/assignments`
    const t = await request(app).post(base).set(A()).send({ vehicleId: fx.vehicles.v1.id, startDate: '2026-11-01', notes: 'Leave cover' })
    expect(t.status).toBe(201)
    expect(t.body.data).toMatchObject({ role: 'Temporary', startDate: '2026-11-01', endDate: null })
    const ended = await request(app).put(`${base}/${t.body.data.id}`).set(A()).send({ endDate: '2026-11-05' })
    expect(ended.body.data.endDate).toBe('2026-11-05')
    expect((await request(app).put(`${base}/${t.body.data.id}`).set(A()).send({ endDate: '2026-10-01' })).status).toBe(400)
    expect((await request(app).delete(`${base}/${t.body.data.id}`).set(A())).status).toBe(200)
    expect((await request(app).post(base).set(A()).send({ vehicleId: fx.vehicles.v8.id, startDate: '2026-11-01' })).status).toBe(400)

    const s = (await createDriver({ name: 'Off', status: 'Suspended' })).body.data
    expect((await request(app).post(`/api/drivers/${s.id}/assignments`).set(A()).send({ vehicleId: fx.vehicles.v1.id, startDate: '2026-11-01' })).status).toBe(400)
  })
})

describe('incidents', () => {
  it('records, lists and deletes incidents', async () => {
    const d = (await createDriver({ name: 'Ahmed' })).body.data
    const base = `/api/drivers/${d.id}/incidents`
    const i = await request(app).post(base).set(A()).send({ date: '2026-11-03', type: 'Accident', vehicleId: fx.vehicles.v1.id, description: 'Rear bumper', cost: '1500' })
    expect(i.status).toBe(201)
    expect(i.body.data).toMatchObject({ date: '2026-11-03', type: 'Accident', cost: 1500 })
    expect((await request(app).post(base).set(A()).send({ date: '2026-11-03', type: 'Alien abduction' })).status).toBe(400)
    expect((await request(app).get(base).set(A())).body.data).toHaveLength(1)
    expect((await request(app).delete(`${base}/${i.body.data.id}`).set(A())).status).toBe(200)
  })
})

describe('rules', () => {
  const T0 = Math.floor(Date.UTC(2026, 10, 5, 4, 0) / 1000) // 08:00 UAE
  const trip = (startMin, driveMin) => ({ startTs: T0 + startMin * 60, endTs: T0 + (startMin + driveMin) * 60, driveSec: driveMin * 60 })

  it('fatigue: a long first stint, a later stint with no break, and the daily limit', () => {
    const rule = { firstDriveMin: 150, breakMin: 15, driveMin: 120, dailyMaxMin: 300 }
    // 160 min first stint (over 150) · 20 min break · 130 min stint (over 120): two stint violations, 290 min ≤ 300.
    let f = P.fatigueOf([trip(0, 100), trip(105, 60), trip(185, 130)], rule)
    expect(f.violations).toBe(2)
    expect(f.daysOverLimit).toBe(0)
    // Short breaks (< 15 min) do not end a stint; 320 min total is over the day.
    f = P.fatigueOf([trip(0, 100), trip(110, 100), trip(220, 120)], { ...rule, firstDriveMin: 600 })
    expect(f.daysOverLimit).toBe(1)
  })

  it('credits a trip to the tag holder, else the temporary cover, else the primary driver', () => {
    const ctx = {
      history: createDriverHistory({
        tags: [{ driverId: 'tagged', code: 'AAAA', startDate: null, endDate: null }],
        assignments: [
          { driverId: 'primary', vehicleId: 'v', role: 'Primary', startDate: new Date('2026-01-01'), endDate: null },
          { driverId: 'cover', vehicleId: 'v', role: 'Temporary', startDate: new Date('2026-11-04'), endDate: new Date('2026-11-06') },
        ],
      }),
    }
    const at = d => Math.floor(Date.parse(d) / 1000)
    expect(P.creditTrip({ startTs: at('2026-11-05T08:00:00Z'), ibutton: 'AAAA' }, 'v', ctx)).toMatchObject({ driverId: 'tagged', via: 'tag' })
    expect(P.creditTrip({ startTs: at('2026-11-05T08:00:00Z'), ibutton: 'BBBB' }, 'v', ctx)).toMatchObject({ driverId: null, tag: 'BBBB' })
    expect(P.creditTrip({ startTs: at('2026-11-05T08:00:00Z') }, 'v', ctx)).toMatchObject({ driverId: 'cover', via: 'assignment' })
    expect(P.creditTrip({ startTs: at('2026-11-10T08:00:00Z') }, 'v', ctx)).toMatchObject({ driverId: 'primary' })
    expect(P.creditTrip({ startTs: at('2025-01-01T08:00:00Z') }, 'v', ctx)).toMatchObject({ driverId: null, via: 'none' })
  })

  it('scores safety and reads the risk levels and trend', () => {
    const t = { distanceKm: 100, driveSec: 7200, idleSec: 600, overSpeedCount: 2, hbCount: 1, haCount: 0, hcCount: 0, xiCount: 0 }
    expect(P.safetyScore(t, { violations: 0 }, 0)).toBe(86) // 100 − 2×5 − 1×4
    expect(P.safetyScore({ ...t, distanceKm: 0.2 }, null, 0)).toBeNull()
    expect(P.safetyScore(t, { violations: 1 }, 1)).toBe(74)
    const r = P.riskProfile(t, { violations: 0, daysOverLimit: 0 }, 0, 86, 95)
    expect(r).toMatchObject({ trend: 'Deteriorating', fatigueRisk: 'Low' })
    expect(P.riskProfile({ ...t, idleSec: 7200 }, { violations: 3, daysOverLimit: 1 }, 1, 50, 70)).toMatchObject({ accidentRisk: 'High', fatigueRisk: 'High' })
  })
})

describe('GET /api/driver-performance', () => {
  const T0 = Math.floor(Date.UTC(2026, 10, 5, 4, 0) / 1000)
  const msg = (dt, o = {}) => ({
    'device.id': 101, timestamp: T0 + dt, 'position.latitude': 24.4 + dt * 0.00008, 'position.longitude': 54.4,
    'position.speed': 40, 'engine.ignition.status': true, ...o,
  })

  it('credits tagged trips to the tag holder, untagged ones to the assigned driver, and lists unknown tags', async () => {
    const assigned = (await createDriver({ name: 'Assigned', vehicleId: fx.vehicles.v1.id })).body.data
    const tagged = (await createDriver({ name: 'Tagged', ibuttonCode: '94000001D9DF0801' })).body.data
    // The assignment was opened now; back-date it so it covers the trips.
    await prisma.driverAssignment.updateMany({ where: { driverId: assigned.id }, data: { startDate: new Date('2026-01-01') } })
    flespiMessages['101'] = [
      // trip 1: tagged
      msg(0, { 'ibutton.code': '94000001D9DF0801' }), msg(600), msg(660, { 'engine.ignition.status': false, 'position.speed': 0 }),
      // trip 2: no tag → assigned driver
      msg(3600), msg(4200), msg(4260, { 'engine.ignition.status': false, 'position.speed': 0 }),
      // trip 3: a tag nobody holds → unidentified
      msg(7200, { 'ibutton.code': 'BEEF0001' }), msg(7800), msg(7860, { 'engine.ignition.status': false, 'position.speed': 0 }),
    ]
    const res = await request(app).get('/api/driver-performance')
      .query({ from: new Date((T0 - 3600) * 1000).toISOString(), to: new Date((T0 + 86000) * 1000).toISOString() }).set(A())
    expect(res.status).toBe(200)
    const by = Object.fromEntries(res.body.data.drivers.map(d => [d.name, d]))
    expect(by.Tagged).toMatchObject({ trips: 1, identifiedBy: { tag: 1, assignment: 0 } })
    expect(by.Assigned).toMatchObject({ trips: 1, identifiedBy: { tag: 0, assignment: 1 } })
    expect(by.Tagged.safetyScore).not.toBeNull()
    expect(by.Tagged.trend).toBe('New')
    expect(res.body.data.unidentified[0]).toMatchObject({ trips: 1, unknownTags: ['BEEF0001'] })
    expect(res.body.data.fatigueRule).toMatchObject({ firstDriveMin: 150, breakMin: 15 })
  })

  it('refuses a range over 31 days', async () => {
    const res = await request(app).get('/api/driver-performance').query({ from: '2026-09-01T00:00:00Z', to: '2026-11-01T00:00:00Z' }).set(A())
    expect(res.status).toBe(400)
  })

  it('lets an administrator change the fatigue rule, not a BG user', async () => {
    const body = { firstDriveMin: 150, breakMin: 30, driveMin: 120, dailyMaxMin: 540 }
    expect((await request(app).put('/api/driver-performance/fatigue-rule').set(A()).send(body)).status).toBe(403)
    const ok = await request(app).put('/api/driver-performance/fatigue-rule').set(auth(fx.tokens.superAdmin)).send(body)
    expect(ok.status).toBe(200)
    expect((await request(app).get('/api/driver-performance/fatigue-rule').set(A())).body.data).toMatchObject({ breakMin: 30, dailyMaxMin: 540 })
  })
})
