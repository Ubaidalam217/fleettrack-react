import { reverseGeocodeMany, geocodeKey, shortenAddress } from './geocode'

const GEOCODE_CHUNK = 10

/**
 * Start and stop addresses for the rows, filled in place a chunk at a time in
 * render order, so the table shows words as they arrive instead of waiting for
 * the last one. Coordinates stand in until a row's address lands (or when the
 * lookup budget runs out).
 */
export async function resolveRowLocations(groups, { limit, signal, onChunk }) {
  const rows = groups.flatMap(g => g.rows).filter(r => r.kind !== 'band')
  const seen = new Set()
  const points = []
  const add = (lat, lng) => {
    if (lat == null || lng == null) return
    const k = geocodeKey(lat, lng)
    if (!seen.has(k)) { seen.add(k); points.push({ lat, lng }) }
  }
  for (const r of rows) { add(r.lat, r.lng); add(r.startLat, r.startLng) }

  const found = new Map()
  const text = (lat, lng) => {
    if (lat == null || lng == null) return null
    const hit = found.get(geocodeKey(lat, lng))
    return hit ? `${shortenAddress(hit, 6)};` : null
  }
  let budget = limit
  for (let i = 0; i < points.length; i += GEOCODE_CHUNK) {
    if (signal?.aborted) return
    const { addresses, resolved } = await reverseGeocodeMany(points.slice(i, i + GEOCODE_CHUNK), { limit: Math.max(0, budget), signal })
    budget -= resolved
    for (const [k, v] of addresses) found.set(k, v)
    for (const r of rows) {
      r.locationText = text(r.lat, r.lng)
      r.startLocationText = text(r.startLat, r.startLng)
    }
    onChunk?.(Math.min(i + GEOCODE_CHUNK, points.length), points.length)
  }
}
