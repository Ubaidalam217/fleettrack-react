/**
 * Fuel alerts (lib/fuelAlerts.js): drain / theft (any fall of the threshold,
 * moving or not — client, 2026-11-25), fill and low fuel, one event per
 * episode, muted vehicles skipped, and the rule form's
 * params. Every series here is invented.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { runFuelAlertPass, evaluateLowFuel, lowFuelLimit } from '../src/lib/fuelAlerts.js'
import { runAlertPass } from '../src/lib/alertEngine.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

const PORT = 'BLE Fuel Level #1'
// 0 L at 500 mV … 100 L at 2500 mV: litres = (mv - 500) / 20.
const mvOf = litres => 500 + litres * 20
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)
const MIN = 60_000

async function calibrate(vehicleId, tankCapacityL = 100) {
  await prisma.fuelCalibration.create({
    data: { vehicleId, method: 'PORT', port: PORT, tankCapacityL, points: [{ litres: 0, mv: 500 }, { litres: 100, mv: 2500 }] },
  })
}
/** Readings every 2 min ending `endMinAgo` before NOW. */
async function readings(vehicleId, levels, { endMinAgo = 0, parked = true } = {}) {
  const n = levels.length
  await prisma.fuelReading.createMany({
    data: levels.map((l, i) => ({
      vehicleId, port: PORT, raw: mvOf(l), ts: new Date(NOW - (endMinAgo + (n - 1 - i) * 2) * MIN),
      ign: !(typeof parked === 'function' ? parked(i) : parked), speed: (typeof parked === 'function' ? parked(i) : parked) ? 0 : 60, lat: 24.3, lng: 54.4,
    })),
  })
}
const rule = (type, params, extra = {}) => prisma.alert.create({ data: { name: `Rule ${type}`, type, bgId: fx.bgA1a.id, allVehicles: true, params, severity: 'High', ...extra } })
const fuelEvents = type => prisma.alertEvent.findMany({ where: { type }, orderBy: { occurredAt: 'asc' } })

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

describe('fuel theft', () => {
  it('raises ONE event for a drain while parked, once it has settled, never twice', async () => {
    const v = fx.vehicles.v1
    await calibrate(v.id)
    await rule('fuel_theft', { litres: 15 })
    // 80 L, then 30 L gone in 6 minutes while parked; only 2 readings after it yet.
    await readings(v.id, [80, 80, 80, 70, 60, 50, 50, 50], { endMinAgo: 2 })
    expect(await runFuelAlertPass(NOW)).toHaveLength(0) // a dropout could still come back
    await readings(v.id, [50], { endMinAgo: 0 })
    const first = await runFuelAlertPass(NOW + MIN)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ type: 'fuel_theft', vehicleId: v.id, bgId: fx.bgA1a.id, value: 30, severity: 'High' })
    expect(first[0].message).toMatch(/Fuel drained, 30 L \(80 → 50 L\) · Stopped \(engine off\)/)
    expect(first[0].endedAt.getTime() - first[0].occurredAt.getTime()).toBe(6 * MIN)
    // Nothing new: the same drain is not raised twice.
    expect(await runFuelAlertPass(NOW + 2 * MIN)).toHaveLength(0)
    expect(await fuelEvents('fuel_theft')).toHaveLength(1)
  })

  it('a drain while moving counts too, with its context', async () => {
    const v = fx.vehicles.v1
    await calibrate(v.id)
    await rule('fuel_theft', { litres: 15 })
    await readings(v.id, [90, 89.5, 89, 70, 69.5, 69, 68.5], { parked: false })
    const [e] = await runFuelAlertPass(NOW)
    expect(e).toMatchObject({ type: 'fuel_theft', value: 19 })
    expect(e.message).toMatch(/Fuel drained, 19 L \(89 → 70 L\) · While moving/)
  })

  it('a drain between trips: the last reading of the old trip against the first of the new one', async () => {
    const v = fx.vehicles.v1
    await calibrate(v.id)
    await rule('fuel_theft', { litres: 15 })
    // Trip ends 5 h ago (engine off at 70 L), nothing while parked, the new trip starts with 45 L.
    await readings(v.id, [72, 71, 70], { endMinAgo: 300, parked: i => i === 2 })
    await readings(v.id, [45, 44.5, 44, 43.5], { parked: false })
    const [e] = await runFuelAlertPass(NOW)
    expect(e).toMatchObject({ type: 'fuel_theft', value: 25 })
    expect(e.message).toMatch(/25 L \(70 → 45 L\) · Between trips \(no data for 4 h 54 min\)/)
  })

  it('fuel used while driving is no theft, and a muted vehicle raises nothing', async () => {
    const { v1, v2 } = fx.vehicles
    await calibrate(v1.id)
    await calibrate(v2.id)
    await rule('fuel_theft', { litres: 15 })
    await readings(v1.id, Array.from({ length: 40 }, (_, i) => 90 - i * 1), { parked: false })
    await readings(v2.id, [80, 80, 60, 40, 40, 40])
    await prisma.vehicle.update({ where: { id: v2.id }, data: { mutedAlerts: ['fuel_theft'] } })
    expect(await runFuelAlertPass(NOW)).toHaveLength(0)
  })

  it('a vehicle without a calibration raises nothing', async () => {
    await rule('fuel_theft', { litres: 15 })
    await readings(fx.vehicles.v1.id, [80, 80, 60, 40, 40, 40])
    expect(await runFuelAlertPass(NOW)).toHaveLength(0)
  })
})

