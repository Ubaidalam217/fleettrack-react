/**
 * Daily usage: every Flespi device's distance and engine-on time per UAE day,
 * computed in the background into DailyUsage, so a Daywise report is one query.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The Daywise Work Hour / Distance reports used to fetch a month of raw messages
 * in the browser (~30 one-day requests, ~1 MB each for ten vehicles) and reduce
 * them there on every Generate: 7-30 s the first time, and the client wants the
 * report "in a sec". A finished day never changes, so it is reduced here once,
 * and the report reads ~300 numbers instead of ~150k messages.
 *
 * ── Same numbers as the browser ─────────────────────────────────────────────
 *
 * The reduction is the frontend's own deriveDeviceMonth (src/utils/daywiseCore.js),
 * imported rather than copied, so the two can never disagree on a kilometre.
 * A day is reduced over a window around it: the day before, the day, the day
 * after, plus each device's last message before that and first one after. The
 * day before gives the distance stepper its odometer anchor and the interval
 * that crosses midnight into this day; the day after, the interval that crosses
 * out of it; the two edge messages, the interval of a device that was silent
 * across the whole window. deriveDeviceMonth splits every interval at midnight,
 * exactly as it does inside a month, and only this day's share is kept.
 * Measured against the browser on October 2026 (days 1-27, all ten vehicles):
 * engine hours identical, distance identical to the metre on eight, and 0.5 km
 * and 0.05 km apart over the month on the two whose odometer flip-flops — the
 * glitch guard there weighs GPS evidence gathered before the window began.
 *
 * ── What gets recomputed ────────────────────────────────────────────────────
 *
 * A day is FINAL once it ended 48 h ago — trackers upload buffered messages late
 * after a coverage gap (measured: one vehicle's yesterday went from 26 km to
 * 350 km an hour later), so earlier than that it can still grow. Every
 * DAILY_USAGE_REFRESH_MS the job recomputes every day in the backfill window
 * that is not final yet: on a running server that is today and the two days
 * before it, ~4 requests.
 *
 * ── Flespi's limits ─────────────────────────────────────────────────────────
 *
 * One request per day covers every device (Flespi applies `count` per device on
 * a multi-device selector). Requests are spaced FETCH_INTERVAL_MS apart, which
 * holds a backfill to ~25 MB/min, half the free plan's 50 MiB/min account-wide
 * cap that the browsers' live polling also draws on. A 429 waits and retries.
 */

import env from '../env.js'
import prisma from '../prisma.js'
import * as flespi from './flespi.js'
import { geocodeKey, reverseGeocodePoints } from './geocoder.js'
import {
  DAYWISE_FIELDS, MAX_MESSAGES, UAE_OFFSET_SEC,
  daysInMonth, deriveDeviceMonth, lastElapsedDay,
} from '../../../src/utils/daywiseCore.js'

const DAY = 86400
/** A day this long past its end is final: late uploads are in. */
const SETTLE_SEC = 48 * 3600
/** Minimum spacing after a request for a day of messages (~1 MB). */
const FETCH_INTERVAL_MS = 2500
/** …and after an edge lookup, one message per device. Flespi allows 200 calls/min. */
const EDGE_INTERVAL_MS = 400
/** Waits after a 429, then give up on this pass (the next pass retries). */
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000]
/** Days asked for by a report but outside the backfill window, at most. */
const MAX_WANTED = 400

const nowSec = () => Math.floor(Date.now() / 1000)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ── UAE day keys ────────────────────────────────────────────────────────────

/** Unix seconds of a UAE day's start → "YYYY-MM-DD". */
export const dayKey = dayStart => new Date((dayStart + UAE_OFFSET_SEC) * 1000).toISOString().slice(0, 10)

/** "YYYY-MM-DD" → unix seconds at which that UAE day starts. */
export function dayStartOf(key) {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 1000 - UAE_OFFSET_SEC
}

/** Start of the UAE day `ts` falls in. */
export const uaeDayStartFor = ts => Math.floor((ts + UAE_OFFSET_SEC) / DAY) * DAY - UAE_OFFSET_SEC

const isFinal = (dayStart, now = nowSec()) => now >= dayStart + DAY + SETTLE_SEC

// ── Flespi ──────────────────────────────────────────────────────────────────

let nextFetchAt = 0

/**
 * Every device's messages for one Flespi selection, as deviceId → messages.
 * `spacingMs` is how long the next request waits after this one: a day of
 * messages is ~1 MB, an edge lookup a few hundred bytes.
 */
async function fetchMessages(selection, spacingMs) {
  const data = JSON.stringify({ ...selection, fields: DAYWISE_FIELDS })
  const path = `/gw/devices/all/messages?data=${encodeURIComponent(data)}`

  for (let attempt = 0; ; attempt++) {
    const wait = nextFetchAt - Date.now()
    if (wait > 0) await sleep(wait)
    nextFetchAt = Date.now() + spacingMs

    const res = await flespi.forward(path, { timeoutMs: 60_000 })
    if (res.status === 429 && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt])
      continue
    }
    if (res.status !== 200) {
      throw new Error(`Flespi answered ${res.status} for ${data}`)
    }

    const byDevice = new Map()
    for (const m of JSON.parse(res.text).result ?? []) {
      const id = m['device.id']
      if (id == null) continue
      if (!byDevice.has(id)) byDevice.set(id, [])
      byDevice.get(id).push(m)
    }
    return byDevice
  }
}

