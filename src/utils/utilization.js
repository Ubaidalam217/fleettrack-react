/**
 * Asset / Over / Under Utilization and Not Used Assets (client report list
 * 2026-11-10, after Ctrack MaXx's utilisation summaries): each vehicle's
 * utilised (engine-on), driving and idling time and distance per UAE day,
 * against the hours it is expected to work — 24 h a day unless the client
 * sets a shift length.
 *
 * Same rules as the Daywise reports and the Charts page, so the three agree:
 * distance from createDistanceStepper, a gap over MAX_GAP_SEC is not engine
 * time, engine-on is the ignition, driving is engine-on with speed above 0.
 */

import { createDistanceStepper } from './distance'
import { MAX_GAP_SEC, UAE_OFFSET_SEC } from './daywiseCore'

export const DAY_SEC = 86_400
/** A day counts as used from 1 km driven (as on the Charts page). */
export const USED_DAY_KM = 1

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isoAt = (ts, tz) => new Date((ts + tz) * 1000).toISOString().slice(0, 10)
const midnightAt = (ts, tz) => Math.floor((ts + tz) / DAY_SEC) * DAY_SEC - tz
export const uaeIso = ts => isoAt(ts, UAE_OFFSET_SEC)

/**
 * One vehicle's messages (ascending; may span several fetches concatenated)
 * → per day inside [from, to): { date, utilisedSec, driveSec, idleSec, km,
 * firstOn, lastOff }, plus the last movement and last position seen.
 *
 * Days are UAE days unless `tzOffsetSec` says otherwise — the report pages
 * pass the browser's, so the days line up with the dates picked.
 */
export function usageByDay(messages, from, to, { tzOffsetSec = UAE_OFFSET_SEC } = {}) {
  const days = new Map()
  const dayOf = ts => {
    const key = isoAt(ts, tzOffsetSec)
    let d = days.get(key)
    if (!d) days.set(key, (d = { date: key, utilisedSec: 0, driveSec: 0, idleSec: 0, km: 0, firstOn: null, lastOff: null }))
    return d
  }
  let lastMove = null
  let lastPos = null
  if (!messages?.length) return { days, lastMove, lastPos }

  const step = createDistanceStepper()
  step(messages[0])
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const lat = num(m['position.latitude']), lng = num(m['position.longitude'])
    if (lat !== null && lng !== null && m.timestamp != null && m.timestamp < to) lastPos = { lat, lng, ts: m.timestamp }
    if (i === 0) continue

    const a = messages[i - 1]
    const { km } = step(m)
    const t0 = a.timestamp, t1 = m.timestamp
    if (t0 == null || t1 == null) continue
    const dt = t1 - t0
    if (dt <= 0) {
      if (km > 0 && t1 >= from && t1 < to) { dayOf(t1).km += km; lastMove = t1 }
      continue
    }
    if (t1 <= from || t0 >= to) continue

    const engineOn = dt <= MAX_GAP_SEC && a['engine.ignition.status'] !== false
    const speed = num(a['position.speed']) ?? 0
    const driving = engineOn && speed > 0
    if (km > 0.05 || driving) lastMove = Math.min(t1, to)
    if (!engineOn && km === 0) continue

    // Split the span across midnights.
    for (let c = Math.max(t0, from), end = Math.min(t1, to); c < end;) {
      const next = Math.min(midnightAt(c, tzOffsetSec) + DAY_SEC, end)
      const len = next - c
      const d = dayOf(c)
      if (km !== 0) d.km += km * (len / dt)
      if (engineOn) {
        d.utilisedSec += len
        if (driving) d.driveSec += len
        else d.idleSec += len
        if (d.firstOn === null) d.firstOn = c
        d.lastOff = next
      }
      c = next
    }
  }
  return { days, lastMove, lastPos }
}

/**
 * A vehicle's totals over the period against what was expected of it.
 * `expectedHours` is per day (default 24), prorated over the period, so
 * "today until now" expects only the hours gone by.
 *
 * Expected, utilised, driving and idling % are shares of the period's clock
 * time — Ctrack's columns, all on one scale. `vsExpectedPct` is utilised time
 * against expected time: what Over and Under Utilization go by.
 */
export function summarize(usage, { from, to, expectedHours = 24 }) {
  const periodSec = Math.max(0, to - from)
  const periodDays = Math.max(1, Math.ceil(periodSec / DAY_SEC - 1e-6))
  const expectedPerDay = expectedHours * 3600
  const expectedSec = periodSec * (expectedHours / 24)
  let utilisedSec = 0, driveSec = 0, idleSec = 0, km = 0, daysUsed = 0
  const overDays = []
  for (const d of [...usage.days.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    utilisedSec += d.utilisedSec
    driveSec += d.driveSec
    idleSec += d.idleSec
    km += d.km
    if (d.km >= USED_DAY_KM) daysUsed += 1
    if (d.utilisedSec > expectedPerDay) overDays.push({ ...d, overSec: d.utilisedSec - expectedPerDay })
  }
  const pct = s => (periodSec ? (s / periodSec) * 100 : null)
  return {
    periodSec, periodDays, expectedSec, utilisedSec, driveSec, idleSec, km, daysUsed,
    expectedPct: pct(expectedSec), utilisedPct: pct(utilisedSec), drivingPct: pct(driveSec), idlingPct: pct(idleSec),
    vsExpectedPct: expectedSec ? (utilisedSec / expectedSec) * 100 : null,
    avgKmPerDay: km / periodDays,
    overSec: overDays.reduce((n, d) => n + d.overSec, 0),
    overDays,
    notUsed: km < USED_DAY_KM && driveSec === 0,
    lastMove: usage.lastMove,
    lastPos: usage.lastPos,
  }
}

/**
 * Which vehicles a variant lists, given each one's summary.
 * - asset:   all of them
 * - over:    any day used longer than the hours expected a day (none can be
 *            at the default 24 h — a day has no more)
 * - under:   utilised below `underPct` of the expected time
 * - notUsed: no movement in the period
 */
export function pickRows(rows, variant, { underPct = 25 } = {}) {
  switch (variant) {
    case 'over': return rows.filter(r => r.s.overDays.length > 0)
    case 'under': return rows.filter(r => (r.s.vsExpectedPct ?? 0) < underPct)
    case 'notUsed': return rows.filter(r => r.s.notUsed)
    default: return rows
  }
}

/** "12:34" from seconds (hours may run past 24). */
export function hhmm(sec) {
  if (sec == null) return '--'
  const m = Math.round(sec / 60)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}
