import { describe, expect, it } from 'vitest'
import {
  DAY_SEC, accumulate, emptyStats, buildWindows, presetWindows, customWindows, monthsCovering,
  summarize, countAlerts, heatIndex, uaeMidnight, isoToUaeStart, bucketOf, pctChange, MAX_CUSTOM_DAYS,
} from './chartsData'
import { deriveDeviceMonth, uaeDayStart, daysInMonth } from '../../utils/daywiseCore.js'

// 2026-10-14 08:00 UAE (a Wednesday)
const T0 = uaeDayStart(2026, 10, 14) + 8 * 3600
const msg = (dt, o = {}) => ({
  timestamp: T0 + dt,
  'position.latitude': 25.2,
  'position.longitude': 55.3,
  'position.speed': 0,
  'engine.ignition.status': true,
  ...o,
})

describe('UAE time helpers', () => {
  it('finds the UAE midnight and the Monday-first heatmap cell', () => {
    expect(uaeMidnight(T0)).toBe(uaeDayStart(2026, 10, 14))
    // Wednesday = 2 in a Monday-first week, 08:00 → hour 8.
    expect(heatIndex(T0)).toBe(2 * 24 + 8)
    // 23:59 UAE on Sunday 2026-10-18 is still Sunday, hour 23.
    expect(heatIndex(uaeDayStart(2026, 10, 18) + DAY_SEC - 1)).toBe(6 * 24 + 23)
    expect(isoToUaeStart('2026-10-14')).toBe(uaeDayStart(2026, 10, 14))
    expect(isoToUaeStart('nope')).toBeNull()
  })

  it('puts speeds in 20 km/h bands with an open top band', () => {
    expect(bucketOf(5)).toBe(0)
    expect(bucketOf(20)).toBe(1)
    expect(bucketOf(99.9)).toBe(4)
    expect(bucketOf(100)).toBe(5)
    expect(bucketOf(180)).toBe(6)
  })
})

describe('periods', () => {
  it('compares a partial day with the same hours of the day before', () => {
    const now = uaeDayStart(2026, 11, 9) + 14 * 3600
    const w = presetWindows(1, now)
    expect(w.cur).toEqual({ from: uaeDayStart(2026, 11, 9), to: now })
    expect(w.prev).toEqual({ from: uaeDayStart(2026, 11, 8), to: now - DAY_SEC })
  })

  it('makes 30 days end today and the previous 30 days end 30 days earlier', () => {
    const now = uaeDayStart(2026, 11, 9) + 3600
    const w = presetWindows(30, now)
    expect(w.cur.from).toBe(uaeDayStart(2026, 10, 11))
    expect(w.prev.from).toBe(uaeDayStart(2026, 9, 11))
    expect(monthsCovering(w.prev.from, w.cur.to)).toEqual([
      { year: 2026, month: 9 }, { year: 2026, month: 10 }, { year: 2026, month: 11 },
    ])
  })

  it('validates a custom range', () => {
    const now = uaeDayStart(2026, 11, 9) + 3600
    expect(customWindows('2026-10-01', '2026-10-31', now).windows.days).toBe(31)
    expect(customWindows('2026-10-01', '2026-11-05', now).error).toMatch(String(MAX_CUSTOM_DAYS))
    expect(customWindows('2026-10-05', '2026-10-01', now).error).toMatch(/before/)
    expect(customWindows('2026-11-08', '2026-11-10', now).error).toMatch(/future/)
    expect(customWindows('', '2026-11-01', now).error).toBeTruthy()
  })
})

