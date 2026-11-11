// Vehicle document helpers: expiry status, and the documents an older version
// kept in this browser.
//
// The documents themselves now live on the server (src/data/vehicleDocuments.js).
// Before 2026-11-11 they were a demo seed file plus edits in localStorage under
// OVERLAY_KEY, keyed by Flespi device id. The demo seed is gone; what a user
// added or changed here is offered once for upload to the server (Documents
// tab), and only cleared after that upload succeeds or the user discards it.

const OVERLAY_KEY = 'ft_documents_overlay'

// The old seed's ids, so an edit to a demo record is still recognised as the
// user's own data. Its read-only "Permit Management" records are not offered.
const SEED_NAMES = {
  'seed-8414546-insurance': 'Insurance',
  'seed-8414546-registration': 'Registration (Mulkiya)',
  'seed-8414548-insurance': 'Insurance',
}

function readOverlay() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OVERLAY_KEY))
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
  } catch {
    return {}
  }
}

const legacyDoc = doc => ({
  name:             typeof doc?.name === 'string' ? doc.name : '',
  expiryDate:       typeof doc?.expiryDate === 'string' ? doc.expiryDate : null,
  notifyBeforeDays: Number.isFinite(doc?.notifyBeforeDays) ? doc.notifyBeforeDays : 30,
})

/** What this browser holds for a device: documents the user added or edited. */
export function legacyDocuments(deviceId) {
  const entry = readOverlay()[String(deviceId)]
  if (!entry) return []
  const edited = Object.entries(entry.edited ?? {})
    .filter(([id]) => SEED_NAMES[id] && !(entry.deleted ?? []).includes(id))
    .map(([id, patch]) => legacyDoc({ name: SEED_NAMES[id], ...patch }))
  const added = (entry.added ?? []).filter(d => d?.source !== 'permit-management').map(legacyDoc)
  return [...edited, ...added].filter(d => d.name || d.expiryDate)
}

/** Forgets this browser's copy for one device (after upload or discard). */
export function clearLegacyDocuments(deviceId) {
  try {
    const overlay = readOverlay()
    delete overlay[String(deviceId)]
    if (Object.keys(overlay).length) localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay))
    else localStorage.removeItem(OVERLAY_KEY)
  } catch {
    // Storage blocked: nothing was readable either.
  }
}

// Days until expiry — negative when already expired, null when no date set.
export function daysUntilExpiry(doc, now = Date.now()) {
  if (!doc?.expiryDate) return null
  const ts = Date.parse(`${doc.expiryDate}T00:00:00`)
  if (Number.isNaN(ts)) return null
  return Math.ceil((ts - now) / 86_400_000)
}

// 'expired' | 'due' (inside the notify window) | 'ok' | null
export function expiryState(doc, now = Date.now()) {
  const days = daysUntilExpiry(doc, now)
  if (days === null) return null
  if (days < 0) return 'expired'
  return days <= (doc.notifyBeforeDays ?? 30) ? 'due' : 'ok'
}
