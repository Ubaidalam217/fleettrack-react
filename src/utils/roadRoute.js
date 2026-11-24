/**
 * Pure helpers of "Road route" in New Journey (client 2026-11-24): the best
 * road route through the stops comes from POST /api/journeys/route
 * (server/src/lib/roadRoute.js); these map its answer onto the form's stops.
 */

export const PROVIDER_LABEL = Object.freeze({ ORS: 'OpenRouteService', OSRM: 'OSRM', GOOGLE: 'Google Maps', ESTIMATE: 'estimate' })

const finite = s => Number.isFinite(s?.lat) && Number.isFinite(s?.lng)

/** What a route needs: every stop placed, in order. null until then. */
export function routePoints(stops) {
  if (!Array.isArray(stops) || stops.length < 2 || !stops.every(finite)) return null
  return stops.map(s => ({ lat: s.lat, lng: s.lng }))
}

/** Changes only when a stop moves (about 1 m), not when a name, radius or stay is typed. */
export function routeKey(stops) {
  const pts = routePoints(stops)
  return pts ? pts.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|') : ''
}

const sameLeg = (s, min, src) => s.legDriveMin === min && s.legSource === src

/** Legs the road service set go back to the planned-speed estimate (the user's own minutes stay). */
export function clearRoadLegs(stops) {
  let changed = false
  const out = stops.map(s => {
    if (s.legSource !== 'ROUTING') return s
    changed = true
    return { ...s, legDriveMin: null, legSource: 'SPEED' }
  })
  return changed ? out : stops
}

/**
 * Each leg's drive minutes from the route (legSource ROUTING). A leg the user
 * typed (MANUAL) is kept. An estimated route sets nothing: the legs stay on
 * the planned speed, as before. Returns the same array when nothing changes.
 */
export function applyRoadLegs(stops, route) {
  if (!route || route.estimated || !Array.isArray(route.legs)) return clearRoadLegs(stops)
  let changed = false
  const out = stops.map((s, i) => {
    if (i === 0 || s.legSource === 'MANUAL') return s
    const leg = route.legs[i - 1]
    if (!leg || !Number.isFinite(leg.durationMin)) return s
    if (sameLeg(s, leg.durationMin, 'ROUTING')) return s
    changed = true
    return { ...s, legDriveMin: leg.durationMin, legSource: 'ROUTING' }
  })
  return changed ? out : stops
}

/** The small banner when the line is only straight legs: why, in the client's words. */
export function estimateBanner(note) {
  return `Estimated route - ${/not set up/i.test(note ?? 'not set up') ? 'road routing is not set up' : 'the road service did not answer'}`
}
