/**
 * The road route of a journey (client 2026-11-24): "point A to point B, it
 * should draw the route and tell how long it takes". The best ROAD route
 * through the journey's stops, one route only: its line, and each leg's
 * distance and driving time.
 *
 * Same providers as the Route Optimization matrix (lib/distanceProvider.js,
 * picked in Journey settings › routing):
 *
 *   ORS     OpenRouteService directions; OPENROUTESERVICE_API_KEY on the server.
 *           Free key. Also what an "Estimate" setting upgrades to when the key
 *           exists, because the key is only ever set to get road routes.
 *   OSRM    the client's own OSRM server (the address in Journey settings).
 *   GOOGLE  Google Directions; GOOGLE_MAPS_API_KEY. Paid per request, so only
 *           when the client picks it in the settings AND sets the key.
 *
 * Nothing set up, or the service fails: the ESTIMATE (straight legs × the road
 * factor, minutes at the planned speed) and `estimated: true`, so the form keeps
 * working and says so. Keys never leave the server.
 *
 * Answers are cached by the stops' rounded coordinates (an edit that does not
 * move a stop costs no call), so a free key's daily limit lasts.
 */

import { haversineKm } from './routeOptimizer.js'
import { getJson, providerStatus } from './distanceProvider.js'
import { simplifyPath } from '../../../src/utils/journeyGeo.js'

/** Most points one request carries, by provider (a longer journey is estimated). */
export const MAX_POINTS = Object.freeze({ ORS: 50, OSRM: 100, GOOGLE: 27 })

const CACHE_TTL_MS = 6 * 3600_000
const CACHE_MAX = 300
const cache = new Map() // key -> { at, value }

export function __clearRoadRouteCache() {
  cache.clear()
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d

/** Which provider a road route uses for these settings, or null (estimate). */
export function routeProvider(routing) {
  const ready = providerStatus(routing)
  const want = routing?.provider ?? 'ESTIMATE'
  if (want === 'ESTIMATE') return ready.ORS ? 'ORS' : null
  return ready[want] ? want : null
}

/** Straight legs × the road factor, minutes at `speedKmh`. */
export function estimateRoute(points, { roadFactor = 1.3, speedKmh = 70 } = {}) {
  const legs = []
  for (let i = 1; i < points.length; i++) {
    const km = haversineKm(points[i - 1], points[i]) * roadFactor
    legs.push({ distanceKm: round(km, 2), durationMin: km > 0 ? Math.max(1, Math.round((km / Math.max(5, speedKmh)) * 60)) : 0 })
  }
  return {
    geometry: points.map(p => [p.lat, p.lng]),
    legs,
    distanceKm: round(legs.reduce((s, l) => s + l.distanceKm, 0), 1),
    durationMin: legs.reduce((s, l) => s + l.durationMin, 0),
  }
}

// ── providers: each returns { geometry: [[lat, lng]], legs: [{ distanceKm, durationMin }] } ──

async function orsRoute(points) {
  const j = await getJson('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: { Authorization: process.env.OPENROUTESERVICE_API_KEY, 'Content-Type': 'application/json' },
    // Snap every stop to the nearest road, however far (a stop in a yard or a field).
    body: JSON.stringify({ coordinates: points.map(p => [p.lng, p.lat]), radiuses: points.map(() => -1), instructions: false, preference: 'recommended' }),
  })
  const f = j?.features?.[0]
  const segs = f?.properties?.segments
  if (!f || !Array.isArray(f.geometry?.coordinates) || !Array.isArray(segs)) throw new Error('no route in the answer')
  return {
    geometry: f.geometry.coordinates.map(c => [c[1], c[0]]),
    legs: segs.map(s => ({ distanceKm: (s.distance ?? 0) / 1000, durationMin: (s.duration ?? 0) / 60 })),
  }
}

