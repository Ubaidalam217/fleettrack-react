import { describe, expect, it } from 'vitest'
import { aed, byCategory, daysBetween, expenseRows, groupByVehicle, monthsBetween, usageInRange, vehicleCost } from './expenseReport'

const v1 = { id: 'v1', plateNo: 'AD 1', imei: '863071011234501', branch: { name: 'Main' } }
const v2 = { id: 'v2', plateNo: 'AD 2', imei: '863071011234502' }
const expenses = [
  { id: 'a', vehicle: v1, category: 'Variable', type: 'Fuel', expenseDate: '2026-11-05', amount: 200, odometer: 1000 },
  { id: 'b', vehicle: v1, category: 'Variable', type: 'Fines', expenseDate: '2026-10-31', amount: 500 },
  // 30-day insurance, 20 of its days in the range
  { id: 'c', vehicle: v2, category: 'Fix', type: 'Insurance', fromDate: '2026-10-22', toDate: '2026-11-20', amount: 3000 },
  { id: 'd', vehicle: v2, category: 'Variable', type: 'Fuel', expenseDate: '2026-11-10', amount: 100 },
]

describe('expense report', () => {
  it('counts days and months of a range', () => {
    expect(daysBetween('2026-11-01', '2026-11-30')).toBe(30)
    expect(daysBetween('2026-11-02', '2026-11-01')).toBe(0)
    expect(monthsBetween('2026-11-20', '2027-01-05')).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 12 }, { year: 2027, month: 1 }])
  })

  it('keeps Variable expenses in the range and spreads a Fix one by days', () => {
    const rows = expenseRows(expenses, '2026-11-01', '2026-11-30')
    expect(rows.map(r => r.id)).toEqual(['c', 'a', 'd'])
    const fix = rows.find(r => r.id === 'c')
    expect(fix.amount).toBeCloseTo(2000, 6)
    expect(fix.spread).toEqual({ days: 20, of: 30 })
    expect(rows.find(r => r.id === 'a').spread).toBeNull()
  })

  it('groups per vehicle and per category', () => {
    const rows = expenseRows(expenses, '2026-11-01', '2026-11-30')
    const groups = groupByVehicle(rows)
    expect(groups.map(g => [g.plate, g.total])).toEqual([['AD 1', 200], ['AD 2', 2100]])
    const cats = byCategory(rows)
    expect(cats[0]).toMatchObject({ category: 'Fix', type: 'Insurance', count: 1 })
    expect(cats.find(c => c.type === 'Fuel')).toMatchObject({ count: 2, amount: 300 })
    expect(cats.reduce((s, c) => s + c.share, 0)).toBeCloseTo(100, 6)
  })

  it('sums km and engine time inside the range and works out the vehicle cost', () => {
    const devices = new Map([[11, { distanceKm: [0, 10, 20, 30], ignitionSec: [0, 3600, 3600, 7200] }]])
    const usage = usageInRange([{ year: 2026, month: 11, devices }], '2026-11-02', '2026-11-30')
    expect(usage.get(11)).toEqual({ km: 50, sec: 10800 })

    const groups = groupByVehicle(expenseRows(expenses, '2026-11-01', '2026-11-30'))
    const cost = vehicleCost(groups, new Map([['863071011234501', usage.get(11)]]), 30)
    expect(cost[0]).toMatchObject({ plate: 'AD 1', km: 50, hours: 3, perKm: 4 })
    expect(cost[0].perHour).toBeCloseTo(200 / 3, 6)
    expect(cost[0].perDay).toBeCloseTo(200 / 30, 6)
    expect(cost[1]).toMatchObject({ plate: 'AD 2', km: null, perKm: null, perHour: null })
  })

  it('formats AED', () => {
    expect(aed(1234.5)).toBe('AED 1,234.50')
    expect(aed(null)).toBe('—')
  })
})
