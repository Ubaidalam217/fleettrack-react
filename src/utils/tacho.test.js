import { describe, expect, it } from 'vitest'
import {
  rpmOf, buildTacho, summarize, downsample, chartPoints, tripWindow, stepTrip, timeTicks,
  thinReadings, byLocalDay, eventFlags, TACHO_GAP_SEC,
} from './tacho'
import { deriveTrips } from './usageReports'

// 2026-11-10 08:00 local
const T0 = Math.floor(new Date(2026, 10, 10, 8, 0, 0).getTime() / 1000)
const msg = (dt, o = {}) => ({
  timestamp: T0 + dt,
  'position.latitude': 25.2 + dt * 0.00008, // ~9 m/s: odometer jumps stay plausible
  'position.longitude': 55.3,
  'position.speed': 0,
  'position.satellites': 12,
  'engine.ignition.status': true,
  ...o,
})

// Off, a 12-minute trip with driving and idling, off, then a second trip.
const DAY = [
  msg(0, { 'engine.ignition.status': false, 'vehicle.mileage': 100 }),
  msg(60, { 'vehicle.mileage': 100 }),
  msg(120, { 'position.speed': 40, 'vehicle.mileage': 100 }),
  msg(720, { 'position.speed': 30, 'vehicle.mileage': 105 }),
  msg(780, { 'vehicle.mileage': 105.5 }),
  msg(840, { 'engine.ignition.status': false, 'vehicle.mileage': 105.5 }),
  msg(3600, { 'engine.ignition.status': false, 'vehicle.mileage': 105.5 }),
  msg(3660, { 'vehicle.mileage': 105.5 }),
  msg(3720, { 'position.speed': 60, 'vehicle.mileage': 105.5 }),
  msg(3900, { 'position.speed': 50, 'vehicle.mileage': 108.5 }),
  msg(3960, { 'engine.ignition.status': false, 'vehicle.mileage': 109 }),
]

describe('rpmOf', () => {
  it('reads the first RPM field present, null when there is none', () => {
    expect(rpmOf({ 'can.engine.rpm': 1800 })).toBe(1800)
    expect(rpmOf({ 'engine.rpm': 900, 'obd.engine.rpm': 950 })).toBe(900)
    expect(rpmOf({ 'can.engine.rpm': 'x', 'obd.engine.rpm': 0 })).toBe(0)
    expect(rpmOf({ 'position.speed': 40 })).toBeNull()
  })
})

describe('buildTacho', () => {
  it('builds one point per message with cumulative km, ignition and the trip it falls in', () => {
    const t = buildTacho(DAY)
    expect(t.points).toHaveLength(DAY.length)
    expect(t.trips).toHaveLength(2)
    expect(t.points[0]).toMatchObject({ ts: T0, speed: 0, km: 0, odo: 100, ign: false, sats: 12, trip: -1 })
    expect(t.points[1].trip).toBe(0)                 // ignition on → trip 0 starts
    expect(t.points[4].trip).toBe(0)
    expect(t.points[5].trip).toBe(-1)                // the switch-off ends it
    expect(t.points[7].trip).toBe(1)
    expect(t.points[t.points.length - 1].km).toBeCloseTo(9, 1)
    expect(t.hasOdometer).toBe(true)
    expect(t.hasIgnition).toBe(true)
  })

  it('has no RPM when the tracker sends none, or only zeros', () => {
    expect(buildTacho(DAY).hasRpm).toBe(false)
    expect(buildTacho(DAY.map(m => ({ ...m, 'can.engine.rpm': 0 }))).hasRpm).toBe(false)
    const withRpm = buildTacho(DAY.map((m, i) => ({ ...m, 'can.engine.rpm': i === 3 ? 2100 : 800 })))
    expect(withRpm.hasRpm).toBe(true)
    expect(summarize(withRpm).maxRpm).toBe(2100)
  })

  it('marks the reading after a silence longer than the gap limit', () => {
    const t = buildTacho([msg(0), msg(60), msg(60 + TACHO_GAP_SEC + 1), msg(60 + TACHO_GAP_SEC + 61)])
    expect(t.points.map(p => p.gapBefore)).toEqual([false, false, true, false])
  })

  it('handles no messages', () => {
    const t = buildTacho([])
    expect(t.points).toEqual([])
    expect(summarize(t)).toMatchObject({ distanceKm: 0, driveSec: 0, maxSpeed: null, maxRpm: null, trips: 0, readings: 0 })
  })
})

describe('summarize', () => {
  it('matches the Trip Report over the whole period', () => {
    const s = summarize(buildTacho(DAY))
    const trips = deriveTrips(DAY, { maxGapSec: TACHO_GAP_SEC })
    expect(s.trips).toBe(2)
    expect(s.driveSec).toBe(trips.reduce((a, t) => a + t.driveSec, 0))
    expect(s.driveSec).toBe(660 + 240)                // 120→780 and 3720→3960
    expect(s.maxSpeed).toBe(60)
    expect(s.maxRpm).toBeNull()
    expect(s.distanceKm).toBeCloseTo(9, 1)
    expect(s.readings).toBe(DAY.length)
  })

  it('clips to a window: distance from the reading before it, drive time cut at its edges', () => {
    const t = buildTacho(DAY)
    const s = summarize(t, T0 + 3000, T0 + 3800)
    expect(s.trips).toBe(1)
    expect(s.readings).toBe(3)                        // 3600, 3660, 3720
    expect(s.driveSec).toBe(80)                       // 3720→3800 of the 3720→3900 run
    expect(s.distanceKm).toBeCloseTo(0, 2)            // the odometer had not moved by 3720
    expect(s.maxSpeed).toBe(60)
  })
})

