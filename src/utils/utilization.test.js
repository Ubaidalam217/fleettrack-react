import { describe, expect, it } from 'vitest'
import { usageByDay, summarize, pickRows, hhmm, uaeIso } from './utilization'

// 2026-11-03 00:00 UAE = 2026-11-02 20:00 UTC.
const D0 = Date.UTC(2026, 10, 2, 20, 0, 0) / 1000
const msg = (t, o = {}) => ({ timestamp: D0 + t, 'engine.ignition.status': true, 'position.speed': 40, 'vehicle.mileage': 1000 + t / 100, 'position.latitude': 24.4, 'position.longitude': 54.4, ...o })

describe('usageByDay', () => {
  it('splits engine time into driving and idling per UAE day, with distance from the odometer', () => {
    // 08:00-09:00 driving (60 s steps), 09:00-09:30 idling, ignition off after.
    const msgs = []
    for (let t = 8 * 3600; t <= 9 * 3600; t += 60) msgs.push(msg(t))
    for (let t = 9 * 3600 + 60; t <= 9.5 * 3600; t += 60) msgs.push(msg(t, { 'position.speed': 0, 'vehicle.mileage': 1000 + 9 * 36 }))
    msgs.push(msg(10 * 3600, { 'engine.ignition.status': false, 'position.speed': 0, 'vehicle.mileage': 1000 + 9 * 36 }))
    const u = usageByDay(msgs, D0, D0 + 86400)
    const d = u.days.get('2026-11-03')
    expect(d.driveSec).toBe(3600 + 60) // the step into the first idle message was still at speed
    // 09:01-09:30 standing, then the last 30 min until the ignition-off message (as Daywise counts it).
    expect(d.idleSec).toBe(1800 - 60 + 1800)
    expect(d.utilisedSec).toBe(d.driveSec + d.idleSec)
    expect(d.km).toBeCloseTo(36, 1)
    expect(uaeIso(d.firstOn)).toBe('2026-11-03')
    expect(u.lastMove).not.toBeNull()
  })

  it('splits a span over UAE midnight between the two days, and skips long gaps', () => {
    const msgs = [msg(86400 - 600), msg(86400 + 600)]
    const u = usageByDay(msgs, D0, D0 + 2 * 86400)
    expect(u.days.get('2026-11-03').utilisedSec).toBe(600)
    expect(u.days.get('2026-11-04').utilisedSec).toBe(600)
    const gap = usageByDay([msg(0), msg(3 * 3600)], D0, D0 + 86400)
    expect(gap.days.get('2026-11-03')?.utilisedSec ?? 0).toBe(0)
  })
})

describe('summarize and pickRows', () => {
  const usage = days => ({ days: new Map(days.map(d => [d.date, { utilisedSec: 0, driveSec: 0, idleSec: 0, km: 0, ...d }])), lastMove: null, lastPos: null })

  it('measures against 24 h a day by default, or the hours set', () => {
    const u = usage([{ date: '2026-11-03', utilisedSec: 6 * 3600, driveSec: 5 * 3600, idleSec: 3600, km: 120 }, { date: '2026-11-04', km: 0.4 }])
    const s = summarize(u, { from: D0, to: D0 + 2 * 86400 })
    expect(s.expectedSec).toBe(48 * 3600)
    expect(s.utilisedPct).toBeCloseTo(12.5)
    expect(s.vsExpectedPct).toBeCloseTo(12.5)
    expect(s.expectedPct).toBeCloseTo(100)
    expect(s.daysUsed).toBe(1)
    expect(s.overDays).toHaveLength(0)
    const shift = summarize(u, { from: D0, to: D0 + 2 * 86400, expectedHours: 5 })
    expect(shift.vsExpectedPct).toBeCloseTo(60)
    expect(shift.expectedPct).toBeCloseTo((5 / 24) * 100)
    expect(shift.utilisedPct).toBeCloseTo(12.5) // of the period's clock time
    expect(shift.overDays.map(d => [d.date, d.overSec])).toEqual([['2026-11-03', 3600]])
  })

  it('lists over, under and not-used vehicles', () => {
    const rows = [
      { id: 1, s: summarize(usage([{ date: '2026-11-03', utilisedSec: 9 * 3600, km: 300 }]), { from: D0, to: D0 + 86400, expectedHours: 8 }) },
      { id: 2, s: summarize(usage([{ date: '2026-11-03', utilisedSec: 3600, km: 20 }]), { from: D0, to: D0 + 86400, expectedHours: 8 }) },
      { id: 3, s: summarize(usage([]), { from: D0, to: D0 + 86400, expectedHours: 8 }) },
    ]
    expect(pickRows(rows, 'over').map(r => r.id)).toEqual([1])
    expect(pickRows(rows, 'under').map(r => r.id)).toEqual([2, 3])
    expect(pickRows(rows, 'notUsed').map(r => r.id)).toEqual([3])
    expect(pickRows(rows, 'asset')).toHaveLength(3)
    expect(hhmm(9 * 3600 + 90)).toBe('9:02')
  })

  it('expects only the hours gone by in a part-day period', () => {
    const s = summarize(usage([{ date: '2026-11-03', utilisedSec: 3 * 3600, km: 40 }]), { from: D0, to: D0 + 6 * 3600 })
    expect(s.expectedSec).toBe(6 * 3600)
    expect(s.vsExpectedPct).toBeCloseTo(50)
    expect(s.periodDays).toBe(1)
  })
})

describe('usageByDay in another time zone', () => {
  it('cuts the days at the midnight of the offset given', () => {
    // 2026-11-03 23:30 UAE = 2026-11-04 00:30 in UTC+5.
    const msgs = [msg(23.5 * 3600 - 300), msg(23.5 * 3600 + 300)]
    const uae = usageByDay(msgs, D0, D0 + 2 * 86400)
    expect([...uae.days.keys()]).toEqual(['2026-11-03'])
    const pk = usageByDay(msgs, D0, D0 + 2 * 86400, { tzOffsetSec: 5 * 3600 })
    expect([...pk.days.keys()]).toEqual(['2026-11-04'])
  })
})