/** Every device's messages for one UAE day. */
const fetchDay = dayStart =>
  fetchMessages({ from: dayStart, to: dayStart + DAY - 1, count: MAX_MESSAGES }, FETCH_INTERVAL_MS)

/** Each device's last message before `ts` (`count` is per device on a multi-device selector). */
const fetchLastBefore = ts => fetchMessages({ to: ts - 1, count: 1, reverse: true }, EDGE_INTERVAL_MS)

/** Each device's first message at or after `ts`. */
const fetchFirstAfter = ts => fetchMessages({ from: ts, count: 1 }, EDGE_INTERVAL_MS)

// ── Reduction ───────────────────────────────────────────────────────────────

/**
 * One day's figures per device, from the raw messages around it.
 *
 * `windowDays` is any number of deviceId → messages maps covering the day and
 * its surroundings, in any order; only the day's own share is kept. The capped
 * flag is read from the messages that fall inside the day.
 *
 * @param {Map<number, object[]>[]} windowDays
 * @returns {{ deviceId: number, distanceKm: number, ignitionSec: number, capped: boolean }[]}
 */
export function reduceDay(dayStart, windowDays) {
  const [y, m, d] = dayKey(dayStart).split('-').map(Number)

  const ids = new Set()
  for (const part of windowDays) for (const id of part.keys()) ids.add(id)

  const rows = []
  for (const deviceId of ids) {
    const messages = windowDays
      .flatMap(part => part.get(deviceId) ?? [])
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    const derived = deriveDeviceMonth(messages, y, m)
    rows.push({
      deviceId,
      distanceKm: derived.distanceKm[d],
      ignitionSec: Math.round(derived.ignitionSec[d]),
      capped: messages.filter(x => x.timestamp >= dayStart && x.timestamp < dayStart + DAY).length >= MAX_MESSAGES,
    })
  }
  return rows
}

/** Compute and store every day in `dayStarts` (ascending), sharing fetches between neighbours. */
async function computeDays(dayStarts) {
  const raw = new Map()
  const get = async ds => {
    if (!raw.has(ds)) raw.set(ds, await fetchDay(ds))
    return raw.get(ds)
  }

  for (const ds of dayStarts) {
    // The edges are what a device that was silent around this day needs: the
    // interval from its last message before to its first one after spans the
    // day, and the browser's month-wide derivation splits it across every day
    // it covers. They also give the distance stepper the anchor it would have had.
    const windowDays = [await fetchLastBefore(ds - DAY), await get(ds - DAY), await get(ds)]
    if (ds + DAY <= nowSec()) windowDays.push(await get(ds + DAY))
    if (ds + 2 * DAY <= nowSec()) windowDays.push(await fetchFirstAfter(ds + 2 * DAY))
    for (const k of raw.keys()) if (k < ds - DAY) raw.delete(k)

    const rows = reduceDay(ds, windowDays)
    const day = dayKey(ds)
    const final = isFinal(ds)
    await prisma.$transaction([
      prisma.dailyUsage.deleteMany({ where: { day } }),
      prisma.dailyUsage.createMany({ data: rows.map(r => ({ ...r, day })) }),
      prisma.usageDay.upsert({
        where: { day },
        create: { day, final, computedAt: new Date() },
        update: { final, computedAt: new Date() },
      }),
    ])
    queueAddresses(ds, await get(ds))
  }
}

// ── Addresses in advance ────────────────────────────────────────────────────
//
// The Movement Report shows an address on every row, and the first report of
// a day had to look up its ~4,000 new positions while the client waited (~2 min
// with the self-hosted Photon). This job already holds every message of the
// day, so it looks them up here instead and the report finds them cached.
// Only against the self-hosted Photon — never as bulk traffic to the public
// Nominatim — and only for recent days, the ones reports are opened for; an
// older day still resolves on demand the first time.

/** Days back from today whose positions are looked up in advance. */
const PREGEOCODE_DAYS = 7
/**
 * Points per call. Small, because the lookups share the geocoder's queue with
 * reports being opened right now, which then wait behind at most one batch.
 */
const PREGEOCODE_BATCH = 50

const addressQueue = []
let resolvingAddresses = false

function queueAddresses(dayStart, dayMsgs) {
  if (env.GEOCODER_KIND !== 'photon') return
  if (dayStart < uaeDayStartFor(nowSec()) - (PREGEOCODE_DAYS - 1) * DAY) return
  const seen = new Set()
  const points = []
  for (const msgs of dayMsgs.values()) {
    for (const m of msgs) {
      const lat = m['position.latitude']
      const lng = m['position.longitude']
      if (lat == null || lng == null) continue
      const key = geocodeKey(lat, lng)
      if (seen.has(key)) continue
      seen.add(key)
      points.push({ lat, lng })
    }
  }
  if (points.length) addressQueue.push(points)
  resolveQueuedAddresses()
}

