import { describe, it, expect } from 'vitest'
import {
  monthFigures, utilization, safetyScore, liveUptime, fleetScore, todayFigures,
  driveEfficiency, maintenanceFigures, expenseFigures, imeiSet, pctChange,
  normalizeAlertEvents, alertOverview, alertCategories, recentOfType, isRecordedOnly,
} from './dashboardStats.js'

const dayArr = (vals, days = 30) => {
  const a = new Array(days + 1).fill(0)
  vals.forEach((v, i) => { a[i + 1] = v })
  return a
}

describe('monthFigures / utilization', () => {
  const derived = new Map([
    [1, { distanceKm: dayArr([10, 0, 5]), ignitionSec: dayArr([3600, 0, 1800]) }],
    [2, { distanceKm: dayArr([0, 0.4, 20]), ignitionSec: dayArr([0, 600, 7200]) }],
  ])

  it('sums the selected devices per day, up to the elapsed day', () => {
    const m = monthFigures(derived, [1, 2], 3)
    expect(m.dailyKm).toEqual([10, 0.4, 25])
    expect(m.dailySec).toEqual([3600, 600, 9000])
    expect(m.totalKm).toBeCloseTo(35.4)
    expect(m.totalSec).toBe(13200)
  })

  it('counts a vehicle-day as used from 1 km', () => {
    const m = monthFigures(derived, [1, 2], 3)
    expect(m.usedDays).toBe(3) // 1:d1, 1:d3, 2:d3 — 0.4 km does not count
    expect(m.vehicleDays).toBe(6)
    expect(utilization(m)).toBe(50)
  })

  it('leaves out devices that are not selected', () => {
    expect(monthFigures(derived, [2], 3).totalKm).toBeCloseTo(20.4)
  })

  it('has no utilization without vehicles', () => {
    expect(utilization(monthFigures(derived, [], 3))).toBeNull()
  })
})

describe('safetyScore', () => {
  it('is null when the fleet did not drive', () => {
    expect(safetyScore([], 0.5)).toBeNull()
  })

  it('takes weighted events per 100 km off 100, at least 50 km counted', () => {
    expect(safetyScore([], 300)).toBe(100)
    // 2 overspeed (5 each) + 1 harsh braking (4) = 14 points per 200 km → 7
    expect(safetyScore([{ type: 'overspeed' }, { type: 'overspeed' }, { type: 'harsh_braking' }], 200)).toBe(93)
    // 10 km driven still counts as 50 km: 5 points per 50 km → 10
    expect(safetyScore([{ type: 'overspeed' }], 10)).toBe(90)
  })

  it('ignores event types that are not driving violations', () => {
    expect(safetyScore([{ type: 'ignition_on' }, { type: 'geofence' }], 100)).toBe(100)
  })

  it('never goes below 0', () => {
    expect(safetyScore(Array.from({ length: 100 }, () => ({ type: 'overspeed' })), 50)).toBe(0)
  })
})

describe('liveUptime / fleetScore', () => {
  it('counts vehicles that reported within 15 minutes', () => {
    const now = 1_000_000
    expect(liveUptime([{ lastTs: now - 60 }, { lastTs: now - 3600 }, { lastTs: null }, { lastTs: now - 899 }], now)).toBe(50)
    expect(liveUptime([], now)).toBeNull()
    expect(liveUptime([{ lastTs: now - 3600 }, { lastTs: now - 90000 }], now, 86400)).toBe(50)
  })

  it('averages only the parts that exist', () => {
    expect(fleetScore({ safety: 90, utilization: 50 })).toBe(70)
    expect(fleetScore({ safety: null, utilization: 40 })).toBe(40)
    expect(fleetScore({ safety: null, utilization: null })).toBeNull()
  })
})

describe('todayFigures', () => {
  const trip = (o) => ({ distanceKm: 5, driveSec: 600, idleSec: 120, open: false, startTs: 1, endTs: 2, ...o })
  const vt = [
    { deviceId: 1, vehicleId: 'A', trips: [trip(), trip({ open: true, distanceKm: 2 }), trip({ distanceKm: 0.01 })] },
    { deviceId: 2, vehicleId: 'B', trips: [] },
    { deviceId: 3, vehicleId: 'C', trips: [trip()] },
  ]

  it('counts moving trips only, split into finished and on the road', () => {
    const t = todayFigures(vt, [1, 2])
    expect(t.trips).toBe(2)
    expect(t.completed).toBe(1)
    expect(t.inProgress).toBe(1)
    expect(t.km).toBe(7)
    expect(t.vehiclesMoved).toBe(1)
  })

  it('gives the moving share of engine time', () => {
    expect(driveEfficiency(todayFigures(vt, [3]))).toBe(83)
    expect(driveEfficiency({ driveSec: 0, idleSec: 0 })).toBeNull()
  })
})

describe('maintenanceFigures', () => {
  const rows = [
    { status: 'overdue', vehicle: { id: 'a', imei: '111' } },
    { status: 'due', vehicle: { id: 'b', imei: '222' } },
    { status: 'upcoming', vehicle: { id: 'a', imei: '111' } },
    { status: 'completed', vehicle: { id: 'c', imei: '333' } },
    { status: 'overdue', active: false, vehicle: { id: 'c', imei: '333' } },
  ]

  it('counts vehicles with something due, and the share in order', () => {
    const m = maintenanceFigures(rows)
    expect(m.rules).toBe(4)
    expect(m.dueVehicles).toBe(2)
    expect(m.overdueVehicles).toBe(1)
    expect(m.compliance).toBe(50)
  })

  it('narrows to the Dashboard filter by IMEI', () => {
    const m = maintenanceFigures(rows, imeiSet([{ ident: '222' }]))
    expect(m.rules).toBe(1)
    expect(m.dueVehicles).toBe(1)
  })

  it('has no compliance without reminders', () => {
    expect(maintenanceFigures([]).compliance).toBeNull()
  })
})

