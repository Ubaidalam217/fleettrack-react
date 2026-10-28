/**
 * /api/flespi/proxy/* — every Flespi call the app makes, through ONE token.
 *
 * Before this route each signed-in user was minted their own limited Flespi token
 * (lib/flespiGrant.js), so the Flespi account filled up with tokens — one per
 * login — and the client asked for a single key. Now the browser never holds a
 * Flespi token at all: it calls this route with its normal login JWT, and the
 * server forwards the request with the one Master token from server/.env.
 *
 * The scoping the per-user tokens used to give is enforced here instead:
 *   - only `gw/devices/...` paths are reachable;
 *   - `gw/devices/all/...` is rewritten to the caller's own device ids, so the
 *     answer never contains another tenant's vehicle (a Super Admin keeps `all`);
 *   - an explicit id list must be entirely inside the caller's scope, else 404 —
 *     the same "not found" any other out-of-scope record gets;
 *   - writes (PUT) are allowed only for roles that may write, and only to a device
 *     itself (vehicle master metadata) or one of its settings (the Poll command).
 *
 * The device scope is the same one buildAcl() always computed for the token ACL,
 * so what each role can see through Flespi has not changed.
 */

import { Router } from 'express'
import { asyncHandler, HttpError, notFound } from '../lib/http.js'
import { buildAcl } from '../lib/flespiGrant.js'
import * as flespi from '../lib/flespi.js'

const router = Router()

const DEVICE_PATH = /^\/gw\/devices\/([^/]+)(\/.*)?$/
// PUT targets: the device object itself, or one named setting of it.
const WRITABLE_REST = /^(?:|\/settings\/[A-Za-z0-9_.-]+)$/

/** "all" or a comma list of numeric ids → null (all) or number[]; undefined if malformed. */
function parseSelector(selector) {
  if (selector === 'all') return null
  const parts = selector.split(',')
  const ids = parts.map(p => Number(p))
  if (!parts.length || ids.some(n => !Number.isInteger(n) || n <= 0)) return undefined
  return ids
}

router.use(
  asyncHandler(async (req, res) => {
    if (!flespi.isConfigured()) {
      throw new HttpError(503, 'Live tracking is not configured on this server')
    }

    const match = DEVICE_PATH.exec(req.path)
    if (!match) throw notFound('Flespi resource')
    const [, selector, rest = ''] = match

    const method = req.method.toUpperCase()
    if (method !== 'GET' && method !== 'PUT') throw new HttpError(405, 'Method not allowed')

    const requested = parseSelector(selector)
    if (requested === undefined) throw notFound('Flespi resource')

    const { deviceIds, methods } = await buildAcl(req.scope)

    if (method === 'PUT') {
      if (!methods.includes('PUT')) throw new HttpError(403, 'Your account is read-only')
      if (!requested || requested.length !== 1 || !WRITABLE_REST.test(rest)) {
        throw new HttpError(403, 'This change is not allowed')
      }
    }

    // Narrow the selector to the caller's devices.
    let effective = selector
    if (deviceIds !== null) {
      if (requested === null) {
        if (deviceIds.length === 0) {
          // Nothing to show. Answered here rather than sent to Flespi, which has no
          // way to express "no devices" in a selector.
          res.json({ result: [] })
          return
        }
        effective = deviceIds.join(',')
      } else if (!requested.every(id => deviceIds.includes(id))) {
        throw notFound('Vehicle')
      }
    }

    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
    const upstream = await flespi.forward(`/gw/devices/${effective}${rest}${query}`, {
      method,
      body: method === 'PUT' ? req.body ?? {} : undefined,
    })

    res.status(upstream.status)
    res.set('Content-Type', upstream.contentType)
    res.set('Cache-Control', 'no-store')
    res.send(upstream.text)
  })
)

export default router
