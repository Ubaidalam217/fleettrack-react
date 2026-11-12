/**
 * The vehicle's odometer correction (PUT /api/vehicles/:id/odometer, GET
 * /api/vehicles/odometers), its effect on distance reminders, and the Bulk
 * Object Update's PATCH /api/vehicles/:id/details. Flespi is mocked as in
 * reminders.test.js; nothing may be written to it.
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
import { auth, resetDb, seedFixture } from './factories.js'
import { clearDeviceCache } from '../src/lib/flespi.js'

const app = createApp()
let fx
/** deviceId -> telemetry (device 101 is v1, 102 is v2…). */
let telemetry = {}
let writes = []

function installFlespiMock() {
  vi.stubGlobal('fetch', (url, init = {}) => {
    const u = String(url)
    if (init.method && init.method !== 'GET') writes.push(`${init.method} ${u}`)
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
      return json({ result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, configuration: { ident: `86307101123450${i + 1}` } })) })
    }
    return json({ result: [] })
  })
}

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  telemetry = { 101: { 'vehicle.mileage': 1200.5, timestamp: 1_800_000_000 } }
  writes = []
  installFlespiMock()
})
afterEach(() => {
  vi.unstubAllGlobals()
  clearDeviceCache()
})

const setOdo = (id, reading, token = fx.tokens.bgUserA1a) =>
  request(app).put(`/api/vehicles/${id}/odometer`).set(auth(token)).send({ reading })

describe('vehicle odometer correction', () => {
  it('keeps reading − tracker as the correction and returns both readings', async () => {
    const res = await setOdo(fx.vehicles.v1.id, 150000)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ deviceKm: 1200.5, offsetKm: 148799.5, vehicleKm: 150000 })
    expect(res.body.data.setBy).toBeTruthy()

    telemetry[101]['vehicle.mileage'] = 1300.5 // the tracker drives on 100 km
    clearDeviceCache()
    const list = await request(app).get('/api/vehicles/odometers').set(auth(fx.tokens.bgUserA1a))
    expect(list.status).toBe(200)
    const v1 = list.body.data.find(r => r.vehicleId === fx.vehicles.v1.id)
    expect(v1.vehicleKm).toBe(150100)
    expect(writes).toEqual([])
  })

  it('refuses when the tracker has no odometer, and a bad reading', async () => {
    const none = await setOdo(fx.vehicles.v2.id, 5000)
    expect(none.status).toBe(400)
    expect(none.body.error.details.reading).toBeTruthy()
    expect((await setOdo(fx.vehicles.v1.id, -1)).status).toBe(400)
    expect((await setOdo(fx.vehicles.v1.id, 'abc')).status).toBe(400)
  })

  it('is scoped and read-only for sub-users', async () => {
    expect((await setOdo(fx.vehicles.v5.id, 100, fx.tokens.bgUserA1a)).status).toBe(404)
    expect((await setOdo(fx.vehicles.v1.id, 100, fx.tokens.subUserA1a)).status).toBe(403)
    const list = await request(app).get('/api/vehicles/odometers').set(auth(fx.tokens.bgUserA1a))
    expect(list.body.data.map(r => r.vehicleId).sort()).toEqual(
      [fx.vehicles.v1, fx.vehicles.v2, fx.vehicles.v3, fx.vehicles.v4].map(v => v.id).sort()
    )
  })

  it('moves distance reminder cycles with the correction, so km since the start do not jump', async () => {
    const rule = await prisma.reminderRule.create({
      data: {
        bgId: fx.bgA1a.id, name: 'Service', type: 'Service', recurring: true, byDistance: true, everyKm: 10000,
        vehicles: { create: [{ vehicleId: fx.vehicles.v1.id, startDate: new Date(), startOdometer: 1000 }] },
      },
      include: { vehicles: true },
    })
    await setOdo(fx.vehicles.v1.id, 150000) // correction 148,799.5
    const rv = await prisma.reminderVehicle.findUnique({ where: { id: rule.vehicles[0].id } })
    expect(rv.startOdometer).toBeCloseTo(149799.5, 3)
    await setOdo(fx.vehicles.v1.id, 150100) // +100 more
    const rv2 = await prisma.reminderVehicle.findUnique({ where: { id: rule.vehicles[0].id } })
    expect(rv2.startOdometer).toBeCloseTo(149899.5, 3)
  })
})

describe('PATCH /api/vehicles/:id/details', () => {
  it('changes only the fields sent, never Flespi, and logs a branch move', async () => {
    const v = fx.vehicles.v1
    const res = await request(app).patch(`/api/vehicles/${v.id}/details`).set(auth(fx.tokens.bgUserA1a))
      .send({ make: 'Scania', branchId: fx.branches.bay1.id })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ make: 'Scania', model: 'FH16', branchId: fx.branches.bay1.id, plateNo: v.plateNo })
    const moves = await prisma.vehicleMove.findMany({ where: { vehicleId: v.id, level: 'branch' } })
    expect(moves.length).toBe(1)
    expect(writes).toEqual([])
  })

  it('refuses a branch of another business group', async () => {
    const res = await request(app).patch(`/api/vehicles/${fx.vehicles.v1.id}/details`).set(auth(fx.tokens.bgUserA1a))
      .send({ branchId: fx.branches.sharjah.id })
    expect(res.status).toBe(400)
  })
})
