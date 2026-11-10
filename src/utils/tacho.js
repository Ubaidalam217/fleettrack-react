/**
 * The Tacho Graph and Tacho Data reports (client list 2026-11-10, after Ctrack
 * MaXx "Tacho Analysis", Ctrack-Reports-Catalog.md §3.10). Pure: no React, no
 * network, no Date.now().
 *
 * Ctrack's Tacho Analysis is not a digital tachograph: it is speed, engine RPM,
 * distance and trips drawn against time, read message by message. Both reports
 * are views of the one per-message series built here — the graph draws it, the
 * data report lists it.
 *
 * ── RPM ──────────────────────────────────────────────────────────────────
 * Probed 2026-11-10 (all 10 devices: telemetry, then 7 days of messages): no
 * tracker sends engine RPM. Only AD 12944-R14 has `can.engine.rpm` in its
 * schema, last reported 124 days ago and always 0. The fields are still
 * requested so a CAN-connected tracker shows its RPM without a code change.
 * A vehicle "has RPM" only once some reading is above 0: a CAN bus that sends
 * nothing but zeros is not a reading, and a flat zero line would claim the
 * engine never ran.
 *
 * ── Trips ────────────────────────────────────────────────────────────────
 * The Trip Report's trips (usageReports.js deriveTrips): one ignition-on run,
 * ended by ignition off or by a gap in the data over 30 minutes; movement
 * (speed > 0) when the tracker never reports ignition. The same rule, so the
 * trip count and drive time here match the Trip Report's.
 *
 * ── Distance ─────────────────────────────────────────────────────────────
 * Cumulative km since the start of the period from createDistanceStepper
 * (distance.js), the rule every report uses: odometer where the tracker sends
 * one, GPS otherwise.
 */

import { createDistanceStepper } from './distance.js'
import { deriveTrips, dayKey } from './usageReports.js'

/** RPM fields, first one present wins. None of the current trackers sends any. */
export const RPM_FIELDS = ['can.engine.rpm', 'engine.rpm', 'obd.engine.rpm']

export const TACHO_FIELDS = [
  'timestamp',
  'position.speed',
  'position.latitude',
  'position.longitude',
  'position.valid',
  'position.satellites',
  'engine.ignition.status',
  'vehicle.mileage',
  ...RPM_FIELDS,
].join(',')

/** Longest period either report fetches. */
export const MAX_TACHO_DAYS = 7

/** A silence longer than this is a gap: it ends a trip and breaks the speed line. */
export const TACHO_GAP_SEC = 30 * 60

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The message's engine RPM, or null when it carries none. */
export function rpmOf(m) {
  for (const f of RPM_FIELDS) {
    const v = num(m?.[f])
    if (v !== null) return v
  }
  return null
}

function posOf(m) {
  const lat = num(m['position.latitude'])
  const lng = num(m['position.longitude'])
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return { lat: null, lng: null }
  return { lat, lng }
}

/**
 * One vehicle's tacho series from its messages (ascending by timestamp).
 *
 * points: one per message —
 *   { ts, speed, rpm, km (cumulative in the period), odo (the tracker's own
 *     odometer, null when the message has none), ign (true/false/null), sats,
 *     lat, lng, trip (index into trips, -1 outside one), gapBefore }
 *
 * @returns {{ points: object[], trips: object[], hasRpm: boolean, hasOdometer: boolean, hasIgnition: boolean }}
 */
export function buildTacho(messages) {
  const msgs = (messages ?? []).filter(m => num(m?.timestamp) !== null)
  const trips = deriveTrips(msgs, { maxGapSec: TACHO_GAP_SEC }).map(t => ({
    startTs: t.startTs, endTs: t.endTs, distanceKm: t.distanceKm, driveSec: t.driveSec, maxSpeed: t.maxSpeed, open: t.open,
  }))

  const step = createDistanceStepper()
  const points = []
  let km = 0
  let ti = 0
  let prevTs = null
  for (const m of msgs) {
    km += step(m).km
    const ts = m.timestamp
    // Trips are in order and never overlap, so one forward walk places every point.
    while (ti < trips.length && trips[ti].endTs <= ts) ti++
    const inTrip = ti < trips.length && trips[ti].startTs <= ts
    const ign = m['engine.ignition.status']
    points.push({
      ts,
      speed: num(m['position.speed']),
      rpm: rpmOf(m),
      km,
      odo: num(m['vehicle.mileage']),
      ign: typeof ign === 'boolean' ? ign : null,
      sats: num(m['position.satellites']),
      ...posOf(m),
      trip: inTrip ? ti : -1,
      gapBefore: prevTs !== null && ts - prevTs > TACHO_GAP_SEC,
    })
    prevTs = ts
  }

  return {
    points,
    trips,
    hasRpm: points.some(p => p.rpm > 0),
    hasOdometer: points.some(p => p.odo > 0),
    hasIgnition: points.some(p => p.ign !== null),
  }
}

