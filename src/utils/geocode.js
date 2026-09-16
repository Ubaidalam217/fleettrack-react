// Reverse geocoding for the Vehicle Info tab's Location field, via Nominatim
// (OpenStreetMap's free reverse-geocode API — no key required, but usage
// policy asks for at most ~1 request/sec and a descriptive User-Agent/Referer,
// which the browser supplies automatically as Referer).
//
// Cached in memory only (not persisted): addresses don't change, but a vehicle
// moves, so there's no reason to carry stale entries across page loads.
const cache = new Map() // "lat,lng" (rounded) -> address string

function key(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

/**
 * Trim a Nominatim display_name down to its most specific parts.
 *
 * The full string runs all the way out to the country ("Sayourah 2 Street, M
 * 38, Musaffah Industrial Area, Musaffah, Abu Dhabi, Abu Dhabi Emirate, United
 * Arab Emirates"), which is useless in a small card on a map — the leading
 * parts are the only ones that say where the vehicle actually is.
 */
export function shortenAddress(address, parts = 3) {
  if (!address) return address
  return address.split(',').slice(0, parts).join(',').trim()
}

/**
 * Resolve (lat, lng) to a human-readable address string. Returns null on
 * failure rather than throwing — a missing address shouldn't break the tab.
 */
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null
  const k = key(lat, lng)
  if (cache.has(k)) return cache.get(k)

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const json = await res.json()
    const address = json.display_name ?? null
    cache.set(k, address)
    return address
  } catch {
    return null
  }
}
