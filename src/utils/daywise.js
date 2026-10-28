/**
 * Daywise Work Hour and Daywise Distance: fetch a month of messages and reduce
 * them to one number per vehicle per day.
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 *
 * Distance is distance.js's createDistanceStepper summed — the SAME rule
 * movementReport.js, geoZoneEngine.js and usageData.js use: odometer
 * (`vehicle.mileage`) deltas where both messages carry it, GPS otherwise. One
 * rule so a day here equals the Movement Report's "Cumulative Odo" for that day
 * and the Dashboard's distance for today. See distance.js for why the GPS
 * fallback exists (four devices send no odometer at all).
 *
 * Work Hour is ignition-on time, accumulated exactly as computeUsage() does it:
 * an interval counts when the EARLIER message's ignition is not false and the
 * gap is under 30 minutes. That is computeUsage's runningSec + idleSec, so the
 * Usage tab's "running + idle" for a day equals this report's cell.
 *
 * MAX_GAP_SEC is 30 minutes for the reason usageData.js gives: these devices
 * sleep with the ignition off, so a longer silence is an engine-off period, not
 * an engine-on period nobody reported. It applies to TIME only — see the
 * distance branch, which deliberately spans gaps so it matches the Movement
 * Report.
 *
 * ── Where a day can still differ from a single-day Movement Report ──────────
 *
 * The Movement Report's figure for a date is the odometer's last reading minus
 * its first INSIDE that date, so whatever the odometer gained between the last
 * message before midnight and the first one after it belongs to neither day and
 * is dropped. This report splits that interval instead, which is what the client
 * asked for and what makes twelve monthly totals add up to the year. So a day
 * with a vehicle driving through midnight can read a few metres higher here;
 * every other day matches to the rounding — measured: 103.93 vs 103.927 and
 * 561.65 vs 561.651 on the two live vehicles.
 *
 * ── UAE days, and the midnight split ────────────────────────────────────────
 *
 * Days are Asia/Dubai (UTC+4, no DST), not the browser's timezone and not UTC.
 * An interval that straddles local midnight is SPLIT: its seconds and its
 * mileage delta are divided between the two days in proportion to how much of
 * the interval fell in each. Attributing the whole interval to one day is the
 * obvious alternative and it is wrong twice over — a vehicle driving at 23:50
 * and again at 00:10 would donate its entire 20 minutes to one date, and the two
 * days' totals would no longer sum to the month's.
 *
 * ── Why the fetch is shaped the way it is ───────────────────────────────────
 *
 * One request per UAE day covering EVERY selected device, rather than one per
 * device per day. Flespi applies `count` per device on a multi-device selector,
 * so a day's request returns up to 3,000 messages for each of them — which makes
 * a month cost ~30 requests whatever the fleet size, instead of 30 x N. Measured
 * on this account: all ten devices for one day is 331 kB in a single request; one
 * busy vehicle for a month is 969 kB across its 30 days.
 *
 * Per-day chunks are not optional. A whole month in one request comes back
 * truncated at the 3,000 cap with no error — measured, 8 of 10 devices capped —
 * so the report would silently show a quarter of the month.
 */

import { BASE_URL, HEADERS } from '../hooks/flespiConfig'
import { DISTANCE_FIELDS, createDistanceStepper } from './distance'

/** Asia/Dubai. Fixed offset — the UAE has no DST, so no zone table is needed. */
export const UAE_OFFSET_SEC = 4 * 3600

/** Per device per day request cap, matching replay.js and usageData.js. */
const MAX_MESSAGES = 3000

/** Same backoff schedule as replay.js / usageData.js — same endpoint, same limit. */
const RETRY_DELAYS_SEC = [30, 60, 120]

/** A silence longer than this is engine-off, not unreported engine-on time. */
const MAX_GAP_SEC = 30 * 60

/**
 * Days fetched at once. Flespi's REST limit is per account, so this is the knob
 * that trades wall-clock against the chance of a 429; three keeps a 31-day month
 * inside a few seconds and has not tripped the limit in testing.
 */
const CONCURRENCY = 3

// Only what the two reports read. Comma-separated STRING: Flespi rejects an
// array outright ("#/fields: invalid type 'array', allowed only string").
const FIELDS = [
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

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const monthLabel = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Seconds as HH:MM, hours uncapped.
 *
 * The reference's Total column reads 130:12 — a month of work hours, not a clock
 * time — so hours run past 24 and are not padded to two digits beyond that.
 */
export function formatHoursMinutes(seconds) {
  if (!seconds || seconds <= 0) return '00:00'
  const total = Math.round(seconds / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Kilometres with two decimals, as the client's Daywise Distance sample. */
export function formatKm(km) {
  if (!km || km <= 0) return '0.00'
  return km.toFixed(2)
}

// ── Fetch ───────────────────────────────────────────────────────────────────

export function isAbortError(err) {
  return err?.name === 'AbortError' || err?.code === 20
}

function abortError() {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(id); reject(abortError()) }, { once: true })
  })
}