async function osrmRoute(points, url) {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';')
  const j = await getJson(`${url}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`)
  if (j.code !== 'Ok' || !j.routes?.[0]) throw new Error(j.message || j.code || 'no route in the answer')
  const r = j.routes[0]
  return {
    geometry: r.geometry.coordinates.map(c => [c[1], c[0]]),
    legs: r.legs.map(l => ({ distanceKm: (l.distance ?? 0) / 1000, durationMin: (l.duration ?? 0) / 60 })),
  }
}

/** Google's encoded polyline (precision 5) → [[lat, lng]]. */
export function decodePolyline(str) {
  const out = []
  let i = 0, lat = 0, lng = 0
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b
      do {
        b = str.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20 && i < str.length)
      const d = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += d; else lng += d
    }
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

async function googleRoute(points) {
  const key = process.env.GOOGLE_MAPS_API_KEY
  const at = p => `${p.lat},${p.lng}`
  const mid = points.slice(1, -1).map(at).join('|')
  const j = await getJson(
    `https://maps.googleapis.com/maps/api/directions/json?origin=${at(points[0])}&destination=${at(points[points.length - 1])}`
    + `${mid ? `&waypoints=${encodeURIComponent(mid)}` : ''}&mode=driving&key=${encodeURIComponent(key)}`
  )
  if (j.status !== 'OK' || !j.routes?.[0]) throw new Error(j.status || 'no route in the answer')
  const legs = j.routes[0].legs
  const geometry = []
  for (const leg of legs) for (const s of leg.steps ?? []) geometry.push(...decodePolyline(s.polyline?.points ?? ''))
  if (geometry.length < 2) geometry.push(...decodePolyline(j.routes[0].overview_polyline?.points ?? ''))
  return {
    geometry,
    legs: legs.map(l => ({ distanceKm: (l.distance?.value ?? 0) / 1000, durationMin: (l.duration?.value ?? 0) / 60 })),
  }
}

const cacheKey = (provider, points) => `${provider}|${points.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';')}`

/**
 * The route through `points` ([{ lat, lng }, …] in order, 2 or more).
 * Returns { geometry, legs, distanceKm, durationMin, provider, estimated, note }.
 * Never throws for a provider problem: that is the estimate, with a note.
 */
export async function roadRoute(points, { routing, speedKmh = 70 } = {}) {
  const est = note => ({
    ...estimateRoute(points, { roadFactor: routing?.roadFactor ?? 1.3, speedKmh }),
    provider: 'ESTIMATE', estimated: true, note,
  })
  const provider = routeProvider(routing)
  if (!provider) {
    const want = routing?.provider ?? 'ESTIMATE'
    return est(want === 'ESTIMATE' ? 'Road routing is not set up' : `${want} is not set up on the server`)
  }
  if (points.length > MAX_POINTS[provider]) return est(`More than ${MAX_POINTS[provider]} points: the route is estimated`)

  const key = cacheKey(provider, points)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true }

  try {
    const r = provider === 'ORS' ? await orsRoute(points) : provider === 'OSRM' ? await osrmRoute(points, routing.osrmUrl) : await googleRoute(points)
    if (r.geometry.length < 2 || r.legs.length !== points.length - 1) throw new Error('the answer does not match the stops')
    const geometry = simplifyPath(r.geometry, 15).map(p => [round(p[0], 5), round(p[1], 5)])
    const legs = r.legs.map(l => ({ distanceKm: round(l.distanceKm, 2), durationMin: Math.max(l.distanceKm > 0 ? 1 : 0, Math.round(l.durationMin)) }))
    const value = {
      geometry, legs,
      distanceKm: round(legs.reduce((s, l) => s + l.distanceKm, 0), 1),
      durationMin: legs.reduce((s, l) => s + l.durationMin, 0),
      provider, estimated: false, note: null,
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
    cache.set(key, { at: Date.now(), value })
    return value
  } catch (err) {
    return est(`${provider} did not answer (${err.message}), so the route is estimated`)
  }
}
