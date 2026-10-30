/**
 * Text helpers for a server alert event (GET /api/alert-events), shared by the
 * header bell and the Notifications page.
 */

const UAE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

/** "30 Oct 2026, 14:05" in UAE time, whatever the browser's own zone. */
export function uaeDateTime(iso) {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? UAE_TIME.format(t) : ''
}

/** "Just now", "5 min ago", "3 hr ago", "2 days ago", then a UAE date. */
export function relativeTime(iso, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now - t)
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`
  if (diff < 7 * 86_400_000) {
    const d = Math.floor(diff / 86_400_000)
    return `${d} day${d === 1 ? '' : 's'} ago`
  }
  return uaeDateTime(new Date(t).toISOString()).split(',')[0]
}

/** The vehicle as the server names it in messages: plate, fleet no., then IMEI. */
export function eventVehicleName(e) {
  return e?.vehicle?.plateNo || e?.vehicle?.fleetNo || e?.vehicle?.imei || ''
}

/**
 * The message without the vehicle and driver the server folds into it.
 *
 * The engine writes "AD 123: Over speed: 130 km/h · Driver: Ali" so an email
 * reads on its own; on a card that shows the vehicle and the driver as fields
 * of their own, the same names twice is clutter. A licence message is prefixed
 * with the driver instead ("Ali (AD 123): Driving licence expires…").
 */
export function eventDetail(e) {
  let text = String(e?.message ?? '')
  const vehicle = eventVehicleName(e)
  const driver = e?.driver?.name
  if (vehicle && text.startsWith(`${vehicle}: `)) {
    text = text.slice(vehicle.length + 2)
  } else if (driver && text.startsWith(driver)) {
    const cut = text.indexOf(': ')
    if (cut !== -1) text = text.slice(cut + 2)
  }
  if (driver && text.endsWith(` · Driver: ${driver}`)) {
    text = text.slice(0, -` · Driver: ${driver}`.length)
  }
  return text
}

/** Google Maps at the event's position, or null when it has none. */
export function mapsLink(e) {
  // Number(null) is 0, a real coordinate, so a missing value is caught first.
  const coord = v => (v === null || v === undefined || v === '' ? NaN : Number(v))
  const lat = coord(e?.lat)
  const lng = coord(e?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}
