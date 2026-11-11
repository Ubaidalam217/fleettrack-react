/**
 * The Dashboard's figures, all from recorded data (client, 2026-11-11: "only
 * real information on the dashboard").
 *
 *   distance / engine time per day  the Daywise reports' month (server
 *                                   DailyUsage, else the browser's own fetch)
 *   trips today                     today's messages cut by deriveTrips, as
 *                                   the Trip reports do
 *   safety                          this month's alert events per 100 km
 *   maintenance                     the Reminders module's status
 *   costs                           the Expense module
 *   uptime                          the live feed
 *
 * Every function here is pure; hooks/useDashboardStats.js loads the inputs.
 * A figure with nothing behind it is null, and the card says so — never a
 * stand-in number.
 */

import { ZERO_KM, sumTrips } from './usageReports.js'

/** A vehicle-day counts as "used" from this distance. */
export const USED_DAY_KM = 1
/** Live: a vehicle that reported within this long is "up". */
export const ONLINE_SEC = 15 * 60

/**
 * Safety: the same weights the driver safety score uses
 * (server/src/lib/driverPerformance.js), on the alert engine's events.
 * Only events of rules the account has set count, so the score reads
 * "no violations recorded", not "no violations".
 */
export const SAFETY_WEIGHTS = Object.freeze({
  overspeed: 5,
  geofence_speed: 5,
  harsh_braking: 4,
  harsh_acceleration: 3,
  idle: 2,
})
const SAFETY_BASE_KM = 50

const sum = arr => arr.reduce((a, b) => a + (b || 0), 0)
const round = n => Math.round(n)

/**
 * A month of per-device daily figures, cut to the selected devices.
 *
 * @param {Map<number, {distanceKm: number[], ignitionSec: number[]}>} derived  1-based day arrays
 * @param {number[]} ids        selected Flespi device ids
 * @param {number} days         days of the month to count (elapsed ones)
 * @returns {{ dailyKm: number[], dailySec: number[], totalKm: number, totalSec: number, usedDays: number, vehicleDays: number }}
 *          dailyKm[i] / dailySec[i] are day i+1
 */
export function monthFigures(derived, ids, days) {
  const dailyKm = new Array(days).fill(0)
  const dailySec = new Array(days).fill(0)
  let usedDays = 0
  for (const id of ids) {
    const d = derived?.get(id)
    if (!d) continue
    for (let day = 1; day <= days; day++) {
      const km = d.distanceKm?.[day] ?? 0
      dailyKm[day - 1] += km
      dailySec[day - 1] += d.ignitionSec?.[day] ?? 0
      if (km >= USED_DAY_KM) usedDays += 1
    }
  }
  return { dailyKm, dailySec, totalKm: sum(dailyKm), totalSec: sum(dailySec), usedDays, vehicleDays: ids.length * days }
}

/** Share of vehicle-days on which the vehicle drove, 0-100; null with no vehicles. */
export function utilization(month) {
  if (!month || !month.vehicleDays) return null
  return round((month.usedDays / month.vehicleDays) * 100)
}

/**
 * Safety score 0-100 from weighted events per 100 km (at least 50 km counted).
 * null when the fleet did not drive.
 */
export function safetyScore(events, km) {
  if (!(km >= 1)) return null
  let penalty = 0
  for (const e of events ?? []) penalty += SAFETY_WEIGHTS[e.type] ?? 0
  const per100 = (penalty * 100) / Math.max(km, SAFETY_BASE_KM)
  return Math.max(0, Math.min(100, round(100 - per100)))
}

/** How many of each counted event type. */
export function violationCounts(events) {
  const out = {}
  for (const e of events ?? []) if (SAFETY_WEIGHTS[e.type] != null) out[e.type] = (out[e.type] ?? 0) + 1
  return out
}

/** Live uptime: share of vehicles that reported within ONLINE_SEC. null with none. */
export function liveUptime(vehicles, nowSec = Date.now() / 1000) {
  if (!vehicles?.length) return null
  const up = vehicles.filter(v => v.lastTs != null && nowSec - v.lastTs < ONLINE_SEC).length
  return round((up / vehicles.length) * 100)
}

/** The fleet score: the mean of whichever of the parts exist. */
export function fleetScore(parts) {
  const have = Object.values(parts).filter(v => Number.isFinite(v))
  return have.length ? round(sum(have) / have.length) : null
}

/**
 * Today's trips, from tripsByVehicle()'s result.
 * A trip that never moved (engine on, parked) is not a trip.
 */
