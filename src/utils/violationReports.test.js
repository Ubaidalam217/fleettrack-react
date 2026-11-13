import { describe, expect, it } from 'vitest'
import {
  buildViolations, violationNames, eventName, detailDays, summaryDays, statisticsDays, violationTotals,
  hhmmss, ctrackDate, ctrackTime, isViolationType, UNCATEGORIZED,
} from './violationReports'
import { NO_DRIVER } from './driverAtTime'
import { isOilGasViolation } from './oilGasViolations'

const at = (day, hms) => new Date(`2026-11-${day}T${hms}`) // local time, as the report groups days
const iso = (day, hms) => at(day, hms).toISOString()
const sec = (day, hms) => Math.floor(at(day, hms).getTime() / 1000)

const vehicles = [
  { id: 1, name: 'dev-1', ident: '111', master: { plateNo: 'Kenworth-9072' } },
  { id: 2, name: 'dev-2', ident: '222', master: { plateNo: 'Actros-76849' } },
]
const rules = [
  { id: 'r1', name: 'Adnoc-over-speed-alarm', type: 'overspeed', settings: { speedKmh: '80' } },
  { id: 'r2', name: 'Adnoc-over-speed', type: 'overspeed', settings: { speedKmh: '90' } },
  { id: 'r3', name: 'Gate', type: 'geofence', settings: {} },
  { id: 'r4', name: 'Docs', type: 'license_expiry', settings: {} },
]
const ev = (id, o) => ({ id, deviceId: 1, alertId: 'r1', type: 'overspeed', severity: 'High', title: 'Adnoc-over-speed-alarm', ...o })

const events = [
  ev('a', { occurredAt: iso('01', '04:07:27'), endedAt: iso('01', '04:07:33'), durationSec: 6, peakValue: 83, driver: { id: 'd1', name: 'Werede' } }),
  ev('b', { occurredAt: iso('01', '04:21:38'), endedAt: iso('01', '04:22:12'), durationSec: 34, peakValue: 94, alertId: 'r2', title: 'Adnoc-over-speed', driver: { id: 'd1', name: 'Werede' } }),
  ev('c', { occurredAt: iso('01', '05:00:00'), endedAt: iso('01', '05:00:09'), durationSec: 9, peakValue: 88, deviceId: 2 }),
  ev('d', { occurredAt: iso('02', '09:00:00'), endedAt: iso('02', '09:01:00'), durationSec: 60, peakValue: 101, driver: { id: 'd2', name: 'Abdul' } }),
  ev('e', { occurredAt: iso('02', '10:00:00'), alertId: 'r3', type: 'geofence', title: 'Gate', driver: { id: 'd2', name: 'Abdul' } }),
]
const opts = {
  vehicles,
  rules,
  siteOf: v => (v?.id === 1 ? 'Yard 1' : ''),
  departmentOf: who => (who.key === 'd:d1' ? 'Logistics' : ''),
}

