/**
 * The tab bar every Journey Management page shows (client 2026-11-24: "all
 * journey things in one place"), so nobody needs the sidebar to move between
 * the journey screens. Same screens and same rights as the sidebar entries.
 */

export const JOURNEY_TABS = Object.freeze([
  { key: 'journeys', label: 'Journeys', path: '/journeys' },
  { key: 'live', label: 'Live', path: '/journeys/live' },
  { key: 'new', label: 'New', path: '/journeys/new', minLevel: 'modify' },
  { key: 'approvals', label: 'Approvals', path: '/journeys/approvals' },
  { key: 'alerts', label: 'Alerts', path: '/journeys/alerts' },
  { key: 'checkpoints', label: 'Checkpoints & Routes', path: '/journeys/checkpoints' },
  { key: 'optimize', label: 'Route Optimization', path: '/journeys/optimize', minLevel: 'modify' },
  { key: 'settings', label: 'Settings', path: '/journeys/settings' },
])

/**
 * The tabs this user sees: not the ones whose screen is closed to them, and
 * not the planning ones (New, Route Optimization) below Journeys = Edit.
 * `canOpen(path)` and `journeysAtLeast(level)` come from data/screens.
 */
export function visibleTabs({ canOpen, journeysAtLeast }) {
  return JOURNEY_TABS.filter(t => canOpen(t.path) && (!t.minLevel || journeysAtLeast(t.minLevel)))
}

/** Which tab a path lights: a journey's own page (and its edit form) is under Journeys. */
export function activeTabKey(pathname) {
  const p = String(pathname ?? '').replace(/\/+$/, '') || '/'
  const exact = JOURNEY_TABS.find(t => t.path === p)
  if (exact) return exact.key
  return /^\/journeys\/[^/]+(\/edit)?$/.test(p) ? 'journeys' : null
}
