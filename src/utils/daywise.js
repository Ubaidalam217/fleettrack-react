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
import { IS_REAL } from '../data/mode'
import { get as apiGet } from '../data/http'
import { isSettled, readDay, writeDay } from './dayCache'
import {
  UAE_OFFSET_SEC, MAX_MESSAGES, DAYWISE_FIELDS as FIELDS,
  uaeDayStart, daysInMonth, currentUaeMonth, uaeDayOf, lastElapsedDay, deriveDeviceMonth,
} from './daywiseCore.js'

export {
  UAE_OFFSET_SEC, uaeDayStart, daysInMonth, currentUaeMonth, uaeDayOf, lastElapsedDay, deriveDeviceMonth,
}

/** Same backoff schedule as replay.js / usageData.js — same endpoint, same limit. */
const RETRY_DELAYS_SEC = [30, 60, 120]

/**
 * Days fetched at once. Flespi's REST limit is per account, so this is the knob
 * that trades wall-clock against the chance of a 429. A day for ten vehicles is
 * ~1 MB, so six at once keeps a full month (~30 MB) inside the free plan's
 * 50 MiB/min while halving the wait of the old three; past days then come from
 * the browser cache (utils/dayCache.js) on every later run.
 */
const CONCURRENCY = 6

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
        throw new Error(`Could not load the report data (error ${res.status}). Please try again.`)
      }
      return res.json()
    }
    if (attempt >= RETRY_DELAYS_SEC.length) {
      throw new Error('The server is busy. Please try again in a minute.')
    }
    for (let left = RETRY_DELAYS_SEC[attempt]; left > 0; left--) {
      onStatus?.(`Server busy — retrying in ${left}s...`)
      await sleep(1000, signal)
    }
  }
}

/**
 * An unfinished day (today, and the two before it while late uploads can still
 * land) is not cached in the browser, but asking Flespi again for every click is
 * what made a re-run take ~2 s. It is kept in memory this long instead, so a
 * re-run, or switching Work Hour <-> Distance, is instant and still fresh.
 */
const RECENT_TTL_MS = 5 * 60 * 1000
const recentDays = new Map() // cacheKey -> { at, result }
const inflight = new Map()   // cacheKey -> Promise<object[]>

/** A day's messages: browser cache, memory, or Flespi, in that order. */
async function loadDay(ids, dayStart, cacheKey, onStatus) {
  // A finished day never changes, so it is read from the browser cache when it
  // can be (utils/dayCache.js). Work Hour and Distance share the same fetch, so
  // one run fills the cache for both.
  const settled = isSettled((dayStart + 86400) * 1000)
  if (settled) {
    const hit = await readDay(cacheKey)
    if (hit) return hit
  } else {
    const hit = recentDays.get(cacheKey)
    if (hit && Date.now() - hit.at < RECENT_TTL_MS) return hit.result
  }

  const data = JSON.stringify({
    from: dayStart,
    to: dayStart + 86399,
    count: MAX_MESSAGES,
    fields: FIELDS,
  })
  const url = `${BASE_URL}/gw/devices/${ids}/messages?data=${encodeURIComponent(data)}`
  const json = await fetchWithRetry(url, { onStatus })
  const result = json.result || []

  if (settled) {
    writeDay(cacheKey, result)
  } else {
    const now = Date.now()
    for (const [k, v] of recentDays) if (now - v.at >= RECENT_TTL_MS) recentDays.delete(k)
    recentDays.set(cacheKey, { at: now, result })
  }
  return result
}

