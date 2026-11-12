/**
 * Reports › Expense › Expense Report (client, 2026-11-12, after AI Revofleet's
 * Expense, Vehicle Cost and Category Wise Expense reports): every expense of
 * the chosen vehicles in a period, per vehicle, with what each vehicle cost
 * per km, per day and per engine hour. Pure: no React, no network, no
 * Date.now() — the page loads the expenses (GET /api/expenses) and the
 * kilometres / engine hours (the Daywise figures) and hands them in.
 *
 * Days are calendar days, "YYYY-MM-DD", both ends included, as the Expense
 * module stores them. A Fix expense (insurance, financing…) covers a period;
 * only the share of it inside the report's range counts, by days — the same
 * rule the Dashboard's Cost Summary uses (dashboardStats.js expenseFigures).
 */

const DAY_MS = 86_400_000
const dayNum = s => Math.floor(Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`) / DAY_MS)
const isDay = s => /^\d{4}-\d{2}-\d{2}/.test(String(s ?? ''))
const digits = v => String(v ?? '').replace(/\D/g, '')

/** Days from `from` to `to`, both included; 0 when the range is empty. */
export function daysBetween(from, to) {
  if (!isDay(from) || !isDay(to)) return 0
  return Math.max(0, dayNum(to) - dayNum(from) + 1)
}

/** The calendar months a range touches, as [{ year, month }] (month 1-12). */
export function monthsBetween(from, to) {
  if (!isDay(from) || !isDay(to) || to < from) return []
  const out = []
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7))
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7))
  while (y < ey || (y === ey && m <= em)) {
    out.push({ year: y, month: m })
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

/**
 * The expenses that fall in the range, each with the amount that counts.
 * A Variable expense counts whole on its date; a Fix one by the share of its
 * period inside the range (`spread` says how many of its days that is).
 */
export function expenseRows(expenses, from, to) {
  const lo = dayNum(from), hi = dayNum(to)
  const out = []
  for (const e of expenses ?? []) {
    const full = Number(e.amount) || 0
    const base = {
      id: e.id,
      vehicleId: e.vehicle?.id ?? e.vehicleId ?? null,
      plate: e.vehicle?.plateNo || e.vehicle?.fleetNo || e.plateNo || '—',
      imei: digits(e.vehicle?.imei),
      company: e.bg?.name ?? '',
      branch: e.vehicle?.branch?.name ?? '',
      category: e.category,
      type: e.type,
      subType: e.subType ?? '',
      vendor: e.vendor ?? '',
      description: e.description ?? '',
      referenceNo: e.referenceNo ?? '',
      odometer: e.odometer ?? null,
      workHours: e.workHours ?? null,
      fullAmount: full,
    }
    if (e.category === 'Fix') {
      if (!isDay(e.fromDate) || !isDay(e.toDate)) continue
      const a = dayNum(e.fromDate), b = dayNum(e.toDate)
      const period = b - a + 1
      const overlap = Math.min(b, hi) - Math.max(a, lo) + 1
      if (!(period > 0) || overlap <= 0) continue
      out.push({
        ...base,
        date: e.fromDate,
        toDate: e.toDate,
        amount: (full * overlap) / period,
        spread: overlap < period ? { days: overlap, of: period } : null,
      })
    } else {
      if (!isDay(e.expenseDate)) continue
      const d = dayNum(e.expenseDate)
      if (d < lo || d > hi) continue
      out.push({ ...base, date: e.expenseDate, toDate: null, amount: full, spread: null })
    }
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
}

/** Rows grouped per vehicle, by plate, each with its total. */
export function groupByVehicle(rows) {
  const map = new Map()
  for (const r of rows) {
    const k = r.vehicleId ?? r.plate
    if (!map.has(k)) map.set(k, { vehicleId: r.vehicleId, plate: r.plate, imei: r.imei, company: r.company, branch: r.branch, rows: [], total: 0 })
    const g = map.get(k)
    g.rows.push(r)
    g.total += r.amount
  }
  return [...map.values()].sort((a, b) => a.plate.localeCompare(b.plate))
}

/** Totals per Category and Type, largest first, with each one's share of the whole. */
export function byCategory(rows) {
  const map = new Map()
  let all = 0
  for (const r of rows) {
    const k = `${r.category}|${r.type}`
    if (!map.has(k)) map.set(k, { category: r.category, type: r.type, count: 0, amount: 0 })
    const c = map.get(k)
    c.count += 1
    c.amount += r.amount
    all += r.amount
  }
  return [...map.values()]
    .map(c => ({ ...c, share: all > 0 ? (c.amount / all) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)
}

/**
 * Kilometres and engine seconds per device over the range, from the Daywise
 * per-day arrays (1-indexed by day of month).
 * @param {{year:number, month:number, devices: Map<number, {distanceKm:number[], ignitionSec:number[]}>}[]} months
 * @returns {Map<number, {km:number, sec:number}>}
 */
export function usageInRange(months, from, to) {
  const out = new Map()
  for (const { year, month, devices } of months ?? []) {
    if (!devices) continue
    for (const [deviceId, d] of devices) {
      let km = 0, sec = 0
      const len = Math.max(d.distanceKm?.length ?? 0, d.ignitionSec?.length ?? 0)
      for (let day = 1; day < len; day++) {
        const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        if (key < from || key > to) continue
        km += Number(d.distanceKm?.[day]) || 0
        sec += Number(d.ignitionSec?.[day]) || 0
      }
      const prev = out.get(deviceId) ?? { km: 0, sec: 0 }
      out.set(deviceId, { km: prev.km + km, sec: prev.sec + sec })
    }
  }
  return out
}

/**
 * The Vehicle Cost table: per vehicle, what it cost in the range against how
 * far it drove and how long its engine ran. `usageByImei` maps a tracker IMEI
 * (digits) to { km, sec }; a vehicle with no usage figures shows "—" for the
 * per-km and per-hour costs rather than a made-up number.
 */
export function vehicleCost(groups, usageByImei, days) {
  return groups.map(g => {
    const u = g.imei ? usageByImei?.get(g.imei) : null
    const km = u ? u.km : null
    const hours = u ? u.sec / 3600 : null
    return {
      vehicleId: g.vehicleId,
      plate: g.plate,
      company: g.company,
      branch: g.branch,
      total: g.total,
      km,
      hours,
      days,
      perKm: km != null && km >= 1 ? g.total / km : null,
      perDay: days > 0 ? g.total / days : null,
      perHour: hours != null && hours >= 0.1 ? g.total / hours : null,
    }
  })
}

/** "AED 1,234.50"; "—" for nothing to show. */
export function aed(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** A plain number with the given decimals and thousands separators; "—" for none. */
export function num(n, decimals = 1) {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
