/**
 * Daywise report figures: the day reduction (lib/dailyUsage.js) and the
 * scoped read behind GET /api/reports/daywise.
 *
 * Flespi is mocked as in flespi.test.js — buildAcl() maps IMEIs to device ids
 * through it, and server/.env holds a real Master token the suite must not use.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const H = vi.hoisted(() => ({ flespiToken: 'mock-master-token' }))

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => {
    const copy = { ...frozen }
    Object.defineProperty(copy, 'FLESPI_TOKEN', {
      get: () => H.flespiToken,
      configurable: true,
      enumerable: true,
    })
    return copy
  }
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
const { reduceDay, dayKey, dayStartOf } = await import('../src/lib/dailyUsage.js')
const { deriveDeviceMonth } = await import('../../src/utils/daywiseCore.js')
import { auth, resetDb, seedFixture } from './factories.js'
import { clearDeviceCache } from '../src/lib/flespi.js'

const app = createApp()
let fx

// factories.js seeds imei 86307101123450<n> for v1..v9; bgA1a holds v1..v4.
const DEVICE_BY_IMEI = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [`86307101123450${i + 1}`, 101 + i])
)
const UNREGISTERED_DEVICE_ID = 9999

function installFlespiMock() {
  vi.stubGlobal('fetch', url => {
    const u = String(url)
    if (u.includes('/gw/devices/all')) {
      const result = Object.entries(DEVICE_BY_IMEI).map(([ident, id]) => ({ id, configuration: { ident } }))
      result.push({ id: UNREGISTERED_DEVICE_ID, configuration: { ident: '999999999999999' } })
      return Promise.resolve(new Response(JSON.stringify({ result }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ errors: [{ reason: `unmocked ${u}` }] }), { status: 500 }))
  })
}

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  installFlespiMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearDeviceCache()
})

// ── The reduction ───────────────────────────────────────────────────────────

/** A vehicle driving 1 km every 5 minutes, ignition on, from `fromTs` to `toTs`. */
function drive(deviceId, fromTs, toTs, startKm = 1000) {
  const out = []
  for (let t = fromTs, i = 0; t <= toTs; t += 300, i++) {
    out.push({
      'device.id': deviceId,
      timestamp: t,
      'engine.ignition.status': true,
      'vehicle.mileage': startKm + i,
      'position.latitude': 24.4 + i * 0.009,
      'position.longitude': 54.4,
      'position.speed': 12,
      'position.valid': true,
    })
  }
  return out
}

const byDevice = msgs => {
  const m = new Map()
  for (const x of msgs) {
    if (!m.has(x['device.id'])) m.set(x['device.id'], [])
    m.get(x['device.id']).push(x)
  }
  return m
}

describe('reduceDay', () => {
  const day = dayStartOf('2026-09-15')

  it('keeps only this day’s share of an interval that crosses midnight', () => {
    // 23:50 the day before → 00:10: 20 minutes on, 10 of them on this day.
    const before = byDevice([{ 'device.id': 7, timestamp: day - 600, 'engine.ignition.status': true }])
    const today = byDevice([{ 'device.id': 7, timestamp: day + 600, 'engine.ignition.status': false }])
    const [row] = reduceDay(day, [before, today])
    expect(row).toMatchObject({ deviceId: 7, ignitionSec: 600 })
  })

  it('gives a day the same figures the month-wide derivation gives it', () => {
    // Driving through both midnights of the 15th, so both splits are exercised.
    const all = drive(7, day - 3 * 3600, day + 86400 + 3 * 3600)
    const parts = [day - 86400, day, day + 86400].map(start =>
      byDevice(all.filter(m => m.timestamp >= start && m.timestamp < start + 86400))
    )
    const [row] = reduceDay(day, parts)
    const month = deriveDeviceMonth(all, 2026, 9)
    expect(row.distanceKm).toBeCloseTo(month.distanceKm[15], 6)
    expect(row.ignitionSec).toBe(Math.round(month.ignitionSec[15]))
    expect(row.distanceKm).toBeGreaterThan(280) // 24 h at 12 km/h
  })

  it('round-trips UAE day keys', () => {
    expect(dayKey(dayStartOf('2026-10-01'))).toBe('2026-10-01')
    // UAE midnight is 20:00 UTC the evening before.
    expect(new Date(dayStartOf('2026-10-01') * 1000).toISOString()).toBe('2026-09-30T20:00:00.000Z')
  })
})

// ── GET /api/reports/daywise ────────────────────────────────────────────────

/** September 2026 computed for devices 101 (bgA1a), 105 (bgA1b) and 9999 (unregistered), except the 2nd. */
async function seedSeptember() {
  const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
  await prisma.usageDay.createMany({
    data: days.filter(d => d !== '2026-09-02').map(day => ({ day, final: true })),
  })
  await prisma.dailyUsage.createMany({
    data: [
      { deviceId: 101, day: '2026-09-01', distanceKm: 12.5, ignitionSec: 3600 },
      { deviceId: 101, day: '2026-09-30', distanceKm: 7.5, ignitionSec: 1800 },
      { deviceId: 105, day: '2026-09-01', distanceKm: 40, ignitionSec: 7200, capped: true },
      { deviceId: UNREGISTERED_DEVICE_ID, day: '2026-09-10', distanceKm: 3, ignitionSec: 60 },
    ],
  })
}

const get = (token, query) =>
  request(app).get('/api/reports/daywise').query(query).set(auth(token))

describe('GET /api/reports/daywise', () => {
  it('returns a month in the derivation’s own shape, with uncomputed days listed', async () => {
    await seedSeptember()
    const res = await get(fx.tokens.superAdmin, { year: 2026, month: 9 })
    expect(res.status).toBe(200)

    const { devices, missingDays, capped } = res.body.data
    expect(devices.map(d => d.deviceId).sort((a, b) => a - b)).toEqual([101, 105, UNREGISTERED_DEVICE_ID])
    expect(missingDays).toEqual(['2026-09-02'])
    expect(capped).toBe(true)

    const v101 = devices.find(d => d.deviceId === 101)
    expect(v101.distanceKm).toHaveLength(31) // 1-indexed, index 0 unused
    expect(v101.distanceKm[1]).toBe(12.5)
    expect(v101.distanceKm[30]).toBe(7.5)
    expect(v101.totalKm).toBe(20)
    expect(v101.totalSec).toBe(5400)
  })

  it('shows a BG user only its own BG’s devices', async () => {
    await seedSeptember()
    const res = await get(fx.tokens.bgUserA1a, { year: 2026, month: 9 })
    expect(res.status).toBe(200)
    // 105 is bgA1b's and 9999 is registered to nobody: neither may appear.
    expect(res.body.data.devices.map(d => d.deviceId)).toEqual([101])
    expect(res.body.data.capped).toBe(false)
  })

  it('answers an account with no devices with an empty month, not everything', async () => {
    await seedSeptember()
    await prisma.subuserVehicle.deleteMany({})
    await prisma.subuserBranch.deleteMany({})
    const res = await get(fx.tokens.subUserA1a, { year: 2026, month: 9 })
    expect(res.status).toBe(200)
    expect(res.body.data.devices).toEqual([])
  })

  it('rejects a bad month and an anonymous caller', async () => {
    expect((await get(fx.tokens.superAdmin, { year: 2026, month: 13 })).status).toBe(400)
    expect((await request(app).get('/api/reports/daywise?year=2026&month=9')).status).toBe(401)
  })
})