describe('expenseFigures', () => {
  const now = { year: 2026, month: 11 }

  it('puts a Variable expense in its month and totals by type', () => {
    const f = expenseFigures([
      { category: 'Variable', type: 'Fuel', amount: 100, expenseDate: '2026-11-03' },
      { category: 'Variable', type: 'Fuel', amount: 50, expenseDate: '2026-10-30' },
      { category: 'Variable', type: 'Fines', amount: 500, expenseDate: '2026-01-01' }, // older than 6 months
    ], now)
    expect(f.months.map(m => m.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'])
    expect(f.thisMonth).toBe(100)
    expect(f.total).toBe(150)
    expect(f.byType).toEqual([{ type: 'Fuel', amount: 150 }])
  })

  it('spreads a Fix expense over its period by days', () => {
    const f = expenseFigures([
      { category: 'Fix', type: 'Insurance', amount: 610, fromDate: '2026-10-01', toDate: '2026-11-30' },
    ], now)
    expect(f.months[4].amount).toBeCloseTo(310) // October, 31 of 61 days
    expect(f.months[5].amount).toBeCloseTo(300)
  })

  it('narrows to the filter, dropping expenses with no vehicle', () => {
    const list = [
      { category: 'Variable', type: 'Fuel', amount: 10, expenseDate: '2026-11-01', vehicle: { imei: '111' } },
      { category: 'Variable', type: 'Fuel', amount: 20, expenseDate: '2026-11-01', vehicle: { imei: '222' } },
      { category: 'Variable', type: 'Other', amount: 40, expenseDate: '2026-11-01', vehicle: null },
    ]
    expect(expenseFigures(list, now).total).toBe(70)
    expect(expenseFigures(list, now, 6, imeiSet([{ ident: '111' }])).total).toBe(10)
  })
})

describe('pctChange', () => {
  it('needs a base above zero', () => {
    expect(pctChange(150, 100)).toBe(50)
    expect(pctChange(50, 0)).toBeNull()
    expect(pctChange(null, 10)).toBeNull()
  })
})

describe('alert events (Alerts Overview, Alert Markers, AI Insights)', () => {
  const NOW = Date.parse('2026-11-11T18:00:00Z')
  const at = h => new Date(NOW - h * 3600 * 1000).toISOString()
  const rows = [
    { id: 'a', occurredAt: at(1), type: 'overspeed', severity: 'Critical', readAt: null, deviceId: 1, vehicle: { plateNo: 'AD 1' }, title: 'Speed' },
    { id: 'b', occurredAt: at(2), type: 'overspeed', severity: 'High', readAt: at(1), deviceId: 2, vehicle: { plateNo: 'AD 2' }, title: 'Speed' },
    { id: 'c', occurredAt: at(3), type: 'idle', severity: 'Medium', readAt: null, deviceId: 1, vehicle: null, title: 'Idle' },
    { id: 'd', occurredAt: at(5), type: 'geofence_speed', severity: 'Low', readAt: at(5), deviceId: 1, title: 'Zone · recorded' },
    { id: 'e', occurredAt: at(30), type: 'ignition_on', severity: 'Low', readAt: at(29), deviceId: 2, title: 'On' },
    { id: 'f', occurredAt: at(10), type: 'license_expiry', severity: 'High', readAt: null, deviceId: null, title: 'Licence' },
  ]

  it('drops recorded-only events and narrows to the filter only when asked', () => {
    expect(isRecordedOnly(rows[3])).toBe(true)
    const all = normalizeAlertEvents(rows)
    expect(all.map(e => e.id)).toEqual(['a', 'b', 'c', 'f', 'e'])
    expect(all[0]).toMatchObject({ vehicleName: 'AD 1', read: false, severity: 'Critical' })
    expect(normalizeAlertEvents(rows, new Set([1])).map(e => e.id)).toEqual(['a', 'c'])
  })

  it('counts the last 24 h by severity and the week read', () => {
    const o = alertOverview(normalizeAlertEvents(rows), NOW)
    expect(o).toEqual({ critical: 1, high: 2, routine: 1, acknowledged: 2 })
    expect(alertOverview([], NOW)).toEqual({ critical: 0, high: 0, routine: 0, acknowledged: 0 })
  })

  it('groups the last 24 h by type, most first', () => {
    expect(alertCategories(normalizeAlertEvents(rows), NOW)).toEqual([
      { type: 'overspeed', count: 2 }, { type: 'idle', count: 1 }, { type: 'license_expiry', count: 1 },
    ])
  })

  it('picks one type within a window', () => {
    const ev = normalizeAlertEvents(rows)
    expect(recentOfType(ev, 'overspeed', 3600 * 1000 * 1.5, NOW).map(e => e.id)).toEqual(['a'])
    expect(recentOfType(ev, 'idle', 3600 * 1000, NOW)).toEqual([])
    expect(recentOfType(undefined, 'idle', 3600 * 1000, NOW)).toEqual([])
  })
})
