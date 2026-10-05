/**
 * What the signed-in role may see and do — for the UI only.
 *
 * ── This is not a security boundary ─────────────────────────────────────────
 *
 * The server is the guard. Every endpoint resolves the caller's scope from the
 * freshly-read user row and answers 403 or 404 regardless of what the client
 * believes (server/src/lib/scope.js). Nothing here is relied on to keep anyone out
 * of anything.
 *
 * What this file buys is honesty in the interface: a sub-user should not be shown
 * an "Add Vehicle" button that is guaranteed to fail, and a BG user should not be
 * offered a GGB page that can only ever render an empty table. Showing controls
 * that always error teaches people to distrust the app.
 *
 * ── It deliberately mirrors the server ──────────────────────────────────────
 *
 * The WRITABLE table below is a copy of the one in server/src/lib/scope.js. A
 * copy, not an import — the two projects do not share code, by design. It is
 * therefore something to keep in step by hand, which is why both sides carry a
 * comment saying so. Being slightly too restrictive here is harmless (a control is
 * hidden that would have worked); being too permissive only produces an error the
 * user did not need to see, never access.
 */

import { IS_REAL } from './mode.js'

export const ROLE = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  GGB_ADMIN: 'GGB_ADMIN',
  GROUP_ADMIN: 'GROUP_ADMIN',
  BG_USER: 'BG_USER',
  SUB_USER: 'SUB_USER',
})

const ALL = [ROLE.SUPER_ADMIN, ROLE.GGB_ADMIN, ROLE.GROUP_ADMIN, ROLE.BG_USER, ROLE.SUB_USER]
const ADMINS_AND_BG = [ROLE.SUPER_ADMIN, ROLE.GGB_ADMIN, ROLE.GROUP_ADMIN, ROLE.BG_USER]

/** Mirror of WRITABLE in server/src/lib/scope.js. Keep in step. */
const WRITABLE = Object.freeze({
  SUPER_ADMIN: new Set(['ggb', 'group', 'bg', 'branch', 'vehicle', 'user', 'alert']),
  GGB_ADMIN: new Set(['group', 'bg', 'branch', 'vehicle', 'user', 'alert']),
  GROUP_ADMIN: new Set(['bg', 'branch', 'vehicle', 'user', 'alert']),
  BG_USER: new Set(['branch', 'vehicle', 'user', 'alert']),
  SUB_USER: new Set(),
})

/**
 * Which roles get each Settings page in the sidebar.
 *
 * Keyed by the node ids in components/sidebar/settingsNav.js, which are the
 * pre-rename names (`reseller` is the GGB page, `company` is the BG page).
 *
 * The rule is "would this page show you anything": a role sees a page when it can
 * either read rows there or write them. GGB and Group are above a BG user's node
 * and would render empty, so they are hidden — the brief asks for exactly that.
 * A sub-user keeps the read-only pages that show its own fleet (Vehicle, Branch,
 * BG, Alerts) and loses the two account-management pages, where the only row it
 * could ever see is itself.
 */
const PAGE_ROLES = Object.freeze({
  reseller: [ROLE.SUPER_ADMIN, ROLE.GGB_ADMIN],
  group: [ROLE.SUPER_ADMIN, ROLE.GGB_ADMIN, ROLE.GROUP_ADMIN],
  company: ALL,
  branch: ALL,
  user: ADMINS_AND_BG,
  'company-subuser': ADMINS_AND_BG,
  vehicle: ALL,
  alerts: ALL,
})

/** Settings page id → the entity its Add/Edit/Delete buttons write. */
export const PAGE_ENTITY = Object.freeze({
  reseller: 'ggb',
  group: 'group',
  company: 'bg',
  branch: 'branch',
  vehicle: 'vehicle',
  user: 'user',
  'company-subuser': 'user',
  alerts: 'alert',
})

/**
 * May this role create/update/delete this entity type?
 *
 * Mock mode answers true for everything: there is no signed-in role, and the demo
 * has always let you edit every page. Hiding buttons there would be a visible
 * change to the mode that is supposed to stay exactly as it was.
 */
export function canWrite(roleKey, entity) {
  if (!IS_REAL) return true
  if (!roleKey) return false
  return WRITABLE[roleKey]?.has(entity) ?? false
}

/** Should this Settings page appear at all? */
export function canSeePage(roleKey, pageId) {
  if (!IS_REAL) return true
  if (!roleKey) return false
  const allowed = PAGE_ROLES[pageId]
  // A page with no entry — the ComingSoon placeholders — is nobody's to hide.
  return allowed ? allowed.includes(roleKey) : true
}

/** Convenience for a page: can the current role write the entity it manages? */
export function canWritePage(roleKey, pageId) {
  const entity = PAGE_ENTITY[pageId]
  return entity ? canWrite(roleKey, entity) : true
}

/**
 * True for an account that may not write anything at all.
 *
 * Used for the one place a blanket statement is better than per-button hiding: a
 * read-only banner at the top of a Settings page, so a sub-user understands why
 * the controls are missing rather than assuming the page is broken.
 */
export function isReadOnly(roleKey) {
  if (!IS_REAL) return false
  return roleKey === ROLE.SUB_USER
}
