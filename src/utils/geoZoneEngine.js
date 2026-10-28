/**
 * Geo Zone Visit Report — pure detection engine.
 *
 * Takes one vehicle's raw Flespi messages (already fetched, ascending by
 * timestamp) plus the geofences scoped to that vehicle's own BG, and derives
 * everything all 5 Geo Zone sub-reports need: containment segments (who was
 * inside which fence when), trips (fence-exit to fence-entry), visits
 * (Reach/Depart per fence), and a 4-bucket Running/Idle/Stop/Inactive time
 * split for any sub-interval.
 *
 * No React, no network, no Date.now()/Math.random() — a caller passes in
 * whatever "now" it wants and everything else is a function of the messages
 * and geofences handed in. That is what makes this unit-testable without a
 * DOM and safe to run inside a Workflow script.
 *
 * ── Trip definition ──────────────────────────────────────────────────────
 * A trip is the span between leaving one geofence and reaching the next.
 * Trips chain with zero gap — a trip's start IS the prior trip's end — and a
 * self-to-self trip (same start and end fence) is a real row, not a merge
 * target. No trip row is emitted before the first fence-exit in the window,
 * or for a tail excursion that never reaches another fence before the window
 * ends — both read as "incomplete", and the reference table only ever shows
 * closed start-fence/end-fence pairs.
 *
 * Driver is not derived here (and never will be): this fleet has no
 * driver-tag/RFID field anywhere in Flespi (see usageData.js), so every
 * caller must render Driver as "--" rather than inventing a value or trying
 * to reproduce the reference system's multi-driver trip concatenation, which
 * depends on data we do not have.
 *
 * ── Visit definition ─────────────────────────────────────────────────────
 * A visit is one Reach (entry) -> Depart (exit) span at one geofence. An
 * in-progress visit at the data cutoff (never departed) has depart fields
 * null — render as "--"/00:00:00, never invented. "Outside duration" for a
 * visit is the gap from its Depart until that SAME geofence's next Reach.
 *
 * ── Noise handling ───────────────────────────────────────────────────────
 * Two independent filters, both applied before any trip/visit is derived,
 * both caller-configurable (surfaced in the report page's settings):
 *
 *   dwellSec (default 60)  — a containment run shorter than this is GPS
 *     jitter at a boundary, not a real entry, and is dropped entirely (the
 *     points inside it are treated as "outside any fence").
 *   mergeGapSec (default 120) — if the vehicle exits fence X and re-enters
 *     the SAME fence X within this many seconds, with no other fence visited
 *     in between, the two runs are merged into one continuous visit/segment.
 *     This does not touch a genuine self-to-self TRIP, which requires the
 *     exit to survive past the merge window.
 */

import { haversineMeters, createDistanceStepper } from './distance'

export { haversineMeters }

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// ── geometry ─────────────────────────────────────────────────────────────

/** Standard ray-casting point-in-polygon, (lng, lat) as the (x, y) plane. */
export function pointInPolygon(lat, lng, points) {
  if (!Array.isArray(points) || points.length < 3) return false
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng, yi = points[i].lat
    const xj = points[j].lng, yj = points[j].lat
    const intersects = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

export function pointInCircle(lat, lng, centerLat, centerLng, radiusM) {
  if (typeof centerLat !== 'number' || typeof centerLng !== 'number' || !(radiusM > 0)) return false
  return haversineMeters(lat, lng, centerLat, centerLng) <= radiusM
}

export function pointInGeofence(lat, lng, g) {
  if (g.shape === 'CIRCLE') return pointInCircle(lat, lng, g.centerLat, g.centerLng, g.radius)
  return pointInPolygon(lat, lng, g.points)
}

/**
 * Which of `geofences` contains (lat, lng), or null. Ties (overlapping
 * fences) resolve to the lowest `id` — deterministic, not meaningful order.
 */
export function whichGeofence(lat, lng, geofences) {
  let best = null
  for (const g of geofences) {
    if (!pointInGeofence(lat, lng, g)) continue
    if (best == null || String(g.id) < String(best.id)) best = g
  }
  return best
}

// ── usage bucket classification (Running / Idle / Stop / Inactive) ────────

// Same threshold computeUsage() uses: longer than this and the device was
// off/out of coverage, not idling — see usageData.js for why.
export const DEFAULT_MAX_GAP_SEC = 30 * 60

/**
 * Classify the interval between two consecutive messages into one of the
 * four buckets, using exactly computeUsage's ignition+speed rule, split into
 * Stop vs Inactive where computeUsage only ever needed one residual bucket
 * (a whole day's worth). For a full day the two together equal computeUsage's
 * stopSec; this just needs them separated for a sub-interval (one trip).
 */
export function classifyInterval(prev, cur, maxGapSec = DEFAULT_MAX_GAP_SEC) {
  const dt = (cur.timestamp ?? 0) - (prev.timestamp ?? 0)
  if (!(dt > 0)) return { bucket: null, dt: 0 }
  if (dt > maxGapSec) return { bucket: 'inactive', dt }
  const ignition = prev['engine.ignition.status'] ?? null
  if (ignition === false) return { bucket: 'stop', dt }
  const speed = num(prev['position.speed']) ?? 0
  return { bucket: speed > 0 ? 'running' : 'idle', dt }
}

/**
 * Running/Idle/Stop/Inactive seconds (plus distanceKm) over [fromTs, toTs],
 * from the full message list. An interval that straddles the window edge is
 * counted whole, so the message just before `fromTs` is the distance baseline.
 * Distance is distance.js's stepper summed (odometer, GPS fallback); every
 * message is stepped, in or out of the window, to keep its odometer anchor.
 */
export function usageOverWindow(messages, fromTs, toTs, maxGapSec = DEFAULT_MAX_GAP_SEC) {
  const result = { runningSec: 0, idleSec: 0, stopSec: 0, inactiveSec: 0, distanceKm: 0, maxSpeed: 0 }
  const step = createDistanceStepper()
  if (messages.length) step(messages[0])

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1]
    const cur = messages[i]
    const { km } = step(cur)
    if ((cur.timestamp ?? 0) <= fromTs || (prev.timestamp ?? 0) >= toTs) continue

    const { bucket, dt } = classifyInterval(prev, cur, maxGapSec)
    if (bucket) result[`${bucket}Sec`] += dt

    const speed = num(cur['position.speed'])
    if (speed != null && speed > result.maxSpeed) result.maxSpeed = speed

    result.distanceKm += km
  }

  return result
}

