import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDaywiseMonth, fetchDaywiseMonth, uaeDayStart } from './daywise'

// The Daywise loaders read an Uffizio vehicle's month from our own copy of its
// samples (never Flespi). Invented ids and data only.
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const D = uaeDayStart(2026, 10, 5)
const sample = (id, ts, odo, ign = true, speed = 50) => ({
  'device.id': id, timestamp: ts, 'position.latitude': 24.4, 'position.longitude': 54.5,
  'position.speed': speed, 'position.valid': true, 'engine.ignition.status': ign, 'vehicle.mileage': odo,
})

afterEach(() => vi.unstubAllGlobals())

/** A fake GET /api/live/uffizio/:id/messages that answers only the samples inside from..to. */
const serve = (rows, calls = [], truncated = false) => vi.fn(async url => {
  const u = new URL(String(url), 'http://x')
  calls.push(String(url))
  const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'))
  return json({ result: rows.filter(m => m.timestamp >= from && m.timestamp <= to), truncated })
})

describe('Daywise months of Uffizio vehicles', () => {
  it('loadDaywiseMonth works an Uffizio month out from its samples: odometer km and engine time per UAE day', async () => {
    const calls = []
    vi.stubGlobal('fetch', serve([sample('uffizio:v-a', D + 3600, 100), sample('uffizio:v-a', D + 3720, 102), sample('uffizio:v-a', D + 3840, 104, false, 0)], calls))
    const { derived } = await loadDaywiseMonth(['uffizio:v-a'], 2026, 10)
    const m = derived.get('uffizio:v-a')
    expect(m.distanceKm[5]).toBeCloseTo(4, 6)
    expect(m.ignitionSec[5]).toBe(240)
    expect(m.totalKm).toBeCloseTo(4, 6)
    expect(m.noData).toBe(false)
    // (In real mode the server's /api/reports/uffizio-daywise is asked first; here it has no answer.)
    expect(calls.filter(u => !u.includes('/api/reports/uffizio-daywise')).every(u => u.includes('/api/live/uffizio/v-a/messages'))).toBe(true)
    expect(calls.some(u => u.includes('/gw/devices'))).toBe(false)
  })

  it('an Uffizio vehicle with no sample in the month comes back as an empty month marked No data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: [], truncated: false })))
    const { derived } = await loadDaywiseMonth(['uffizio:v-empty'], 2026, 9)
    expect(derived.get('uffizio:v-empty').noData).toBe(true)
    expect(derived.get('uffizio:v-empty').totalKm).toBe(0)
  })

  it('fetchDaywiseMonth returns the Uffizio samples next to the Flespi devices (none here)', async () => {
    vi.stubGlobal('fetch', serve([sample('uffizio:v-b', D + 60, 1)], [], true))
    const { byDevice, capped } = await fetchDaywiseMonth(['uffizio:v-b'], 2026, 10)
    expect(byDevice.get('uffizio:v-b')).toHaveLength(1)
    expect(capped).toBe(true)
  })
})
