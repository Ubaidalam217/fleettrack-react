/**
 * Which Flespi devices the signed-in account is allowed to see.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * Flespi holds the live telemetry and there is ONE Flespi account for every
 * tenant, so the MQTT stream carries every device on it. The permission model
 * lives in our own database. The two meet on the IMEI, which is the only
 * identifier both sides carry — Flespi reports it as `configuration.ident`, we
 * store it as Vehicle.imei.
 *
 * So after login we ask the server "which vehicles may I see" (GET
 * /api/me/vehicles, which applies the same scope rules as everything else) and
 * keep the resulting IMEIs as an allowlist. Anything streaming in that is not on
 * the list is dropped before any component sees it.
 *
 * ── This is a client-side filter, and that is a Phase 3 problem ─────────────
 *
 * A determined user can read the Flespi token out of the bundle and subscribe to
 * the whole account directly. Per-user Flespi tokens with their own ACLs are
 * Phase 3; this phase makes the UI correct, not the stream private. Worth being
 * explicit about rather than leaving someone to assume the filter is a boundary.
 *
 * ── Why the filter goes inside useFlespiMQTT ────────────────────────────────
 *
 * Because every consumer reads from there: the Live Map's list, map, counts and
 * search, the Dashboard tiles, Reports, VehicleActivity and the notification
 * engine. Filtering at each of those is nine places to keep in step, and the one
 * that gets missed is the one that leaks a count. Filtering at the source means a
 * component added later is scoped without knowing this file exists.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { IS_REAL } from './mode.js'
import { request } from './http.js'
import { PHASE, useSession } from './session.js'

/** Digits only — the same normalisation the server applies to a stored IMEI. */
export const imeiDigits = v => String(v ?? '').replace(/\D/g, '')

/**
 * `allowed` is null when no filter should apply, and a Set when one should.
 *
 * null and an empty Set are emphatically different: null means "every device is
 * visible" (mock mode, or a Super Admin), an empty Set means "this account may see
 * nothing". A sub-user with no assignments must see an empty map, not the whole
 * fleet, so the two cannot share a representation.
 */
let state = { allowed: null, loading: false, error: null, count: 0 }

const listeners = new Set()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}

const subscribe = fn => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const getSnapshot = () => state

export function useFleetScope() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The current allowlist, for non-React callers. */
export const allowedImeis = () => state.allowed

export async function loadFleetScope() {
  if (!IS_REAL) return
  setState({ loading: true, error: null })
  try {
    // unwrap: false — this endpoint's `role` and `count` sit beside `data`, and the
    // role is what decides whether a filter applies at all.
    const payload = await request('/api/me/vehicles', { unwrap: false })
    const list = Array.isArray(payload?.data) ? payload.data : []

    /**
     * A Super Admin is handed null rather than a Set of all nine IMEIs.
     *
     * Not an optimisation — a correctness choice. A Super Admin is meant to see
     * the whole Flespi account, including a device that has been added to Flespi
     * but not yet registered under Settings > Vehicle. Building the allowlist from
     * our own vehicle table would hide exactly those devices, which are the ones
     * an administrator most needs to notice.
     */
    const isSuper = payload?.role === 'SUPER_ADMIN'

    setState({
      allowed: isSuper ? null : new Set(list.map(v => imeiDigits(v.imei)).filter(Boolean)),
      loading: false,
      error: null,
      count: list.length,
    })
  } catch (err) {
    /**
     * Fail CLOSED: an empty allowlist, not null.
     *
     * If the scope request fails we do not know what this account may see, and the
     * safe answer to that is "nothing" — showing an empty map is a visible,
     * explicable state. Defaulting to null on error would show a sub-user the
     * entire fleet the moment the network hiccuped, which is the one outcome this
     * module exists to prevent.
     */
    setState({ allowed: new Set(), loading: false, error: err, count: 0 })
  }
}

export function clearFleetScope() {
  setState({ allowed: null, loading: false, error: null, count: 0 })
}

/**
 * Mounted once by App: loads the allowlist when a real session is ready.
 *
 * Tied to the READY phase rather than to having a token, so it does not fire for
 * an account still sitting behind the change-password gate — that request would
 * come back 428 and be recorded as a scope failure.
 */
export function useFleetScopeLoader() {
  const session = useSession()
  const ready = session.phase === PHASE.READY
  const userId = session.user?.id ?? null

  useEffect(() => {
    if (!IS_REAL) return
    if (!ready) {
      clearFleetScope()
      return
    }
    loadFleetScope()
  }, [ready, userId])
}

/**
 * Applies the allowlist to an MQTT snapshot.
 *
 * Returns the snapshot unchanged — same object identity — whenever there is no
 * filter, which is mock mode and Super Admin. That matters: the snapshot comes
 * from useSyncExternalStore and handing back a fresh object every render would
 * make every downstream useMemo recompute on every render.
 */
export function useScopedSnapshot(snapshot) {
  const { allowed } = useFleetScope()

  return useMemo(() => {
    if (!allowed) return snapshot
    if (!snapshot?.vehicles) return snapshot

    const vehicles = snapshot.vehicles.filter(v => allowed.has(imeiDigits(v.ident)))
    // Nothing was filtered out: hand back the original so identity is preserved.
    if (vehicles.length === snapshot.vehicles.length) return snapshot

    return { ...snapshot, vehicles }
  }, [snapshot, allowed])
}