// ── containment segments ────────────────────────────────────────────────

/**
 * Collapse a vehicle's positioned messages into contiguous containment runs,
 * then apply the dwell-time and short-exit-merge noise filters.
 *
 * @param {object[]} messages    full message list, ascending by timestamp
 * @param {object[]} geofences   this vehicle's own-BG geofences
 * @param {object} [opts]
 * @param {number} [opts.dwellSec]
 * @param {number} [opts.mergeGapSec]
 * @returns {{fenceId: string|null, fence: object|null, startMsg: object, endMsg: object}[]}
 *          ordered, alternating (no two adjacent segments share a fenceId —
 *          including null, so "outside" runs are also merged)
 */
export function buildContainmentSegments(messages, geofences, opts = {}) {
  const { dwellSec = 60, mergeGapSec = 120 } = opts
  const byId = new Map(geofences.map(g => [String(g.id), g]))

  // Pass 1: one entry per positioned message, carrying its containing fence
  // (or null) forward across messages with no fix — a missing fix does not
  // imply the vehicle left the fence it was last confirmed inside.
  const points = []
  let lastFence = null
  for (const m of messages) {
    const lat = num(m['position.latitude'])
    const lng = num(m['position.longitude'])
    if (lat != null && lng != null) {
      lastFence = whichGeofence(lat, lng, geofences)
    }
    points.push({ msg: m, fenceId: lastFence ? String(lastFence.id) : null })
  }

  // Pass 2: collapse into alternating runs.
  const raw = []
  for (const p of points) {
    const last = raw[raw.length - 1]
    if (last && last.fenceId === p.fenceId) {
      last.endMsg = p.msg
    } else {
      raw.push({ fenceId: p.fenceId, startMsg: p.msg, endMsg: p.msg })
    }
  }

  // Pass 3: dwell filter — a non-null run shorter than dwellSec is jitter;
  // fold it into "outside" (null) and re-collapse adjacent outside runs.
  const dwelled = []
  for (const r of raw) {
    const span = (r.endMsg.timestamp ?? 0) - (r.startMsg.timestamp ?? 0)
    const keep = r.fenceId == null || span >= dwellSec
    const fenceId = keep ? r.fenceId : null
    const last = dwelled[dwelled.length - 1]
    if (last && last.fenceId === fenceId) last.endMsg = r.endMsg
    else dwelled.push({ fenceId, startMsg: r.startMsg, endMsg: r.endMsg })
  }

  // Pass 4: short-exit merge — an "outside" run shorter than mergeGapSec,
  // sandwiched between two runs of the SAME fence, is folded away. Built with
  // explicit lookahead (the full run list is already in memory) rather than
  // a streaming guess, so a chain of several short back-and-forths collapses
  // in one left-to-right pass without needing to revisit earlier output.
  const merged = []
  for (let i = 0; i < dwelled.length; i++) {
    const r = dwelled[i]
    const prevOut = merged[merged.length - 1]
    const next = dwelled[i + 1]
    const isShortOutsideGap = r.fenceId == null
      && (r.endMsg.timestamp ?? 0) - (r.startMsg.timestamp ?? 0) < mergeGapSec
    const returnsToSameFence = prevOut && next
      && prevOut.fenceId != null && prevOut.fenceId === next.fenceId

    if (isShortOutsideGap && returnsToSameFence) {
      // Absorb this gap into prevOut; the next run (same fence) absorbs into
      // it on its own iteration since it will again see prevOut as the tail.
      prevOut.endMsg = r.endMsg
      continue
    }

    if (prevOut && prevOut.fenceId === r.fenceId) prevOut.endMsg = r.endMsg
    else merged.push({ fenceId: r.fenceId, startMsg: r.startMsg, endMsg: r.endMsg })
  }

  return merged.map(r => ({
    fenceId: r.fenceId,
    fence: r.fenceId != null ? byId.get(r.fenceId) ?? null : null,
    startMsg: r.startMsg,
    endMsg: r.endMsg,
  }))
}

