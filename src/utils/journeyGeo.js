/**
 * Journey Management geometry (client, 2026-11-13/16/17), shared by the server's
 * journey engine (server/src/lib/journeyEngine.js) and the web screens.
 *
 * Pure functions on plain numbers: a path is [[lat, lng], …]; a stop is
 * { arrivalType: 'RADIUS'|'GEOFENCE', lat, lng, radiusM, polygon? }.
 *
 * ── Why a segment test, not a point-in-circle test ─────────────────────────
 * The trackers report every 36–60 s while moving, 1–1.7 km apart at highway
 * speed, so a 300 m stop circle is usually jumped over between two fixes.
 * passBy() measures how close the straight line between two fixes came to the
 * stop, so a drive-through is never missed.
 *
 * ── Why the projection is monotonic ────────────────────────────────────────
 * project() looks forward from the last matched segment only (within a window),
 * so a round trip or a loop never snaps back onto the outbound leg.
 */

import { haversineMeters } from './distance.js'

const R = 6371000
const rad = d => (d * Math.PI) / 180

export const distM = (a, b) => haversineMeters(a[0], a[1], b[0], b[1])

/** Straight distances count as this much road (no routing engine yet). */
export const ROAD_FACTOR = 1.25

/** Cumulative km along a path: out[i] = km from path[0] to path[i]. */
export function cumulativeKm(path) {
  const out = new Array(path.length).fill(0)
  for (let i = 1; i < path.length; i++) out[i] = out[i - 1] + distM(path[i - 1], path[i]) / 1000
  return out
}

export const pathKm = path => (path.length > 1 ? cumulativeKm(path)[path.length - 1] : 0)

/**
 * The closest point of segment a→b to p, on a local flat projection (fine for
 * segments of a few km). Returns { t: 0..1 along the segment, m: metres away }.
 */
export function closestOnSegment(a, b, p) {
  const lat0 = rad(p[0])
  const x = q => rad(q[1]) * Math.cos(lat0) * R
  const y = q => rad(q[0]) * R
  const ax = x(a), ay = y(a), bx = x(b), by = y(b), px = x(p), py = y(p)
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx, cy = ay + t * dy
  return { t, m: Math.hypot(px - cx, py - cy) }
}

/**
 * Where point p sits on the path: { alongKm, crossM, segIdx }.
 *
 * Searches segments from `fromSeg` forward while they start within `windowKm`
 * of where that segment starts. When nothing in the window is within
 * `corridorM`, the whole path is searched once (the engine was off for a while
 * and the vehicle is already far ahead) — still never before `fromSeg - 1`.
 */
export function project(path, cum, p, fromSeg = 0, { windowKm = 30, corridorM = 1000 } = {}) {
  if (!path || path.length < 2) {
    const m = path?.length ? distM(path[0], p) : Infinity
    return { alongKm: 0, crossM: m, segIdx: 0 }
  }
  const start = Math.max(0, Math.min(fromSeg - 1, path.length - 2))
  const scan = limitKm => {
    let best = null
    for (let i = start; i < path.length - 1; i++) {
      if (limitKm !== null && cum[i] - cum[start] > limitKm) break
      const { t, m } = closestOnSegment(path[i], path[i + 1], p)
      if (!best || m < best.crossM - 1e-6) best = { alongKm: cum[i] + t * (cum[i + 1] - cum[i]), crossM: m, segIdx: i }
    }
    return best
  }
  const near = scan(windowKm)
  if (near && near.crossM <= corridorM) return near
  const all = scan(null)
  return all && all.crossM < (near?.crossM ?? Infinity) ? all : near
}

/**
 * How close the drive from fix a to fix b came to `center`, and when.
 * a, b: { lat, lng, ts }. Returns { m, ts } at the closest approach.
 */
export function passBy(a, b, center) {
  const { t, m } = closestOnSegment([a.lat, a.lng], [b.lat, b.lng], center)
  return { m, ts: a.ts + t * (b.ts - a.ts) }
}