/**
 * One day's request, surviving 429 on the shared backoff.
 *
 * `onStatus` gets a human countdown rather than the raw error: a rate limit is a
 * wait, not a failure, and the report keeps going.
 */
async function fetchWithRetry(url, { signal, onStatus }) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError()
    const res = await fetch(url, { headers: HEADERS, signal })
    if (res.status !== 429) {
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Flespi /messages ${res.status}: ${body.slice(0, 200)}`)
      }
      return res.json()
    }
    if (attempt >= RETRY_DELAYS_SEC.length) {
      throw new Error('Flespi is still rate-limiting requests after several retries. Try again in a minute, or pick a shorter month.')
    }
    for (let left = RETRY_DELAYS_SEC[attempt]; left > 0; left--) {
      onStatus?.(`Rate limited by Flespi — retrying in ${left}s...`)
      await sleep(1000, signal)
    }
  }
}

/**
 * Every selected device's messages for one UAE day, grouped by device id.
 *
 * The selector is an explicit comma-separated id list rather than `all`, even
 * though the per-user token would narrow `all` to the same set: the report's
 * scope has to come from the signed-in account's vehicles, and saying so in the
 * URL means a token that is briefly wider than the account cannot widen the
 * report with it.
 */
async function fetchDay(deviceIds, dayStart, opts) {
  const data = JSON.stringify({
    from: dayStart,
    to: dayStart + 86399,
    count: MAX_MESSAGES,
    fields: FIELDS,
  })
  const url = `${BASE_URL}/gw/devices/${deviceIds.join(',')}/messages?data=${encodeURIComponent(data)}`
  const json = await fetchWithRetry(url, opts)
  const byDevice = new Map()
  for (const m of json.result || []) {
    const id = m['device.id']
    if (id == null) continue
    if (!byDevice.has(id)) byDevice.set(id, [])
    byDevice.get(id).push(m)
  }
  return byDevice
}

/**
 * A month of messages for a set of devices, as deviceId -> ascending messages.
 *
 * @param {number[]} deviceIds  Flespi device ids, already scoped to the account
 * @param {number} year
 * @param {number} month        1-based
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {(p: {done: number, total: number, text: string}) => void} [opts.onProgress]
 * @returns {Promise<{ byDevice: Map<number, object[]>, capped: boolean }>}
 */
export async function fetchDaywiseMonth(deviceIds, year, month, opts = {}) {
  const { signal, onProgress } = opts
  if (!deviceIds.length) return { byDevice: new Map(), capped: false }

  const total = daysInMonth(year, month)
  // Never ask for days that have not happened: on the current month that is up
  // to 30 pointless requests, and each one still costs the rate limit.
  const lastDay = Math.min(total, lastElapsedDay(year, month) || total)

  const byDevice = new Map()
  let capped = false
  let done = 0

  const days = []
  for (let d = 1; d <= lastDay; d++) days.push(d)

  const report = text => onProgress?.({ done, total: lastDay, text })
  report('Fetching...')

  // A fixed pool rather than Promise.all over everything: thirty simultaneous
  // requests is the quickest way to earn the 429 this whole module is shaped
  // around avoiding.
  let cursor = 0
  const worker = async () => {
    for (;;) {
      if (signal?.aborted) throw abortError()
      const i = cursor++
      if (i >= days.length) return
      const day = days[i]
      const result = await fetchDay(deviceIds, uaeDayStart(year, month, day), {
        signal,
        onStatus: text => report(text),
      })
      for (const [id, msgs] of result) {
        if (msgs.length >= MAX_MESSAGES) capped = true
        if (!byDevice.has(id)) byDevice.set(id, [])
        byDevice.get(id).push(...msgs)
      }
      done += 1
      report(`Fetching day ${done} of ${lastDay}...`)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, days.length) }, worker))

  // Days arrive out of order with a worker pool, and every derivation below
  // walks consecutive pairs.
  for (const msgs of byDevice.values()) {
    msgs.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  }

  return { byDevice, capped }
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

/**
 * Build the table model for both reports in one pass.
 *
 * @param {Map<number, object[]>} byDevice   from fetchDaywiseMonth
 * @param {object[]} vehicles  { id, label, company, ident } already scoped
 * @returns {{ rows: object[], days: number, year: number, month: number }}
 */
export function buildDaywiseRows(byDevice, vehicles, year, month) {
  const rows = vehicles.map(v => {
    const derived = deriveDeviceMonth(byDevice.get(v.id) ?? [], year, month)
    return {
      deviceId: v.id,
      label: v.label,
      company: v.company,
      ident: v.ident,
      ...derived,
    }
  })
  return { rows, days: daysInMonth(year, month), year, month }
}
