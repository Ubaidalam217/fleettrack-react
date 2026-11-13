// Event Occurrence Report — the Movement Report, but only the moments an alert
// was raised, each with the vehicle's tracking at that moment attached.
//
// Client, 2026-11-02: "the same as Movement report but only show alerts and
// tracking with alerts attached". The alerts come from the server's alert
// history (GET /api/alert-events); the tracking comes from the same Flespi
// messages the Movement Report reads, derived the same way (one row per
// message, no tolerance or interval thinning), and is joined to each alert by
// time: the last message at or before the alert, else the first one after it,
// within TRACK_WINDOW_SEC.
//
// The output has the Movement Report's shape — vehicles -> dates -> rows, each
// row with lat/lng/location — so its geocoding helpers work on it unchanged.

import { deriveMovementReport, AVAILABLE_STATUS_KEYS, formatTime, formatDateLabel, flattenRows } from './movementReport'
import { driverIdentity, driverPasses, NO_DRIVER } from './driverAtTime.js'

/** How far from the alert a message may be and still describe that moment. */
export const TRACK_WINDOW_SEC = 15 * 60

const pad = n => String(n).padStart(2, '0')
const dateKeyOf = ts => {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Index of the last row with ts <= t, or -1. Rows are in time order. */
function lastAtOrBefore(rows, t) {
  let lo = 0, hi = rows.length - 1, hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].ts <= t) { hit = mid; lo = mid + 1 } else hi = mid - 1
  }
  return hit
}

/** The tracking row that describes moment `t`, or null when none is close enough. */
export function trackAt(rows, t, windowSec = TRACK_WINDOW_SEC) {
  if (!rows?.length) return null
  const i = lastAtOrBefore(rows, t)
  const before = i >= 0 ? rows[i] : null
  const after = i + 1 < rows.length ? rows[i + 1] : null
  if (before && t - before.ts <= windowSec) return before
  if (after && after.ts - t <= windowSec) return after
  return null
}

/**
 * @param {object[]} events   alert events (API shape), any order
 * @param {Map}      byDevice Flespi messages from fetchMovementMessages, or null
 * @param {object}   opts
 * @param {object[]} opts.vehicles       the live vehicles (id = Flespi device id)
 * @param {(type) => string} opts.typeLabel
 * @param {(vehicle) => string} opts.driverNameFor
 * @param {string[]|null} opts.types       alert types to keep (null = all)
 * @param {string[]|null} opts.severities  severities to keep (null = all)
 * @param {(vehicle, messages) => (ts) => {key,label}} [opts.driverAt]  driver at a moment (utils/driverAtTime.js)
 * @param {Set|null} [opts.driverFilter]  driver keys to keep (null = all)
 * @param {'vehicle'|'driver'} [opts.groupBy]  'driver' heads groups "Driver — Vehicle"
 * An event's driver is the one the alert engine recorded with it; else the
 * driver at that moment from the tracks; else the vehicle's driver.
 * @returns {{ vehicles: object[], totalRows: number, untracked: number }}
 */
export function buildEventReport(events, byDevice, opts = {}) {
  const { vehicles = [], typeLabel = t => t, driverNameFor, types = null, severities = null, driverAt = null, driverFilter = null, groupBy = 'vehicle' } = opts
  const timelines = new Map()
  const timelineOf = (deviceId, meta) => {
    if (!driverAt) return null
    if (!timelines.has(deviceId)) timelines.set(deviceId, driverAt(meta, byDevice?.get(deviceId)?.messages ?? []))
    return timelines.get(deviceId)
  }

  // Tracking rows per device, exactly as the Movement Report derives them.
  const trackByDevice = new Map()
  if (byDevice) {
    const movement = deriveMovementReport(byDevice, {
      vehicles, statuses: AVAILABLE_STATUS_KEYS, applyTolerance: false, intervalSec: 0, driverNameFor,
    })
    for (const v of movement.vehicles) {
      trackByDevice.set(v.deviceId, flattenRows({ vehicles: [v] }).sort((a, b) => a.ts - b.ts))
    }
  }

  const metaById = new Map(vehicles.map(v => [v.id, v]))
  const keepType = types ? new Set(types) : null
  const keepSev = severities ? new Set(severities) : null
  const byVehicle = new Map()
  let untracked = 0

  for (const e of events) {
    if (e.deviceId == null) continue
    if (keepType && !keepType.has(e.type)) continue
    if (keepSev && !keepSev.has(e.severity)) continue
    const ts = Math.floor(Date.parse(e.occurredAt) / 1000)
    if (!Number.isFinite(ts)) continue

    const track = trackAt(trackByDevice.get(e.deviceId), ts)
    if (!track) untracked += 1
    const meta = metaById.get(e.deviceId)
    const vehicleId = meta?.master?.plateNo || e.vehicle?.plateNo || e.vehicle?.fleetNo || meta?.name || `Device ${e.deviceId}`
    const who = driverIdentity(e.driver) ?? timelineOf(e.deviceId, meta)?.(ts)
      ?? driverIdentity((meta && driverNameFor ? driverNameFor(meta) : '') || null) ?? NO_DRIVER
    if (!driverPasses(who, driverFilter)) continue

    const row = {
      key: e.id,
      ts,
      time: formatTime(ts),
      alert: typeLabel(e.type),
      alertType: e.type,
      severity: e.severity,
      message: e.message || e.title || '',
      // A lasting violation's end, as the engine stored it, for the map dialog.
      endedAt: e.endedAt ?? null,
      durationSec: e.durationSec ?? null,
      peakValue: e.peakValue ?? null,
      value: e.value ?? null,
      // Tracking at that moment. An over-speed alert's own reading wins over
      // the nearest message, which may be a few seconds away from the peak.
      status: track?.status ?? '—',
      speed: e.type === 'overspeed' && Number.isFinite(e.value) ? Math.round(e.value) : (track ? track.speed : '—'),
      odoKm: track?.odoKm ?? null,
      driverId: who === NO_DRIVER ? '' : who.label,
      driverKey: who.key,
      // Where the alert says it happened; the message's position otherwise.
      lat: e.lat ?? track?.lat ?? null,
      lng: e.lng ?? track?.lng ?? null,
      location: track && e.lat == null ? track.location : null,
    }

    const gk = groupBy === 'driver' ? `${who.key}\u0000${e.deviceId}` : e.deviceId
    if (!byVehicle.has(gk)) {
      byVehicle.set(gk, groupBy === 'driver'
        ? { deviceId: e.deviceId, vehicleId: `${who.label} — ${vehicleId}`, sortKey: `${who.label}\u0000${vehicleId}`, rows: [] }
        : { deviceId: e.deviceId, vehicleId, rows: [] })
    }
    byVehicle.get(gk).rows.push(row)
  }

  const out = []
  let totalRows = 0
  for (const v of byVehicle.values()) {
    v.rows.sort((a, b) => a.ts - b.ts)
    const dates = []
    let current = null
    for (const r of v.rows) {
      const k = dateKeyOf(r.ts)
      if (!current || current.dateKey !== k) {
        current = { dateKey: k, label: formatDateLabel(new Date(r.ts * 1000)), rows: [] }
        dates.push(current)
      }
      current.rows.push(r)
    }
    totalRows += v.rows.length
    out.push({ deviceId: v.deviceId, vehicleId: v.vehicleId, sortKey: v.sortKey, rowCount: v.rows.length, dates })
  }
  out.sort((a, b) => (a.sortKey ?? a.vehicleId).localeCompare(b.sortKey ?? b.vehicleId))
  return { vehicles: out, totalRows, untracked, groupBy }
}