describe('violationReports', () => {
  it('formats like the samples', () => {
    expect(hhmmss(337)).toBe('00:05:37')
    expect(hhmmss(39570)).toBe('10:59:30')
    expect(hhmmss(100000)).toBe('27:46:40')
    expect(ctrackDate(new Date(2026, 10, 1))).toBe('01 Nov, 2026')
    expect(ctrackTime(sec('13', '04:07:27'))).toBe('04:07:27')
  })

  it('names the event after its rule, else its title, else its type', () => {
    const byId = new Map(rules.map(r => [r.id, r]))
    expect(eventName({ alertId: 'r2', title: 'old' }, byId)).toBe('Adnoc-over-speed')
    expect(eventName({ alertId: 'gone', title: 'Zone speed · recorded' }, byId)).toBe('Zone speed')
    expect(eventName({ type: 'idle' }, byId, t => `T:${t}`)).toBe('T:idle')
  })

  it('offers every rule name, ignition and geo zone enter / exit off by default', () => {
    const names = violationNames(events, rules, t => t)
    expect(names.map(n => n.name)).toEqual(['Adnoc-over-speed', 'Adnoc-over-speed-alarm', 'Gate'])
    expect(names.find(n => n.name === 'Gate').byDefault).toBe(false)
    expect(isViolationType('ignition_on')).toBe(false)
    expect(isViolationType('harsh_braking')).toBe(true)
  })

  it('Oil & Gas: offers and builds only its violation types, whatever names are picked', () => {
    const withTemp = [...events, ev('t', { occurredAt: iso('02', '11:00:00'), alertId: null, type: 'temperature', title: 'Reefer temp' })]
    const names = violationNames(withTemp, rules, t => t, { keepType: isOilGasViolation })
    expect(names.map(n => n.name)).toEqual(['Adnoc-over-speed', 'Adnoc-over-speed-alarm'])
    expect(names.every(n => n.byDefault)).toBe(true)
    expect(buildViolations(withTemp, null, { ...opts, keepType: isOilGasViolation }).map(v => v.key)).toEqual(['a', 'b', 'c', 'd'])
    // Ticking a left-out name by hand does not bring it back.
    const picked = buildViolations(withTemp, null, { ...opts, keepType: isOilGasViolation, names: new Set(['Gate', 'Reefer temp', 'Adnoc-over-speed']) })
    expect(picked.map(v => v.key)).toEqual(['b'])
  })

  it('builds one violation per event with its driver, site, asset and category', () => {
    const list = buildViolations(events, null, opts)
    expect(list.map(v => v.key)).toEqual(['a', 'b', 'c', 'd'])
    expect(list[0]).toMatchObject({ event: 'Adnoc-over-speed-alarm', asset: 'Kenworth-9072', site: 'Yard 1', driver: 'Werede', department: 'Logistics', durationSec: 6, speed: 83 })
    expect(list[2]).toMatchObject({ asset: 'Actros-76849', site: '', driver: NO_DRIVER.label, department: UNCATEGORIZED, siteCategory: UNCATEGORIZED })
    // Picking names replaces the default: Gate in, the alarm out.
    const picked = buildViolations(events, null, { ...opts, names: new Set(['Gate', 'Adnoc-over-speed']) })
    expect(picked.map(v => v.key)).toEqual(['b', 'e'])
    // The driver filter.
    expect(buildViolations(events, null, { ...opts, driverFilter: new Set(['d:d2']) }).map(v => v.key)).toEqual(['d'])
  })

  it('falls back to the driver at that moment, then the assigned driver', () => {
    const noDriver = events.slice(2, 3)
    const timeline = buildViolations(noDriver, null, { ...opts, driverAt: () => () => ({ key: 'd:t', label: 'Tagged' }) })
    expect(timeline[0].driver).toBe('Tagged')
    const assigned = buildViolations(noDriver, null, { ...opts, assignedFor: () => ({ key: 'd:a', label: 'Assigned' }) })
    expect(assigned[0].driver).toBe('Assigned')
  })

  it('lists the details per day, by driver then time, with the day totals', () => {
    const days = detailDays(buildViolations(events, null, opts), { by: 'driver' })
    expect(days.map(d => d.label)).toEqual(['01 Nov, 2026', '02 Nov, 2026'])
    expect(days[0].rows.map(r => r.key)).toEqual(['c', 'a', 'b']) // "No driver" < "Werede"
    expect(days[0].totals).toEqual({ count: 3, durationSec: 49, maxSpeed: 94, events: 2 })
    const byAsset = detailDays(buildViolations(events, null, opts), { by: 'vehicle' })
    expect(byAsset[0].rows.map(r => r.key)).toEqual(['c', 'a', 'b']) // Actros < Kenworth
  })

  it('sums each driver, asset and event per day, by asset then event', () => {
    const more = [...events, ev('f', { occurredAt: iso('01', '06:00:00'), endedAt: iso('01', '06:00:20'), durationSec: 20, peakValue: 90, driver: { id: 'd1', name: 'Werede' } })]
    const days = summaryDays(buildViolations(more, null, opts))
    expect(days[0].lines.map(l => [l.asset, l.event, l.driver, l.count, l.durationSec, l.maxSpeed])).toEqual([
      ['Actros-76849', 'Adnoc-over-speed-alarm', 'No driver', 1, 9, 88],
      ['Kenworth-9072', 'Adnoc-over-speed', 'Werede', 1, 34, 94],
      ['Kenworth-9072', 'Adnoc-over-speed-alarm', 'Werede', 2, 26, 90],
    ])
    expect(days[0].totals).toEqual({ lines: 3, durationSec: 69, count: 4 })
    expect(violationTotals(buildViolations(more, null, opts))).toMatchObject({ count: 5, events: 2 })
  })

  it('counts each category per day, UnCategorized last', () => {
    const days = statisticsDays(buildViolations(events, null, opts), { by: 'driver' })
    expect(days[0].categories.map(c => [c.category, c.count, c.durationSec])).toEqual([
      ['Logistics', 2, 40],
      [UNCATEGORIZED, 1, 9],
    ])
    const bySite = statisticsDays(buildViolations(events, null, opts), { by: 'vehicle' })
    expect(bySite[0].categories.map(c => c.category)).toEqual(['Yard 1', UNCATEGORIZED])
  })
})
