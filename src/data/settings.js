/**
 * The Settings data façade. Every Settings page imports from here, in both modes.
 *
 * ── The shape of the seam ───────────────────────────────────────────────────
 *
 * mockData.js holds two different kinds of thing:
 *
 *   1. observable stores + ~30 PURE selectors over them (branchTreeForCompany,
 *      groupsForReseller, isImeiTaken, settingsProfileForImei, vehicleLabel…)
 *   2. a data source (seed rows + localStorage) and 24 mutators
 *
 * Only (2) is mode-specific. So this file re-exports all of (1) verbatim and
 * replaces (2): in real mode the stores are filled from the API — translated into
 * mockData's own field names by adapters.js — and the mutators become HTTP calls.
 *
 * The payoff is that `useCompanies()`, `branchTreeForCompany(id)` and
 * `settingsProfileForImei(imei)` behave identically against live data, so the
 * eight Settings pages, the Live Map's vehicle Console and the alert scope picker
 * keep every field reference they already had.
 *
 * ── What changes for a page ─────────────────────────────────────────────────
 *
 * One import path, and `await` on the mutators. In mock mode they return
 * immediately; the promise wrapper makes the two modes one code path so a page
 * does not branch on the mode either.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { IS_REAL } from './mode.js'
import { del, get, post, put } from './http.js'
import * as A from './adapters.js'
import * as mock from '../pages/settings/mockData'
import { PHASE, useSession } from './session.js'

// ── Pass-through: everything that is pure, or already mode-agnostic ─────────
// Re-exported by name rather than with `export *` so this list is also the
// inventory of what the Settings module's public surface actually is.

export {
  // Blank-record factories — the field contract each form binds to.
  emptyReseller, emptyGroup, emptyCompany, emptyBranch,
  emptyUser, emptySubuser, emptyVehicle, emptyAlert,
  normalizeSubuser,

  // Read hooks. Backed by the same stores in both modes.
  useResellers, useGroups, useCompanies, useBranches,
  useUsers, useSubusers, useVehicles, useAlerts,

  // Name lookups, tolerant of an id that no longer resolves.
  resellerNameFor, groupNameFor, companyNameFor, branchNameFor,

  // Derived collections and labels.
  groupsForReseller, groupsForCompany, groupIdForCompany, groupLabelForCompany,
  branchesForCompany, branchTreeForCompany, branchDescendantIds, branchSubtreeIds,
  branchOptionLabel, vehiclesForCompany, vehicleLabel, vehicleSubLabel,

  // The Flespi ↔ Settings join, keyed on IMEI.
  imeiKey, vehicleByImei, settingsProfileForImei, useSettingsProfile,

  // Constants and registries.
  DEFAULT_PASSWORD, ALERT_TYPES, alertTypeLabel,
} from '../pages/settings/mockData'

/**
 * Local duplicate checks.
 *
 * Kept in real mode as well, as fast feedback while typing — but they are only
 * half the check. A real-mode store holds the rows the signed-in account may
 * SEE, so a BG email already taken by another tenant's BG is invisible here and
 * passes. The server's unique index catches it and the mutators below surface the
 * 409 against the same field, so the user gets the same message either way.
 */
export { isCompanyEmailTaken, isUserEmailTaken, isSubuserEmailTaken, isImeiTaken } from '../pages/settings/mockData'

// ── Real-mode hydration ─────────────────────────────────────────────────────

/**
 * One collection: where to fetch it, how to translate it, which store it fills.
 *
 * `role` filters the user list into the two frontend collections the UI treats as
 * separate pages — the backend has one User table, which is correct, but Settings
 * has a User screen and a Company Subuser screen.
 */
