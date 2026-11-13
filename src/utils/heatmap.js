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
 *   stopped  standing still, engine on or off: where the vehicles stop and park
 *   idle     standing still with the engine on: where fuel is burnt for nothing
 *
 * The Live Map's heat map (client, 2026-11-13: "Heatmap is not report feature,
 * its map feature and should show specific device data if selected one") uses
 * the same cells, plus the option helpers at the bottom of this file.
 */

import { MAX_GAP_SEC } from './daywiseCore'

/** The heat colours, little to most — the map layer and its legend share them. */
export const HEAT_STOPS = [
  [0.2, '#2563eb'], [0.4, '#06b6d4'], [0.55, '#22c55e'], [0.7, '#facc15'], [0.85, '#f97316'], [1, '#dc2626'],
]

/** About 50 m of latitude: a square small enough to tell one yard from the next. */
export const CELL_DEG = 0.0005
/** Parked trackers report rarely; in "all" and "stopped" up to an hour between readings counts. */
const PARKED_GAP_SEC = 3600
/** Below this a vehicle stands still — the alert engine's STILL_KMH (GPS drift reads 1-2 km/h at a standstill). */
export const STILL_KMH = 3

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const cellKey = (lat, lng) => `${Math.round(lat / CELL_DEG)}:${Math.round(lng / CELL_DEG)}`
const valid = (lat, lng) => lat !== null && lng !== null && !(lat === 0 && lng === 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

function counts(m, mode) {
  const speed = num(m['position.speed']) ?? 0
  const ign = m['engine.ignition.status']
  if (mode === 'all') return true
  if (mode === 'moving') return speed > 0 && ign !== false
  if (mode === 'stopped') return speed < STILL_KMH
  if (mode === 'idle') return ign === true && speed < STILL_KMH
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
 * @param {object} opts  { mode: 'moving' | 'engine' | 'all' | 'stopped' | 'idle', labelOf?: id => string }
 * @returns {{ cells: {key, lat, lng, weight (seconds), vehicles, types}[], totalSec: number }}
 */
export function presenceCells(byVehicle, { mode = 'engine', labelOf = id => id } = {}) {
  const cells = new Map()
  const cap = mode === 'all' || mode === 'stopped' ? PARKED_GAP_SEC : MAX_GAP_SEC
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

// ── The Live Map's heat map options ──────────────────────────────────────────
//
// Which vehicles, which period and what to colour. Kept here, pure, so the
// rules are tested; hooks/useLiveHeat.js loads the data and
// components/tracking/HeatMapControls.jsx draws the options.

export const HEAT_PERIODS = Object.freeze([
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'd7',        label: 'Last 7 days' },
  { key: 'custom',    label: 'Custom' },
])

export const HEAT_SHOWS = Object.freeze([
  { key: 'presence', label: 'Presence' },
  { key: 'stops',    label: 'Stops & idle' },
  { key: 'events',   label: 'Events' },
])

/** What counts as time in each view (presenceCells' modes). */
export const HEAT_SUBMODES = Object.freeze({
  presence: [{ key: 'engine', label: 'Engine on' }, { key: 'moving', label: 'Moving only' }],
  stops:    [{ key: 'stopped', label: 'All stops' }, { key: 'idle', label: 'Idling only' }],
})

/**
 * How much history one heat map reads. Positions come from Flespi's /messages
 * (production serves them from its own 90-day telemetry copy, local runs read
 * Flespi itself): one request per day for the chosen vehicles, ~0.2-1 MB per
 * vehicle-day. The FREE plan stops the account for a minute past 50 MiB/min —
 * the 429s a month of the whole fleet used to cause. So the budget is in
 * vehicle-days: a week of ten vehicles, or a month of two.
 */
export const HEAT_MAX_DAYS = 31
export const HEAT_VEHICLE_DAYS = 70
/** Production keeps 90 days of telemetry of its own; older reads would go to Flespi. */
export const HEAT_HISTORY_DAYS = 90

export const DEFAULT_HEAT_OPTIONS = Object.freeze({
  scope: 'all',       // 'all' = the vehicles in the list | 'custom' = customIds
  customIds: [],
  period: 'today',
  from: '',           // 'YYYY-MM-DD', the custom period's first day
  to: '',             // 'YYYY-MM-DD', its last day
  show: 'presence',
  presenceMode: 'engine',
  stopMode: 'stopped',
  types: null,        // event types; null = every type
})

const DAY_SEC = 86400
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback)
const tsOf = d => Math.floor(d.getTime() / 1000)
const midnightOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

/** Saved options (localStorage) made safe: anything unknown falls back to the default. */
export function normalizeHeatOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  return {
    scope: oneOf(o.scope, ['all', 'custom'], DEFAULT_HEAT_OPTIONS.scope),
    customIds: Array.isArray(o.customIds) ? [...new Set(o.customIds.map(Number).filter(Number.isFinite))] : [],
    period: oneOf(o.period, HEAT_PERIODS.map(p => p.key), DEFAULT_HEAT_OPTIONS.period),
    from: isDay(o.from) ? o.from : '',
    to: isDay(o.to) ? o.to : '',
    show: oneOf(o.show, HEAT_SHOWS.map(s => s.key), DEFAULT_HEAT_OPTIONS.show),
    presenceMode: oneOf(o.presenceMode, HEAT_SUBMODES.presence.map(m => m.key), DEFAULT_HEAT_OPTIONS.presenceMode),
    stopMode: oneOf(o.stopMode, HEAT_SUBMODES.stops.map(m => m.key), DEFAULT_HEAT_OPTIONS.stopMode),
    types: Array.isArray(o.types) ? o.types.filter(t => typeof t === 'string') : null,
  }
}