/** Index of the first point at or after ts. */
function lowerBound(points, ts) {
  let lo = 0, hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].ts < ts) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Totals over a window of the series (the whole period by default):
 * distance, drive time, top speed, top RPM, trips touching the window and the
 * number of readings.
 *
 * Drive time counts an interval the way deriveTrips does — it lies inside a
 * trip and the vehicle was moving at its start — clipped to the window, so
 * over the whole period it equals the trips' drive time exactly.
 */
export function summarize(tacho, x0 = -Infinity, x1 = Infinity) {
  const { points, trips, hasRpm } = tacho
  let driveSec = 0
  let maxSpeed = null
  let maxRpm = null
  let readings = 0
  let kmBefore = null
  let kmFirst = null
  let kmLast = null

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[i + 1]
    if (q && p.trip >= 0 && q.ts <= trips[p.trip].endTs && (p.speed ?? 0) > 0) {
      const a = Math.max(p.ts, x0)
      const b = Math.min(q.ts, x1)
      if (b > a) driveSec += b - a
    }
    if (p.ts < x0) { kmBefore = p.km; continue }
    if (p.ts > x1) break
    readings += 1
    if (kmFirst === null) kmFirst = p.km
    kmLast = p.km
    if (p.speed !== null && (maxSpeed === null || p.speed > maxSpeed)) maxSpeed = p.speed
    if (hasRpm && p.rpm !== null && (maxRpm === null || p.rpm > maxRpm)) maxRpm = p.rpm
  }

  return {
    distanceKm: kmLast === null ? 0 : kmLast - (kmBefore ?? kmFirst),
    driveSec,
    maxSpeed,
    maxRpm,
    trips: trips.filter(t => t.endTs >= x0 && t.startTs <= x1).length,
    readings,
  }
}

// ── graph ────────────────────────────────────────────────────────────────

/**
 * About `maxPoints` of the series for drawing: per equal slice of time the
 * slowest and the fastest reading (and the highest RPM), so peaks and stops
 * survive a week squeezed into one chart width. Both ends of every gap are
 * always kept, so the gap is still seen where it was.
 */
export function downsample(points, maxPoints) {
  if (points.length <= maxPoints || points.length < 3) return points
  const buckets = Math.max(1, Math.floor(maxPoints / 3))
  const t0 = points[0].ts
  const width = (points[points.length - 1].ts - t0) / buckets || 1
  const keep = new Set([0, points.length - 1])
  let bucket = -1
  let lo = -1, hi = -1, top = -1
  const flush = () => { if (bucket >= 0) { keep.add(lo); keep.add(hi); if (top >= 0) keep.add(top) } }
  const sp = p => p.speed ?? 0

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.gapBefore && i > 0) { keep.add(i - 1); keep.add(i) }
    const b = Math.min(buckets - 1, Math.floor((p.ts - t0) / width))
    if (b !== bucket) {
      flush()
      bucket = b
      lo = hi = i
      top = typeof p.rpm === 'number' ? i : -1
      continue
    }
    if (sp(p) < sp(points[lo])) lo = i
    if (sp(p) > sp(points[hi])) hi = i
    if (typeof p.rpm === 'number' && (top < 0 || p.rpm > points[top].rpm)) top = i
  }
  flush()
  return [...keep].sort((a, b) => a - b).map(i => points[i])
}

/**
 * The series inside [x0, x1] ready for the chart: thinned to maxPoints, one
 * reading kept either side so the lines run to the edges, and a break
 * (speed null) across each gap the vehicle was moving into or out of — a
 * straight line over an hour of silence would draw driving nobody recorded.
 * A gap between two parked readings stays a flat 0: parked is what it was.
 */
