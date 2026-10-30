/**
 * A driver's licence expiry, read as the state the Driver page's chip shows.
 *
 * The expiry is a calendar date ("YYYY-MM-DD", the same string the API and the
 * date input both use), so it is compared as one: day numbers in UTC, against
 * today's LOCAL date. Comparing timestamps instead would flip a licence to
 * expired at 04:00 in the UAE, when UTC midnight passes.
 *
 *   none      — no expiry on file
 *   expired   — the date is in the past
 *   expiring  — within EXPIRY_WARN_DAYS, today included
 *   valid     — further out than that
 */

export const EXPIRY_WARN_DAYS = 30

const DAY_MS = 86400000

/** "YYYY-MM-DD" → whole days since the epoch, or null for anything else. */
function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim())
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : Math.round(t / DAY_MS)
}

/** Today's local calendar date as a day number. */
function todayNumber(now) {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS)
}

/**
 * @param {string} expiry  "YYYY-MM-DD" or ''
 * @param {Date}   now     injectable for tests
 * @returns {{ state: 'none'|'expired'|'expiring'|'valid', days: number|null, label: string }}
 *          `days` is days remaining (negative once expired).
 */
export function licenceExpiryState(expiry, now = new Date()) {
  const day = dayNumber(expiry)
  if (day === null) return { state: 'none', days: null, label: '—' }

  const days = day - todayNumber(now)
  if (days < 0) return { state: 'expired', days, label: 'Expired' }
  if (days <= EXPIRY_WARN_DAYS) {
    return {
      state: 'expiring',
      days,
      label: days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`,
    }
  }
  return { state: 'valid', days, label: 'Valid' }
}

/** "2027-03-31" → "31 Mar 2027", the form the tables print dates in. */
export function formatExpiryDate(expiry) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiry ?? '').trim())
  if (!m) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ''} ${m[1]}`
}

/** A local date `days` from today as "YYYY-MM-DD" — for seed rows and tests. */
export function isoDateFromToday(days, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