describe('accumulate', () => {
  it('splits engine-on time into driving and idling, and drops long gaps', () => {
    const w = buildWindows(uaeDayStart(2026, 10, 14), 1, uaeDayStart(2026, 10, 15))
    const s = accumulate(emptyStats(1), [
      msg(0),                                   // idle 0→60
      msg(60, { 'position.speed': 50 }),        // driving 60→180
      msg(180, { 'engine.ignition.status': false }),
      msg(600),                                 // off 180→600: not engine time
      msg(600 + 3600),                          // a 1 h silence: excluded
      msg(600 + 3660),
    ], w)
    expect(s.cur.idleSec).toBe(60 + 60)
    expect(s.cur.driveSec).toBe(120)
    expect(s.heat[heatIndex(T0)]).toBe(120)
    expect(s.speedSec[2]).toBe(120)             // 50 km/h → the 40-60 band
    expect(s.prev.driveSec).toBe(0)
  })

  it('splits driving across an hour boundary into both heatmap cells', () => {
    const w = buildWindows(uaeDayStart(2026, 10, 14), 1, uaeDayStart(2026, 10, 15))
    const s = accumulate(emptyStats(1), [
      msg(3600 - 300, { 'position.speed': 40 }),
      msg(3600 + 600, { 'position.speed': 40 }),
    ], w)
    expect(s.heat[heatIndex(T0)]).toBe(300)
    expect(s.heat[heatIndex(T0 + 3600)]).toBe(600)
  })

  it('agrees with the Daywise derivation day by day over a whole month', () => {
    const year = 2026
    const month = 10
    const start = uaeDayStart(year, month, 1)
    // A vehicle driving 08:00-08:20 and 23:50-00:10 every day, odometer rising.
    const messages = []
    let odo = 1000
    for (let d = 0; d < daysInMonth(year, month); d++) {
      for (const base of [8 * 3600, 23 * 3600 + 50 * 60]) {
        for (let k = 0; k <= 20; k++) {
          odo += 0.5
          messages.push({
            timestamp: start + d * DAY_SEC + base + k * 60,
            'vehicle.mileage': odo,
            'position.latitude': 25.2 + k * 0.004,
            'position.longitude': 55.3,
            'position.speed': k < 20 ? 60 : 0,
            'engine.ignition.status': k < 20,
          })
        }
      }
    }
    messages.sort((a, b) => a.timestamp - b.timestamp)
    const days = daysInMonth(year, month)
    const w = buildWindows(start, days, start + days * DAY_SEC)
    const s = accumulate(emptyStats(days), messages, w)
    const ref = deriveDeviceMonth(messages, year, month)

    for (let d = 1; d <= days; d++) {
      const km = s.cur.kmByHour.slice((d - 1) * 24, d * 24).reduce((a, b) => a + b, 0)
      expect(km).toBeCloseTo(ref.distanceKm[d], 6)
    }
    expect(s.cur.driveSec + s.cur.idleSec).toBeCloseTo(ref.totalSec, 6)
  })
})

describe('summarize', () => {
  const now = uaeDayStart(2026, 10, 16)
  const w = buildWindows(uaeDayStart(2026, 10, 14), 2, now)
  const stats = new Map([
    [1, accumulate(emptyStats(2), [
      msg(0, { 'vehicle.mileage': 10, 'position.speed': 30 }),
      // ~5 km north: the stepper trusts an odometer rise GPS can account for.
      msg(600, { 'vehicle.mileage': 15, 'position.speed': 30, 'position.latitude': 25.245 }),
    ], w)],
  ])
  const vehicles = [
    { id: 1, label: 'AD 1', bg: 'Alpha' },
    { id: 2, label: 'AD 2', bg: 'Alpha' },
  ]

  it('totals the selection and counts used vehicle-days', () => {
    const r = summarize(stats, vehicles, w)
    expect(r.series).toHaveLength(2)
    expect(r.series[0].cur).toBeCloseTo(5)
    expect(r.series[0].vehicles).toBe(1)
    expect(r.totals.cur.km).toBeCloseTo(5)
    expect(r.totals.cur.usedDays).toBe(1)
    expect(r.totals.vehicleDays).toBe(4)
    expect(r.topVehicles.map(v => v.label)).toEqual(['AD 1'])
  })

  it('makes each BG\'s off time the rest of its vehicles\' time', () => {
    const r = summarize(stats, vehicles, w)
    const alpha = r.byBg[0]
    expect(alpha.vehicles).toBe(2)
    expect(alpha.driveSec).toBe(600)
    expect(alpha.offSec).toBe(2 * 2 * DAY_SEC - 600)
  })

  it('draws hours, up to now, for a single day', () => {
    const today = buildWindows(uaeDayStart(2026, 10, 14), 1, uaeDayStart(2026, 10, 14) + 5 * 3600 + 1)
    const r = summarize(new Map(), vehicles, today)
    expect(r.hourly).toBe(true)
    expect(r.series).toHaveLength(6)
  })
})

describe('countAlerts and pctChange', () => {
  it('counts the selected vehicles\' alerts per window and type', () => {
    const w = buildWindows(1000, 1, 1000 + DAY_SEC)
    const r = countAlerts([
      { ts: 1000 + 5, type: 'overspeed', deviceId: 1 },
      { ts: 1000 + 6, type: 'overspeed', deviceId: 1 },
      { ts: 1000 + 7, type: 'idle', deviceId: 1 },
      { ts: 1000 + 8, type: 'idle', deviceId: 9 },          // not selected
      { ts: 1000 - 5, type: 'idle', deviceId: 1 },          // previous window
    ], new Set([1]), w)
    expect(r.cur).toBe(3)
    expect(r.prev).toBe(1)
    expect(r.types).toEqual([{ type: 'overspeed', count: 2 }, { type: 'idle', count: 1 }])
  })

  it('has no change to report without a previous value', () => {
    expect(pctChange(5, 0)).toBeNull()
    expect(pctChange(110, 100)).toBeCloseTo(10)
  })
})
