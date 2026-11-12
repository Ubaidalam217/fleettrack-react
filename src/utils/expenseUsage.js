/**
 * Kilometres and engine hours for the Expense Report's cost per km / per hour,
 * from the figures the Daywise reports already keep — no Flespi read of its
 * own: the server's DailyUsage table (GET /api/reports/daywise, one small
 * request per month), and, for the current month when the server has nothing
 * yet, the browser's month cache the sign-in warm-up and the Dashboard fill
 * (loadDaywiseMonth with the whole fleet, so it shares their cache entry).
 */
import { get as apiGet } from '../data/http'
import { IS_REAL } from '../data/mode'
import { currentUaeMonth, loadDaywiseMonth } from './daywise'

const TTL_MS = 5 * 60 * 1000
const cache = new Map() // 'YYYY-M' -> { at, promise }

function serverMonth(year, month) {
  const key = `${year}-${month}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise
  const promise = apiGet('/api/reports/daywise', { year, month }).catch(() => null)
  cache.set(key, { at: Date.now(), promise })
  return promise
}

/**
 * @param {{year:number, month:number}[]} months
 * @param {number[]} allIds  every tracker the account sees (the warm-up's key)
 * @returns {Promise<{year:number, month:number, devices: Map|null, partial: boolean}[]>}
 *   `devices` null means no figures for that month; `partial` that the server
 *   is still missing some of its days.
 */
export function loadUsageMonths(months, allIds) {
  const cur = currentUaeMonth()
  return Promise.all(months.map(async ({ year, month }) => {
    if (IS_REAL) {
      const data = await serverMonth(year, month)
      if (data?.devices?.length) {
        return { year, month, devices: new Map(data.devices.map(d => [d.deviceId, d])), partial: (data.missingDays?.length ?? 0) > 0 }
      }
    }
    if (cur.year === year && cur.month === month && allIds.length) {
      try {
        const r = await loadDaywiseMonth([...allIds].sort((a, b) => a - b), year, month)
        return { year, month, devices: r.derived, partial: false }
      } catch { /* no figures for this month */ }
    }
    return { year, month, devices: null, partial: false }
  }))
}
