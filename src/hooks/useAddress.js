import { useState, useEffect } from 'react'
import { reverseGeocode } from '../utils/geocode'

// Coordinates are rounded to the same precision geocode.js caches on, so GPS
// jitter while a vehicle is parked doesn't refire a lookup for an address we
// already resolved — and, more importantly, doesn't retrigger the effect.
function round(n) {
  return n == null ? null : Math.round(n * 10000) / 10000
}

/**
 * Reverse-geocode a coordinate. Returns null until it resolves (and on failure
 * — geocode.js never throws).
 *
 * Pass `enabled: false` to skip the lookup entirely. That is what keeps closed
 * marker popups quiet: react-leaflet mounts popup children eagerly, so without
 * the gate every marker on the map would fire a Nominatim request on page load
 * and blow straight through its ~1 request/second usage policy.
 */
export function useAddress(lat, lng, enabled = true) {
  const [address, setAddress] = useState(null)
  const rLat = enabled ? round(lat) : null
  const rLng = enabled ? round(lng) : null

  useEffect(() => {
    if (rLat == null || rLng == null) { setAddress(null); return }
    let cancelled = false
    reverseGeocode(rLat, rLng).then(a => { if (!cancelled) setAddress(a) })
    return () => { cancelled = true }
  }, [rLat, rLng])

  return address
}

/**
 * Same, but waits for the coordinate to stop changing for `delayMs` before
 * looking anything up, and keeps returning the previous address in the
 * meantime.
 *
 * Replay playback moves its point up to 25x/second at 10x speed. Geocoding
 * each one would be both useless (the card would never settle long enough to
 * read) and a good way to get the browser's IP blocked by Nominatim.
 */
export function useSettledAddress(lat, lng, enabled = true, delayMs = 1200) {
  const [address, setAddress] = useState(null)
  const rLat = enabled ? round(lat) : null
  const rLng = enabled ? round(lng) : null

  useEffect(() => {
    // Deliberately no setAddress(null) here: while the point is moving the
    // card keeps showing the last address it resolved instead of flashing back
    // to the raw coordinates between lookups.
    if (rLat == null || rLng == null) { setAddress(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      reverseGeocode(rLat, rLng).then(a => { if (!cancelled) setAddress(a) })
    }, delayMs)
    return () => { cancelled = true; clearTimeout(t) }
  }, [rLat, rLng, delayMs])

  return address
}
