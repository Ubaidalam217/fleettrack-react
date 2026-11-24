/**
 * Fuel calibrations (routes/fuel.js, lib/fuel.js): apply to one or many
 * vehicles, history kept, per-row errors, scope and the screen permission,
 * and litres computed on read. Every value here is invented.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { signToken } from '../src/lib/jwt.js'
import { storeReadings } from '../src/lib/uffizio.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

const TABLE = [{ litres: 0, mv: 500 }, { litres: 100, mv: 2500 }, { litres: 50, mv: 1500 }]
const PORT = 'BLE Fuel Level #1'
const apply = (token, body) => request(app).post('/api/fuel/calibrations').set(auth(token)).send(body)

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

const reading = (vehicleId, raw, minAgo = 5, port = PORT) =>
  prisma.fuelReading.create({ data: { vehicleId, port, raw, ts: new Date(Date.now() - minAgo * 60_000), ign: false } })

describe('applying a calibration', () => {
  it('applies one table to several vehicles and converts their readings on read', async () => {
    const { v1, v2 } = fx.vehicles
    await reading(v1.id, 1000)
    await reading(v2.id, 30022) // another scale: no litres, not invented
    const res = await apply(fx.tokens.bgUserA1a, { vehicleIds: [v1.id, v2.id], method: 'PORT', port: PORT, tankCapacityL: 100, points: TABLE, fileName: 'cal.xlsx' })
    expect(res.status).toBe(201)
    expect(res.body.data.applied).toHaveLength(2)
    expect(res.body.data.applied[0]).toMatchObject({ method: 'PORT', port: PORT, tankCapacityL: 100, active: true, fileName: 'cal.xlsx', createdByName: expect.any(String) })
    expect(res.body.data.applied[0].points.map(p => p.mv)).toEqual([500, 1500, 2500])

    const one = await request(app).get(`/api/fuel/vehicles/${v1.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(one.status).toBe(200)
    expect(one.body.data.ports).toEqual([expect.objectContaining({ port: PORT, raw: 1000, litres: 25, flag: null })])
    const two = await request(app).get(`/api/fuel/vehicles/${v2.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(two.body.data.ports[0]).toMatchObject({ raw: 30022, litres: null, flag: 'out_of_range' })

    const ov = await request(app).get('/api/fuel/overview').set(auth(fx.tokens.bgUserA1a))
    expect(ov.body.data.map(r => r.vehicleId).sort()).toEqual([v1.id, v2.id].sort())
  })

  it('keeps the replaced calibration as history', async () => {
    const { v1 } = fx.vehicles
    await apply(fx.tokens.bgUserA1a, { vehicleIds: [v1.id], method: 'PORT', port: PORT, points: TABLE })
    await apply(fx.tokens.bgUserA1a, { vehicleIds: [v1.id], method: 'CAN', tankCapacityL: 300 })
    const rows = await prisma.fuelCalibration.findMany({ where: { vehicleId: v1.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map(r => [r.method, r.active, !!r.replacedAt])).toEqual([['PORT', false, true], ['CAN', true, false]])
    const one = await request(app).get(`/api/fuel/vehicles/${v1.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(one.body.data.calibration).toMatchObject({ method: 'CAN', port: 'can', tankCapacityL: 300, points: [] })
    expect(one.body.data.history).toHaveLength(1)

    // Removing it keeps it too.
    const del = await request(app).delete(`/api/fuel/calibrations/${rows[1].id}`).set(auth(fx.tokens.bgUserA1a))
    expect(del.status).toBe(200)
    expect(await prisma.fuelCalibration.count({ where: { vehicleId: v1.id } })).toBe(2)
    expect(await prisma.fuelCalibration.count({ where: { vehicleId: v1.id, active: true } })).toBe(0)
  })

  it('points at the bad row', async () => {
    const res = await apply(fx.tokens.bgUserA1a, {
      vehicleIds: [fx.vehicles.v1.id], method: 'AIN1',
      points: [{ litres: 0, mv: 500, row: 2 }, { litres: 30, mv: 900, row: 3 }, { litres: 20, mv: 1300, row: 4 }],
    })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/^Row 4: .*only rise or only fall/)
    expect(res.body.error.details).toHaveProperty('points.4')
    expect(await prisma.fuelCalibration.count()).toBe(0)
  })

  it('CAN needs the tank capacity; a blank one stays null', async () => {
    const res = await apply(fx.tokens.bgUserA1a, { vehicleIds: [fx.vehicles.v1.id], method: 'CAN', tankCapacityL: null })
    expect(res.status).toBe(400)
    expect(res.body.error.details).toHaveProperty('tankCapacityL')
    const port = await apply(fx.tokens.bgUserA1a, { vehicleIds: [fx.vehicles.v1.id], method: 'PORT', port: '', points: TABLE })
    expect(port.status).toBe(400)
    expect(port.body.error.details).toHaveProperty('port')
  })
})

describe('who may', () => {
  it('only on vehicles of one’s own scope, and not as a sub-user', async () => {
    const other = await apply(fx.tokens.bgUserA1a, { vehicleIds: [fx.vehicles.v1.id, fx.vehicles.v5.id], method: 'PORT', port: PORT, points: TABLE })
    expect(other.status).toBe(404)
    expect(await prisma.fuelCalibration.count()).toBe(0) // all or nothing
    const sub = await apply(fx.tokens.subUserA1a, { vehicleIds: [fx.vehicles.v1.id], method: 'PORT', port: PORT, points: TABLE })
    expect(sub.status).toBe(403)
    const read = await request(app).get(`/api/fuel/vehicles/${fx.vehicles.v5.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(read.status).toBe(404)
  })

  it('needs the Fuel calibration screen at Edit', async () => {
    const viewer = await prisma.user.update({ where: { id: fx.users.bgUserA1a.id }, data: { screenAccess: { '/settings/fuel': 'view' } } })
    const res = await apply(signToken(viewer), { vehicleIds: [fx.vehicles.v1.id], method: 'PORT', port: PORT, points: TABLE })
    expect(res.status).toBe(403)
  })
})

describe('readings stored with litres', () => {
  it('a new reading gets the litres of the calibration in use', async () => {
    const v = fx.vehicles.v1
    await apply(fx.tokens.bgUserA1a, { vehicleIds: [v.id], method: 'PORT', port: PORT, points: TABLE })
    const n = await storeReadings(
      [{ imei: v.imei, ts: Date.now() - 1000, ign: true, lat: null, lng: null, speed: 0, fuel: [{ port: PORT, raw: 2000 }, { port: 'Other', raw: 2000 }] }],
      new Map([[v.imei, { id: v.id }]]),
    )
    expect(n).toBe(2)
    const rows = await prisma.fuelReading.findMany({ where: { vehicleId: v.id }, orderBy: { port: 'asc' } })
    expect(rows.map(r => [r.port, r.litres])).toEqual([[PORT, 75], ['Other', null]])
  })
})