async function resolveQueuedAddresses() {
  if (resolvingAddresses) return
  resolvingAddresses = true
  try {
    while (addressQueue.length) {
      const points = addressQueue.shift()
      for (let i = 0; i < points.length; i += PREGEOCODE_BATCH) {
        const batch = points.slice(i, i + PREGEOCODE_BATCH)
        await reverseGeocodePoints(batch, { resolve: batch.length, budgetMs: 60_000 })
      }
    }
  } catch (err) {
    console.error(`[fleetmax] address pre-lookup failed: ${err.message}`)
  } finally {
    resolvingAddresses = false
  }
}

// ── The job ─────────────────────────────────────────────────────────────────

/** Days a report asked for that the backfill window does not cover. */
const wanted = new Set()
let running = false
let addressesPrimed = false
let kick = null

/** One pass: every non-final day in the window, plus any day a report asked for. */
export async function refreshDailyUsage() {
  const today = uaeDayStartFor(nowSec())
  const first = today - (env.DAILY_USAGE_BACKFILL_DAYS - 1) * DAY

  const candidates = new Set()
  for (let ds = first; ds <= today; ds += DAY) candidates.add(dayKey(ds))
  for (const key of wanted) candidates.add(key)

  const final = await prisma.usageDay.findMany({
    where: { day: { in: [...candidates] }, final: true },
    select: { day: true },
  })
  for (const { day } of final) candidates.delete(day)

  // Once per process: the recent days that are already final are fetched again
  // too, so their addresses get looked up in advance (queueAddresses) after a
  // restart or a deploy, not only the two or three days still changing.
  if (!addressesPrimed) {
    addressesPrimed = true
    if (env.GEOCODER_KIND === 'photon') {
      for (let ds = today - (PREGEOCODE_DAYS - 1) * DAY; ds <= today; ds += DAY) candidates.add(dayKey(ds))
    }
  }

  const todo = [...candidates].map(dayStartOf).sort((a, b) => a - b)
  if (!todo.length) return 0
  await computeDays(todo)
  for (const ds of todo) wanted.delete(dayKey(ds))
  return todo.length
}

async function tick() {
  if (running) return
  running = true
  try {
    const n = await refreshDailyUsage()
    if (n > 1) console.log(`[fleetmax] daily usage: ${n} days computed`)
  } catch (err) {
    console.error(`[fleetmax] daily usage pass failed: ${err.message}`)
  } finally {
    running = false
  }
}

/**
 * Ask for days the backfill window does not cover (an older month opened in a
 * report). They are computed on the next pass, which starts at once.
 */
export function requestDays(keys) {
  for (const key of keys) {
    if (wanted.size >= MAX_WANTED) break
    wanted.add(key)
  }
  if (kick) kick()
}

/** Start the background job. Returns a stop function. No-op under test or when off. */
export function startDailyUsageJob() {
  if (env.isTest || !env.DAILY_USAGE_ENABLED || !flespi.isConfigured()) return () => {}

  kick = () => setTimeout(tick, 0)
  const first = setTimeout(tick, 5000)
  const timer = setInterval(tick, env.DAILY_USAGE_REFRESH_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    kick = null
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

/**
 * A month of figures for the Daywise reports, in deriveDeviceMonth's own shape
 * (1-indexed arrays, index 0 unused), so the frontend renders it unchanged.
 *
 * @param {number[] | null} deviceIds  the caller's devices, null = all
 * @returns {Promise<{ devices: object[], missingDays: string[], capped: boolean }>}
 */
export async function readMonth(year, month, deviceIds) {
  const days = daysInMonth(year, month)
  const elapsed = Math.min(days, lastElapsedDay(year, month) || 0)
  const keys = []
  for (let d = 1; d <= elapsed; d++) {
    keys.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  if (!keys.length || (deviceIds && !deviceIds.length)) return { devices: [], missingDays: [], capped: false }

  const [computed, rows] = await Promise.all([
    prisma.usageDay.findMany({ where: { day: { in: keys } }, select: { day: true } }),
    prisma.dailyUsage.findMany({
      where: { day: { in: keys }, ...(deviceIds ? { deviceId: { in: deviceIds } } : {}) },
    }),
  ])

  const have = new Set(computed.map(r => r.day))
  const missingDays = keys.filter(k => !have.has(k))

  const byDevice = new Map()
  let capped = false
  for (const r of rows) {
    if (!byDevice.has(r.deviceId)) {
      byDevice.set(r.deviceId, {
        deviceId: r.deviceId,
        distanceKm: new Array(days + 1).fill(0),
        ignitionSec: new Array(days + 1).fill(0),
        totalKm: 0,
        totalSec: 0,
      })
    }
    const dev = byDevice.get(r.deviceId)
    const d = Number(r.day.slice(8, 10))
    dev.distanceKm[d] = r.distanceKm
    dev.ignitionSec[d] = r.ignitionSec
    dev.totalKm += r.distanceKm
    dev.totalSec += r.ignitionSec
    if (r.capped) capped = true
  }

  return { devices: [...byDevice.values()], missingDays, capped }
}