/** `promise`, or an AbortError as soon as `signal` fires. */
function untilAborted(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
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
async function fetchDay(deviceIds, dayStart, opts = {}) {
  const ids = [...deviceIds].sort((a, b) => a - b).join(',')
  const cacheKey = `${FIELDS}|${ids}|${dayStart}`

  // One request per day however many callers want it: the background warm-up
  // and a Generate click asking for the same day share it. The request itself
  // is never aborted — it is one day, and finishing it fills the cache — the
  // caller just stops waiting for it.
  let pending = inflight.get(cacheKey)
  if (!pending) {
    pending = loadDay(ids, dayStart, cacheKey, opts.onStatus)
      .finally(() => inflight.delete(cacheKey))
    inflight.set(cacheKey, pending)
  }
  const result = await untilAborted(pending, opts.signal)

  const byDevice = new Map()
  for (const m of result) {
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

  const lastDay = lastFetchDay(year, month)

  const byDevice = new Map()
  let capped = false
  let done = 0

  const days = []
  for (let d = 1; d <= lastDay; d++) days.push(d)

  const report = text => onProgress?.({ done, total: lastDay, text })
  report('Generating report...')

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
      report('Generating report...')
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

/**
 * The last day of a month worth asking for. Never days that have not happened:
 * on the current month that is up to 30 pointless requests, and each one still
 * costs the rate limit.
 */
function lastFetchDay(year, month) {
  const total = daysInMonth(year, month)
  return Math.min(total, lastElapsedDay(year, month) || total)
}

/**
 * Real mode: the month as the server already computed it (server/src/lib/
 * dailyUsage.js) — one small request instead of ~30 Flespi days, which is what
 * makes Generate instant in a fresh browser too. The server scopes it to the
 * signed-in account itself.
 *
 * null when the server cannot answer the whole month yet (days not computed —
 * an old month, or a server that has just started; it queues them) or the call
 * fails: the browser then computes the month itself, as in mock mode, so the
 * report is never wrong, only occasionally slower.
 */
async function fromServer(year, month) {
  try {
    const data = await apiGet('/api/reports/daywise', { year, month })
    if (!data || data.missingDays?.length) return null
    return { derived: new Map(data.devices.map(d => [d.deviceId, d])), capped: !!data.capped }
  } catch {
    return null
  }
}

/** How long a month the server answered is reused before asking it again. */
const SERVER_TTL_MS = 60 * 1000

/**
 * Finished month reports, per fleet and month: `{ at, done, fromServer, promise }`.
 *
 * Even with every day in the browser cache, a month is ~150k messages: reading
 * them back takes ~1.8 s and deriving them ~0.8 s. The derived result is a few
 * numbers per vehicle per day, so it is kept here instead, and Generate on a
 * month that is already computed is instant. A month still inside the
 * unfinished-day window is recomputed after RECENT_TTL_MS so today keeps moving.
 */
const months = new Map()

/**
 * A month's per-device derivation, computed once and shared by every caller —
 * the background warm-up, the page opening, and Generate.
 *
 * The computation itself is not cancelled by `signal`: it finishes into the
 * cache, and the caller just stops waiting for it.
 *
 * @returns {Promise<{ derived: Map<number, ReturnType<typeof deriveDeviceMonth>>, capped: boolean }>}
 */
export function loadDaywiseMonth(deviceIds, year, month, opts = {}) {
  const ids = [...deviceIds].sort((a, b) => a - b)
  const key = `${ids.join(',')}|${year}-${month}`
  const hit = months.get(key)
  const monthEndMs = uaeDayStart(year, month, daysInMonth(year, month)) * 1000 + 86400 * 1000
  // The server's answer costs one small request, so it is asked again sooner.
  const ttl = hit?.fromServer ? SERVER_TTL_MS : RECENT_TTL_MS
  const fresh = hit && (!hit.done || isSettled(monthEndMs) || Date.now() - hit.at < ttl)
  if (fresh) return untilAborted(hit.promise, opts.signal)

  const entry = { at: Date.now(), done: false, fromServer: false, promise: null }
  const inBrowser = () => fetchDaywiseMonth(ids, year, month, { onProgress: opts.onProgress })
    .then(({ byDevice, capped }) => {
      const derived = new Map()
      for (const id of ids) derived.set(id, deriveDeviceMonth(byDevice.get(id) ?? [], year, month))
      return { derived, capped }
    })
  entry.promise = (IS_REAL ? fromServer(year, month) : Promise.resolve(null))
    .then(server => {
      entry.fromServer = !!server
      return server ?? inBrowser()
    })
    .then(result => {
      entry.at = Date.now()
      entry.done = true
      return result
    })
  // A failed month must not stay cached as a failure.
  entry.promise.catch(() => { if (months.get(key) === entry) months.delete(key) })
  months.set(key, entry)
  return untilAborted(entry.promise, opts.signal)
}

/**
 * Compute a month in the background, so Generate finds it ready.
 *
 * The app runs this quietly after sign-in and again when a Daywise page opens.
 * Errors are swallowed: if the warm-up fails, Generate simply fetches as before.
 */
export function warmDaywiseMonth(deviceIds, year, month) {
  if (!deviceIds.length) return
  loadDaywiseMonth(deviceIds, year, month).catch(() => {})
}

/**
 * Build the table model for both reports in one pass.
 *
 * @param {Map<number, object[]>} byDevice   from fetchDaywiseMonth
 * @param {object[]} vehicles  { id, label, company, ident } already scoped
 * @returns {{ rows: object[], days: number, year: number, month: number }}
 */
export function buildDaywiseRows(byDevice, vehicles, year, month) {
  const derivedById = new Map(vehicles.map(v => [v.id, deriveDeviceMonth(byDevice.get(v.id) ?? [], year, month)]))
  return rowsFromDerived(derivedById, vehicles, year, month)
}

/** The table model from loadDaywiseMonth's per-device derivation. */
export function rowsFromDerived(derivedById, vehicles, year, month) {
  const empty = () => deriveDeviceMonth([], year, month)
  const rows = vehicles.map(v => {
    const derived = derivedById.get(v.id) ?? empty()
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