function pointInPolygon(lat, lng, points) {
  if (!Array.isArray(points) || points.length < 3) return false
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng, yi = points[i].lat
    const xj = points[j].lng, yj = points[j].lat
    if (((yi > lat) !== (yj > lat)) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Is (lat, lng) inside a stop's arrival area? A geofence stop uses its shape snapshot. */
export function inStop(lat, lng, stop) {
  if (stop.arrivalType === 'GEOFENCE' && Array.isArray(stop.polygon) && stop.polygon.length >= 3) {
    return pointInPolygon(lat, lng, stop.polygon)
  }
  return haversineMeters(lat, lng, stop.lat, stop.lng) <= (stop.radiusM || 300)
}

/**
 * Did the drive from fix a to fix b pass through the stop's area between the
 * two fixes? Returns the time it was closest/inside, or null.
 * Circles: the exact closest approach. Polygons: the segment sampled every ~50 m.
 */
export function passThrough(a, b, stop) {
  if (stop.arrivalType === 'GEOFENCE' && Array.isArray(stop.polygon) && stop.polygon.length >= 3) {
    const len = haversineMeters(a.lat, a.lng, b.lat, b.lng)
    const n = Math.min(400, Math.max(2, Math.ceil(len / 50)))
    for (let i = 1; i < n; i++) {
      const t = i / n
      if (pointInPolygon(a.lat + t * (b.lat - a.lat), a.lng + t * (b.lng - a.lng), stop.polygon)) return a.ts + t * (b.ts - a.ts)
    }
    return null
  }
  const { m, ts } = passBy(a, b, [stop.lat, stop.lng])
  return m <= (stop.radiusM || 300) ? ts : null
}

/** Douglas–Peucker on [[lat, lng, …rest]] with a tolerance in metres. Keeps the extra columns. */
export function simplifyPath(points, toleranceM = 30) {
  if (!Array.isArray(points) || points.length < 3) return points ? [...points] : []
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let worst = -1, at = -1
    for (let i = s + 1; i < e; i++) {
      const { m } = closestOnSegment(points[s], points[e], points[i])
      if (m > worst) { worst = m; at = i }
    }
    if (worst > toleranceM && at > 0) {
      keep[at] = 1
      stack.push([s, at], [at, e])
    }
  }
  return points.filter((_, i) => keep[i])
}

/**
 * Where each stop sits along the path (km from the start), matched in order so
 * a stop is never placed before the one before it. Stops off the path take the
 * closest point after the previous stop.
 */
export function stopsAlong(path, stops) {
  if (!path || path.length < 2) {
    // No line: straight legs between the stops, counted as road.
    let km = 0
    return stops.map((s, i) => {
      if (i > 0) km += (distM([stops[i - 1].lat, stops[i - 1].lng], [s.lat, s.lng]) / 1000) * ROAD_FACTOR
      return km
    })
  }
  const cum = cumulativeKm(path)
  let seg = 0
  return stops.map((s, i) => {
    if (i === 0) return 0
    if (i === stops.length - 1) {
      // The destination is the end of the line, or the closest point to it after the last stop.
      const p = project(path, cum, [s.lat, s.lng], seg, { windowKm: Infinity, corridorM: Infinity })
      return p.crossM < 2000 && cum[cum.length - 1] - p.alongKm < 2 ? cum[cum.length - 1] : p.alongKm
    }
    const p = project(path, cum, [s.lat, s.lng], seg, { windowKm: Infinity, corridorM: Infinity })
    seg = p.segIdx
    return p.alongKm
  })
}

/** The straight-leg "path" through the stops, for a journey with no recorded or drawn line. */
export const straightPath = stops => stops.map(s => [s.lat, s.lng])

/**
 * Splits a path into the part already driven and the part still to go, at
 * `alongKm` — the detail page draws the first solid and the second dashed.
 */
export function splitPath(path, alongKm) {
  if (!path || path.length < 2) return { done: [], todo: path ?? [] }
  const cum = cumulativeKm(path)
  if (alongKm <= 0) return { done: [], todo: path }
  if (alongKm >= cum[cum.length - 1]) return { done: path, todo: [] }
  let i = 1
  while (i < cum.length && cum[i] < alongKm) i++
  const t = (alongKm - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1])
  const cut = [path[i - 1][0] + t * (path[i][0] - path[i - 1][0]), path[i - 1][1] + t * (path[i][1] - path[i - 1][1])]
  return { done: [...path.slice(0, i), cut], todo: [cut, ...path.slice(i)] }
}

/** The point at `alongKm` on a path. */
export function pointAt(path, alongKm) {
  const { done } = splitPath(path, alongKm)
  return done.length ? done[done.length - 1] : path?.[0] ?? null
}
