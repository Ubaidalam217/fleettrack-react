/**
 * Heat Map (client, 2026-11-10: "can we show the heatmap of vehicles presence
 * or any event where occurred"). The fleet's readings — or its alert events —
 * summed into small squares of the map, so the page can colour where vehicles
 * spend their time and where violations keep happening.
 *
 * Presence is TIME, not readings: a tracker that reports every 10 s while
 * driving and every 30 min while parked would otherwise make every road look
 * busier than the depot. Each reading carries the time until the next one, at
 * most MAX_GAP_SEC (a longer silence is not known to be spent there), and
 * counts only in the chosen mode:
 *
 *   moving   speed above 0 (and the ignition not off)
 *   engine   ignition on, or moving if the tracker reports no ignition
 *   all      parked time too — overnight at the depot dominates this one
 */

import { MAX_GAP_SEC } from './daywiseCore'

/** The heat colours, little to most — the map layer and its legend share them. */
export const HEAT_STOPS = [
  [0.2, '#2563eb'], [0.4, '#06b6d4'], [0.55, '#22c55e'], [0.7, '#facc15'], [0.85, '#f97316'], [1, '#dc2626'],
]

/** About 50 m of latitude: a square small enough to tell one yard from the next. */
export const CELL_DEG = 0.0005
/** Parked trackers report rarely; in "all" mode up to an hour between readings counts. */
const PARKED_GAP_SEC = 3600

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const cellKey = (lat, lng) => `${Math.round(lat / CELL_DEG)}:${Math.round(lng / CELL_DEG)}`
const valid = (lat, lng) => lat !== null && lng !== null && !(lat === 0 && lng === 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

function counts(m, mode) {
  const speed = num(m['position.speed']) ?? 0
  const ign = m['engine.ignition.status']
  if (mode === 'all') return true
  if (mode === 'moving') return speed > 0 && ign !== false
  return ign === true || (ign == null && speed > 0)
}

function add(cells, lat, lng, weight, who, extra) {
  const key = cellKey(lat, lng)
  let c = cells.get(key)
  if (!c) cells.set(key, (c = { key, latSum: 0, lngSum: 0, n: 0, weight: 0, vehicles: new Set(), types: {} }))
  c.latSum += lat
  c.lngSum += lng
  c.n += 1
  c.weight += weight
  if (who != null) c.vehicles.add(who)
  if (extra) c.types[extra] = (c.types[extra] ?? 0) + 1
}

const finish = cells => [...cells.values()].map(c => ({
  key: c.key, lat: c.latSum / c.n, lng: c.lngSum / c.n, weight: c.weight, vehicles: [...c.vehicles], types: c.types,
}))

/**
 * @param {Map<any, object[]>} byVehicle  each vehicle's messages, oldest first
 * @param {object} opts  { mode: 'moving' | 'engine' | 'all', labelOf?: id => string }
 * @returns {{ cells: {key, lat, lng, weight (seconds), vehicles, types}[], totalSec: number }}
 */
export function presenceCells(byVehicle, { mode = 'engine', labelOf = id => id } = {}) {
  const cells = new Map()
  const cap = mode === 'all' ? PARKED_GAP_SEC : MAX_GAP_SEC
  let totalSec = 0
  for (const [id, messages] of byVehicle) {
    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i]
      const lat = num(m['position.latitude']), lng = num(m['position.longitude'])
      if (!valid(lat, lng) || !counts(m, mode)) continue
      const dt = messages[i + 1].timestamp - m.timestamp
      if (!(dt > 0) || dt > cap) continue
      add(cells, lat, lng, dt, labelOf(id))
      totalSec += dt
    }
  }
  return { cells: finish(cells), totalSec }
}

/**
 * @param {object[]} events  alert events with lat / lng
 * @returns {{ cells, total, unplaced }}  weight = number of events; unplaced have no position
 */
export function eventCells(events, { labelOf = e => e.deviceId } = {}) {
  const cells = new Map()
  let total = 0, unplaced = 0
  for (const e of events) {
    const lat = num(e.lat), lng = num(e.lng)
    if (!valid(lat, lng)) { unplaced += 1; continue }
    add(cells, lat, lng, 1, labelOf(e), e.type)
    total += 1
  }
  return { cells: finish(cells), total, unplaced }
}

/**
 * The hottest places: neighbouring squares joined into one spot (a yard is
 * several squares), heaviest first.
 */
export function hotspots(cells, { limit = 10, joinDeg = CELL_DEG * 4 } = {}) {
  const spots = []
  for (const c of [...cells].sort((a, b) => b.weight - a.weight)) {
    const near = spots.find(s => Math.abs(s.lat - c.lat) <= joinDeg && Math.abs(s.lng - c.lng) <= joinDeg)
    if (near) {
      near.weight += c.weight
      for (const v of c.vehicles) near.vehicles.add(v)
      for (const [t, n] of Object.entries(c.types)) near.types[t] = (near.types[t] ?? 0) + n
    } else {
      spots.push({ lat: c.lat, lng: c.lng, weight: c.weight, vehicles: new Set(c.vehicles), types: { ...c.types } })
    }
  }
  return spots
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((s, i) => ({ ...s, rank: i + 1, vehicles: [...s.vehicles].sort() }))
}