describe('fuel fill', () => {
  it('raises a fill once, moving or not', async () => {
    const v = fx.vehicles.v1
    await calibrate(v.id)
    await rule('fuel_fill', { litres: 20 }, { severity: 'Low' })
    await readings(v.id, [20, 20, 45, 75, 95, 95, 94, 94], { parked: i => i < 5 })
    const ev = await runFuelAlertPass(NOW)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ type: 'fuel_fill', value: 75, severity: 'Low' })
    expect(await runFuelAlertPass(NOW + MIN)).toHaveLength(0)
  })
})

describe('low fuel', () => {
  it('raises once under the % of the tank, closes when filled again', async () => {
    const v = fx.vehicles.v1
    await calibrate(v.id, 200)
    await rule('low_fuel', { litres: null, percent: 15 }) // 30 L of 200
    await readings(v.id, [40, 36, 33, 29, 28], { endMinAgo: 30 })
    const ev = await runFuelAlertPass(NOW)
    expect(ev).toHaveLength(1)
    expect(ev[0].message).toMatch(/Low fuel, 28(\.\d)? L \(under 15% of the 200 L tank\)/)
    await readings(v.id, [27, 26], { endMinAgo: 20 })
    expect(await runFuelAlertPass(NOW + MIN)).toHaveLength(0)
    await readings(v.id, [80, 120, 150], { endMinAgo: 0 })
    expect(await runFuelAlertPass(NOW + 2 * MIN)).toHaveLength(0)
    const [e] = await fuelEvents('low_fuel')
    expect(e.endedAt).not.toBeNull()
    expect(e.peakValue).toBe(26)
  })

  it('the limit: litres first, else percent of the tank', () => {
    expect(lowFuelLimit({ litres: 40, percent: 15 }, { tankCapacityL: 200 })).toBe(40)
    expect(lowFuelLimit({ litres: null, percent: 15 }, { tankCapacityL: 200 })).toBe(30)
    expect(lowFuelLimit({ litres: null, percent: 15 }, { tankCapacityL: null })).toBeNull()
    expect(evaluateLowFuel([{ ts: 1, litres: 5 }], {}, { limit: null }).fire).toBeNull()
  })
})

describe('the rules', () => {
  it('the form saves the fuel types with their settings', async () => {
    const ok = await request(app).post('/api/alerts').set(auth(fx.tokens.bgUserA1a)).send({ bgId: fx.bgA1a.id, name: 'Theft', type: 'fuel_theft', params: { litres: 25 }, allVehicles: true })
    expect(ok.status).toBe(201)
    expect(ok.body.data.params).toEqual({ litres: 25, allowanceLph: 0 })
    const allow = await request(app).post('/api/alerts').set(auth(fx.tokens.bgUserA1a)).send({ bgId: fx.bgA1a.id, name: 'Theft 2', type: 'fuel_theft', params: { litres: 25, allowanceLph: 300 }, allVehicles: true })
    expect(allow.status).toBe(400)
    expect(allow.body.error.details).toHaveProperty('allowanceLph')
    const low = await request(app).post('/api/alerts').set(auth(fx.tokens.bgUserA1a)).send({ bgId: fx.bgA1a.id, name: 'Low', type: 'low_fuel', params: { litres: null, percent: 0 }, allVehicles: true })
    expect(low.status).toBe(400)
    expect(low.body.error.details).toHaveProperty('percent')
    const lowL = await request(app).post('/api/alerts').set(auth(fx.tokens.bgUserA1a)).send({ bgId: fx.bgA1a.id, name: 'Low', type: 'low_fuel', params: { litres: 40 }, allVehicles: true })
    expect(lowL.body.data.params).toEqual({ litres: 40, percent: null })
  })

  it('the telemetry pass leaves the fuel rules to the fuel pass', async () => {
    await prisma.alert.deleteMany({})
    await rule('fuel_theft', { litres: 15 })
    expect(await runAlertPass(Math.floor(NOW / 1000), { telemetry: new Map(), deviceByImei: new Map() })).toEqual([])
  })
})
