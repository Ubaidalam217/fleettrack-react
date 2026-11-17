import { describe, expect, it } from 'vitest'
import { computeSchedule, overrideArrival, timingOf, displayStatus, journeyRef, diffText, legMinutes } from './journeySchedule.js'

const T0 = Date.parse('2026-11-18T06:00:00Z') // 10:00 UAE
const MIN = 60_000

describe('computeSchedule — the client example (2026-11-17)', () => {
  // leave Karachi 10:00 → Hyderabad 12:00 (2 h) → stay 30 min → leave 12:30 → next leg 2 h…
  const stops = [
    { name: 'Karachi' },
    { name: 'Hyderabad', legDriveMin: 120, legSource: 'TRIP', stayMin: 30 },
    { name: 'Sukkur', legDriveMin: 120, legSource: 'TRIP', stayMin: 15 },
    { name: 'Multan', legDriveMin: 90, legSource: 'MANUAL' },
  ]
  const s = computeSchedule({ plannedStart: T0, stops })

  it('chains arrive and leave times', () => {
    expect(s.stops[0].plannedDepart.getTime()).toBe(T0)
    expect(s.stops[1].plannedArrive.getTime()).toBe(T0 + 120 * MIN)
    expect(s.stops[1].plannedDepart.getTime()).toBe(T0 + 150 * MIN)
    expect(s.stops[2].plannedArrive.getTime()).toBe(T0 + 270 * MIN)
    expect(s.stops[2].plannedDepart.getTime()).toBe(T0 + 285 * MIN)
    expect(s.stops[3].plannedArrive.getTime()).toBe(T0 + 375 * MIN)
    expect(s.stops[3].plannedDepart).toBeNull()
    expect(s.expectedArrival.getTime()).toBe(T0 + 375 * MIN)
    expect(s).toMatchObject({ driveMin: 330, stayMin: 45, totalMin: 375 })
  })

  it('an overridden arrival shifts every time after it, nothing before it', () => {
    const moved = overrideArrival(stops, 2, new Date(T0 + 300 * MIN), s)
    const s2 = computeSchedule({ plannedStart: T0, stops: moved })
    expect(s2.stops[1].plannedArrive.getTime()).toBe(T0 + 120 * MIN)
    expect(s2.stops[2]).toMatchObject({ legDriveMin: 150, legSource: 'MANUAL' })
    expect(s2.stops[2].plannedArrive.getTime()).toBe(T0 + 300 * MIN)
    expect(s2.stops[3].plannedArrive.getTime()).toBe(T0 + 405 * MIN)
  })

  it('SPEED legs come from km ÷ the planned speed', () => {
    const r = computeSchedule({ plannedStart: T0, speedKmh: 60, stops: [{}, { legKm: 90 }] })
    expect(r.stops[1]).toMatchObject({ legDriveMin: 90, legSource: 'SPEED' })
    expect(legMinutes(0.1, 70)).toBe(1)
    expect(legMinutes(0, 70)).toBe(0)
  })
})

describe('the six events', () => {
  it('early, on time and late against the tolerance', () => {
    expect(timingOf(T0 + 9 * MIN, T0, 10)).toEqual({ timing: 'ON_TIME', diffMin: 9 })
    expect(timingOf(T0 - 10 * MIN, T0, 10)).toEqual({ timing: 'ON_TIME', diffMin: -10 })
    expect(timingOf(T0 + 11 * MIN, T0, 10)).toEqual({ timing: 'LATE', diffMin: 11 })
    expect(timingOf(T0 - 25 * MIN, T0, 10)).toEqual({ timing: 'EARLY', diffMin: -25 })
    expect(timingOf(null, T0)).toBeNull()
  })
  it('writes the difference', () => {
    expect(diffText(8)).toBe('+8 min')
    expect(diffText(-75)).toBe('−1 h 15 min')
  })
})

describe('labels', () => {
  it('shows Pending and Rejected as their own states', () => {
    expect(displayStatus({ status: 'Draft', approvalStatus: 'PENDING' })).toBe('Pending')
    expect(displayStatus({ status: 'Draft', approvalStatus: 'REJECTED' })).toBe('Rejected')
    expect(displayStatus({ status: 'InProgress', approvalStatus: 'APPROVED' })).toBe('InProgress')
  })
  it('numbers by the UAE year of the start', () => {
    expect(journeyRef({ journeyNo: 12, plannedStart: '2026-12-31T21:00:00Z' })).toBe('JRN-2027-0012')
  })
})
