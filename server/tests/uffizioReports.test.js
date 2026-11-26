/**
 * The Uffizio vehicles' Daywise months (lib/uffizioReports.js,
 * GET /api/reports/uffizio-daywise). Every name, number and IMEI is invented.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
const { __resetUffizioReports } = await import('../src/lib/uffizioReports.js')
const { signToken } = await import('../src/lib/jwt.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
let veh

// 2026-10-05 08:00 UAE.
const T0 = Date.parse('2026-10-05T04:00:00Z') / 1000

beforeEach(async () => {
  await resetDb()
  __resetUffizioReports()
  fx = await seedFixture()
  veh = await prisma.vehicle.create({
    data: { bgId: fx.bgA2.id, imei: '359990000000101', plateNo: 'ZZ 7001 Q9', dataSource: 'UFFIZIO', uffizioName: 'ZZ 7001 Q9' },
  })
  // A 20-minute drive every 2 minutes, 2 km per sample on the odometer, then parked.
  const rows = []
  for (let k = 0; k <= 10; k++) {
    rows.push({ vehicleId: veh.id, ts: new Date((T0 + k * 120) * 1000), lat: 24.4 + k * 0.018, lng: 54.5, speed: 60, ign: true, odometerKm: 1000 + 2 * k })
  }
  rows.push({ vehicleId: veh.id, ts: new Date((T0 + 11 * 120) * 1000), lat: 24.58, lng: 54.5, speed: 0, ign: false, odometerKm: 1020 })
  await prisma.uffizioPosition.createMany({ data: rows })
})

describe('GET /api/reports/uffizio-daywise', () => {
  it('works each Uffizio vehicle month out from its samples: odometer km and engine time per UAE day', async () => {
    const res = await request(app).get('/api/reports/uffizio-daywise?year=2026&month=10').set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    const d = res.body.data.devices.find(x => x.deviceId === `uffizio:${veh.id}`)
    expect(d.distanceKm[5]).toBeCloseTo(20, 6)
    expect(d.totalKm).toBeCloseTo(20, 6)
    expect(d.ignitionSec[5]).toBe(11 * 120)
    expect(d.estimatedKm[5]).toBe(0)
    expect(d.samplesPerDay[5]).toBe(12)
    expect(d.noData).toBe(false)
  })

  it('a month without samples is No data', async () => {
    const res = await request(app).get('/api/reports/uffizio-daywise?year=2026&month=9').set(auth(fx.tokens.superAdmin))
    const d = res.body.data.devices.find(x => x.deviceId === `uffizio:${veh.id}`)
    expect(d.noData).toBe(true)
    expect(d.totalKm).toBe(0)
  })

  it('is scoped: another BG sees none, the fuel BG its own', async () => {
    const other = await request(app).get('/api/reports/uffizio-daywise?year=2026&month=10').set(auth(fx.tokens.bgUserA1a))
    expect(other.status).toBe(200)
    expect(other.body.data.devices).toEqual([])
    const user = await prisma.user.create({ data: { email: 'a2-daywise@example.test', passwordHash: 'x', role: 'BG_USER', bgId: fx.bgA2.id, mustChangePassword: false } })
    const mine = await request(app).get('/api/reports/uffizio-daywise?year=2026&month=10').set(auth(signToken(user)))
    expect(mine.body.data.devices.map(x => x.deviceId)).toEqual([`uffizio:${veh.id}`])
  })

  it('rejects a bad month', async () => {
    expect((await request(app).get('/api/reports/uffizio-daywise?year=2026&month=13').set(auth(fx.tokens.superAdmin))).status).toBe(400)
  })
})

describe('GET /api/alert-events?vehicleIds (events of vehicles without a tracker id)', () => {
  it('finds an Uffizio vehicle by vehicle, alone or with device ids', async () => {
    const base = { bgId: fx.bgA2.id, type: 'fuel_drain', severity: 'High', title: 'Fuel drop', message: 'x', occurredAt: new Date((T0 + 600) * 1000) }
    await prisma.alertEvent.createMany({ data: [
      { ...base, vehicleId: veh.id },
      { ...base, bgId: fx.bgA1a.id, deviceId: 101, type: 'overspeed' },
    ] })
    const get = query => request(app).get('/api/alert-events').query(query).set(auth(fx.tokens.superAdmin))
    const mine = await get({ vehicleIds: veh.id, limit: 2000 })
    expect(mine.status).toBe(200)
    expect(mine.body.data.map(e => e.vehicleId)).toEqual([veh.id])
    const both = await get({ vehicleIds: veh.id, deviceIds: '101', limit: 2000 })
    expect(both.body.data).toHaveLength(2)
    expect((await get({ vehicleIds: 'bad id;' })).status).toBe(400)
  })
})
