/**
 * The Flespi token the browser uses, in real mode.
 *
 * ── What changed in Phase 3 ─────────────────────────────────────────────────
 *
 * Before: the bundle carried one Flespi token for everyone, and the Live Map
 * filtered client-side. Anyone who read the bundle could talk to every device.
 *
 * Now, in real mode: the backend mints a per-user ACL token restricted to the
 * device ids that account may see, expiring with its JWT. The browser never sees a
 * token wider than the user. The client-side IMEI filter stays as a second layer —
 * belt and braces, not the boundary.
 *
 * In mock mode nothing here is used: flespiConfig falls back to
 * VITE_FLESPI_TOKEN, which for the deployed demo is a read-only ACL token.
 *
 * ── Lifecycle ───────────────────────────────────────────────────────────────
 *
 * login       → the response carries a grant, so the map has data on first render
 * ready       → ensureToken() fills the gap if login could not mint one
 * expiry      → a timer refreshes shortly before, so no request fails first
 * MQTT error  → refresh(), because a dead token looks like a connection problem
 * sign-out    → revoke() tells the server to delete it at Flespi
 */

import { useSyncExternalStore } from 'react'
import { IS_REAL } from './mode.js'
import { request } from './http.js'

let state = {
  token: null,
  /** ms epoch, or 0 when unknown. */
  expiresAt: 0,
  /** -1 means "every device in the account" (Super Admin). */
  deviceCount: 0,
  loading: false,
  error: null,
  /**
   * Vehicles registered in Settings whose IMEI matches no Flespi device. Only the
   * server can tell this apart from "the vehicle is offline", so it reports it and
   * the UI can surface it instead of silently showing fewer vehicles.
   */
  unmatchedImeis: [],
}

const listeners = new Set()
let refreshTimer = null
/** The in-flight fetch, so parallel callers share one request. */
let inFlight = null

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}

const subscribe = fn => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const getSnapshot = () => state

export function useFlespiTokenState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The current token, or null. Read by flespiConfig on every request. */
export const currentToken = () => state.token

/**
 * Schedule a refresh shortly before the token dies.
 *
 * Proactive rather than reactive: the alternative is letting a request fail with a
 * 401 and retrying, which means every Flespi caller needs retry logic. One timer
 * keeps that out of the seven call sites entirely.
 */
function scheduleRefresh(expiresAtMs) {
  if (refreshTimer) clearTimeout(refreshTimer)
  if (!expiresAtMs) return
  // 60s of headroom, and never a negative or absurdly long delay.
  const delay = Math.max(5_000, Math.min(expiresAtMs - Date.now() - 60_000, 2 ** 31 - 1))
  refreshTimer = setTimeout(() => {
    refresh().catch(() => {})
  }, delay)
}

function adopt(grant) {
  if (!grant?.token) return
  const expiresAt = grant.expiresAt ? new Date(grant.expiresAt).getTime() : 0
  setState({
    token: grant.token,
    expiresAt,
    deviceCount: grant.deviceCount ?? 0,
    unmatchedImeis: grant.unmatchedImeis ?? [],
    loading: false,
    error: null,
  })
  scheduleRefresh(expiresAt)
}

/**
 * Take the grant that came back with a login response.
 *
 * Best-effort on the server, so this may be called with null — in which case the
 * normal ensureToken() path fills in.
 */
export function adoptLoginGrant(grant) {
  if (!IS_REAL) return
  if (grant?.token) adopt(grant)
}

/** Fetch a token, replacing whatever is held. Shared between concurrent callers. */
export async function refresh() {
  if (!IS_REAL) return null
  if (inFlight) return inFlight

  setState({ loading: true, error: null })
  inFlight = (async () => {
    try {
      const grant = await request('/api/flespi/token', { method: 'POST' })
      adopt(grant)
      return grant.token
    } catch (err) {
      /**
       * Fail CLOSED: clear the token rather than keep a possibly-stale one.
       *
       * A token we cannot refresh may describe a scope the user no longer has — the
       * server revokes on reassignment precisely so the old one stops working. An
       * empty map is the honest outcome; silently reusing the old token is not.
       */
      setState({ token: null, loading: false, error: err, deviceCount: 0 })
      throw err
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** Fetch only if there is no usable token. Cheap to call on every mount. */
export async function ensureToken() {
  if (!IS_REAL) return null
  const alive = state.token && (!state.expiresAt || state.expiresAt - Date.now() > 30_000)
  if (alive) return state.token
  return refresh()
}

/**
 * Ask the server to delete this account's Flespi token, and forget it locally.
 *
 * Local state is cleared even if the call fails: the user has signed out, and
 * keeping a live token in a signed-out tab is worse than a token that lingers at
 * Flespi until its own expiry (which is why expiries are short).
 */
export async function revoke() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  const had = !!state.token
  setState({ token: null, expiresAt: 0, deviceCount: 0, unmatchedImeis: [], error: null })
  if (!IS_REAL || !had) return
  try {
    await request('/api/flespi/revoke', { method: 'POST' })
  } catch {
    /* the local token is already gone; the server-side one expires on its own */
  }
}

/** Drop local state without calling the server — used when a session ends. */
export function clearLocal() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  setState({ token: null, expiresAt: 0, deviceCount: 0, unmatchedImeis: [], error: null })
}