function msgPoint(m) {
  return {
    ts: m.timestamp ?? null,
    lat: num(m['position.latitude']),
    lng: num(m['position.longitude']),
  }
}

// ── trips ───────────────────────────────────────────────────────────────

/**
 * Derive trips from containment segments: each trip pairs one fence-exit
 * event with the next fence-entry event. No trip before the first exit, none
 * for a tail excursion that never reaches another fence.
 */
export function deriveTrips(segments, messages, opts = {}) {
  const trips = []
  let pendingExit = null // { fence, exitMsg }

  for (const seg of segments) {
    if (seg.fenceId == null) continue
    if (pendingExit) {
      trips.push(buildTrip(pendingExit, seg, messages, opts))
    }
    pendingExit = { fence: seg.fence, exitMsg: seg.endMsg }
  }

  return trips
}

function buildTrip(pendingExit, enterSeg, messages, opts) {
  const startMsg = pendingExit.exitMsg
  const endMsg = enterSeg.startMsg
  const fromTs = startMsg.timestamp ?? 0
  const toTs = endMsg.timestamp ?? 0
  const usage = usageOverWindow(messages, fromTs, toTs, opts.maxGapSec)
  return {
    startFence: pendingExit.fence,
    endFence: enterSeg.fence,
    start: msgPoint(startMsg),
    end: msgPoint(endMsg),
    durationSec: Math.max(0, toTs - fromTs),
    ...usage,
  }
}

// ── visits ──────────────────────────────────────────────────────────────

/**
 * Derive visits (Reach/Depart per fence occurrence) from containment
 * segments, plus each visit's "outside duration" — the gap from its Depart
 * until that SAME fence's next Reach. The last visit to a fence in the
 * window may be in-progress (never departed); `departMsg` is null then.
 *
 * @param {boolean} [opts.cutoffIsEnd]  when true (default), the last message
 *   in `messages` is treated as the data cutoff, so a visit still open there
 *   is "in progress" rather than silently closed.
 */
export function deriveVisits(segments, messages, opts = {}) {
  const byFence = new Map() // fenceId -> visit[]
  const allVisits = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.fenceId == null) continue
    const isLastMessage = seg.endMsg === messages[messages.length - 1]
    const visit = {
      fence: seg.fence,
      reach: msgPoint(seg.startMsg),
      depart: isLastMessage ? null : msgPoint(seg.endMsg),
      inProgress: isLastMessage,
    }
    if (!byFence.has(seg.fenceId)) byFence.set(seg.fenceId, [])
    byFence.get(seg.fenceId).push(visit)
    allVisits.push(visit)
  }

  for (const visits of byFence.values()) {
    visits.sort((a, b) => (a.reach.ts ?? 0) - (b.reach.ts ?? 0))
    for (let i = 0; i < visits.length; i++) {
      const v = visits[i]
      const next = visits[i + 1]
      v.outsideDurationSec = (v.depart && next)
        ? Math.max(0, (next.reach.ts ?? 0) - (v.depart.ts ?? 0))
        : (v.depart ? null : 0) // null = "still outside, unknown until data ends" (no next visit)
    }
  }

  allVisits.sort((a, b) => (a.reach.ts ?? 0) - (b.reach.ts ?? 0))
  return allVisits
}

// ── geofence history (entry/exit log + visit counts) ──────────────────────

/** One Entry->Exit row per containment segment, for the History sub-report. */
export function deriveHistoryRows(segments, messages, opts = {}) {
  const rows = []
  for (const seg of segments) {
    if (seg.fenceId == null) continue
    const isLastMessage = seg.endMsg === messages[messages.length - 1]
    const fromTs = seg.startMsg.timestamp ?? 0
    const toTs = seg.endMsg.timestamp ?? 0
    const usage = usageOverWindow(messages, fromTs, toTs, opts.maxGapSec)
    rows.push({
      fence: seg.fence,
      entry: msgPoint(seg.startMsg),
      exit: isLastMessage ? null : msgPoint(seg.endMsg),
      durationSec: Math.max(0, toTs - fromTs),
      distanceKm: usage.distanceKm,
    })
  }
  return rows
}

// ── orchestration ───────────────────────────────────────────────────────

/**
 * Run the full engine for one vehicle: containment segments, trips, visits
 * and history rows, in one pass over its messages.
 *
 * @param {object[]} messages   ascending by timestamp
 * @param {object[]} geofences  this vehicle's own-BG geofences
 * @param {object} [opts]       dwellSec, mergeGapSec, maxGapSec
 */
export function analyzeVehicle(messages, geofences, opts = {}) {
  const segments = buildContainmentSegments(messages, geofences, opts)
  return {
    segments,
    trips: deriveTrips(segments, messages, opts),
    visits: deriveVisits(segments, messages, opts),
    historyRows: deriveHistoryRows(segments, messages, opts),
  }
}
