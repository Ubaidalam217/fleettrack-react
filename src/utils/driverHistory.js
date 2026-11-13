/**
 * Who drove a vehicle at a past moment, from the recorded history (client,
 * 2026-11-13: "All the drivers names will stay as it is, it will not replace
 * with last one saved"). A trip keeps the driver who drove it when the vehicle
 * later gets another driver, when the tag moves to someone else, and when the
 * driver is removed.
 *
 * The history is three lists (GET /api/drivers/history):
 *   - drivers      every driver the rows name, removed ones included;
 *   - assignments  DriverAssignment rows: Primary ones follow the driver's
 *                  Vehicle field, at exact times; Temporary ones are dated
 *                  cover, whole days;
 *   - tags         DriverTagHistory rows: who held an iButton code when. No
 *                  start means "since always" (the first holder of a code owns
 *                  its earlier reads).
 *
 * The rule at a moment T:
 *   1. a tag read → whoever held that code at T;
 *   2. else a Temporary assignment covering T;
 *   3. else the Primary assignment covering T;
 *   4. else nobody.
 *
 * Pure and dependency-free: the server's Driver Performance (lib/driverPerformance.js)
 * credits trips with the same functions the reports use.
 */

export const UAE_OFFSET_SEC = 4 * 3600
const DAY = 86_400

/** Epoch seconds from a Date, an ISO string or seconds; null for nothing. */
export function toSec(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const ms = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/** A code as drivers store it: separators dropped, upper-case; '' for none or the all-zero "no tag". */
export function codeKey(code) {
  const s = String(code ?? '').replace(/[\s:-]/g, '').toUpperCase()
  return /^0*$/.test(s) ? '' : s
}

/**
 * The [from, to) seconds an assignment row covers. A Temporary row's dates are
 * calendar days in the account's time zone (stored at UTC midnight), its end
 * day included; a time that is not midnight is an exact moment (a row closed
 * when the vehicle moved BG or the driver was removed). Primary rows are exact.
 */
export function assignmentSpan(a, tzOffsetSec = UAE_OFFSET_SEC) {
  const s = toSec(a.startDate ?? a.start)
  const e = toSec(a.endDate ?? a.end)
  if (a.role === 'Temporary') {
    const isDate = sec => sec % DAY === 0
    return {
      from: s === null ? -Infinity : isDate(s) ? s - tzOffsetSec : s,
      to: e === null ? Infinity : isDate(e) ? e + DAY - tzOffsetSec : e,
    }
  }
  return { from: s ?? -Infinity, to: e ?? Infinity }
}

/** The [from, to) seconds a tag row covers; no start is "since always". */
export function tagSpan(t) {
  const s = toSec(t.startDate ?? t.start)
  const e = toSec(t.endDate ?? t.end)
  return { from: s ?? -Infinity, to: e ?? Infinity }
}

const covers = (span, ts) => span.from <= ts && ts < span.to

/** The row covering ts; the latest-starting one when several do. */
function pick(rows, ts) {
  let best = null
  for (const r of rows) {
    if (!covers(r.span, ts)) continue
    if (!best || r.span.from > best.span.from) best = r
  }
  return best
}

/**
 * A lookup over one history payload.
 *
 * @param {{drivers?: object[], assignments?: object[], tags?: object[]}} payload
 * @param {{tzOffsetSec?: number}} [opts]
 */
export function createDriverHistory(payload, { tzOffsetSec = UAE_OFFSET_SEC } = {}) {
  const drivers = new Map()
  for (const d of payload?.drivers ?? []) if (d?.id) drivers.set(d.id, d)

  const byVehicle = new Map()
  for (const a of payload?.assignments ?? []) {
    if (!a?.vehicleId || !a.driverId) continue
    const row = { driverId: a.driverId, role: a.role === 'Temporary' ? 'Temporary' : 'Primary', span: assignmentSpan(a, tzOffsetSec) }
    if (!byVehicle.has(a.vehicleId)) byVehicle.set(a.vehicleId, [])
    byVehicle.get(a.vehicleId).push(row)
  }

  const byCode = new Map()
  for (const t of payload?.tags ?? []) {
    const code = codeKey(t?.code)
    if (!code || !t.driverId) continue
    if (!byCode.has(code)) byCode.set(code, [])
    byCode.get(code).push({ driverId: t.driverId, span: tagSpan(t) })
  }

  return {
    /** The driver record by id (removed ones too), or null. */
    driver: id => (id ? drivers.get(id) ?? null : null),
    /** Every driver the history names. */
    drivers: () => [...drivers.values()],
    /** Whether any assignment was ever recorded for this vehicle. */
    hasVehicle: vehicleId => byVehicle.has(vehicleId),
    /** The id of the driver assigned to the vehicle at ts: Temporary cover first, then Primary. */
    assignedAt(vehicleId, ts) {
      const rows = byVehicle.get(vehicleId)
      if (!rows || !Number.isFinite(ts)) return null
      const temp = pick(rows.filter(r => r.role === 'Temporary'), ts)
      return (temp ?? pick(rows.filter(r => r.role === 'Primary'), ts))?.driverId ?? null
    },
    /** Ids of the drivers assigned to the vehicle at any moment of [fromTs, toTs). */
    assignedDuring(vehicleId, fromTs, toTs) {
      const ids = new Set()
      for (const r of byVehicle.get(vehicleId) ?? []) {
        if (r.span.from < toTs && fromTs < r.span.to) ids.add(r.driverId)
      }
      return [...ids]
    },
    /** The id of the driver who held this iButton code at ts, or null. */
    tagHolderAt(code, ts) {
      const rows = byCode.get(codeKey(code))
      if (!rows || !Number.isFinite(ts)) return null
      return pick(rows, ts)?.driverId ?? null
    },
  }
}

/** A trip's driver by the rule above: { driverId, via: 'tag'|'assignment'|'unknown tag'|'none', tag? }. */
export function creditAt(history, { vehicleId, tag = null, ts }) {
  const code = codeKey(tag)
  if (code) {
    const id = history.tagHolderAt(code, ts)
    return id ? { driverId: id, via: 'tag' } : { driverId: null, via: 'unknown tag', tag: code }
  }
  const id = history.assignedAt(vehicleId, ts)
  return id ? { driverId: id, via: 'assignment' } : { driverId: null, via: 'none' }
}
