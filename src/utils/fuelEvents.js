/**
 * Fuel report and fuel alerts: fills, drains and the period's figures from a
 * vehicle's fuel level over time. Pure and shared — the server builds the
 * report and raises the alerts with it, so both agree. `.js` imports only.
 *
 * The rule (client, 2026-11-25): "Any drop or fill during a trip, even on
 * idle, or after a new trip: the difference between the old and the new
 * reading, if it satisfies the threshold, will alert and be noted as drain or
 * fill." So:
 *
 *   1. Readings without litres (outside the calibration: a dropout far out of
 *      range, a reading on another scale) are left out first.
 *   2. Dropouts: a short excursion — 1 to 3 readings that jump away from the
 *      readings on both sides by at least the threshold, when those two agree
 *      within the threshold (e.g. 120 → 0 → 0 → 120) — is a sensor glitch and
 *      is left out, so it never makes a drain + fill pair.
 *   3. Noise: a median of 3 readings.
 *   4. Each valid reading is compared with the previous valid one, WHATEVER
 *      the ignition or speed and however long the time between them: a fall
 *      of at least `drainThreshold` litres is a DRAIN, a rise of at least
 *      `fillThreshold` a FILL — while moving, at idle, stopped, between two
 *      trips (the last reading of the old trip against the first of the new)
 *      and after a gap in the data (the device was offline).
 *   5. Episodes: a drain or fill that goes on over consecutive readings is ONE
 *      event, from the reading before it to the furthest one. Consecutive
 *      steps join when each moves at least the "step" amount (20 % of the
 *      threshold, at least 2 L; 1 L between two engine-off readings, where no
 *      fuel is being used), and one small step in between (back by less than
 *      that) does not break it. Normal consumption while driving (well under
 *      2 L per reading) never builds an episode, so it stays consumption.
 *   6. Optional allowance (`allowanceLph`, default 0 = the pure threshold the
 *      client asked for): litres per hour the engine may use, taken off a
 *      fall for the time the engine may have run (not between two engine-off
 *      readings). Raise it if long data gaps while driving read as drains.
 *
 * Each event records its context: 'moving' | 'idle' | 'stopped' |
 * 'between_trips' | 'gap' | 'unknown', plus gapMin when readings in it are
 * more than GAP_MS apart.
 *
 * Litres used = start + filled − end − drained: consumption, without the
 * detected drains and fills.
 */

export const DEFAULT_THRESHOLD_L = 15
/** Readings further apart than this are "a gap in the data". */
export const GAP_MS = 15 * 60_000
/** A dropout is at most this many readings long. */
export const DROPOUT_MAX_READINGS = 3
/** An alert waits for this many readings after an event's end (a dropout could still come back). */
export const SETTLE_READINGS = DROPOUT_MAX_READINGS
const STILL_KMH = 2
const ENGINE_OFF_STEP_L = 1
const EPS = 1e-9

const fin = v => typeof v === 'number' && Number.isFinite(v)
const round1 = v => Math.round(v * 10) / 10

/** 'moving' | 'idle' | 'stopped' | 'unknown' for one reading. */
export function readingState(r) {
  if (r?.ign === false) return 'stopped'
  if (fin(r?.speed) && r.speed >= STILL_KMH) return 'moving'
  if (r?.ign === true) return 'idle'
  return 'unknown'
}

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
 * Leave out short excursions that come back (rule 2). A run at the very end
 * of the series is kept: it may yet come back, or be a real drain.
 */
export function removeDropouts(list, threshold = DEFAULT_THRESHOLD_L) {
  const th = fin(threshold) && threshold > 0 ? threshold : DEFAULT_THRESHOLD_L
  const keep = list.map(() => true)
  for (let i = 1; i < list.length - 1; i++) {
    if (!keep[i]) continue
    const before = list[i - 1].litres
    const dir = Math.sign(list[i].litres - before)
    if (!dir || Math.abs(list[i].litres - before) < th - EPS) continue
    for (let len = 1; len <= DROPOUT_MAX_READINGS && i + len < list.length; len++) {
      const run = list.slice(i, i + len)
      const after = list[i + len].litres
      if (Math.abs(after - before) >= th - EPS) {
        // Not back yet: a longer run may still be a dropout.
        if (!run.every(r => dir * (r.litres - before) >= th - EPS)) break
        continue
      }
      if (run.every(r => dir * (r.litres - before) >= th - EPS && dir * (r.litres - after) >= th - EPS)) {
        for (let k = i; k < i + len; k++) keep[k] = false
      }
      break
    }
  }
  return list.filter((_, i) => keep[i])
}