export function todayFigures(vehicleTrips, ids) {
  const wanted = new Set(ids)
  const all = []
  const perVehicle = []
  for (const v of vehicleTrips ?? []) {
    if (!wanted.has(v.deviceId)) continue
    const trips = v.trips.filter(t => (t.distanceKm ?? 0) >= ZERO_KM)
    all.push(...trips)
    const s = sumTrips(trips)
    perVehicle.push({ deviceId: v.deviceId, name: v.vehicleId, trips: s.trips, km: s.distanceKm, driveSec: s.driveSec, idleSec: s.idleSec })
  }
  const t = sumTrips(all)
  return {
    trips: t.trips,
    completed: all.filter(x => !x.open).length,
    inProgress: all.filter(x => x.open).length,
    km: t.distanceKm,
    driveSec: t.driveSec,
    idleSec: t.idleSec,
    vehiclesMoved: perVehicle.filter(v => v.trips > 0).length,
    perVehicle,
  }
}

/** Moving share of engine-on time today, 0-100; null with no engine time. */
export function driveEfficiency(today) {
  const on = (today?.driveSec ?? 0) + (today?.idleSec ?? 0)
  return on > 0 ? round((today.driveSec / on) * 100) : null
}

const digits = v => String(v ?? '').replace(/\D/g, '')

/**
 * Whether a server record's vehicle is in the Dashboard's vehicle filter,
 * matched on the IMEI (the live feed knows trackers, the server vehicles).
 * No filter (null) takes everything, records with no vehicle included.
 */
export function inFilter(vehicle, imeis) {
  if (!imeis) return true
  return !!vehicle && imeis.has(digits(vehicle.imei))
}

export const imeiSet = vehicles => new Set((vehicles ?? []).map(v => digits(v.ident)).filter(Boolean))

/**
 * Reminder status rows (GET /api/reminders/status) to the Dashboard's numbers.
 * @returns {{ rules: number, dueVehicles: number, overdueVehicles: number, compliance: number|null, overdue: object[] }}
 */
export function maintenanceFigures(rows, imeis = null) {
  const scoped = (rows ?? []).filter(r => r.active !== false && inFilter(r.vehicle, imeis))
  const due = new Set(), overdue = new Set()
  for (const r of scoped) {
    if (r.status === 'overdue') overdue.add(r.vehicle.id)
    else if (r.status === 'due') due.add(r.vehicle.id)
  }
  const open = scoped.filter(r => r.status === 'due' || r.status === 'overdue').length
  return {
    rules: scoped.length,
    dueVehicles: new Set([...due, ...overdue]).size,
    overdueVehicles: overdue.size,
    compliance: scoped.length ? round(((scoped.length - open) / scoped.length) * 100) : null,
    overdue: scoped.filter(r => r.status === 'overdue'),
  }
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86400 * 1000

/** "YYYY-MM-DD" → UTC ms at that day's start. */
const dayMs = s => (s ? Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`) : NaN)

/**
 * Expenses (GET /api/expenses) per month and per type, last `months` months.
 * A Fix expense (insurance, financing…) is spread over its period by days,
 * so a year's insurance shows as a twelfth in each month.
 *
 * @param {{year: number, month: number}} now   the current month, 1-based
 * @returns {{ months: {key: string, label: string, amount: number}[], byType: {type: string, amount: number}[], total: number, thisMonth: number }}
 */
export function expenseFigures(expenses, now, months = 6, imeis = null) {
  const buckets = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.year, now.month - 1 - i, 1))
    const start = d.getTime()
    const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
    buckets.push({ key: `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`, label: MONTH_SHORT[d.getUTCMonth()], start, end, amount: 0 })
  }
  const byType = new Map()
  const add = (type, b, amount) => {
    b.amount += amount
    byType.set(type, (byType.get(type) ?? 0) + amount)
  }
  for (const e of expenses ?? []) {
    if (!inFilter(e.vehicle, imeis)) continue
    const amount = Number(e.amount) || 0
    if (!amount) continue
    if (e.category === 'Fix' && e.fromDate && e.toDate) {
      const from = dayMs(e.fromDate), to = dayMs(e.toDate) + DAY_MS
      const span = to - from
      if (!(span > 0)) continue
      for (const b of buckets) {
        const overlap = Math.min(to, b.end) - Math.max(from, b.start)
        if (overlap > 0) add(e.type, b, (amount * overlap) / span)
      }
    } else {
      const at = dayMs(e.expenseDate ?? e.fromDate)
      const b = buckets.find(x => at >= x.start && at < x.end)
      if (b) add(e.type, b, amount)
    }
  }
  const total = sum(buckets.map(b => b.amount))
  return {
    months: buckets.map(({ key, label, amount }) => ({ key, label, amount })),
    byType: [...byType].map(([type, amount]) => ({ type, amount })).sort((a, b) => b.amount - a.amount),
    total,
    thisMonth: buckets[buckets.length - 1].amount,
  }
}

/** Percentage change, rounded to one decimal; null when there is no base. */
export function pctChange(now, before) {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null
  return Math.round(((now - before) / before) * 1000) / 10
}
