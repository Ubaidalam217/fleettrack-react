import { describe, expect, it } from 'vitest'
import { assignmentSpan, createDriverHistory, creditAt, tagSpan } from './driverHistory'
import { driverIdentity, driverTimeline, NO_DRIVER } from './driverAtTime'

// Client, 2026-11-13: "All the drivers names will stay as it is, it will not
// replace with last one saved." A past trip keeps the driver who drove it.

const T = iso => Math.floor(Date.parse(iso) / 1000)
const SWAP = '2026-11-10T08:00:00.000Z' // Ubaid hands vehicle X to Ali
const REMOVED = '2026-11-12T09:00:00.000Z' // Ali is removed

const history = createDriverHistory({
  drivers: [
    { id: 'ubaid', name: 'Ubaid', removed: false },
    { id: 'ali', name: 'Ali', removed: true },
    { id: 'sara', name: 'Sara', removed: false },
  ],
  assignments: [
    { driverId: 'ubaid', vehicleId: 'X', role: 'Primary', startDate: '2026-11-01T06:00:00.000Z', endDate: SWAP },
    { driverId: 'ali', vehicleId: 'X', role: 'Primary', startDate: SWAP, endDate: REMOVED },
    // Sara covers X for the whole UAE day of 11 Nov (dates are stored at UTC midnight).
    { driverId: 'sara', vehicleId: 'X', role: 'Temporary', startDate: '2026-11-11T00:00:00.000Z', endDate: '2026-11-11T00:00:00.000Z' },
  ],
  tags: [
    // Tag AB12 was Ubaid's (first holder: since always), then moved to Sara.
    { driverId: 'ubaid', code: 'AB12', startDate: null, endDate: '2026-11-05T00:00:00.000Z' },
    { driverId: 'sara', code: 'AB12', startDate: '2026-11-05T00:00:00.000Z', endDate: null },
  ],
})

describe('driver history: names stay as they were', () => {
  it('replace a driver: trips before the swap keep the old name, later ones the new', () => {
    expect(history.assignedAt('X', T('2026-11-09T10:00:00Z'))).toBe('ubaid')
    expect(history.assignedAt('X', T('2026-11-10T07:59:59Z'))).toBe('ubaid')
    expect(history.assignedAt('X', T('2026-11-10T08:00:00Z'))).toBe('ali')
    expect(history.assignedAt('X', T('2026-11-12T08:00:00Z'))).toBe('ali')
  })

  it('remove a driver: their trips keep the name; after removal nobody is assigned', () => {
    expect(history.driver(history.assignedAt('X', T('2026-11-12T08:59:00Z')))).toMatchObject({ name: 'Ali', removed: true })
    expect(history.assignedAt('X', T('2026-11-12T09:00:00Z'))).toBeNull()
  })

  it('tag moved: old reads keep the old holder, new reads the new one', () => {
    expect(history.tagHolderAt('ab:12', T('2026-10-01T00:00:00Z'))).toBe('ubaid') // before any record: first holder
    expect(history.tagHolderAt('AB12', T('2026-11-04T23:00:00Z'))).toBe('ubaid')
    expect(history.tagHolderAt('AB12', T('2026-11-05T00:00:00Z'))).toBe('sara')
    expect(history.tagHolderAt('FFFF', T('2026-11-05T00:00:00Z'))).toBeNull()
  })

  it('a Temporary cover beats the Primary driver for its whole local day', () => {
    // 11 Nov UAE = 10 Nov 20:00Z .. 11 Nov 20:00Z.
    expect(history.assignedAt('X', T('2026-11-10T19:59:00Z'))).toBe('ali')
    expect(history.assignedAt('X', T('2026-11-10T20:00:00Z'))).toBe('sara')
    expect(history.assignedAt('X', T('2026-11-11T19:59:00Z'))).toBe('sara')
    expect(history.assignedAt('X', T('2026-11-11T20:00:00Z'))).toBe('ali')
  })

  it('credits a trip: tag holder then, else the assignment then, else nobody', () => {
    expect(creditAt(history, { vehicleId: 'X', tag: 'AB12', ts: T('2026-11-03T08:00:00Z') })).toEqual({ driverId: 'ubaid', via: 'tag' })
    expect(creditAt(history, { vehicleId: 'X', tag: 'BEEF', ts: T('2026-11-03T08:00:00Z') })).toEqual({ driverId: null, via: 'unknown tag', tag: 'BEEF' })
    expect(creditAt(history, { vehicleId: 'X', ts: T('2026-11-03T08:00:00Z') })).toEqual({ driverId: 'ubaid', via: 'assignment' })
    expect(creditAt(history, { vehicleId: 'X', ts: T('2026-10-01T08:00:00Z') })).toEqual({ driverId: null, via: 'none' })
  })

  it('lists who was assigned during a period', () => {
    expect(history.assignedDuring('X', T('2026-11-01T00:00:00Z'), T('2026-12-01T00:00:00Z')).sort()).toEqual(['ali', 'sara', 'ubaid'])
    expect(history.assignedDuring('X', T('2026-11-02T00:00:00Z'), T('2026-11-03T00:00:00Z'))).toEqual(['ubaid'])
    expect(history.hasVehicle('X')).toBe(true)
    expect(history.hasVehicle('Y')).toBe(false)
  })

  it('reads spans: dates as whole local days, exact times as they are, no start as always', () => {
    expect(assignmentSpan({ role: 'Temporary', startDate: '2026-11-11T00:00:00Z', endDate: null }).to).toBe(Infinity)
    expect(assignmentSpan({ role: 'Temporary', startDate: '2026-11-11T00:00:00Z', endDate: '2026-11-11T13:30:00Z' }).to).toBe(T('2026-11-11T13:30:00Z'))
    expect(tagSpan({ startDate: null, endDate: null })).toEqual({ from: -Infinity, to: Infinity })
  })
})

