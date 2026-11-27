/**
 * Fuel from Flespi trackers (lib/flespiFuel.js): the reading of the calibrated
 * input is stored once per device timestamp; vehicles without a fuel
 * calibration are left alone. Every figure here is invented.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import prisma from '../src/prisma.js'
import { readingOf, fuelInputsOf, runFlespiFuelPass } from '../src/lib/flespiFuel.js'
import { rawToLitres } from '../../src/utils/fuelCalibration.js'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()

let fx
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0)
const sec = ms => Math.floor(ms / 1000)

const device = (vehicle, deviceId) => new Map([[vehicle.imei, deviceId]])
const tele = (deviceId, fuel, extra = {}) => new Map([[deviceId, { fuel, ignition: true, lat: 25.1, lng: 55.2, speed: 0, ...extra }]])
const input = (value, ts) => ({ value, ts })

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

describe('readingOf', () => {
  it('turns the analogue input volts into millivolts', () => {
    expect(readingOf('AIN2', { 'ain.2': input(0.084, 100) })).toEqual({ port: 'ain.2', raw: 84, ts: 100 })
    expect(readingOf('AIN1', { 'ain.2': input(0.084, 100) })).toBeNull()
  })
  it('reads CAN litres directly and CAN percent as it is', () => {
    expect(readingOf('CAN_VOLUME', { 'can.fuel.volume': input(22, 5) })).toEqual({ port: 'can.fuel.volume', raw: 22, ts: 5 })
    expect(readingOf('CAN', { 'can.fuel.level': input(40, 5) })).toEqual({ port: 'can.fuel.level', raw: 40, ts: 5 })
  })
  it('counts a CAN percent of 0 with no volume next to it as no reading', () => {
    expect(readingOf('CAN', { 'can.fuel.level': input(0, 5) })).toBeNull()
    expect(readingOf('CAN', { 'can.fuel.level': input(0, 5), 'can.fuel.volume': input(22, 5) })).toEqual({ port: 'can.fuel.level', raw: 0, ts: 5 })
  })
  it('keeps only numeric inputs with a time', () => {
    expect(fuelInputsOf({ 'ain.1': { value: 1.2, ts: 9 }, 'ain.2': { value: 'x', ts: 9 }, 'can.fuel.volume': { value: 3 } })).toEqual({ 'ain.1': { value: 1.2, ts: 9 } })
  })
})

describe('litres of CAN_VOLUME', () => {
  it('is the reading itself; a figure far above the tank is out of range', () => {
    expect(rawToLitres(22, { method: 'CAN_VOLUME', tankCapacityL: null })).toEqual({ litres: 22, flag: null })
    expect(rawToLitres(500, { method: 'CAN_VOLUME', tankCapacityL: 100 })).toEqual({ litres: null, flag: 'out_of_range' })
    expect(rawToLitres(-1, { method: 'CAN_VOLUME' }).flag).toBe('out_of_range')
  })
})

describe('runFlespiFuelPass', () => {
  const calibrate = (vehicleId, data) => prisma.fuelCalibration.create({ data: { vehicleId, points: [], ...data } })

  it('stores a reading once per device timestamp, with its litres', async () => {
    const v = fx.vehicles.v1
    await calibrate(v.id, { method: 'CAN_VOLUME', port: 'can.fuel.volume', tankCapacityL: 100 })
    const map = device(v, 501)
    const t = sec(NOW) - 30
    expect(await runFlespiFuelPass(tele(501, { 'can.fuel.volume': input(22, t) }), map, NOW)).toBe(1)
    expect(await runFlespiFuelPass(tele(501, { 'can.fuel.volume': input(22, t) }), map, NOW + 5000)).toBe(0) // same stamp
    expect(await runFlespiFuelPass(tele(501, { 'can.fuel.volume': input(21.5, t + 60) }), map, NOW + 90_000)).toBe(1)
    const rows = await prisma.fuelReading.findMany({ where: { vehicleId: v.id }, orderBy: { ts: 'asc' } })
    expect(rows.map(r => [r.port, r.raw, r.litres, r.ign])).toEqual([['can.fuel.volume', 22, 22, true], ['can.fuel.volume', 21.5, 21.5, true]])
  })

  it('stores an analogue input in mV and converts it with the table', async () => {
    const v = fx.vehicles.v2
    await calibrate(v.id, { method: 'AIN2', port: 'ain.2', points: [{ litres: 0, mv: 0 }, { litres: 100, mv: 1000 }] })
    expect(await runFlespiFuelPass(tele(502, { 'ain.2': input(0.5, sec(NOW)) }), device(v, 502), NOW)).toBe(1)
    const r = await prisma.fuelReading.findFirst({ where: { vehicleId: v.id } })
    expect(r).toMatchObject({ port: 'ain.2', raw: 500, litres: 50 })
  })

  it('stores nothing for a CAN level of 0 without a volume, and leaves unconfigured vehicles alone', async () => {
    const v = fx.vehicles.v1
    await calibrate(v.id, { method: 'CAN', port: 'can.fuel.level', tankCapacityL: 80 })
    const both = new Map([...device(v, 501), ...device(fx.vehicles.v3, 503)])
    const telemetry = new Map([...tele(501, { 'can.fuel.level': input(0, sec(NOW)) }), ...tele(503, { 'can.fuel.volume': input(22, sec(NOW)) })])
    expect(await runFlespiFuelPass(telemetry, both, NOW)).toBe(0)
    expect(await prisma.fuelReading.count()).toBe(0)
  })

  it('ignores a clock far in the future and an Uffizio vehicle', async () => {
    const v = fx.vehicles.v1
    await calibrate(v.id, { method: 'CAN_VOLUME', port: 'can.fuel.volume' })
    expect(await runFlespiFuelPass(tele(501, { 'can.fuel.volume': input(22, sec(NOW) + 3600) }), device(v, 501), NOW)).toBe(0)
    await prisma.vehicle.update({ where: { id: v.id }, data: { dataSource: 'UFFIZIO' } })
    expect(await runFlespiFuelPass(tele(501, { 'can.fuel.volume': input(22, sec(NOW)) }), device(v, 501), NOW)).toBe(0)
  })
})

describe('GET /api/fuel/series', () => {
  it('gives the litres series, the events, the summary and the latest reading of a Flespi vehicle', async () => {
    const v = fx.vehicles.v1
    await prisma.fuelCalibration.create({ data: { vehicleId: v.id, method: 'CAN_VOLUME', port: 'can.fuel.volume', points: [] } })
    const t0 = Date.now() - 3600_000
    const levels = [60, 60, 60, 60, 30, 30, 30, 30]
    await prisma.fuelReading.createMany({ data: levels.map((l, i) => ({ vehicleId: v.id, port: 'can.fuel.volume', raw: l, ts: new Date(t0 + i * 120_000), ign: false, speed: 0 })) })
    const res = await request(app).get('/api/fuel/series').query({ vehicleId: v.id, from: new Date(t0 - 60_000).toISOString(), to: new Date().toISOString() }).set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ calibrated: true, unit: 'L', port: 'can.fuel.volume', latest: { raw: 30, litres: 30 } })
    expect(res.body.data.series).toHaveLength(8)
    expect(res.body.data.events.map(e => [e.kind, e.litres])).toEqual([['drain', 30]])
    expect(res.body.data.summary).toMatchObject({ start: 60, end: 30, drained: 30 })
  })
  it('is empty for a vehicle with no fuel, scoped, and capped to 31 days', async () => {
    const q = { vehicleId: fx.vehicles.v1.id, from: new Date(Date.now() - 3600_000).toISOString(), to: new Date().toISOString() }
    const empty = await request(app).get('/api/fuel/series').query(q).set(auth(fx.tokens.bgUserA1a))
    expect(empty.body.data).toMatchObject({ calibrated: false, series: [], latest: null })
    expect((await request(app).get('/api/fuel/series').query(q).set(auth(fx.tokens.bgUserB1a))).status).toBe(404)
    expect((await request(app).get('/api/fuel/series').query({ ...q, from: new Date(Date.now() - 40 * 86400_000).toISOString() }).set(auth(fx.tokens.bgUserA1a))).status).toBe(400)
  })
})
