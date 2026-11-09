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

/** An account's level on one screen. */
export function levelOf(screenAccess, screenId) {
  const v = screenAccess && typeof screenAccess === 'object' ? screenAccess[screenId] : undefined
  return v in RANK ? (v === 'customize' ? FULL : v) : FULL
}

export const atLeast = (level, need) => RANK[level] >= RANK[need]

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