describe('driverTimeline over the history', () => {
  const m = (ts, o = {}) => ({ timestamp: ts, 'engine.ignition.status': true, ...o })
  const byId = id => history.driver(id)
  const opts = {
    driverForTag: (code, ts) => byId(history.tagHolderAt(code, ts)),
    assigned: driverIdentity({ id: 'today', name: 'Today’s driver' }), // must never be used with assignedAt
    assignedAt: ts => driverIdentity(byId(history.assignedAt('X', ts))),
  }

  it('names each untagged moment by the assignment then, not today’s driver', () => {
    const at = driverTimeline([m(T('2026-11-09T10:00:00Z')), m(T('2026-11-10T10:00:00Z')), m(T('2026-11-13T10:00:00Z'))], opts)
    expect(at(T('2026-11-09T10:00:00Z')).label).toBe('Ubaid')
    expect(at(T('2026-11-10T10:00:00Z')).label).toBe('Ali')
    expect(at(T('2026-11-13T10:00:00Z'))).toBe(NO_DRIVER)
  })

  it('names a tagged run by whoever held the tag when it was read', () => {
    const before = T('2026-11-04T10:00:00Z')
    const after = T('2026-11-06T10:00:00Z')
    const at = driverTimeline([
      m(before), m(before + 60, { 'ibutton.code': 'AB12' }), m(before + 600, { 'engine.ignition.status': false }),
      m(after), m(after + 60, { 'ibutton.code': 'AB12' }), m(after + 600, { 'engine.ignition.status': false }),
    ], opts)
    expect(at(before + 30).label).toBe('Ubaid')
    expect(at(after + 30).label).toBe('Sara')
  })

  it('keeps the old behaviour without a history lookup', () => {
    const at = driverTimeline([m(100)], { driverForTag: () => null, assigned: driverIdentity({ id: 'today', name: 'Today' }) })
    expect(at(100).label).toBe('Today')
  })
})