const COLLECTIONS = [
  { key: 'resellers', path: '/api/ggbs', toFe: A.ggb.toFe },
  { key: 'groups', path: '/api/groups', toFe: A.group.toFe },
  { key: 'companies', path: '/api/bgs', toFe: A.company.toFe },
  { key: 'branches', path: '/api/branches', toFe: A.branch.toFe },
  { key: 'vehicles', path: '/api/vehicles', toFe: A.vehicle.toFe },
  { key: 'users', path: '/api/users', toFe: A.user.toFe, query: { role: 'BG_USER' } },
  { key: 'subusers', path: '/api/users', toFe: A.subuser.toFe, query: { role: 'SUB_USER' } },
  { key: 'alerts', path: '/api/alerts', toFe: A.alert.toFe },
]

/** Load status, so a page can show a spinner and a retry instead of an empty table. */
let status = { loading: false, error: null, loaded: false }
const statusListeners = new Set()

function setStatus(patch) {
  status = { ...status, ...patch }
  statusListeners.forEach(fn => fn())
}

const subscribeStatus = fn => {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

const getStatus = () => status

export function useSettingsStatus() {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus)
}

/**
 * Refetch every collection and replace the stores.
 *
 * ── Why all eight, after every mutation ─────────────────────────────────────
 *
 * Because the server's writes cascade, and the cascades cross collections:
 * deleting a branch deletes its whole subtree, detaches that subtree's vehicles
 * and strips sub-user branch assignments; deleting a vehicle removes it from
 * sub-users and alerts; deleting a BG takes branches, vehicles, accounts and
 * alerts with it. Tracking which collections each mutation could possibly touch
 * is a per-mutation invalidation map that has to be kept in step with the server's
 * referential actions — and the failure mode when it drifts is a stale row on
 * screen that the user then tries to edit.
 *
 * Eight parallel GETs of a few hundred rows is a few tens of milliseconds, and
 * these are low-traffic admin screens. Correctness is worth more than the round
 * trips here. If a tenant ever gets big enough for this to show, the fix is
 * pagination and per-mutation invalidation together, not invalidation alone.
 */
export async function refreshAll() {
  if (!IS_REAL) return
  setStatus({ loading: true, error: null })
  try {
    const results = await Promise.all(
      COLLECTIONS.map(c => get(c.path, c.query).then(rows => (rows ?? []).map(c.toFe)))
    )
    COLLECTIONS.forEach((c, i) => mock.__replaceStore(c.key, results[i]))
    setStatus({ loading: false, error: null, loaded: true })
  } catch (err) {
    // The stores keep whatever they already held: a failed refresh should not
    // blank a table the user is reading. The banner says it is stale.
    setStatus({ loading: false, error: err })
    throw err
  }
}

/**
 * Mounted once, by App. Loads the Settings data when a real session is ready and
 * clears it on sign-out.
 *
 * Clearing matters: the stores are module-level, so without it the next account to
 * sign in during the same page life would see the previous one's rows until the
 * first fetch resolved — which is a cross-tenant data leak on screen, even if only
 * for a frame.
 */
export function useSettingsData() {
  const session = useSession()
  const ready = session.phase === PHASE.READY
  const userId = session.user?.id ?? null

  useEffect(() => {
    if (!IS_REAL) return
    if (!ready) {
      COLLECTIONS.forEach(c => mock.__replaceStore(c.key, []))
      setStatus({ loading: false, error: null, loaded: false })
      return
    }
    // Keyed on the user id as well as the phase, so switching accounts refetches
    // rather than reusing the previous scope's rows.
    refreshAll().catch(() => {})
  }, [ready, userId])

  return useSettingsStatus()
}

// ── Mutators ────────────────────────────────────────────────────────────────
//
// Every one returns a promise in both modes. Mock mode resolves immediately with
// the same value the synchronous mutator used to return, so a page awaits in both
// and never branches on the mode.
//
// Real mode always refreshes after the write rather than patching the store from
// the response: the response is one row, and the write may have changed several
// collections (see refreshAll). It also means what the page shows next is what the
// server actually holds, including any normalisation it applied — a hand-typed
// IMEI comes back digits-only, which is visible immediately.

const done = v => Promise.resolve(v)