/**
 * The period as unix seconds, in the browser's time like the date inputs.
 * Custom runs from its first day's midnight to the end of its last day, or now.
 * @returns {{ fromTs: number, toTs: number } | null}  null: custom with no dates yet
 */
export function heatRange(period, { now = new Date(), from, to } = {}) {
  const today = midnightOf(now)
  const nowTs = tsOf(now)
  switch (period) {
    case 'today':     return { fromTs: tsOf(today), toTs: nowTs }
    case 'yesterday': return { fromTs: tsOf(addDays(today, -1)), toTs: tsOf(today) - 1 }
    case 'd7':        return { fromTs: tsOf(addDays(today, -6)), toTs: nowTs }
    case 'custom': {
      if (!isDay(from) || !isDay(to)) return null
      const first = new Date(`${from}T00:00:00`)
      const afterLast = addDays(new Date(`${to}T00:00:00`), 1)
      return { fromTs: tsOf(first), toTs: Math.min(tsOf(afterLast) - 1, nowTs) }
    }
    default: return null
  }
}

/** Calendar days a range touches, a part day counting as one. */
export const rangeDays = (fromTs, toTs) => Math.max(1, Math.ceil((toTs - fromTs + 1) / DAY_SEC))

/** The longest period of positions the map reads for this many vehicles. */
export function maxHeatDays(vehicleCount) {
  return Math.max(1, Math.min(HEAT_MAX_DAYS, Math.floor(HEAT_VEHICLE_DAYS / Math.max(1, vehicleCount))))
}

/**
 * Why this period cannot be drawn, or null. Events come from our own server
 * (no Flespi read), so only the day cap applies to them.
 */
export function heatRangeProblem(range, { vehicleCount, show, now = new Date() }) {
  if (!range) return 'Pick the first and the last day.'
  if (range.fromTs > range.toTs) return 'The last day is before the first.'
  if (range.fromTs < tsOf(addDays(midnightOf(now), -(HEAT_HISTORY_DAYS - 1)))) return `History goes back ${HEAT_HISTORY_DAYS} days.`
  const days = rangeDays(range.fromTs, range.toTs)
  if (show === 'events') return days > HEAT_MAX_DAYS ? `Choose ${HEAT_MAX_DAYS} days or fewer.` : null
  const max = maxHeatDays(vehicleCount)
  if (days <= max) return null
  return vehicleCount > 1
    ? `${vehicleCount} vehicles can show up to ${max} day${max === 1 ? '' : 's'}: pick a shorter period or fewer vehicles.`
    : `Choose ${max} days or fewer.`
}

/**
 * Whose heat to draw. A selected vehicle wins (client: "should show specific
 * device data if selected one and other vehicle and their data should hide"),
 * then a custom pick (only vehicles still on the account), then the list.
 * @returns {{ ids: number[], by: 'selected' | 'custom' | 'all' }}
 */
export function heatVehicleIds({ scope, customIds = [], focusId = null, listedIds = [], knownIds = [] }) {
  if (focusId != null) return { ids: [focusId], by: 'selected' }
  if (scope === 'custom') {
    const known = new Set(knownIds)
    return { ids: customIds.filter(id => known.has(id)), by: 'custom' }
  }
  return { ids: listedIds, by: 'all' }
}

/** Some vehicles' messages out of a fleet-wide read: Map<id, messages[] | { messages }>. */
export function pickVehicles(byDevice, ids) {
  const out = new Map()
  for (const id of ids) {
    const e = byDevice?.get(id)
    if (e) out.set(id, Array.isArray(e) ? e : e.messages ?? [])
  }
  return out
}

/** Past days and today, read separately, as one oldest-first list per vehicle. */
export function joinMessages(...parts) {
  const out = new Map()
  for (const part of parts) {
    for (const [id, list] of part) out.set(id, [...(out.get(id) ?? []), ...list])
  }
  for (const list of out.values()) list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  return out
}

/** Alert events of these vehicles and kinds (types null = every kind). */
export function eventsFor(events, { ids, types = null }) {
  const want = new Set(ids.map(Number))
  const kinds = types ? new Set(types) : null
  return events.filter(e => want.has(Number(e.deviceId)) && (!kinds || kinds.has(e.type)))
}

/** "3 h 20 min" */
export function durationText(sec) {
  const min = Math.round(sec / 60)
  if (min < 1) return sec > 0 ? 'under 1 min' : '0 min'
  const h = Math.floor(min / 60), m = min % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

const shortDay = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`

export function heatPeriodLabel({ period, from, to }) {
  if (period !== 'custom') return HEAT_PERIODS.find(p => p.key === period)?.label ?? ''
  if (!isDay(from) || !isDay(to)) return 'Custom'
  return from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`
}

export function heatShowLabel({ show, presenceMode, stopMode }) {
  if (show === 'events') return 'Events'
  if (show === 'stops') return stopMode === 'idle' ? 'Idling' : 'Stops & idle'
  return presenceMode === 'moving' ? 'Moving' : 'Presence'
}

/** The legend's line: "PLATE-1 · Today · Presence", "3 vehicles · 10/11 – 12/11 · Events". */
export function heatCaption({ ids, labelOf = id => String(id), ...opts }) {
  const who = ids.length === 1 ? labelOf(ids[0]) : `${ids.length} vehicles`
  return [who, heatPeriodLabel(opts), heatShowLabel(opts)].join(' · ')
}
