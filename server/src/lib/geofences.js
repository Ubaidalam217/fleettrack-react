/**
 * Geometry rules for a Geofence row that cannot live in a zod schema because
 * they depend on `shape` (which fields even apply) or need a database read
 * (name uniqueness).
 */

import prisma from '../prisma.js'
import { badRequest, conflict } from './http.js'

/** A sane upper bound on a circle's radius, in meters — 50 km. */
export const MAX_RADIUS_METERS = 50_000

/**
 * Shoelace-formula signed area, doubled. Zero area means every vertex is
 * collinear — a degenerate "polygon" with no inside.
 */
function signedAreaX2(points) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.lng * b.lat - b.lng * a.lat
  }
  return sum
}

/** Whether segment p1→p2 crosses segment p3→p4, sharing no endpoint. */
function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng)
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  )
}

/**
 * True when any two non-adjacent edges of the (closed) polygon cross.
 *
 * O(n²) over the edge list, which is fine — a hand-drawn polygon on a map is
 * tens of vertices, never thousands.
 */
function isSelfIntersecting(points) {
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a1 = points[i]
    const a2 = points[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges share a vertex by construction and always "touch" there
      // — that is not a crossing.
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue
      const b1 = points[j]
      const b2 = points[(j + 1) % n]
      if (segmentsCross(a1, a2, b1, b2)) return true
    }
  }
  return false
}

/**
 * Validates the shape-specific fields and throws a 400 naming the offending
 * field, the same way the zod schemas in the route do. Kept separate from the
 * zod schema because which fields are even checked depends on `shape`, which
 * zod's per-field validators do not see.
 */
export function assertValidGeometry({ shape, points, centerLat, centerLng, radius }) {
  if (shape === 'POLYGON') {
    if (!Array.isArray(points) || points.length < 3) {
      throw badRequest('A polygon needs at least 3 points', { points: 'Add at least 3 points' })
    }
    for (const p of points) {
      if (
        typeof p?.lat !== 'number' || typeof p?.lng !== 'number' ||
        !Number.isFinite(p.lat) || !Number.isFinite(p.lng) ||
        Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180
      ) {
        throw badRequest('Every polygon point needs a valid lat/lng', { points: 'Invalid point' })
      }
    }
    if (signedAreaX2(points) === 0) {
      throw badRequest('Polygon points cannot all lie on one line', { points: 'Degenerate polygon' })
    }
    if (isSelfIntersecting(points)) {
      throw badRequest('Polygon edges cannot cross themselves', { points: 'Self-intersecting polygon' })
    }
    return
  }

  // CIRCLE
  if (
    typeof centerLat !== 'number' || typeof centerLng !== 'number' ||
    !Number.isFinite(centerLat) || !Number.isFinite(centerLng) ||
    Math.abs(centerLat) > 90 || Math.abs(centerLng) > 180
  ) {
    throw badRequest('A circle needs a valid center point', { centerLat: 'Invalid center' })
  }
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
    throw badRequest('Radius must be greater than 0', { radius: 'Must be greater than 0' })
  }
  if (radius > MAX_RADIUS_METERS) {
    throw badRequest(`Radius cannot exceed ${MAX_RADIUS_METERS.toLocaleString()} meters`, {
      radius: `Must be ${MAX_RADIUS_METERS.toLocaleString()} m or less`,
    })
  }
}

/** Throws 409 if another geofence in the same BG already uses this name. */
export async function assertNameFree(bgId, name, exceptId = null) {
  const clash = await prisma.geofence.findFirst({
    where: { bgId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) {
    throw conflict('That name is already used by another geofence in this business group', {
      name: 'Already in use',
    })
  }
}
