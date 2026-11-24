/**
 * Distances for route optimization (client 2026-11-21). Pluggable:
 *
 *   ESTIMATE  great-circle km × roadFactor (Journey settings, default 1.3),
 *             minutes at the planned speed. Needs nothing; the default.
 *   OSRM      a self-hosted OSRM (the client's own server; the URL is set in
 *             Journey settings): GET {url}/table/v1/driving/…
 *   ORS       OpenRouteService's matrix API; needs OPENROUTESERVICE_API_KEY
 *             in the server's environment (a free key has daily limits).
 *   GOOGLE    Google's Distance Matrix API; needs GOOGLE_MAPS_API_KEY in the
 *             server's environment. Paid per element — never used unless the
 *             client sets the key AND picks it.
 *
 * A provider that is picked but not set up, or that fails, falls back to the
 * estimate, and the answer says so (the page shows the "Estimated distances"
 * banner). Keys never leave the server.
 */

import { haversineKm } from './routeOptimizer.js'

export const PROVIDERS = Object.freeze(['ESTIMATE', 'OSRM', 'ORS', 'GOOGLE'])

/** Which providers are set up on this server (no secrets in the answer). */
export function providerStatus(routing) {
  return {
    ESTIMATE: true,
    OSRM: Boolean(routing?.osrmUrl),
    ORS: Boolean(process.env.OPENROUTESERVICE_API_KEY),
    GOOGLE: Boolean(process.env.GOOGLE_MAPS_API_KEY),
  }
}

/** The estimate: (n×n) km and minutes. */
export function estimateMatrix(places, { roadFactor = 1.3, speedKmh = 70 } = {}) {
  const n = places.length
  const km = Array.from({ length: n }, () => new Array(n).fill(0))
  const min = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const d = haversineKm(places[i], places[j]) * roadFactor
      km[i][j] = d
      min[i][j] = (d / Math.max(5, speedKmh)) * 60
    }
  }
  return { km, min }
}

export async function getJson(url, init = {}, timeoutMs = 20_000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (!res.ok) throw new Error(`answered ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

async function osrmMatrix(places, url) {
  const coords = places.map(p => `${p.lng},${p.lat}`).join(';')
  const j = await getJson(`${url}/table/v1/driving/${coords}?annotations=distance,duration`)
  if (j.code !== 'Ok') throw new Error(j.message || j.code)
  return { km: j.distances.map(r => r.map(m => (m ?? 0) / 1000)), min: j.durations.map(r => r.map(s => (s ?? 0) / 60)) }
}

async function orsMatrix(places) {
  const j = await getJson('https://api.openrouteservice.org/v2/matrix/driving-car', {
    method: 'POST',
    headers: { Authorization: process.env.OPENROUTESERVICE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: places.map(p => [p.lng, p.lat]), metrics: ['distance', 'duration'], units: 'km' }),
  })
  return { km: j.distances, min: j.durations.map(r => r.map(s => (s ?? 0) / 60)) }
}

async function googleMatrix(places) {
  // One request per origin row (Google caps elements per request).
  const key = process.env.GOOGLE_MAPS_API_KEY
  const dest = places.map(p => `${p.lat},${p.lng}`).join('|')
  const km = [], min = []
  for (const p of places) {
    const j = await getJson(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${p.lat},${p.lng}&destinations=${encodeURIComponent(dest)}&key=${encodeURIComponent(key)}`)
    if (j.status !== 'OK') throw new Error(j.status)
    km.push(j.rows[0].elements.map(e => (e.distance?.value ?? 0) / 1000))
    min.push(j.rows[0].elements.map(e => (e.duration?.value ?? 0) / 60))
  }
  return { km, min }
}

/** Largest matrix a road service is asked for (a bigger one uses the estimate). */
export const MAX_SERVICE_PLACES = 100

/**
 * The matrix for these places (index 0 = the start) with the provider the
 * settings pick. Returns { km, min, provider, estimated, note }.
 */
export async function distanceMatrix(places, { routing, speedKmh }) {
  const want = routing?.provider ?? 'ESTIMATE'
  const est = () => ({ ...estimateMatrix(places, { roadFactor: routing?.roadFactor ?? 1.3, speedKmh }), provider: 'ESTIMATE', estimated: true })
  if (want === 'ESTIMATE') return { ...est(), note: null }
  const ready = providerStatus(routing)[want]
  if (!ready) return { ...est(), note: `${want} is not set up on the server, so distances are estimated` }
  if (places.length > MAX_SERVICE_PLACES) return { ...est(), note: `More than ${MAX_SERVICE_PLACES - 1} points: distances are estimated` }
  try {
    const m = want === 'OSRM' ? await osrmMatrix(places, routing.osrmUrl) : want === 'ORS' ? await orsMatrix(places) : await googleMatrix(places)
    return { ...m, provider: want, estimated: false, note: null }
  } catch (err) {
    return { ...est(), note: `${want} did not answer (${err.message}), so distances are estimated` }
  }
}
