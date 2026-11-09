/**
 * The Charts page's arithmetic: periods, and one pass over each vehicle's
 * messages that fills every chart on the page. Pure — no React, no network,
 * no Date.now() — so it is tested directly (chartsData.test.js).
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 *
 * The messages are the Daywise reports' own month fetch (utils/daywise.js
 * fetchDaywiseMonth), so the page shares their browser cache, and the rules are
 * theirs too:
 *
 *   - distance is distance.js's stepper, split in proportion across hour (and so
 *     day) boundaries exactly as deriveDeviceMonth splits it across midnight — a
 *     day here equals that day in the Daywise Distance report;
 *   - engine-on time is computeUsage's rule: an interval counts when the EARLIER
 *     message's ignition is not false and the gap is at most 30 minutes; it is
 *     driving when that message's speed is above 0 and idling otherwise, so
 *     driving + idle equals the Daywise Work Hour figure.
 *
 * Days and hours are UAE local time (UTC+4, no DST). Because the offset is a
 * whole number of hours, a UAE hour boundary is also a UTC hour boundary, which
 * is what lets the pass slice intervals on plain multiples of 3600.
 */

import { createDistanceStepper } from '../../utils/distance.js'
import { UAE_OFFSET_SEC, MAX_GAP_SEC } from '../../utils/daywiseCore.js'

export const DAY_SEC = 86400
const HOUR_SEC = 3600

export const PRESETS = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
]

/** A custom range is capped like a Daywise month, to keep the Flespi load bounded. */
export const MAX_CUSTOM_DAYS = 31

/** A vehicle-day counts as "used" when the vehicle drove at least this far. */
export const USED_DAY_KM = 1
/** An hour counts a vehicle as moving when it drove at least this far. */
export const MOVING_HOUR_KM = 0.1

/** Speed bands of the speed distribution, 20 km/h wide; the last is open-ended. */
export const SPEED_BUCKETS = ['0-20', '20-40', '40-60', '60-80', '80-100', '100-120', '120+']
/** Bands at or above this speed are drawn as over the limit. */
export const SPEED_LIMIT_KMH = 100
export const bucketOf = speed => Math.min(SPEED_BUCKETS.length - 1, Math.max(0, Math.floor(speed / 20)))
export const bucketFrom = i => i * 20

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// ── UAE days ────────────────────────────────────────────────────────────────

/** Start (unix seconds) of the UAE day that contains `ts`. */
export const uaeMidnight = ts => Math.floor((ts + UAE_OFFSET_SEC) / DAY_SEC) * DAY_SEC - UAE_OFFSET_SEC

/** 'YYYY-MM-DD' of the UAE day that contains `ts`. */
export const uaeIsoDate = ts => new Date((ts + UAE_OFFSET_SEC) * 1000).toISOString().slice(0, 10)

/** Start of the UAE day named by 'YYYY-MM-DD', or null when it is not a date. */
export function isoToUaeStart(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ms) ? ms / 1000 - UAE_OFFSET_SEC : null
}

/** Heatmap cell of an instant: Monday-first weekday x UAE hour. */
export function heatIndex(ts) {
  const local = ts + UAE_OFFSET_SEC
  const dayNo = Math.floor(local / DAY_SEC)
  // 1970-01-01 was a Thursday, index 3 in a Monday-first week.
  const weekday = (((dayNo + 3) % 7) + 7) % 7
  const hour = Math.floor((((local % DAY_SEC) + DAY_SEC) % DAY_SEC) / HOUR_SEC)
  return weekday * 24 + hour
}

// ── Periods ─────────────────────────────────────────────────────────────────

/**
 * The window shown and the one it is compared against: the same days shifted
 * back by the window's length, cut at the same time of day. "Today" until 14:00
 * is compared with yesterday until 14:00, not with all of yesterday.
 */
export function buildWindows(firstDay, days, nowSec) {
  const curTo = Math.min(firstDay + days * DAY_SEC, nowSec)
  const shift = days * DAY_SEC
  return {
    days,
    key: `${firstDay}|${days}|${curTo}`,
    cur: { from: firstDay, to: curTo },
    prev: { from: firstDay - shift, to: curTo - shift },
  }
}

/** Today, 7 days or 30 days, each ending now. */
export function presetWindows(days, nowSec) {
  return buildWindows(uaeMidnight(nowSec) - (days - 1) * DAY_SEC, days, nowSec)
}

