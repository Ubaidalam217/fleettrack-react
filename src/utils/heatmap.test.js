import { describe, expect, it } from 'vitest'
import {
  presenceCells, eventCells, hotspots,
  normalizeHeatOptions, DEFAULT_HEAT_OPTIONS, heatRange, rangeDays, maxHeatDays, heatRangeProblem,
  heatVehicleIds, pickVehicles, joinMessages, eventsFor, durationText, heatCaption, heatPeriodLabel,
} from './heatmap'

const at = (t, lat, lng, speed, ign = true) => ({ timestamp: t, 'position.latitude': lat, 'position.longitude': lng, 'position.speed': speed, 'engine.ignition.status': ign })

describe('presenceCells', () => {
  // Parked 2 h at the depot (ignition off), then 10 min idling there, then driving.
  const depot = [24.4, 54.4]
  const msgs = [
    at(0, ...depot, 0, false), at(3600, ...depot, 0, false), at(7200, ...depot, 0, true),
    at(7800, ...depot, 0, true), at(7860, 24.41, 54.41, 40), at(7920, 24.42, 54.42, 50),
  ]
  const byVehicle = new Map([[1, msgs]])

  it('counts time, by what the vehicle was doing', () => {
    const all = presenceCells(byVehicle, { mode: 'all' })
    expect(all.totalSec).toBe(7920) // the last reading has no "until next"
    const engine = presenceCells(byVehicle, { mode: 'engine' })
    expect(engine.totalSec).toBe(600 + 60 + 60)
    const moving = presenceCells(byVehicle, { mode: 'moving' })
    expect(moving.totalSec).toBe(60)
    expect(moving.cells).toHaveLength(1)
  })

  it('stops count standing time, parked or idling; idle only with the engine on', () => {
    // 2 h parked + 10 min idling at the depot; the 40 km/h minute does not count.
    const stopped = presenceCells(byVehicle, { mode: 'stopped' })
    expect(stopped.totalSec).toBe(3600 + 3600 + 600 + 60)
    expect(stopped.cells).toHaveLength(1)
    expect(presenceCells(byVehicle, { mode: 'idle' }).totalSec).toBe(600 + 60)
    // GPS drift at a standstill (2 km/h) is still standing; 3 km/h is moving.
    const drift = new Map([[1, [at(0, 24.4, 54.4, 2), at(60, 24.4, 54.4, 3), at(120, 24.4, 54.4, 0)]]])
    expect(presenceCells(drift, { mode: 'idle' }).totalSec).toBe(60)
  })

  it('skips silences too long to know, and 0,0 fixes', () => {
    const gap = new Map([[1, [at(0, 24.4, 54.4, 30), at(3 * 3600, 24.4, 54.4, 30), at(3 * 3600 + 10, 0, 0, 30), at(3 * 3600 + 20, 24.4, 54.4, 30)]]])
    // Only the 10 s from the reading after the gap to the next one count; the
    // 3 h silence and the reading at 0,0 do not.
    expect(presenceCells(gap, { mode: 'moving' }).totalSec).toBe(10)
  })
})

describe('eventCells and hotspots', () => {
  it('counts events per place by type, and joins a yard into one hot spot', () => {
    const ev = (lat, lng, type, deviceId = 7) => ({ lat, lng, type, deviceId })
    const events = [
      ev(24.4, 54.4, 'overspeed'), ev(24.4001, 54.4001, 'overspeed'), ev(24.4006, 54.4, 'idle', 8),
      ev(25.2, 55.3, 'harsh_braking'), ev(null, null, 'offline'),
    ]
    const { cells, total, unplaced } = eventCells(events, { labelOf: e => `V${e.deviceId}` })
    expect([total, unplaced]).toEqual([4, 1])
    const [top, next] = hotspots(cells)
    expect(top).toMatchObject({ rank: 1, weight: 3, types: { overspeed: 2, idle: 1 }, vehicles: ['V7', 'V8'] })
    expect(next).toMatchObject({ rank: 2, weight: 1, types: { harsh_braking: 1 } })
  })
})

