import { driverPasses } from './driverAtTime.js'

/**
 * The driver dimension over a Geo Zone analysis (geoZoneReports.js
 * buildGeoZoneAnalysis), before the five sub-reports are built from it
 * (client, 2026-11-12). Every trip, visit and entry/exit is stamped with the
 * driver at its start (utils/driverAtTime.js), then:
 *   - a driver filter keeps only that driver's items;
 *   - "Grouped By: Driver" splits each vehicle into one entry per driver,
 *     headed "Driver — Vehicle", so every sub-report groups by driver without
 *     knowing about drivers.
 *
 * @param {Map} analysis  deviceId → { meta, messages, geo, addr }
 * @param {object} opts
 * @param {(deviceId, messages) => (ts) => {key,label}} opts.timelineFor
 * @param {Set|null} [opts.driverFilter]
 * @param {'vehicle'|'driver'} [opts.groupBy]
 * @returns {Map} the same shape
 */
export function applyGeoZoneDrivers(analysis, { timelineFor, driverFilter = null, groupBy = 'vehicle' } = {}) {
  if (!analysis || !timelineFor) return analysis
  const out = new Map()
  for (const [id, entry] of analysis) {
    const at = timelineFor(id, entry.messages)
    const stamp = (item, ts) => {
      const who = at(ts ?? 0)
      return { ...item, driver: who.label, driverKey: who.key }
    }
    const stampPart = part => part && {
      ...part,
      trips: (part.trips ?? []).map(t => stamp(t, t.start?.ts)),
      visits: (part.visits ?? []).map(v => stamp(v, v.reach?.ts)),
      historyRows: (part.historyRows ?? []).map(r => stamp(r, r.entry?.ts)),
    }
    const geo = stampPart(entry.geo)
    const addr = stampPart(entry.addr)
    const keepPart = (part, keep) => part && {
      ...part,
      trips: part.trips.filter(keep),
      visits: part.visits.filter(keep),
      historyRows: part.historyRows.filter(keep),
    }
    const passes = x => driverPasses({ key: x.driverKey }, driverFilter)

    if (groupBy !== 'driver') {
      out.set(id, { ...entry, geo: keepPart(geo, passes), addr: keepPart(addr, passes) })
      continue
    }
    const drivers = new Map()
    for (const part of [geo, addr]) {
      for (const list of [part?.trips, part?.visits, part?.historyRows]) {
        for (const x of list ?? []) if (passes(x)) drivers.set(x.driverKey, x.driver)
      }
    }
    for (const [key, label] of drivers) {
      const mine = x => x.driverKey === key
      out.set(`${id}|${key}`, {
        ...entry,
        meta: { ...entry.meta, vehicleId: `${label} — ${entry.meta.vehicleId}`, driverLabel: label },
        geo: keepPart(geo, mine),
        addr: keepPart(addr, mine),
      })
    }
  }
  if (groupBy !== 'driver') return out
  return new Map([...out.entries()].sort((a, b) => a[1].meta.vehicleId.localeCompare(b[1].meta.vehicleId)))
}
