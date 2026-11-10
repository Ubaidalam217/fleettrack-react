import { describe, expect, it } from 'vitest'
import { overview, VIOLATION_TYPES } from './violationOverview'

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