async function write(fn) {
  const result = await fn()
  await refreshAll()
  return result
}

// GGB ───────────────────────────────────────────────────────────────────────

export function addReseller(row) {
  if (!IS_REAL) return done(mock.addReseller(row))
  return write(async () => A.ggb.toFe(await post('/api/ggbs', A.ggb.toApi(row))))
}

export function updateReseller(id, patch) {
  if (!IS_REAL) return done(mock.updateReseller(id, patch))
  return write(async () => A.ggb.toFe(await put(`/api/ggbs/${id}`, A.ggb.toApi(patch))))
}

export function removeReseller(id) {
  if (!IS_REAL) return done(mock.removeReseller(id))
  return write(() => del(`/api/ggbs/${id}`))
}

// Group ────────────────────────────────────────────────────────────────────

export function addGroup(row) {
  if (!IS_REAL) return done(mock.addGroup(row))
  return write(async () => A.group.toFe(await post('/api/groups', A.group.toApiCreate(row))))
}

export function updateGroup(id, patch) {
  if (!IS_REAL) return done(mock.updateGroup(id, patch))
  return write(async () => A.group.toFe(await put(`/api/groups/${id}`, A.group.toApiUpdate(patch))))
}

export function removeGroup(id) {
  if (!IS_REAL) return done(mock.removeGroup(id))
  return write(() => del(`/api/groups/${id}`))
}

// BG ───────────────────────────────────────────────────────────────────────

export function addCompany(row) {
  if (!IS_REAL) return done(mock.addCompany(row))
  return write(async () => A.company.toFe(await post('/api/bgs', A.company.toApiCreate(row))))
}

export function updateCompany(id, patch) {
  if (!IS_REAL) return done(mock.updateCompany(id, patch))
  return write(async () =>
    A.company.toFe(await put(`/api/bgs/${id}`, A.company.toApiUpdate(patch)))
  )
}

export function removeCompany(id) {
  if (!IS_REAL) return done(mock.removeCompany(id))
  return write(() => del(`/api/bgs/${id}`))
}

// Branch ───────────────────────────────────────────────────────────────────

export function addBranch(row) {
  if (!IS_REAL) return done(mock.addBranch(row))
  return write(async () => A.branch.toFe(await post('/api/branches', A.branch.toApiCreate(row))))
}

export function updateBranch(id, patch) {
  if (!IS_REAL) return done(mock.updateBranch(id, patch))
  return write(async () =>
    A.branch.toFe(await put(`/api/branches/${id}`, A.branch.toApiUpdate(patch)))
  )
}

/**
 * Delete a branch and its whole subtree.
 *
 * Mock mode returns a summary the page shows in a toast — how many branches went
 * and how many vehicles were detached. The server returns the same figures under
 * its own names, so they are mapped here and the page's toast is unchanged.
 */
export function removeBranch(id) {
  if (!IS_REAL) return done(mock.removeBranch(id))
  return write(async () => {
    const r = await del(`/api/branches/${id}`)
    return {
      removed: r?.removed ?? 0,
      subBranches: r?.subBranches ?? 0,
      vehiclesDetached: r?.vehiclesDetached ?? 0,
    }
  })
}

// Vehicle ──────────────────────────────────────────────────────────────────

export function addVehicle(row) {
  if (!IS_REAL) return done(mock.addVehicle(row))
  return write(async () => A.vehicle.toFe(await post('/api/vehicles', A.vehicle.toApiCreate(row))))
}

export function updateVehicle(id, patch) {
  if (!IS_REAL) return done(mock.updateVehicle(id, patch))
  return write(async () =>
    A.vehicle.toFe(await put(`/api/vehicles/${id}`, A.vehicle.toApiUpdate(patch)))
  )
}

export function removeVehicle(id) {
  if (!IS_REAL) return done(mock.removeVehicle(id))
  return write(() => del(`/api/vehicles/${id}`))
}

// User (a BG login account) ────────────────────────────────────────────────

