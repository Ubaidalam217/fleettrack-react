/**
 * Violation Overview Report (client report list, 2026-11-10): how many alerts
 * of each kind every vehicle — or every driver — had in the period, from the
 * events the server's alert engine raised (GET /api/alert-events).
 *
 * A "violation" is an alert about how the vehicle was driven or kept; status
 * alerts (ignition on/off, offline) and paperwork (licence expiry, reminders)
 * are left out by default but can be picked.
 */

export const VIOLATION_TYPES = [
  'overspeed', 'geofence_speed', 'harsh_braking', 'harsh_acceleration', 'idle', 'night_driving', 'suspended_driver',
  'geofence', 'temperature', 'custom',
]

const HIGH = new Set(['High', 'Critical'])

const pad2 = n => String(n).padStart(2, '0')
/** 'YYYY-MM-DD' of a unix time in the browser's time, as the dates were picked. */
export const localDay = ts => {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Every day of [fromTs, toTs] in the browser's time, oldest first. */
export function periodDays(fromTs, toTs) {
  const out = []
  const d = new Date(fromTs * 1000)
  d.setHours(12, 0, 0, 0) // noon: a day step never lands on a DST edge
  const last = localDay(toTs)
  for (let i = 0; i < 400; i++) {
    const day = localDay(Math.floor(d.getTime() / 1000))
    out.push(day)
    if (day >= last) break
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * The Violation Overview in the client's Ctrack layout (sample, 2026-11-13):
 * the alert rules by name, every one of them — those nobody broke as zeros —
 * counted per day of the period; and per entity (vehicle or driver) a count
 * of each rule and their sum. Rules with the same name (one per Business
 * Group, say) share a line.
 *
 * @param {object[]} events  alert events (alertId, title, type, deviceId, occurredAt, …)
 * @param {object} opts
 *   ruleNames   every rule's name: each gets a line
 *   nameOf      event => its rule's name ('' or null: not counted)
 *   days        the period's days ('YYYY-MM-DD'), oldest first
 *   dayOf       ts => 'YYYY-MM-DD'
 *   entityOf    event => {key, label}
 *   keepRule    name => boolean (default: all)
 *   keepEntity  {key, label} => boolean (default: all)
 * @returns {{ rules: {key, label, byDay, total}[], entities: {key, label, counts, total}[], items: object[], total: number }}
 *   items: each counted event with its ts, day, rule and entity — for the drill-down.
 */
export function overviewByRule(events, { ruleNames = [], nameOf, days = [], dayOf, entityOf, keepRule = null, keepEntity = null }) {
  const byRule = new Map()
  const ruleFor = name => {
    let r = byRule.get(name)
    if (!r) byRule.set(name, (r = { key: name, label: name, byDay: Object.fromEntries(days.map(d => [d, 0])), total: 0 }))
    return r
  }
  for (const name of ruleNames) if (name && (!keepRule || keepRule(name))) ruleFor(name)

  const entities = new Map()
  const items = []
  for (const e of events ?? []) {
    const ts = Math.floor(Date.parse(e.occurredAt) / 1000)
    if (!Number.isFinite(ts)) continue
    const name = nameOf(e)
    if (!name || (keepRule && !keepRule(name))) continue
    const who = entityOf(e)
    if (keepEntity && !keepEntity(who)) continue
    const day = dayOf(ts)
    const r = ruleFor(name)
    r.byDay[day] = (r.byDay[day] ?? 0) + 1
    r.total += 1
    let en = entities.get(who.key)
    if (!en) entities.set(who.key, (en = { key: who.key, label: who.label, counts: {}, total: 0 }))
    en.counts[name] = (en.counts[name] ?? 0) + 1
    en.total += 1
    items.push({ event: e, ts, day, rule: name, entity: who })
  }
  const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key)
  return { rules: [...byRule.values()].sort(byLabel), entities: [...entities.values()].sort(byLabel), items, total: items.length }
}

/**
 * events → one row per vehicle (by: 'vehicle') or per driver (by: 'driver'):
 * { key, label, vehicles:Set, drivers:Set, counts: {type: n}, total, high, first, last, events }
 * sorted by total, most first. Also the per-type totals and the types seen.
 *
 * @param {object[]} events     alert events (deviceId, type, severity, occurredAt, driver?)
 * @param {object}   opts
 * @param {(deviceId) => string} opts.vehicleLabel
 * @param {(deviceId) => string} opts.assignedDriver  driver when the event names none
 */
export function overview(events, { by = 'vehicle', types = null, severities = null, vehicleLabel, assignedDriver } = {}) {
  const keepType = types ? new Set(types) : null
  const keepSev = severities ? new Set(severities) : null
  const rows = new Map()
  const totals = {}
  let total = 0

  for (const e of events) {
    if (e.deviceId == null || !e.type) continue
    if (keepType && !keepType.has(e.type)) continue
    if (keepSev && !keepSev.has(e.severity)) continue
    const ts = Math.floor(Date.parse(e.occurredAt) / 1000)
    if (!Number.isFinite(ts)) continue

    const vehicle = vehicleLabel?.(e.deviceId) || `Device ${e.deviceId}`
    const driver = e.driver?.name || assignedDriver?.(e.deviceId) || ''
    const key = by === 'driver' ? (driver || '—') : String(e.deviceId)
    let r = rows.get(key)
    if (!r) {
      r = { key, label: by === 'driver' ? (driver || 'No driver') : vehicle, vehicles: new Set(), drivers: new Set(), counts: {}, total: 0, high: 0, first: ts, last: ts, events: [] }
      rows.set(key, r)
    }
    r.vehicles.add(vehicle)
    if (driver) r.drivers.add(driver)
    r.counts[e.type] = (r.counts[e.type] ?? 0) + 1
    r.total += 1
    if (HIGH.has(e.severity)) r.high += 1
    if (ts < r.first) r.first = ts
    if (ts > r.last) r.last = ts
    // Each event as the drill-down lists it (components/reports/EventListModal.jsx).
    r.events.push({ id: e.id, deviceId: Number(e.deviceId), vehicle, driver, type: e.type, ts, severity: e.severity, message: e.message, value: e.value, lat: e.lat, lng: e.lng })
    totals[e.type] = (totals[e.type] ?? 0) + 1
    total += 1
  }

  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  return { rows: list, totals, total, high: list.reduce((n, r) => n + r.high, 0), seenTypes: Object.keys(totals) }
}
