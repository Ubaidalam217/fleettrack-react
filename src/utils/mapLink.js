/**
 * Links from an exported report (PDF / Excel) to FleetmaxX's own map.
 *
 * Client, 2026-11-02: clicking a location in the Movement Report PDF opens the
 * place on our map. A PDF can only open a URL, so the link goes to the public
 * /location page (pages/LocationPage.jsx), which needs no sign-in — everything
 * it shows is already in the link, so it reveals nothing the PDF does not.
 */

const MAX_ADDR = 140

/** Absolute URL of the /location page for one point; null without coordinates. */
export function locationUrl({ lat, lng, vehicle, time, address } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const q = new URLSearchParams({ lat: lat.toFixed(6), lng: lng.toFixed(6) })
  if (vehicle) q.set('v', String(vehicle))
  if (time) q.set('t', String(time))
  if (address) q.set('a', String(address).slice(0, MAX_ADDR))
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://fleetmaxx.ltfms.com'
  return `${origin}/location?${q}`
}
