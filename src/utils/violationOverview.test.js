import { describe, expect, it } from 'vitest'
import { overview, overviewByRule, periodDays, localDay, VIOLATION_TYPES } from './violationOverview'

const ev = (deviceId, type, severity = 'Medium', at = '2026-11-03T08:00:00Z', driver) => ({ deviceId, type, severity, occurredAt: at, ...(driver ? { driver: { name: driver } } : {}) })
const opts = { vehicleLabel: id => `V${id}`, assignedDriver: id => (id === 1 ? 'Ali' : '') }

describe('overview', () => {
  const events = [
    ev(1, 'overspeed', 'High', '2026-11-03T08:00:00Z'),
    ev(1, 'overspeed', 'Medium', '2026-11-03T09:00:00Z'),
    ev(1, 'idle', 'Low', '2026-11-04T09:00:00Z', 'Omar'),
    ev(2, 'night_driving', 'Critical'),
    ev(2, 'ignition_on'),
  ]

  it('counts each kind per vehicle, most first, with the high-severity share', () => {
    const o = overview(events, { ...opts, types: VIOLATION_TYPES })
    expect(o.total).toBe(4)
    expect(o.rows.map(r => r.label)).toEqual(['V1', 'V2'])
    expect(o.rows[0].counts).toEqual({ overspeed: 2, idle: 1 })
    expect(o.rows[0].high).toBe(1)
    expect(o.high).toBe(2)
    expect([...o.rows[0].drivers].sort()).toEqual(['Ali', 'Omar'])
    expect(o.rows[0].last - o.rows[0].first).toBe(25 * 3600)
    expect(o.totals).toEqual({ overspeed: 2, idle: 1, night_driving: 1 })
  })

  it('groups by driver, the tag read first and the assigned driver otherwise', () => {
    const o = overview(events, { ...opts, by: 'driver', types: VIOLATION_TYPES })
    expect(o.rows.map(r => [r.label, r.total])).toEqual([['Ali', 2], ['No driver', 1], ['Omar', 1]])
  })

  it('keeps only the severities asked for', () => {
    expect(overview(events, { ...opts, severities: ['High', 'Critical'] }).total).toBe(2)
  })
})

describe('overviewByRule', () => {
  const at = (d, h) => new Date(2026, 10, d, h, 0, 0).toISOString()
  const e = (alertId, day, deviceId, driver, title) => ({
    id: `${alertId}-${day}-${deviceId}`, alertId, type: 'overspeed', title, deviceId, occurredAt: at(day, 9),
    ...(driver ? { driver: { id: driver, name: driver } } : {}),
  })
  const names = new Map([['a1', 'Adnoc-over-speed'], ['a2', 'adnoc seat belt'], ['a3', 'Harsh Braking']])
  const opts = {
    ruleNames: [...names.values()],
    nameOf: ev => names.get(ev.alertId) || ev.title,
    days: ['2026-11-07', '2026-11-08', '2026-11-09'],
    dayOf: localDay,
    entityOf: ev => (ev.driver ? { key: `d:${ev.driver.id}`, label: ev.driver.name } : { key: 'none', label: 'No driver' }),
  }
  const events = [
    e('a1', 7, 1, 'Zaheer'), e('a1', 9, 1, 'Zaheer'), e('a1', 9, 2, 'Azhar'),
    e('a3', 8, 2, 'Azhar'),
    e('gone', 8, 3, null, 'Old rule'),
  ]

  it('lists every rule by name, unbroken ones as zeros, with a count per day', () => {
    const o = overviewByRule(events, opts)
    expect(o.rules.map(r => [r.label, r.total])).toEqual([
      ['adnoc seat belt', 0], ['Adnoc-over-speed', 3], ['Harsh Braking', 1], ['Old rule', 1],
    ])
    expect(o.rules[1].byDay).toEqual({ '2026-11-07': 1, '2026-11-08': 0, '2026-11-09': 2 })
    expect(o.total).toBe(5)
  })

  it('counts each rule per entity with the sum, by name', () => {
    const o = overviewByRule(events, opts)
    expect(o.entities.map(en => [en.label, en.counts, en.total])).toEqual([
      ['Azhar', { 'Adnoc-over-speed': 1, 'Harsh Braking': 1 }, 2],
      ['No driver', { 'Old rule': 1 }, 1],
      ['Zaheer', { 'Adnoc-over-speed': 2 }, 2],
    ])
    expect(o.items.filter(it => it.entity.key === 'd:Zaheer').map(it => it.day)).toEqual(['2026-11-07', '2026-11-09'])
  })

  it('keeps only the rules and entities asked for', () => {
    const o = overviewByRule(events, { ...opts, keepRule: n => n !== 'Harsh Braking', keepEntity: who => who.key !== 'none' })
    expect(o.rules.map(r => r.label)).toEqual(['adnoc seat belt', 'Adnoc-over-speed'])
    expect(o.total).toBe(3)
  })
})

describe('periodDays', () => {
  it('lists each local day of the period', () => {
    const from = new Date(2026, 10, 7, 0, 0, 0).getTime() / 1000
    const to = new Date(2026, 10, 13, 23, 59, 59).getTime() / 1000
    expect(periodDays(from, to)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
    expect(periodDays(from, from + 60)).toEqual(['2026-11-07'])
  })
})