describe('downsample / chartPoints', () => {
  const long = Array.from({ length: 5000 }, (_, i) => ({
    ts: T0 + i * 10, speed: i === 2345 ? 140 : i % 7 === 0 ? 0 : 50, rpm: null, km: i / 100, gapBefore: false,
  }))

  it('keeps under the limit, both ends and the peak', () => {
    const out = downsample(long, 600)
    expect(out.length).toBeLessThanOrEqual(600)
    expect(out[0]).toBe(long[0])
    expect(out[out.length - 1]).toBe(long[long.length - 1])
    expect(out.some(p => p.speed === 140)).toBe(true)
    expect(out.every((p, i) => i === 0 || p.ts > out[i - 1].ts)).toBe(true)
  })

  it('leaves a short series alone', () => {
    expect(downsample(long.slice(0, 10), 600)).toHaveLength(10)
  })

  it('takes the window plus one reading either side', () => {
    const out = chartPoints(long.slice(0, 100), T0 + 200, T0 + 400)
    expect(out[0].ts).toBe(T0 + 190)
    expect(out[out.length - 1].ts).toBe(T0 + 410)
  })

  it('breaks the line across a gap the vehicle was moving into, not across a parked one', () => {
    const pts = [
      { ts: T0, speed: 50, km: 0, gapBefore: false, rpm: null },
      { ts: T0 + 4000, speed: 0, km: 1, gapBefore: true, rpm: null },
      { ts: T0 + 9000, speed: 0, km: 1, gapBefore: true, rpm: null },
    ]
    const out = chartPoints(pts, T0, T0 + 9000)
    expect(out).toHaveLength(4)
    expect(out[1]).toMatchObject({ ts: T0 + 1, speed: null, gap: true, km: 0 })
    expect(out[3].ts).toBe(T0 + 9000)
  })
})

describe('trip navigation', () => {
  const trips = [{ startTs: 100, endTs: 400 }, { startTs: 1000, endTs: 1200 }, { startTs: 5000, endTs: 9000 }]

  it('pads a trip window by at least two minutes', () => {
    expect(tripWindow({ startTs: 1000, endTs: 1200 })).toEqual([880, 1320])
    expect(tripWindow({ startTs: 0, endTs: 10000 })).toEqual([-800, 10800])
  })

  it('steps from a trip to its neighbours and stops at the ends', () => {
    expect(stepTrip(trips, 1, [0, 0], 1)).toBe(2)
    expect(stepTrip(trips, 1, [0, 0], -1)).toBe(0)
    expect(stepTrip(trips, 2, [0, 0], 1)).toBeNull()
    expect(stepTrip(trips, 0, [0, 0], -1)).toBeNull()
  })

  it('from the whole period goes to the first or last trip; from a dragged zoom, to the next one in or after it', () => {
    expect(stepTrip(trips, null, [0, 10000], 1)).toBe(0)
    expect(stepTrip(trips, null, [0, 10000], -1)).toBe(2)
    expect(stepTrip(trips, null, [500, 3000], 1)).toBe(1)
    expect(stepTrip(trips, null, [500, 3000], -1)).toBe(1)
    expect(stepTrip(trips, null, [9500, 9900], 1)).toBeNull()
    expect(stepTrip([], null, [0, 1], 1)).toBeNull()
  })
})

describe('timeTicks', () => {
  it('picks round local-time ticks', () => {
    // 08:00 to 20:00 UTC+4 → every 2 hours on the even hour
    const x0 = Date.UTC(2026, 10, 10, 4, 0, 0) / 1000
    const ticks = timeTicks(x0, x0 + 12 * 3600, 8, 4 * 3600)
    expect(ticks).toHaveLength(7)
    expect(ticks[0]).toBe(x0)
    expect(ticks[1] - ticks[0]).toBe(7200)
  })

  it('lands on local midnight for a week', () => {
    const x0 = Date.UTC(2026, 10, 3, 20, 0, 0) / 1000 // 00:00 on the 4th, UTC+4
    const ticks = timeTicks(x0 - 3600, x0 + 7 * 86400, 8, 4 * 3600)
    expect(ticks[0]).toBe(x0)
    expect(ticks.every(t => (t + 4 * 3600) % 86400 === 0)).toBe(true)
  })

  it('returns nothing for an empty span', () => {
    expect(timeTicks(100, 100)).toEqual([])
  })
})

describe('thinReadings', () => {
  const pts = buildTacho(DAY).points

  it('keeps every reading at 0', () => {
    expect(thinReadings(pts, 0)).toBe(pts)
  })

  it('keeps one per interval plus every ignition switch', () => {
    const kept = thinReadings(pts, 1800).map(p => p.ts - T0)
    // 0 first; 60 on; 840 off; 3600 (≥30 min after 840); 3660 on; 3960 off
    expect(kept).toEqual([0, 60, 840, 3600, 3660, 3960])
  })
})

describe('byLocalDay / eventFlags', () => {
  it('splits at local midnight', () => {
    const late = new Date(2026, 10, 10, 23, 59, 0).getTime() / 1000
    const days = byLocalDay([{ ts: late }, { ts: late + 30 }, { ts: late + 120 }])
    expect(days.map(d => d.points.length)).toEqual([2, 1])
    expect(days[1].key).toBe('2026-11-11')
  })

  it('flags the first and last reading of a day and each ignition switch', () => {
    const flags = eventFlags(buildTacho(DAY).points)
    expect(flags).toEqual([true, true, false, false, false, true, false, true, false, false, true])
  })
})