describe('Live Map heat options', () => {
  const ts = s => Math.floor(new Date(s).getTime() / 1000)
  const now = new Date('2026-11-13T15:30:00')

  it('reads saved options safely', () => {
    expect(normalizeHeatOptions(null)).toEqual({ ...DEFAULT_HEAT_OPTIONS })
    expect(normalizeHeatOptions({ scope: 'weird', period: 'd99', show: 'events', customIds: ['5', 5, 'x', 7], from: '2026-11-01', to: 'nope', types: ['overspeed', 3] }))
      .toMatchObject({ scope: 'all', period: 'today', show: 'events', customIds: [5, 7], from: '2026-11-01', to: '', types: ['overspeed'] })
  })

  it('turns a period into a range, in local time', () => {
    expect(heatRange('today', { now })).toEqual({ fromTs: ts('2026-11-13T00:00:00'), toTs: ts('2026-11-13T15:30:00') })
    expect(heatRange('yesterday', { now })).toEqual({ fromTs: ts('2026-11-12T00:00:00'), toTs: ts('2026-11-13T00:00:00') - 1 })
    expect(heatRange('d7', { now }).fromTs).toBe(ts('2026-11-07T00:00:00'))
    expect(heatRange('custom', { now, from: '2026-11-10', to: '2026-11-11' }))
      .toEqual({ fromTs: ts('2026-11-10T00:00:00'), toTs: ts('2026-11-12T00:00:00') - 1 })
    // A custom period ending today stops at now; one without dates is not a range yet.
    expect(heatRange('custom', { now, from: '2026-11-12', to: '2026-11-13' }).toTs).toBe(ts('2026-11-13T15:30:00'))
    expect(heatRange('custom', { now, from: '2026-11-12', to: '' })).toBeNull()
    expect(rangeDays(ts('2026-11-07T00:00:00'), ts('2026-11-13T15:30:00'))).toBe(7)
  })

  it('caps positions in vehicle-days, events in days, history at 90 days', () => {
    expect([maxHeatDays(0), maxHeatDays(1), maxHeatDays(2), maxHeatDays(10), maxHeatDays(11), maxHeatDays(500)]).toEqual([31, 31, 31, 7, 6, 1])
    const d7 = heatRange('d7', { now })
    expect(heatRangeProblem(d7, { vehicleCount: 10, show: 'presence', now })).toBeNull()
    expect(heatRangeProblem(d7, { vehicleCount: 11, show: 'presence', now })).toMatch(/11 vehicles can show up to 6 days/)
    // Events are our own server's: a week of the whole fleet is fine.
    expect(heatRangeProblem(d7, { vehicleCount: 500, show: 'events', now })).toBeNull()
    const month = heatRange('custom', { now, from: '2026-10-01', to: '2026-11-13' })
    expect(heatRangeProblem(month, { vehicleCount: 1, show: 'events', now })).toMatch(/31 days or fewer/)
    expect(heatRangeProblem(heatRange('custom', { now, from: '2026-08-01', to: '2026-08-02' }), { vehicleCount: 1, show: 'stops', now })).toMatch(/90 days/)
    expect(heatRangeProblem(heatRange('custom', { now, from: '2026-11-12', to: '2026-11-10' }), { vehicleCount: 1, show: 'stops', now })).toMatch(/before/)
    expect(heatRangeProblem(null, { vehicleCount: 1, show: 'presence', now })).toMatch(/Pick/)
  })

  it('a selected vehicle wins, then the custom pick, then the list', () => {
    const base = { scope: 'all', customIds: [3, 9, 4], listedIds: [1, 2, 3], knownIds: [1, 2, 3, 4] }
    expect(heatVehicleIds(base)).toEqual({ ids: [1, 2, 3], by: 'all' })
    expect(heatVehicleIds({ ...base, focusId: 2 })).toEqual({ ids: [2], by: 'selected' })
    // Vehicle 9 left the account: dropped from the pick.
    expect(heatVehicleIds({ ...base, scope: 'custom' })).toEqual({ ids: [3, 4], by: 'custom' })
    expect(heatVehicleIds({ ...base, scope: 'custom', focusId: 1 })).toEqual({ ids: [1], by: 'selected' })
  })

  it('cuts a fleet read down to some vehicles and joins past days to today', () => {
    const m = (t, id) => ({ timestamp: t, 'device.id': id })
    const fleet = new Map([[1, { messages: [m(5, 1)] }], [2, { messages: [m(6, 2)] }], [3, { messages: [] }]])
    const picked = pickVehicles(fleet, [2, 3, 8])
    expect([...picked.keys()]).toEqual([2, 3])
    const past = new Map([[2, [m(1, 2), m(3, 2)]]])
    expect(joinMessages(past, picked).get(2).map(x => x.timestamp)).toEqual([1, 3, 6])
  })

  it('keeps the events of the chosen vehicles and kinds', () => {
    const events = [
      { deviceId: 1, type: 'overspeed' }, { deviceId: '2', type: 'idle' }, { deviceId: 3, type: 'panic' }, { deviceId: 2, type: 'overspeed' },
    ]
    expect(eventsFor(events, { ids: [2, 3] })).toHaveLength(3)
    expect(eventsFor(events, { ids: [2, 3], types: ['overspeed', 'panic'] }).map(e => e.type)).toEqual(['panic', 'overspeed'])
    expect(eventsFor(events, { ids: [1], types: [] })).toEqual([])
  })

  it('words the legend', () => {
    expect([durationText(0), durationText(20), durationText(45 * 60), durationText(3600), durationText(12000)])
      .toEqual(['0 min', 'under 1 min', '45 min', '1 h', '3 h 20 min'])
    const opts = { ...DEFAULT_HEAT_OPTIONS }
    expect(heatCaption({ ids: [7], labelOf: () => 'PLATE-1', ...opts })).toBe('PLATE-1 · Today · Presence')
    expect(heatCaption({ ids: [7, 8], ...opts, period: 'custom', from: '2026-11-10', to: '2026-11-12', show: 'stops', stopMode: 'idle' }))
      .toBe('2 vehicles · 10/11 – 12/11 · Idling')
    expect(heatPeriodLabel({ period: 'custom', from: '2026-11-10', to: '2026-11-10' })).toBe('10/11')
    expect(heatCaption({ ids: [], ...opts, period: 'd7', show: 'events' })).toBe('0 vehicles · Last 7 days · Events')
  })
})