export function addUser(row) {
  if (!IS_REAL) return done(mock.addUser(row))
  return write(async () => {
    const body = A.user.toApiCreate(row)
    // Only sent when the operator actually changed it. Omitted, the server uses
    // DEFAULT_USER_PASSWORD, which is the same value the form was showing.
    if (row.password && row.password !== mock.DEFAULT_PASSWORD) body.password = row.password
    return A.user.toFe(await post('/api/users', body))
  })
}

/**
 * Update, plus a password reset when the box was edited.
 *
 * PUT /api/users deliberately takes no password — a profile edit must not be able
 * to re-hash a credential as a side effect. So a changed password is a second,
 * explicit call to the reset endpoint, which is also what re-arms the
 * first-login gate for that account.
 */
export function updateUser(id, patch) {
  if (!IS_REAL) return done(mock.updateUser(id, patch))
  return write(async () => {
    const row = A.user.toFe(await put(`/api/users/${id}`, A.user.toApiUpdate(patch)))
    if (patch.password && patch.password !== mock.DEFAULT_PASSWORD) {
      await post(`/api/users/${id}/reset-password`, { password: patch.password })
    }
    return row
  })
}

export function removeUser(id) {
  if (!IS_REAL) return done(mock.removeUser(id))
  return write(() => del(`/api/users/${id}`))
}

// Sub-user ─────────────────────────────────────────────────────────────────

export function addSubuser(row) {
  if (!IS_REAL) return done(mock.addSubuser(row))
  return write(async () => {
    const body = A.subuser.toApiCreate(row)
    if (row.password && row.password !== mock.DEFAULT_PASSWORD) body.password = row.password
    return A.subuser.toFe(await post('/api/users', body))
  })
}

/**
 * Update a sub-user: the row, then its two assignment sets.
 *
 * The order is not arbitrary. The server refuses to move a sub-user to another BG
 * while it still holds vehicle assignments (they would point at vehicles it may no
 * longer see), and it validates new assignments against the sub-user's CURRENT bg.
 * So a BG change has to be: clear, move, re-assign. Doing it in the other order
 * fails on one of those two rules depending on which way the move went.
 */
export function updateSubuser(id, patch) {
  if (!IS_REAL) return done(mock.updateSubuser(id, patch))
  return write(async () => {
    const existing = mock.__snapshot('subusers').find(s => s.id === id) ?? null
    const movingBg = !!existing && !!patch.companyId && existing.companyId !== patch.companyId

    if (movingBg) {
      await put(`/api/users/${id}/vehicles`, { ids: [] })
      await put(`/api/users/${id}/branches`, { ids: [] })
    }

    const row = A.subuser.toFe(await put(`/api/users/${id}`, A.subuser.toApiUpdate(patch)))

    await put(`/api/users/${id}/vehicles`, { ids: patch.vehicleIds ?? [] })
    await put(`/api/users/${id}/branches`, { ids: patch.branchIds ?? [] })

    if (patch.password && patch.password !== mock.DEFAULT_PASSWORD) {
      await post(`/api/users/${id}/reset-password`, { password: patch.password })
    }
    return row
  })
}

export function removeSubuser(id) {
  if (!IS_REAL) return done(mock.removeSubuser(id))
  return write(() => del(`/api/users/${id}`))
}

// Alert ────────────────────────────────────────────────────────────────────

export function addAlert(row) {
  if (!IS_REAL) return done(mock.addAlert(row))
  return write(async () => A.alert.toFe(await post('/api/alerts', A.alert.toApiCreate(row))))
}

export function updateAlert(id, patch) {
  if (!IS_REAL) return done(mock.updateAlert(id, patch))
  return write(async () => A.alert.toFe(await put(`/api/alerts/${id}`, A.alert.toApiUpdate(patch))))
}

export function removeAlert(id) {
  if (!IS_REAL) return done(mock.removeAlert(id))
  return write(() => del(`/api/alerts/${id}`))
}
