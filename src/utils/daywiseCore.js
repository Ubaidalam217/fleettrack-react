/**
 * The Daywise reports' arithmetic: UAE days and the per-vehicle-per-day
 * derivation, with no browser or network code.
 *
 * Kept apart from daywise.js so the backend can run the SAME derivation
 * (server/src/lib/dailyUsage.js imports this file): the server precomputes each
 * day once and the browser only shows it, and the two must never disagree on
 * what a kilometre or an engine hour is. Imports carry their `.js` extension so
 * Node can load this file as it is. The rules themselves are documented at the
 * top of daywise.js.
 */

import { DISTANCE_FIELDS, createDistanceStepper } from './distance.js'

/** Asia/Dubai. Fixed offset — the UAE has no DST, so no zone table is needed. */
export const UAE_OFFSET_SEC = 4 * 3600

/** Per device per day request cap, matching replay.js and usageData.js. */
export const MAX_MESSAGES = 3000

/** A silence longer than this is engine-off, not unreported engine-on time. */
export const MAX_GAP_SEC = 30 * 60

// Only what the two reports read. Comma-separated STRING: Flespi rejects an
// array outright ("#/fields: invalid type 'array', allowed only string").
export const DAYWISE_FIELDS = [
  'device.id',
  'timestamp',
  'engine.ignition.status',
  ...DISTANCE_FIELDS,
].join(',')

// ── Month / day arithmetic in UAE local time ────────────────────────────────

/** Unix seconds at which UAE-local day `d` of `year`-`month` (1-based) begins. */
export function uaeDayStart(year, month, day) {
  return Date.UTC(year, month - 1, day) / 1000 - UAE_OFFSET_SEC
}

/** How many days the month has. */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** `{ year, month }` of the UAE-local today — the month picker's default. */
export function currentUaeMonth(nowMs = Date.now()) {
  const d = new Date(nowMs + UAE_OFFSET_SEC * 1000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

/**
 * 1-based day-of-month in UAE time for a unix-second timestamp, or null when it
 * falls outside the month. Also returns the month so a caller can tell "before"
 * from "after".
 */
export function uaeDayOf(ts, year, month) {
  const d = new Date((ts + UAE_OFFSET_SEC) * 1000)
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month) return null
  return d.getUTCDate()
}

/**
 * The last day of this month that has already happened in UAE time.
 *
 * Drives the "future day" styling: a cell for a day that has not arrived is
 * blank-by-definition, and showing it as a 0 implies a vehicle that did nothing.
 * Returns the day count for a past month and 0 for a future one.
 */
export function lastElapsedDay(year, month, nowMs = Date.now()) {
  const now = currentUaeMonth(nowMs)
  if (year < now.year || (year === now.year && month < now.month)) return daysInMonth(year, month)
  if (year > now.year || (year === now.year && month > now.month)) return 0
  return new Date(nowMs + UAE_OFFSET_SEC * 1000).getUTCDate()
}

// ── Derivation ──────────────────────────────────────────────────────────────

/**
 * Add `value` to the day(s) an interval covers, splitting at UAE midnight.
 *
 * `into` is a 1-indexed array sized to the month. An interval entirely outside
 * the month contributes nothing; one that starts in the previous month
 * contributes only its part inside this one, which is what makes the first day
 * of a month correct rather than inheriting the tail of the last.
 */
function addSplit(into, year, month, fromTs, toTs, value) {
  if (!(toTs > fromTs) || !value) return
  const span = toTs - fromTs

  let cursor = fromTs
  while (cursor < toTs) {
    // Start of the UAE day `cursor` falls in, then the next midnight after it.
    const localDayIndex = Math.floor((cursor + UAE_OFFSET_SEC) / 86400)
    const nextMidnight = (localDayIndex + 1) * 86400 - UAE_OFFSET_SEC
    const sliceEnd = Math.min(nextMidnight, toTs)

    const day = uaeDayOf(cursor, year, month)
    if (day != null) into[day] += value * ((sliceEnd - cursor) / span)

    cursor = sliceEnd
  }
}

/**
 * One device's month reduced to per-day seconds and kilometres.
 *
 * @returns {{ ignitionSec: number[], distanceKm: number[], totalSec: number, totalKm: number }}
 *          both arrays are 1-indexed by day-of-month; index 0 is unused.
 */
export function deriveDeviceMonth(messages, year, month) {
  const days = daysInMonth(year, month)
  const ignitionSec = new Array(days + 1).fill(0)
  const distanceKm = new Array(days + 1).fill(0)

  // Every message goes through the stepper — it carries the odometer anchor
  // across messages that lack one (see distance.js).
  const step = createDistanceStepper()
  if (messages?.length) step(messages[0])

  for (let i = 1; i < (messages?.length ?? 0); i++) {
    const prev = messages[i - 1]
    const cur = messages[i]
    const { km } = step(cur)
    const t0 = prev.timestamp
    const t1 = cur.timestamp
    if (t0 == null || t1 == null) continue

    const dt = t1 - t0
    if (dt <= 0) {
      // A duplicate timestamp has no span to split; any distance the stepper
      // credited it (an odometer catch-up) belongs to that instant's day.
      const day = km !== 0 ? uaeDayOf(t1, year, month) : null
      if (day != null) distanceKm[day] += km
      continue
    }

    /**
     * Work hour: computeUsage's rule kept verbatim, so the two agree.
     *
     * The interval belongs to the state the EARLIER message reported, and a gap
     * over 30 minutes is excluded — these trackers sleep with the ignition, so a
     * longer silence is parking, and counting it would turn every overnight into
     * a shift.
     */
    if (dt <= MAX_GAP_SEC && prev['engine.ignition.status'] !== false) {
      addSplit(ignitionSec, year, month, t0, t1, dt)
    }

    /**
     * Distance: the stepper's km, and no gap rule — both are what make this
     * agree with the Movement Report, which sums the same intervals.
     *
     * No gap rule — the odometer only advances when the vehicle moves, so a rise
     * across a long silence is real kilometres driven while the device was not
     * reporting, and the Movement Report counts them too.
     *
     * Odometer deltas stay SIGNED — `vehicle.mileage` jitters down by a few
     * metres at a time, and a signed sum absorbs that where a sum of increases
     * does not. Measured on one vehicle for one day: increases-only gave
     * 561.913 km against the Movement Report's 561.651.
     */
    if (km !== 0) addSplit(distanceKm, year, month, t0, t1, km)
  }

  const sum = arr => arr.reduce((a, b) => a + b, 0)
  return {
    ignitionSec,
    distanceKm,
    totalSec: sum(ignitionSec),
    totalKm: sum(distanceKm),
  }
}

