import { useEffect, useState } from 'react'
import { reverseGeocodeMany, geocodeKey } from '../utils/geocode'

// Network lookups spent on one replay's trip list. Ten trips' start and end;
// anything already in the cache (local, or the server's shared one) is free, so
// a longer list still fills in wherever someone has looked before.
const LOOKUP_LIMIT = 20

/**
 * Start/end place names for a replay's trips, keyed by geocodeKey(lat, lng).
 *
 * Two passes: the cache first (instant, so the list does not flash empty on a
 * range that was looked at before), then up to LOOKUP_LIMIT real lookups. The
 * map grows as answers come in; a new trip list cancels the old lookups.
 *
 * @param {object[]} trips  from tripsFromPoints
 * @returns {Map<string,string>}
 */
export function useTripPlaces(trips) {
  const [places, setPlaces] = useState(() => new Map())

  useEffect(() => {
    setPlaces(new Map())
    const coords = []
    for (const t of trips ?? []) {
      if (t.startLat != null && t.startLng != null) coords.push({ lat: t.startLat, lng: t.startLng })
      if (t.endLat != null && t.endLng != null) coords.push({ lat: t.endLat, lng: t.endLng })
    }
    if (!coords.length) return

    const ctrl = new AbortController()
    const absorb = ({ addresses }) => {
      if (ctrl.signal.aborted || !addresses.size) return
      setPlaces(prev => new Map([...prev, ...addresses]))
    }
    ;(async () => {
      try {
        absorb(await reverseGeocodeMany(coords, { limit: 0, signal: ctrl.signal }))
        absorb(await reverseGeocodeMany(coords, { limit: LOOKUP_LIMIT, signal: ctrl.signal }))
      } catch {
        // Cancelled, or the geocoder is down — the list just shows no places.
      }
    })()
    return () => ctrl.abort()
  }, [trips])

  return places
}

/** A trip end's place from the map useTripPlaces returns, or null. */
export function placeOf(places, lat, lng) {
  if (lat == null || lng == null) return null
  return places.get(geocodeKey(lat, lng)) ?? null
}
