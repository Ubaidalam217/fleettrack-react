/**
 * What is left of the per-user Flespi token store.
 *
 * The browser no longer holds a Flespi token: every request goes through
 * /api/flespi/proxy with the login JWT (hooks/flespiConfig.js), and the server
 * uses the client's one Flespi key. The only job remaining is to delete a token
 * minted for this account before that switch, so it does not linger in the
 * Flespi panel — the server's revoke endpoint does that, and a sign-out calls it.
 */

import { IS_REAL } from './mode.js'
import { request } from './http.js'

/** Best effort: delete any token the server minted for this account in the past. */
export async function revoke() {
  if (!IS_REAL) return
  try {
    await request('/api/flespi/revoke', { method: 'POST' })
  } catch {
    // Nothing to clean, or the session is already gone — neither matters here.
  }
}