/**
 * The cleaned series: readings with litres, in time order, dropouts out,
 * median of 3.
 * @param {{ts:number, litres:number|null, ign?:boolean|null, speed?:number|null}[]} readings
 * @param {{ threshold?: number }} [opts] the smaller of the drain / fill thresholds
 */
export function cleanSeries(readings, { threshold = DEFAULT_THRESHOLD_L } = {}) {
  const list = (readings ?? []).filter(r => fin(r?.ts) && fin(r?.litres)).sort((a, b) => a.ts - b.ts)
  return medianOf3(removeDropouts(list, threshold))
}

/** The context of the readings from `a` to `b` (indexes, inclusive). */
export function eventContext(pts, a, b) {
  const seg = pts.slice(a, b + 1)
  let maxGap = 0
  for (let i = 1; i < seg.length; i++) maxGap = Math.max(maxGap, seg[i].ts - seg[i - 1].ts)
  const gapMin = maxGap > GAP_MS ? Math.round(maxGap / 60_000) : null
  // What the vehicle was doing where the level moved: the readings after the
  // first one (the first is the level "before", often the last one driving).
  const moved = seg.length > 1 ? seg.slice(1) : seg
  const states = moved.map(readingState)
  const last = seg[seg.length - 1]
  let context
  if (last?.ign === true && seg.slice(0, -1).some(r => r.ign === false)) context = 'between_trips'
  else if (moved.every(r => r.ign === false)) context = 'stopped'
  else if (gapMin) context = 'gap'
  else if (states.includes('moving')) context = 'moving'
  else if (states.includes('idle')) context = 'idle'
  else if (states.includes('stopped')) context = 'stopped'
  else context = 'unknown'
  return { context, gapMin }
}

export const CONTEXT_LABELS = Object.freeze({
  moving: 'While moving',
  idle: 'At idle',
  stopped: 'Stopped (engine off)',
  between_trips: 'Between trips',
  gap: 'After a gap in data',
  unknown: 'Ignition not known',
})

