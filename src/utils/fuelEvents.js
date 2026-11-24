/**
 * Fuel report and fuel alerts (client, 2026-11-24): fills, drains and the
 * period's figures from a vehicle's fuel level over time. Pure and shared —
 * the server builds the report and raises the alerts with it, so both agree.
 * `.js` imports only.
 *
 * The rules:
 *   - Readings without litres (outside the calibration: a dropout to 0, a
 *     reading on another scale) are left out before anything else.
 *   - Noise: a median of 3 readings (a single spike or dip disappears).
 *   - FILL: the level rises by at least `threshold` litres (default 15) from
 *     a low to the next high; dips smaller than the noise band do not break
 *     the rise. Counted whether moving or not.
 *   - DRAIN: the level falls by at least `threshold` litres while the vehicle
 *     stands — ignition OFF, or speed 0 — counted only between readings that
 *     are both standing. Fuel used while driving is consumption, not a drain.
 *     A reading with neither ignition nor speed known is not "standing".
 *   - Litres used (driving) = start + filled − end − drained.
 */

export const DEFAULT_THRESHOLD_L = 15
const STILL_KMH = 2

const fin = v => typeof v === 'number' && Number.isFinite(v)

/** Is the vehicle standing at this reading (ignition off, or not moving)? */
export const isStanding = r => r?.ign === false || (fin(r?.speed) && r.speed < STILL_KMH)

/** Median of 3, the ends kept. Input and output: [{ ts, litres, ... }] with litres set. */
export function medianOf3(list) {
  if (list.length < 3) return list.map(r => ({ ...r }))
  return list.map((r, i) => {
    if (i === 0 || i === list.length - 1) return { ...r }
    const m = [list[i - 1].litres, r.litres, list[i + 1].litres].sort((a, b) => a - b)[1]
    return { ...r, litres: m }
  })
}

/**
 * The cleaned series: readings with litres, in time order, median of 3.
 * @param {{ts:number, litres:number|null, ign?:boolean|null, speed?:number|null}[]} readings
 */
export function cleanSeries(readings) {
  const list = (readings ?? []).filter(r => fin(r?.ts) && fin(r?.litres)).sort((a, b) => a.ts - b.ts)
  return medianOf3(list)
}

/**
 * Runs in one direction: from a turning point to the furthest point before
 * the level turns back by more than `noise`. `ok(a, b)` may refuse a step
 * (drains: both readings must be standing), which ends the run there.
 */
function runs(pts, dir, noise, ok = () => true) {
  const out = []
  let i = 0
  const n = pts.length
  while (i < n - 1) {
    if (!(dir * (pts[i + 1].litres - pts[i].litres) > 0) || !ok(pts[i], pts[i + 1])) { i++; continue }
    const start = i
    let extreme = i + 1
    let j = i + 2
    while (j < n && ok(pts[j - 1], pts[j])) {
      if (dir * (pts[j].litres - pts[extreme].litres) > 0) extreme = j
      else if (dir * (pts[extreme].litres - pts[j].litres) > noise) break
      j++
    }
    out.push({ start, end: extreme })
    i = Math.max(extreme, i + 1)
  }
  return out
}

/**
 * Fills and drains in a cleaned series.
 * @returns {{ kind:'fill'|'drain', startTs:number, endTs:number, before:number, after:number, litres:number, lat:number|null, lng:number|null }[]}
 */
export function detectFuelEvents(series, { threshold = DEFAULT_THRESHOLD_L } = {}) {
  const pts = series ?? []
  const th = fin(threshold) && threshold > 0 ? threshold : DEFAULT_THRESHOLD_L
  const noise = Math.max(1, th * 0.2)
  const make = kind => ({ start, end }) => {
    const a = pts[start], b = pts[end]
    return {
      kind, startTs: a.ts, endTs: b.ts, before: round1(a.litres), after: round1(b.litres),
      litres: round1(Math.abs(b.litres - a.litres)), lat: b.lat ?? a.lat ?? null, lng: b.lng ?? a.lng ?? null,
    }
  }
  const fills = runs(pts, 1, noise).map(make('fill')).filter(e => e.litres >= th)
  const drains = runs(pts, -1, noise, (a, b) => isStanding(a) && isStanding(b)).map(make('drain')).filter(e => e.litres >= th)
  return [...fills, ...drains].sort((x, y) => x.startTs - y.startTs)
}

const round1 = v => Math.round(v * 10) / 10

/** The period's figures from a cleaned series and its events. */
export function fuelSummary(series, events) {
  const pts = series ?? []
  if (!pts.length) return { readings: 0, start: null, end: null, min: null, max: null, filled: 0, drained: 0, fills: 0, drains: 0, used: null }
  const levels = pts.map(p => p.litres)
  const fills = events.filter(e => e.kind === 'fill')
  const drains = events.filter(e => e.kind === 'drain')
  const filled = fills.reduce((s, e) => s + e.litres, 0)
  const drained = drains.reduce((s, e) => s + e.litres, 0)
  const start = levels[0], end = levels[levels.length - 1]
  return {
    readings: pts.length,
    start: round1(start), end: round1(end), min: round1(Math.min(...levels)), max: round1(Math.max(...levels)),
    filled: round1(filled), drained: round1(drained), fills: fills.length, drains: drains.length,
    used: round1(Math.max(0, start + filled - end - drained)),
  }
}

/** Raw-value figures for a vehicle without a calibration (no events). */
export function rawSummary(readings) {
  const vals = (readings ?? []).filter(r => fin(r?.raw)).sort((a, b) => a.ts - b.ts).map(r => r.raw)
  if (!vals.length) return { readings: 0, start: null, end: null, min: null, max: null }
  return { readings: vals.length, start: vals[0], end: vals[vals.length - 1], min: Math.min(...vals), max: Math.max(...vals) }
}

/**
 * At most `max` points for the graph: the series split into equal time
 * buckets, each giving its lowest and highest reading in time order — so a
 * fill or a drain keeps its full height however long the period.
 * Input/output: [{ ts, v }].
 */
export function downsample(points, max = 800) {
  if (points.length <= max) return points
  const buckets = Math.max(1, Math.floor(max / 2))
  const t0 = points[0].ts, t1 = points[points.length - 1].ts
  const span = Math.max(1, t1 - t0)
  const out = []
  let cur = -1, lo = null, hi = null
  const flush = () => {
    if (!lo) return
    if (lo === hi) out.push(lo)
    else if (lo.ts <= hi.ts) out.push(lo, hi)
    else out.push(hi, lo)
  }
  for (const p of points) {
    const b = Math.min(buckets - 1, Math.floor(((p.ts - t0) / span) * buckets))
    if (b !== cur) { flush(); cur = b; lo = p; hi = p; continue }
    if (p.v < lo.v) lo = p
    if (p.v > hi.v) hi = p
  }
  flush()
  return out
}
