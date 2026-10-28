// Where the browser sends Flespi requests — never to Flespi itself.
//
// The client asked for ONE Flespi key. So no Flespi token reaches the browser at
// all any more; every call goes to a proxy that adds the single server-side key:
//
//   real mode → our backend, /api/flespi/proxy, authenticated with the login JWT.
//               The backend narrows every request to the devices this account may
//               see (server/src/routes/flespiProxy.js).
//   mock mode → /flespi on the same origin. On Netlify that is a function holding
//               the key as a secret env var (netlify/functions/flespi-proxy.mjs,
//               read-only); in `vite dev` it is the dev-server proxy, which adds
//               FLESPI_TOKEN from the local .env (vite.config.js).
//
// Every module builds its URLs from BASE_URL and sends HEADERS, so this file is
// the only place that knows any of that.

import { IS_REAL, API_URL } from '../data/mode'
import { getToken } from '../data/session'

export const BASE_URL = IS_REAL ? `${API_URL}/api/flespi/proxy` : '/flespi'

/**
 * Request headers, resolved at read time.
 *
 * `Authorization` is a GETTER so it carries the login JWT of the moment —
 * `fetch(url, { headers: HEADERS })` reads it when the request is built. In mock
 * mode it is empty: the Netlify function ignores any client header and uses its
 * own key.
 */
export const HEADERS = {
  get Authorization() {
    return IS_REAL ? `Bearer ${getToken() ?? ''}` : ''
  },
  'Content-Type': 'application/json',
}

/** True when a Flespi call can be expected to succeed (real mode needs a login). */
export const hasFlespiToken = () => (IS_REAL ? !!getToken() : true)
