import { describe, expect, it } from 'vitest'
import { driverTimeline, driverIdentity, tagIdentity, driverPasses, driverFilterLabel, NO_DRIVER } from './driverAtTime'

const drivers = [{ id: 'a', name: 'Ali', ibuttonCode: '01AB' }, { id: 'b', name: 'Bilal', ibuttonCode: '02CD' }]
const driverForTag = key => drivers.find(d => d.ibuttonCode === key) ?? null
const m = (ts, o = {}) => ({ timestamp: ts, 'engine.ignition.status': true, ...o })

describe('driverTimeline', () => {
  it('names the run from its start by the first tag read, until ignition off', () => {
    const at = driverTimeline([
      m(0, { 'engine.ignition.status': false }),
      m(100), m(160, { 'ibutton.code': '01:ab' }), m(300),
      m(400, { 'engine.ignition.status': false }),
      m(500), m(600),
    ], { driverForTag, assigned: driverIdentity(drivers[1]) })
    expect(at(50).label).toBe('Bilal')     // before any run: assigned
    expect(at(100).label).toBe('Ali')      // run start takes the tag read at 160
    expect(at(350).label).toBe('Ali')
    expect(at(450).label).toBe('Bilal')    // after ignition off: assigned again
    expect(at(550).label).toBe('Bilal')
  })

  it('switches on a new tag mid-run and labels unknown cards', () => {
    const at = driverTimeline([
      m(0), m(10, { 'ibutton.code': '01AB' }), m(100, { 'ibutton.code': 'FFEE' }), m(200),
    ], { driverForTag })
    expect(at(5).label).toBe('Ali')
    expect(at(150)).toEqual({ key: 'u:FFEE', label: 'Unregistered Driver · ID FFEE' })
  })

  it('falls back to No driver, and ignores the all-zero tag', () => {
    const at = driverTimeline([m(0, { 'ibutton.code': '0000' }), m(10)], { driverForTag })
    expect(at(5)).toBe(NO_DRIVER)
  })
})

describe('filters and identities', () => {
  it('passes by key, and u:* passes any unregistered card', () => {
    expect(driverPasses({ key: 'd:a' }, null)).toBe(true)
    expect(driverPasses({ key: 'd:a' }, new Set(['d:b']))).toBe(false)
    expect(driverPasses({ key: 'u:FF' }, new Set(['u:*']))).toBe(true)
    expect(tagIdentity('02cd', driverForTag)).toEqual({ key: 'd:b', label: 'Bilal' })
    expect(driverIdentity('Legacy Name')).toEqual({ key: 'n:Legacy Name', label: 'Legacy Name' })
    expect(driverFilterLabel(new Set(['d:a', 'none']), [{ key: 'd:a', label: 'Ali' }, { key: 'none', label: 'No driver' }])).toBe('Ali, No driver')
  })
})

describe('runsForDrivers', () => {
  it('keeps the intervals of the chosen drivers whole', async () => {
    const { runsForDrivers } = await import('./driverAtTime')
    const msgs = [0, 10, 20, 30, 40].map(ts => ({ timestamp: ts }))
    const at = ts => (ts >= 20 && ts < 40 ? { key: 'd:b' } : { key: 'd:a' })
    expect(runsForDrivers(msgs, at, new Set(['d:a'])).map(r => r.map(x => x.timestamp))).toEqual([[0, 10, 20], [40]])
    expect(runsForDrivers(msgs, at, null)[0]).toHaveLength(5)
  })
})
