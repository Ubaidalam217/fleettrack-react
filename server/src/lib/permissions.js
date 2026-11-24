/**
 * Per-user screen permissions — the client's "give a user specific access"
 * (2026-11-02), on top of the role rules in lib/scope.js.
 *
 * Each account may carry `screenAccess`: { [screenId]: level }, where level is
 *   none < view < modify < addDelete
 * ("customize", from the old sub-user form, reads as addDelete). A screen that
 * is not in the map — or an account with no map at all — is unrestricted: the
 * role alone decides, exactly as before this existed. So nothing changes for an
 * account until somebody sets its permissions.
 *
 * Enforced here for writes. Reads stay open, because the same data feeds every
 * screen (the Live Map needs the vehicle list whatever the Vehicle page's level
 * is); hiding a screen from view is the frontend's job (src/data/screens.js,
 * which carries the same screen ids).
 */

import { forbidden } from './http.js'
import { ROLES } from './scope.js'

export const LEVELS = Object.freeze(['none', 'view', 'modify', 'addDelete'])
const RANK = Object.freeze({ none: 0, view: 1, modify: 2, addDelete: 3, customize: 3 })
const FULL = 'addDelete'

/**
 * Screens that are closed unless granted (design §A.6): "HSE must approve" is
 * true from day one only if an account with no permission map cannot approve.
 * A Super Admin still can, and assigns the approvers.
 */
export const DENY_BY_DEFAULT = Object.freeze(new Set(['journey-approval']))

/** An account's level on one screen. */
export function levelOf(screenAccess, screenId) {
  const v = screenAccess && typeof screenAccess === 'object' ? screenAccess[screenId] : undefined
  if (v in RANK) return v === 'customize' ? FULL : v
  return DENY_BY_DEFAULT.has(screenId) ? 'none' : FULL
}

export const atLeast = (level, need) => RANK[level] >= RANK[need]

/**
 * A user's level on the Journeys screen. A sub-user is read-only everywhere
 * else, so unless the screen is given to it explicitly it may look, not plan.
 */
export function journeysLevel(user, role) {
  if (role === ROLES.SUPER_ADMIN) return FULL
  const access = user?.screenAccess && typeof user.screenAccess === 'object' ? user.screenAccess : null
  if (role === ROLES.SUB_USER && !(access?.journeys in RANK)) return 'view'
  return levelOf(access, 'journeys')
}

/** May this account approve or reject journeys at all (journey-approval ≥ Edit)? */
export function canApproveJourneys(user, role) {
  if (role === ROLES.SUPER_ADMIN) return true
  return atLeast(levelOf(user?.screenAccess, 'journey-approval'), 'modify')
}

/** API prefix → the Settings screen whose level governs writes there. */
export const WRITE_SCREENS = Object.freeze({
  '/api/ggbs': '/settings/reseller',
  '/api/groups': '/settings/group',
  '/api/bgs': '/settings/company',
  '/api/branches': '/settings/branch',
  '/api/vehicles': '/settings/vehicle',
  '/api/alerts': '/settings/alerts',
  '/api/geofences': '/settings/geofence',
  '/api/drivers': '/settings/driver',
  '/api/expenses': '/settings/expense',
  '/api/reminder-rules': '/settings/reminder-rule',
  // Mark done is a change to the reminder.
  '/api/reminders': '/settings/reminder-rule',
  '/api/users': 'users',
  // /api/journeys and /api/route-templates check the Journeys screen in their
  // routes: there, creating needs Edit, not Full (design §A.6).
  '/api/journey-settings': '/settings/journey',
  // Fuel calibrations (Settings › Master › Fuel).
  '/api/fuel': '/settings/fuel',
})

/**
 * Router-level guard for one API prefix. Creating (POST to the collection) and
 * deleting need Full; every other write (edit, move, reset password, assign)
 * needs Edit. A Super Admin is never restricted.
 */
export function requireScreen(screenId) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
    if (req.scope?.role === ROLES.SUPER_ADMIN) return next()
    const need = req.method === 'DELETE' || (req.method === 'POST' && (req.path === '/' || req.path === '')) ? FULL : 'modify'
    const have = levelOf(req.user?.screenAccess, screenId)
    if (!atLeast(have, need)) {
      return next(forbidden(need === FULL
        ? 'You do not have permission to add or delete here'
        : 'You do not have permission to change this'))
    }
    next()
  }
}

/**
 * The map an editor may hand out: no screen above the editor's own level (a
 * Super Admin may give anything). Unknown levels are dropped. Returns null for
 * "no map" so the account stays unrestricted.
 */
export function clampGrant(editor, screenAccess) {
  if (screenAccess == null) return screenAccess
  const out = {}
  for (const [screen, raw] of Object.entries(screenAccess)) {
    if (!(raw in RANK)) continue
    const want = raw === 'customize' ? FULL : raw
    if (editor.role === ROLES.SUPER_ADMIN) { out[screen] = want; continue }
    const cap = levelOf(editor.screenAccess, screen)
    out[screen] = atLeast(cap, want) ? want : cap
  }
  return out
}
