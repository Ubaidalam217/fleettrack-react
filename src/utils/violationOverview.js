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

/**
 * events → one row per vehicle (by: 'vehicle') or per driver (by: 'driver'):
 * { key, label, vehicles:Set, drivers:Set, counts: {type: n}, total, high, first, last }
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
      r = { key, label: by === 'driver' ? (driver || 'No driver') : vehicle, vehicles: new Set(), drivers: new Set(), counts: {}, total: 0, high: 0, first: ts, last: ts }
      rows.set(key, r)
    }
    r.vehicles.add(vehicle)
    if (driver) r.drivers.add(driver)
    r.counts[e.type] = (r.counts[e.type] ?? 0) + 1
    r.total += 1
    if (HIGH.has(e.severity)) r.high += 1
    if (ts < r.first) r.first = ts
    if (ts > r.last) r.last = ts
    totals[e.type] = (totals[e.type] ?? 0) + 1
    total += 1
  }

  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  return { rows: list, totals, total, high: list.reduce((n, r) => n + r.high, 0), seenTypes: Object.keys(totals) }
}