export function chartPoints(points, x0, x1, maxPoints = 1200) {
  const from = Math.max(0, lowerBound(points, x0) - 1)
  const to = Math.min(points.length, lowerBound(points, x1 + 1) + 1)
  const slice = downsample(points.slice(from, to), maxPoints)
  const out = []
  for (let i = 0; i < slice.length; i++) {
    const p = slice[i]
    const prev = out[out.length - 1]
    if (p.gapBefore && prev && ((prev.speed ?? 0) > 0 || (p.speed ?? 0) > 0)) {
      out.push({ ...prev, ts: prev.ts + 1, speed: null, rpm: null, gap: true })
    }
    out.push(p)
  }
  return out
}

/** The zoom window for one trip, with a little room either side. */
export function tripWindow(trip, minPadSec = 120) {
  const pad = Math.max(minPadSec, (trip.endTs - trip.startTs) * 0.08)
  return [trip.startTs - pad, trip.endTs + pad]
}

/**
 * The trip ‹ Trip / Trip › moves to, or null when there is none that way.
 * From a trip: the one before or after it. From the whole period: the first or
 * the last. From a dragged zoom: the first trip starting inside or after the
 * window, or the last one ending inside or before it.
 *
 * @param {number|null} current  index of the trip in view, null for none
 * @param {[number, number]} view the window shown
 * @param {1|-1} dir
 */
export function stepTrip(trips, current, view, dir) {
  if (!trips.length) return null
  if (current !== null && current !== undefined) {
    const next = current + dir
    return next >= 0 && next < trips.length ? next : null
  }
  if (dir > 0) {
    const i = trips.findIndex(t => t.startTs >= view[0])
    return i === -1 ? null : i
  }
  for (let i = trips.length - 1; i >= 0; i--) if (trips[i].endTs <= view[1]) return i
  return null
}

const TICK_STEPS = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400]

/**
 * Round local-time ticks across [x0, x1]: the smallest step from TICK_STEPS
 * (a minute to a day) that leaves at most maxTicks.
 *
 * @param {number} tzOffsetSec  seconds east of UTC (the browser's by default)
 */
export function timeTicks(x0, x1, maxTicks = 8, tzOffsetSec = -new Date(x0 * 1000).getTimezoneOffset() * 60) {
  const span = x1 - x0
  if (!(span > 0)) return []
  const step = TICK_STEPS.find(s => span / s <= maxTicks) ?? Math.ceil(span / maxTicks / 86400) * 86400
  const ticks = []
  for (let t = Math.ceil((x0 + tzOffsetSec) / step) * step - tzOffsetSec; t <= x1; t += step) ticks.push(t)
  return ticks
}

// ── data report ──────────────────────────────────────────────────────────

/**
 * The readings left after "one per N seconds": the first, then each one at
 * least intervalSec after the last kept — but every ignition switch and the
 * first reading after a gap are always kept, so no trip start or stop drops
 * out of a thinned list. Cumulative km is already on every point, so a thinned
 * list still reads the same distance.
 */
export function thinReadings(points, intervalSec) {
  if (!(intervalSec > 0)) return points
  const out = []
  let lastKept = null
  let ign = null // last known ignition
  for (const p of points) {
    const switched = p.ign !== null && ign !== null && p.ign !== ign
    if (p.ign !== null) ign = p.ign
    if (!lastKept || switched || p.gapBefore || p.ts - lastKept.ts >= intervalSec) {
      out.push(p)
      lastKept = p
    }
  }
  return out
}

/** Readings grouped by local calendar day, in order: [{ key, date, points }]. */
export function byLocalDay(points) {
  const days = []
  for (const p of points) {
    const k = dayKey(p.ts)
    if (days[days.length - 1]?.key !== k) days.push({ key: k, date: new Date(p.ts * 1000), points: [] })
    days[days.length - 1].points.push(p)
  }
  return days
}

/**
 * Which readings of a day are its events: the first and the last, and every
 * one where the ignition switched. These are the rows worth an address; the
 * rest of a message-by-message list sits between them.
 */
export function eventFlags(points) {
  let ign = null
  return points.map((p, i) => {
    const switched = p.ign !== null && ign !== null && p.ign !== ign
    if (p.ign !== null) ign = p.ign
    return i === 0 || i === points.length - 1 || switched
  })
}
