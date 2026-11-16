/**
 * How the replay's vehicle card (the "info flag" beside the replay car) is
 * shown — client, 2026-11-16: "we can hide the info flag as well", and let
 * the user set it so it does not cover the route.
 *
 *   show     on / off
 *   dock     'follow' rides beside the car (as before); 'tl' / 'tr' / 'bl'
 *            pin it to a corner of the map
 *   corner   the corner a pin goes to, remembered while it follows
 *   compact  one line (state · speed · time) instead of the chosen fields
 *
 * Remembered per user in localStorage. Pure apart from the two storage
 * helpers, which never throw.
 */

export const CARD_DOCKS = [
  ['follow', 'Follow'],
  ['tl', 'Top left'],
  ['tr', 'Top right'],
  ['bl', 'Bottom left'],
]
const CORNERS = ['tl', 'tr', 'bl']

export const DEFAULT_CARD_PREFS = Object.freeze({ show: true, dock: 'follow', corner: 'tl', compact: false })

/** Any stored or patched value as a full, valid prefs object. */
export function normalizeCardPrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const dock = CARD_DOCKS.some(([k]) => k === r.dock) ? r.dock : DEFAULT_CARD_PREFS.dock
  const corner = CORNERS.includes(r.corner) ? r.corner : CORNERS.includes(dock) ? dock : DEFAULT_CARD_PREFS.corner
  return {
    show: typeof r.show === 'boolean' ? r.show : DEFAULT_CARD_PREFS.show,
    dock,
    // A pinned card's corner is the one to come back to.
    corner: CORNERS.includes(dock) ? dock : corner,
    compact: typeof r.compact === 'boolean' ? r.compact : DEFAULT_CARD_PREFS.compact,
  }
}

/** Pin to the remembered corner, or back to following the car. */
export function togglePinned(prefs) {
  const p = normalizeCardPrefs(prefs)
  return normalizeCardPrefs({ ...p, dock: p.dock === 'follow' ? p.corner : 'follow' })
}

/** The next corner clockwise-ish: top left → top right → bottom left → top left. */
export function nextCorner(prefs) {
  const p = normalizeCardPrefs(prefs)
  const at = CORNERS.indexOf(p.dock === 'follow' ? p.corner : p.dock)
  return normalizeCardPrefs({ ...p, dock: CORNERS[(at + 1) % CORNERS.length] })
}

export const cardPrefsKey = userId => `ft-replay-card.${userId ?? 'demo'}`

export function loadCardPrefs(userId) {
  try {
    return normalizeCardPrefs(JSON.parse(localStorage.getItem(cardPrefsKey(userId))))
  } catch {
    return normalizeCardPrefs(null)
  }
}

export function saveCardPrefs(userId, prefs) {
  try { localStorage.setItem(cardPrefsKey(userId), JSON.stringify(normalizeCardPrefs(prefs))) } catch { /* private mode */ }
}
