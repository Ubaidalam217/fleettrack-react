/**
 * Recurring journeys (client 2026-11-21, after Uffizio's Job module
 * "Relative" schedule): a journey template that repeats DAILY, WEEKLY on
 * chosen days or MONTHLY on chosen dates, at one start time (UAE), between a
 * Valid From and a Valid To. The server's engine makes each day's journey
 * ahead of time (lib/journeySchedules.js); New Journey shows the next ones.
 *
 * Days are UAE calendar days written 'YYYY-MM-DD'. The UAE has no daylight
 * saving, so UTC+4 all year.
 */

export const UAE_OFFSET_MS = 4 * 3600 * 1000
const DAY_MS = 86_400_000

export const REPEATS = Object.freeze(['DAILY', 'WEEKLY', 'MONTHLY'])
export const WEEKDAY_SHORT = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])

const toMs = v => (v == null || v === '' ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v))

/** The UAE day of an instant, 'YYYY-MM-DD'. */
export function uaeDateKey(v) {
  const ms = toMs(v)
  return ms == null || !Number.isFinite(ms) ? null : new Date(ms + UAE_OFFSET_MS).toISOString().slice(0, 10)
}

/** A day key moved by n days. */
export function addDays(key, n) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

const validTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

/** The instant a day's journey leaves: that UAE day at 'HH:mm'. */
export function startOn(key, startTime) {
  if (!validTime(startTime)) return null
  return new Date(Date.parse(`${key}T${startTime}:00Z`) - UAE_OFFSET_MS)
}

/** Does the schedule run on this UAE day? */
export function runsOn(s, key) {
  const d = new Date(`${key}T00:00:00Z`)
  const from = uaeDateKey(s.validFrom)
  const to = uaeDateKey(s.validTo)
  if (from && key < from) return false
  if (to && key > to) return false
  switch (s.repeat) {
    case 'DAILY': return true
    case 'WEEKLY': return (s.weekdays ?? []).includes(d.getUTCDay())
    case 'MONTHLY': return (s.monthDays ?? []).includes(d.getUTCDate())
    default: return false
  }
}

/**
 * The days in [fromKey, toKey] the schedule runs on, oldest first, at most
 * `limit` of them.
 */
export function occurrences(s, fromKey, toKey, limit = 400) {
  const out = []
  if (!fromKey || !toKey || fromKey > toKey) return out
  for (let k = fromKey, n = 0; k <= toKey && out.length < limit && n < 4000; k = addDays(k, 1), n++) {
    if (runsOn(s, k)) out.push(k)
  }
  return out
}

/**
 * What a schedule should have made by `now`: its days from today (or Valid
 * From, if later) to today + horizonDays (or Valid To, if sooner), each with
 * its start instant; a day whose start time has already passed is left out.
 */
export function upcoming(s, now = Date.now(), horizonDays = s.horizonDays ?? 7) {
  const today = uaeDateKey(now)
  const from = [today, uaeDateKey(s.validFrom)].filter(Boolean).sort().pop()
  let to = addDays(today, Math.max(0, Math.min(62, horizonDays)))
  const validTo = uaeDateKey(s.validTo)
  if (validTo && validTo < to) to = validTo
  return occurrences(s, from, to)
    .map(key => ({ key, start: startOn(key, s.startTime) }))
    .filter(o => o.start && o.start.getTime() > toMs(now))
}

/** Why this schedule cannot be saved, by field; {} when it can. */
export function scheduleErrors(s) {
  const e = {}
  if (s.scheduleKind === 'RELATIVE') {
    if (!REPEATS.includes(s.repeat)) e.repeat = 'Pick daily, weekly or monthly'
    if (s.repeat === 'WEEKLY' && !(s.weekdays ?? []).length) e.weekdays = 'Pick at least one day'
    if (s.repeat === 'MONTHLY' && !(s.monthDays ?? []).length) e.monthDays = 'Pick at least one date'
    if (!validTime(s.startTime)) e.startTime = 'Set the start time'
  }
  if (s.scheduleKind === 'RELATIVE' || s.scheduleKind === 'AUTOMATIC') {
    if (!s.validFrom) e.validFrom = 'Set Valid From'
    const f = toMs(s.validFrom), t = toMs(s.validTo)
    if (f != null && t != null && t < f) e.validTo = 'Valid To is before Valid From'
  }
  return e
}

/** "Every day at 06:00", "Sun, Tue, Thu at 06:00", "On the 1st, 15th at 06:00". */
export function describeSchedule(s) {
  if (s.scheduleKind === 'AUTOMATIC') return 'Automatic: each time the vehicle leaves the first stop'
  if (s.scheduleKind === 'NONE') return 'No schedule: used from New Journey'
  if (s.scheduleKind !== 'RELATIVE') return 'One-off'
  const at = s.startTime ? ` at ${s.startTime}` : ''
  if (s.repeat === 'DAILY') return `Every day${at}`
  if (s.repeat === 'WEEKLY') return `${[...(s.weekdays ?? [])].sort().map(d => WEEKDAY_SHORT[d]).join(', ') || 'No days'}${at}`
  if (s.repeat === 'MONTHLY') {
    const ord = n => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
    return `On the ${[...(s.monthDays ?? [])].sort((a, b) => a - b).map(ord).join(', ') || '—'}${at}`
  }
  return 'Repeats'
}