/** A custom range of whole UAE days, or the reason it cannot be used. */
export function customWindows(fromIso, toIso, nowSec) {
  const from = isoToUaeStart(fromIso)
  const to = isoToUaeStart(toIso)
  if (from == null || to == null) return { error: 'Pick a start and an end date.' }
  if (to < from) return { error: 'The end date is before the start date.' }
  if (to > uaeMidnight(nowSec)) return { error: 'The end date is in the future.' }
  const days = Math.round((to - from) / DAY_SEC) + 1
  if (days > MAX_CUSTOM_DAYS) return { error: `Pick at most ${MAX_CUSTOM_DAYS} days.` }
  return { windows: buildWindows(from, days, nowSec) }
}

/** Every UAE month `{ year, month }` the span [from, to) touches, oldest first. */
export function monthsCovering(from, to) {
  const at = ts => {
    const d = new Date((ts + UAE_OFFSET_SEC) * 1000)
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
  }
  const start = at(from)
  const end = at(Math.max(from, to - 1))
  const out = []
  for (let { year, month } = start; year < end.year || (year === end.year && month <= end.month);) {
    out.push({ year, month })
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return out
}

// ── The pass ────────────────────────────────────────────────────────────────

/** One vehicle's running totals for a pair of windows `days` long. */
export function emptyStats(days) {
  const win = () => ({ kmByHour: new Array(days * 24).fill(0), driveSec: 0, idleSec: 0 })
  return {
    cur: win(),
    prev: win(),
    /** Driving seconds per Monday-first weekday x hour, current window only. */
    heat: new Array(7 * 24).fill(0),
    /** Driving seconds per SPEED_BUCKETS band, current window only. */
    speedSec: new Array(SPEED_BUCKETS.length).fill(0),
  }
}

/**
 * Add one device's messages (ascending, one fetch's worth — a month) to its
 * stats. Called once per month; like deriveDeviceMonth, the odometer anchor
 * starts afresh with each call.
 */
export function accumulate(stats, messages, windows) {
  if (!messages?.length) return stats
  const wins = [['cur', windows.cur], ['prev', windows.prev]]
  const lo = windows.prev.from
  const hi = windows.cur.to

  // Every message is stepped, inside the windows or not: the stepper carries
  // its odometer anchor across them (see distance.js).
  const step = createDistanceStepper()
  step(messages[0])

  for (let i = 1; i < messages.length; i++) {
    const a = messages[i - 1]
    const b = messages[i]
    const { km } = step(b)
    const t0 = a.timestamp
    const t1 = b.timestamp
    if (t0 == null || t1 == null) continue

    const dt = t1 - t0
    if (dt <= 0) {
      // No span to split: an odometer catch-up on a repeated timestamp belongs
      // to that instant, as in deriveDeviceMonth.
      if (km === 0) continue
      for (const [name, w] of wins) {
        if (t1 >= w.from && t1 < w.to) stats[name].kmByHour[Math.floor((t1 - w.from) / HOUR_SEC)] += km
      }
      continue
    }
    if (t1 <= lo || t0 >= hi) continue

    const engineOn = dt <= MAX_GAP_SEC && a['engine.ignition.status'] !== false
    if (!engineOn && km === 0) continue
    const speed = num(a['position.speed']) ?? 0
    const driving = engineOn && speed > 0

    for (const [name, w] of wins) {
      const s0 = Math.max(t0, w.from)
      const s1 = Math.min(t1, w.to)
      if (s1 <= s0) continue
      const ws = stats[name]
      for (let c = s0; c < s1;) {
        const slot = Math.floor((c - w.from) / HOUR_SEC)
        const end = Math.min(w.from + (slot + 1) * HOUR_SEC, s1)
        const len = end - c
        if (km !== 0) ws.kmByHour[slot] += km * (len / dt)
        if (driving) {
          ws.driveSec += len
          if (name === 'cur') {
            stats.heat[heatIndex(c)] += len
            stats.speedSec[bucketOf(speed)] += len
          }
        } else if (engineOn) {
          ws.idleSec += len
        }
        c = end
      }
    }
  }
  return stats
}

// ── Summary for the selected vehicles ───────────────────────────────────────

const sum = arr => arr.reduce((a, b) => a + b, 0)

function dayKms(kmByHour, days) {
  const out = new Array(days).fill(0)
  for (let i = 0; i < kmByHour.length; i++) out[Math.floor(i / 24)] += kmByHour[i]
  return out
}

/**
 * Everything the page draws, for a subset of the vehicles.
 *
 * @param {Map<number, ReturnType<typeof emptyStats>>} statsById
 * @param {{ id: number, label: string, bg: string }[]} vehicles  the selection
 * @param {ReturnType<typeof buildWindows>} windows
 */
export function summarize(statsById, vehicles, windows) {
  const { days, cur } = windows
  const hourly = days === 1
  const zero = emptyStats(days)
  const of = id => statsById?.get(id) ?? zero

  // ── distance series: hours for a single day, days otherwise ──
  const slotSec = hourly ? HOUR_SEC : DAY_SEC
  const slots = hourly ? 24 : days
  const series = []
  for (let i = 0; i < slots; i++) {
    const start = cur.from + i * slotSec
    if (start >= cur.to) break
    series.push({ start, cur: 0, prev: 0, vehicles: 0 })
  }
  const totals = {
    cur: { km: 0, driveSec: 0, idleSec: 0, usedDays: 0 },
    prev: { km: 0, driveSec: 0, idleSec: 0, usedDays: 0 },
    vehicleDays: vehicles.length * days,
  }
  const heat = new Array(7 * 24).fill(0)
  const speedSec = new Array(SPEED_BUCKETS.length).fill(0)
  const perVehicle = []
  const bgs = new Map()
  const spanSec = Math.max(0, cur.to - cur.from)

  for (const v of vehicles) {
    const s = of(v.id)
    const curDays = dayKms(s.cur.kmByHour, days)
    const prevDays = dayKms(s.prev.kmByHour, days)
    const curSlots = hourly ? s.cur.kmByHour : curDays
    const prevSlots = hourly ? s.prev.kmByHour : prevDays
    const moving = hourly ? MOVING_HOUR_KM : USED_DAY_KM
    series.forEach((p, i) => {
      p.cur += curSlots[i]
      p.prev += prevSlots[i]
      if (curSlots[i] >= moving) p.vehicles += 1
    })

    const km = sum(curDays)
    totals.cur.km += km
    totals.prev.km += sum(prevDays)
    totals.cur.driveSec += s.cur.driveSec
    totals.prev.driveSec += s.prev.driveSec
    totals.cur.idleSec += s.cur.idleSec
    totals.prev.idleSec += s.prev.idleSec
    totals.cur.usedDays += curDays.filter(k => k >= USED_DAY_KM).length
    totals.prev.usedDays += prevDays.filter(k => k >= USED_DAY_KM).length
    s.heat.forEach((x, i) => { heat[i] += x })
    s.speedSec.forEach((x, i) => { speedSec[i] += x })
    perVehicle.push({ id: v.id, label: v.label, km })

    const bg = bgs.get(v.bg) ?? { bg: v.bg, vehicles: 0, driveSec: 0, idleSec: 0, totalSec: 0 }
    bg.vehicles += 1
    bg.driveSec += s.cur.driveSec
    bg.idleSec += s.cur.idleSec
    bg.totalSec += spanSec
    bgs.set(v.bg, bg)
  }

  const byBg = [...bgs.values()]
    .map(b => ({ ...b, offSec: Math.max(0, b.totalSec - b.driveSec - b.idleSec) }))
    .sort((a, b) => b.driveSec - a.driveSec || a.bg.localeCompare(b.bg))

  return {
    hourly,
    series,
    totals,
    heat,
    speedSec,
    topVehicles: perVehicle.filter(v => v.km >= 0.05).sort((a, b) => b.km - a.km),
    byBg,
  }
}

// ── Alerts ──────────────────────────────────────────────────────────────────

/**
 * Alert counts per type in the current window, and the totals of both windows.
 *
 * @param {{ ts: number, type: string, deviceId: number }[]} items
 * @param {Set<number>} ids  the selected vehicles
 */
export function countAlerts(items, ids, windows) {
  const byType = new Map()
  let cur = 0
  let prev = 0
  for (const e of items ?? []) {
    if (!ids.has(e.deviceId)) continue
    if (e.ts >= windows.cur.from && e.ts < windows.cur.to) {
      cur += 1
      byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
    } else if (e.ts >= windows.prev.from && e.ts < windows.prev.to) {
      prev += 1
    }
  }
  const types = [...byType].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
  return { cur, prev, types }
}

// ── Comparison ──────────────────────────────────────────────────────────────

/** Percent change, or null when there is nothing to compare against. */
export function pctChange(cur, prev) {
  if (!(prev > 0)) return null
  return ((cur - prev) / prev) * 100
}
