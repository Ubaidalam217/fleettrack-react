// In dev the Vite proxy forwards /flespi → https://flespi.io (avoids CORS).
// In production the browser calls Flespi directly (Flespi supports CORS).
export const BASE_URL = import.meta.env.DEV ? '/flespi' : 'https://flespi.io'

import { IS_REAL } from '../data/mode'
import { currentToken } from '../data/flespiToken'

/**
 * The Flespi token this browser should use right now.
 *
 *   real mode → the per-user ACL token minted by our backend, restricted to the
 *               devices that account may see (data/flespiToken.js)
 *   mock mode → VITE_FLESPI_TOKEN, which for the deployed demo is a read-only ACL
 *               token covering the whole account
 *
 * Real mode deliberately IGNORES VITE_FLESPI_TOKEN rather than falling back to it.
 * A fallback would silently restore the old behaviour — every user sharing one
 * bundled token — on any day the backend was unreachable, which is exactly the
 * property this phase removes. No token is the correct answer; the Live Map shows
 * an explicable empty state.
 *
 * Note that a real-mode BUILD should also leave VITE_FLESPI_TOKEN unset: Vite
 * inlines it at build time, so a runtime check cannot remove it from the bundle.
 */
export function flespiToken() {
  if (IS_REAL) return currentToken()
  return import.meta.env.VITE_FLESPI_TOKEN ?? null
}

/**
 * Request headers for Flespi, resolved at read time.
 *
 * `Authorization` is a GETTER on purpose. Seven modules already do
 * `fetch(url, { headers: HEADERS })`, and `fetch` reads the object's own
 * enumerable properties when it builds the Headers — which invokes getters. So the
 * token can now change per request (minted after login, refreshed before expiry)
 * without touching a single one of those call sites, and none of them can
 * accidentally capture a stale token in a module-level constant.
 *
 * In mock mode this resolves to exactly the value it always did.
 */
export const HEADERS = {
  get Authorization() {
    return `FlespiToken ${flespiToken() ?? ''}`
  },
  'Content-Type': 'application/json',
}

/** True when a Flespi call can be expected to succeed. */
export const hasFlespiToken = () => !!flespiToken()
