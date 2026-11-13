/**
 * The replay player's timeline, speed chart and red "above the limit" route
 * (client-approved replay "Option C", 2026-11-13).
 *
 * The timeline is laid out by time, not by point count: an hour parked is as
 * wide as an hour driven, and a stretch with no data at all shows as a gap
 * instead of being squeezed out between two points.
 *
 * Pure: no React, no network, no Date.now().
 */

/**
 * Longer than this between two points is a gap: nothing is known inside it.
 * The violation reports' rule (violationEpisodes.js MAX_GAP_SEC).
 */
export const GAP_SEC = 10 * 60

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A replay point's state on the timeline: driving, idle or stopped. */
export function pointState(p) {
  switch (p?.status) {
    case 'Running': return 'driving'
    case 'Idle':    return 'idle'
    case 'Stopped': return 'stopped'
    // No ignition reported: movement is the only thing to go on.
    default:        return (num(p?.speed) ?? 0) > 0 ? 'driving' : 'stopped'
  }
}

/** First and last timestamp, and the span between them (at least 1 s). */
function bounds(points) {
  const t0 = points[0].ts
  const t1 = points[points.length - 1].ts
  return { t0, t1, span: Math.max(1, t1 - t0) }
}

/**
 * Whether nothing is known between two readings: more than `gapSec` apart,
 * unless the vehicle was parked at both — a parked tracker reports rarely.
 */
function isGap(a, b, gapSec) {
  return b.ts - a.ts > gapSec && !(pointState(a) === 'stopped' && pointState(b) === 'stopped')
}

/**
 * The points cut into runs of one state, each with where it sits on a 0..1
 * time axis. The stretch between two points takes the state of the first one
 * (that is what the vehicle was doing until the next reading), unless the two
 * are more than `gapSec` apart — then it is a 'gap'. A parked tracker reports
 * rarely, so a long wait between two readings that are both stopped is
 * stopped, not missing data.
 *
 * @param {object[]} points  replay points, ascending by ts
 * @returns {{ state: 'driving'|'idle'|'stopped'|'gap', fromTs: number, toTs: number,
 *   fromIdx: number, toIdx: number, start: number, end: number }[]}
 */
export function timelineSegments(points, { gapSec = GAP_SEC } = {}) {
  if (!points?.length) return []
  const { t0, span } = bounds(points)
  const frac = ts => (ts - t0) / span
  if (points.length === 1) {
    const p = points[0]
    return [{ state: pointState(p), fromTs: p.ts, toTs: p.ts, fromIdx: 0, toIdx: 0, start: 0, end: 1 }]
  }

  const out = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const state = isGap(a, b, gapSec) ? 'gap' : pointState(a)
    const last = out[out.length - 1]
    if (last && last.state === state) {
      last.toTs = b.ts
      last.toIdx = i
      last.end = frac(b.ts)
    } else {
      out.push({ state, fromTs: a.ts, toTs: b.ts, fromIdx: i - 1, toIdx: i, start: frac(a.ts), end: frac(b.ts) })
    }
  }
  return out
}

/** Where a moment sits on the timeline, 0..1 (clamped). */
export function timeFraction(points, ts) {
  if (!points?.length || !Number.isFinite(ts)) return 0
  const { t0, span } = bounds(points)
  return Math.min(1, Math.max(0, (ts - t0) / span))
}

/** Index of the point nearest a moment (points ascending by ts). */
export function indexAtTime(points, ts) {
  if (!points?.length) return 0
  let lo = 0, hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].ts < ts) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(points[lo - 1].ts - ts) <= Math.abs(points[lo].ts - ts)) return lo - 1
  return lo
}

/** Index of the point at a 0..1 position on the timeline. */
export function indexAtFraction(points, f) {
  if (!points?.length) return 0
  const { t0, span } = bounds(points)
  return indexAtTime(points, t0 + Math.min(1, Math.max(0, f)) * span)
}

/**
 * The speed chart's line: the top speed in each of `buckets` equal slices of
 * time, so a short burst over the limit is never averaged away. Slices with
 * no reading are left out (the line runs straight across them), except across
 * a real gap (isGap) — where the series carries a null and the chart breaks
 * the line.
 *
 * @returns {{ f: number, v: number|null }[]}  f = the slice's middle, 0..1
 */
export function speedSeries(points, buckets = 240, { gapSec = GAP_SEC } = {}) {
  if (!points?.length) return []
  const { t0, span } = bounds(points)
  const n = Math.max(1, buckets)
  const out = []
  let bucket = -1
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const b = Math.min(n - 1, Math.floor(((p.ts - t0) / span) * n))
    const v = num(p.speed) ?? 0
    if (i > 0 && isGap(points[i - 1], p, gapSec)) out.push({ f: (b + 0.5) / n, v: null })
    if (b === bucket && out.length && out[out.length - 1].v !== null) {
      if (v > out[out.length - 1].v) out[out.length - 1].v = v
    } else {
      out.push({ f: (b + 0.5) / n, v })
      bucket = b
    }
  }
  return out
}

/**
 * The stretches of route driven above `limitKmh`, for drawing in red. The
 * stretch between two points counts when the reading that ends it is over the
 * limit; a gap is never drawn. Consecutive stretches merge into one run.
 *
 * @returns {{ fromIdx: number, toIdx: number }[]}  inclusive point indexes
 */
export function overLimitRuns(points, limitKmh, { gapSec = GAP_SEC } = {}) {
  const limit = num(limitKmh)
  if (!points?.length || limit === null || limit <= 0) return []
  const out = []
  for (let i = 1; i < points.length; i++) {
    const over = (num(points[i].speed) ?? 0) > limit && points[i].ts - points[i - 1].ts <= gapSec
    if (!over) continue
    const last = out[out.length - 1]
    if (last && last.toIdx === i - 1) last.toIdx = i
    else out.push({ fromIdx: i - 1, toIdx: i })
  }
  return out
}
