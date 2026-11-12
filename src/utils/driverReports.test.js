import { describe, expect, it } from 'vitest'
import { buildEventReport } from './eventOccurrence'
import { applyGeoZoneDrivers } from './geoZoneDriver'

const ali = { key: 'd:a', label: 'Ali' }
const bilal = { key: 'd:b', label: 'Bilal' }

describe('Event Occurrence driver dimension', () => {
  const T = Math.floor(Date.parse('2026-11-12T08:00:00Z') / 1000)
  const ev = (id, dt, extra = {}) => ({ id, deviceId: 1, type: 'overspeed', severity: 'High', occurredAt: new Date((T + dt) * 1000).toISOString(), ...extra })
  const events = [ev('e1', 0), ev('e2', 600), ev('e3', 1200, { driver: { id: 'b', name: 'Bilal' } })]
  const driverAt = () => ts => (ts < T + 300 ? ali : bilal)
  const vehicles = [{ id: 1, name: 'PLATE-1', master: { plateNo: 'PLATE-1' } }]

  it('uses the recorded driver, else the driver at that moment, and groups by driver', () => {
    const r = buildEventReport(events, null, { vehicles, driverAt, groupBy: 'driver' })
    expect(r.vehicles.map(v => [v.vehicleId, v.rowCount])).toEqual([['Ali — PLATE-1', 1], ['Bilal — PLATE-1', 2]])
  })

  it('filters by driver', () => {
    const r = buildEventReport(events, null, { vehicles, driverAt, driverFilter: new Set(['d:a']) })
    expect(r.totalRows).toBe(1)
    expect(r.vehicles[0].dates[0].rows[0].driverId).toBe('Ali')
  })
})

describe('Geo Zone driver dimension', () => {
  const part = {
    trips: [{ start: { ts: 10 } }, { start: { ts: 500 } }],
    visits: [{ reach: { ts: 20 } }],
    historyRows: [{ entry: { ts: 600 } }],
    segments: [],
  }
  const analysis = new Map([[1, { meta: { vehicleId: 'PLATE-1' }, messages: [], geo: part, addr: { trips: [], visits: [], historyRows: [] } }]])
  const timelineFor = () => ts => (ts < 300 ? ali : bilal)

  it('stamps and filters items by driver', () => {
    const out = applyGeoZoneDrivers(analysis, { timelineFor, driverFilter: new Set(['d:b']) })
    const geo = out.get(1).geo
    expect(geo.trips.map(t => t.driver)).toEqual(['Bilal'])
    expect(geo.visits).toHaveLength(0)
    expect(geo.historyRows[0].driver).toBe('Bilal')
  })

  it('splits a vehicle into one entry per driver', () => {
    const out = applyGeoZoneDrivers(analysis, { timelineFor, groupBy: 'driver' })
    expect([...out.values()].map(e => [e.meta.vehicleId, e.geo.trips.length])).toEqual([['Ali — PLATE-1', 1], ['Bilal — PLATE-1', 1]])
  })
})
