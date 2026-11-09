/**
 * The screens a user can be given (or denied) access to, and the signed-in
 * user's level on each — client, 2026-11-02: "give users specific permissions".
 *
 * Levels, lowest first: none < view < modify < addDelete. The two kinds:
 *   page — something you look at (Live Map, a report): No Access or View;
 *   data — a Settings page that edits records: No Access, View, Edit, Full.
 *
 * An account with no permission map, or a screen missing from it, is
 * unrestricted: the role alone decides, as it always did. The server applies the
 * same ids and rules to writes (server/src/lib/permissions.js) — this file is
 * what hides menus, pages and buttons.
 */

import { IS_REAL } from './mode.js'
import { useSession } from './session.js'
import { REPORT_CATEGORIES } from '../components/sidebar/reportsNav'

export const LEVELS = [
  { value: 'none',      label: 'No Access', short: 'None' },
  { value: 'view',      label: 'View',      short: 'View' },
  { value: 'modify',    label: 'Edit',      short: 'Edit' },
  { value: 'addDelete', label: 'Full',      short: 'Full', hint: 'Add, edit and delete' },
]
const RANK = { none: 0, view: 1, modify: 2, addDelete: 3, customize: 3 }
const FULL = 'addDelete'

export const atLeast = (level, need) => (RANK[level] ?? 3) >= RANK[need]

/** Levels a screen of this kind offers. */
export const levelsFor = kind => (kind === 'page' ? LEVELS.slice(0, 2) : LEVELS)

/** The catalogue, grouped the way the permission editor shows it. */
export const SCREEN_MODULES = [
  {
    id: 'main', label: 'Main',
    screens: [
      { id: '/dashboard',     label: 'Snapshots (Dashboard)', kind: 'page' },
      { id: '/tracking',      label: 'Live Map',              kind: 'page' },
      { id: '/charts',        label: 'Charts',                kind: 'page' },
      { id: '/notifications', label: 'Notifications',         kind: 'page' },
      { id: '/announcements', label: 'Announcements',         kind: 'page' },
    ],
  },
  {
    id: 'reports', label: 'Reports',
    screens: REPORT_CATEGORIES.flatMap(c => c.reports.map(r => ({ id: r.path, label: r.label, kind: 'page' }))),
  },
  {
    id: 'settings', label: 'Settings',
    screens: [
      { id: '/settings/reseller', label: 'Group Global Admin', kind: 'data' },
      { id: '/settings/group',    label: 'Group',              kind: 'data' },
      { id: '/settings/company',  label: 'Business Group',     kind: 'data' },
      { id: '/settings/branch',   label: 'Branch',             kind: 'data' },
      { id: 'users',              label: 'User accounts',      kind: 'data', hint: 'The Users panels and the sub-user form' },
      { id: '/settings/vehicle',  label: 'Vehicle',            kind: 'data' },
      { id: '/settings/alerts',   label: 'Alert rules',        kind: 'data' },
      { id: '/settings/driver',   label: 'Driver',             kind: 'data' },
      { id: '/settings/geofence', label: 'Address - Geofence', kind: 'data' },
      { id: '/settings/expense',  label: 'Expense',            kind: 'data' },
    ],
  },
]

export const ALL_SCREENS = SCREEN_MODULES.flatMap(m => m.screens.map(s => ({ ...s, moduleId: m.id })))
const SCREEN_IDS = new Set(ALL_SCREENS.map(s => s.id))

/**
 * Which screen a route belongs to. The sub-user pages are part of "User
 * accounts"; paths with no screen (account settings, the report hub, the
 * public map page) return null and are never blocked.
 */
export function screenForPath(pathname) {
  if (SCREEN_IDS.has(pathname)) return pathname
  if (pathname === '/settings/user' || pathname === '/settings/company-subuser') return 'users'
  if (pathname === '/reports/usage-summary') return '/reports/daywise-distance'
  return null
}

/** One account's level on one screen. */
export function levelIn(access, screenId) {
  const v = access && typeof access === 'object' ? access[screenId] : undefined
  return v in RANK ? (v === 'customize' ? FULL : v) : FULL
}

/** The signed-in user's level on a screen. Mock mode and Super Admin: Full. */
export function sessionLevel(user, screenId) {
  if (!IS_REAL || !user || user.role === 'SUPER_ADMIN' || !screenId) return FULL
  return levelIn(user.screenAccess, screenId)
}

/** `level(screenId)` for the signed-in user, as a hook. */
export function useScreenLevel() {
  const { user } = useSession()
  return screenId => sessionLevel(user, screenId)
}

/** Can the signed-in user open this route? */
export function useCanOpen() {
  const level = useScreenLevel()
  return path => {
    const screen = screenForPath(path)
    return !screen || level(screen) !== 'none'
  }
}

/** The first screen this user may open, for when the one they asked for is closed. */
export function firstOpenPath(user) {
  const s = ALL_SCREENS.find(sc => sc.id.startsWith('/') && sessionLevel(user, sc.id) !== 'none')
  return s?.id ?? '/settings'
}

/** The highest level `editor` may give on a screen — never above its own. */
export function grantCap(editor, screenId) {
  return sessionLevel(editor, screenId)
}

/** Count of screens a map leaves open — for a row's "8 / 26" summary. */
export function openCount(access) {
  return ALL_SCREENS.filter(s => levelIn(access, s.id) !== 'none').length
}
