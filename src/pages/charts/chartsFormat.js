/**
 * Number and date text for the Charts page. Dates are UAE dates whatever the
 * browser's own zone, like every report.
 */

import { uaeMidnight } from './chartsData'

const TZ = 'Asia/Dubai'
const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' })
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' })
const WEEKDAY_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric' })

export const fmtInt = n => INT.format(Math.round(n || 0))

/** "1 Oct" */
export const dayLabel = ts => DAY_MONTH.format(ts * 1000)
/** "Mon 19 Oct" */
export const weekdayLabel = ts => WEEKDAY_DAY.format(ts * 1000)
/** "14:00" */
export const hourLabel = ts => HOUR.format(ts * 1000)

/** "1 Oct – 30 Oct 2026", or one date for a single day. */
export function rangeLabel(windows) {
  if (!windows) return ''
  const first = windows.cur.from
  const last = uaeMidnight(Math.max(first, windows.cur.to - 1))
  if (last === first) return `${WEEKDAY_DAY.format(first * 1000)} ${YEAR.format(first * 1000)}`
  const sameYear = YEAR.format(first * 1000) === YEAR.format(last * 1000)
  return `${sameYear ? DAY_MONTH.format(first * 1000) : DAY_MONTH_YEAR.format(first * 1000)} – ${DAY_MONTH_YEAR.format(last * 1000)}`
}

/**
 * A duration as a headline number and its unit: hours, with one decimal under
 * ten, and minutes under one hour.
 */
export function durationParts(sec) {
  const s = Math.max(0, sec || 0)
  if (s < 3600) return { value: fmtInt(s / 60), unit: 'min' }
  const h = s / 3600
  return { value: h < 10 ? h.toFixed(1) : fmtInt(h), unit: 'h' }
}

/** "4 h 20 min" for tooltips. */
export function durationText(sec) {
  const total = Math.round(Math.max(0, sec || 0) / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${fmtInt(h)} h ${m} min` : `${fmtInt(h)} h`
}

/** What the current window is compared against, for the change lines. */
export const compareLabel = days => (days === 1 ? 'yesterday' : `previous ${days} days`)