/** "1 h 20 min" */
export function minutesText(min) {
  if (!fin(min)) return ''
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`
  return `${Math.round(h / 24)} days`
}

/** "Between trips (no data for 3 h 5 min)" */
export function contextText(e) {
  const label = CONTEXT_LABELS[e?.context] ?? CONTEXT_LABELS.unknown
  if (!e?.gapMin) return label
  if (e.context === 'gap') return `After ${minutesText(e.gapMin)} without data`
  return `${label} (no data for ${minutesText(e.gapMin)})`
}

/** Litres the engine may have used between two readings (the allowance). */
function allowanceOf(a, b, lph) {
  if (!(lph > 0)) return 0
  if (a.ign === false && b.ign === false) return 0
  return lph * Math.max(0, b.ts - a.ts) / 3600_000
}

/** One direction's episodes (rule 5). dir: -1 drains, +1 fills. */
function episodes(pts, dir, th, lph) {
  const stepMin = Math.max(2, th * 0.2)
  const n = pts.length
  const amount = []
  const strong = []
  const allow = []
  for (let k = 1; k < n; k++) {
    const a = pts[k - 1], b = pts[k]
    const al = dir < 0 ? allowanceOf(a, b, lph) : 0
    const amt = dir * (b.litres - a.litres) - al
    const min = a.ign === false && b.ign === false ? Math.min(stepMin, ENGINE_OFF_STEP_L) : stepMin
    amount[k] = amt
    allow[k] = al
    strong[k] = amt >= min - EPS || amt >= th - EPS
  }
  const runs = []
  let cur = null
  for (let k = 1; k < n; k++) {
    if (!strong[k]) continue
    if (cur && cur.end === k - 1) {
      cur.end = k
      cur.allow += allow[k]
    } else if (cur && cur.end === k - 2 && dir * (pts[k - 1].litres - pts[k - 2].litres) > -stepMin) {
      // One small step inside the run, not back by more than the step amount.
      cur.end = k
      cur.allow += allow[k - 1] + allow[k]
    } else {
      if (cur) runs.push(cur)
      cur = { start: k - 1, end: k, allow: allow[k] }
    }
  }
  if (cur) runs.push(cur)
  return runs
    .map(r => ({ ...r, litres: dir * (pts[r.end].litres - pts[r.start].litres) - r.allow }))
    .filter(r => r.litres >= th - EPS)
}

/**
 * Fills and drains in a cleaned series.
 * @param {object} [opts]
 * @param {number} [opts.drainThreshold]  litres (default `threshold`, else 15)
 * @param {number} [opts.fillThreshold]   litres (default `threshold`, else 15)
 * @param {number} [opts.threshold]       both, when the two are not given
 * @param {number} [opts.allowanceLph]    litres per hour taken off a fall (default 0)
 * @returns {{ kind:'fill'|'drain', startTs, endTs, before, after, litres, lat, lng, context, gapMin, readings }[]}
 */
export function detectFuelEvents(series, { threshold, drainThreshold, fillThreshold, allowanceLph = 0 } = {}) {
  const pts = series ?? []
  const pick = v => (fin(v) && v > 0 ? v : null)
  const base = pick(threshold) ?? DEFAULT_THRESHOLD_L
  const thDrain = pick(drainThreshold) ?? base
  const thFill = pick(fillThreshold) ?? base
  const lph = fin(allowanceLph) && allowanceLph > 0 ? allowanceLph : 0
  const make = kind => r => {
    const a = pts[r.start], b = pts[r.end]
    return {
      kind, startTs: a.ts, endTs: b.ts, before: round1(a.litres), after: round1(b.litres),
      litres: round1(r.litres),
      lat: b.lat ?? a.lat ?? null, lng: b.lng ?? a.lng ?? null,
      ...eventContext(pts, r.start, r.end),
      readings: r.end - r.start + 1,
    }
  }
  const fills = episodes(pts, 1, thFill, 0).map(make('fill'))
  const drains = episodes(pts, -1, thDrain, lph).map(make('drain'))
  return [...fills, ...drains].sort((x, y) => x.startTs - y.startTs)
}

/** Has at least SETTLE_READINGS readings after its end, so a dropout cannot still undo it? */
export function isSettled(event, series) {
  let after = 0
  for (const p of series ?? []) if (p.ts > event.endTs) after++
  return after >= SETTLE_READINGS
}

/** The period's figures from a cleaned series and its events. */
export function fuelSummary(series, events) {
  const pts = series ?? []
  const empty = { moving: 0, idle: 0, stopped: 0, between_trips: 0, gap: 0, unknown: 0 }
  if (!pts.length) return { readings: 0, start: null, end: null, min: null, max: null, filled: 0, drained: 0, fills: 0, drains: 0, used: null, drainsByContext: empty }
  const levels = pts.map(p => p.litres)
  const fills = events.filter(e => e.kind === 'fill')
  const drains = events.filter(e => e.kind === 'drain')
  const filled = fills.reduce((s, e) => s + e.litres, 0)
  const drained = drains.reduce((s, e) => s + e.litres, 0)
  const start = levels[0], end = levels[levels.length - 1]
  const drainsByContext = { ...empty }
  for (const e of drains) drainsByContext[e.context in drainsByContext ? e.context : 'unknown']++
  return {
    readings: pts.length,
    start: round1(start), end: round1(end), min: round1(Math.min(...levels)), max: round1(Math.max(...levels)),
    filled: round1(filled), drained: round1(drained), fills: fills.length, drains: drains.length,
    used: round1(Math.max(0, start + filled - end - drained)),
    drainsByContext,
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
