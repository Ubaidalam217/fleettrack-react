/**
 * POST /api/flespi/token   — the caller's own limited Flespi token
 * POST /api/flespi/revoke  — drop it (called on sign-out)
 *
 * POST rather than GET for the token: it can mint a credential as a side effect,
 * and a GET that creates things is one browser prefetch away from churning tokens.
 * It is also not cacheable, which is the behaviour we want.
 *
 * The response carries the Flespi token itself — the one credential this API hands
 * out deliberately. It is limited to the caller's own devices, expires with their
 * JWT, and is revoked on sign-out.
 */

import { Router } from 'express'
import { asyncHandler } from '../lib/http.js'
import { bearerFrom, verifyToken } from '../lib/jwt.js'
import { ensureGrant, revokeGrant } from '../lib/flespiGrant.js'
import { isConfigured } from '../lib/flespi.js'

const router = Router()

/**
 * The caller's JWT `exp`, so the Flespi token can be given the same lifetime.
 *
 * Re-decoded from the header rather than threaded through req.user: the auth
 * middleware intentionally does not trust the token's claims for authorisation, so
 * it does not keep them. `exp` is not an authorisation claim — it is the lifetime
 * of the credential in the caller's hand — and it has already been verified by the
 * time this runs.
 */
function jwtExpFrom(req) {
  const payload = verifyToken(bearerFrom(req.headers.authorization) ?? '')
  return Number.isFinite(payload?.exp) ? payload.exp : null
}

router.post(
  '/token',
  asyncHandler(async (req, res) => {
    if (!isConfigured()) {
      // 503, not 500: the server is working, this capability just is not
      // configured. The frontend treats it as "no live data available" rather
      // than as a bug, and every other endpoint keeps working.
      return res.status(503).json({
        error: {
          message: 'Live tracking is not configured on this server.',
          code: 'FLESPI_NOT_CONFIGURED',
        },
      })
    }

    const grant = await ensureGrant(req.user, req.scope, jwtExpFrom(req))

    res.json({
      data: {
        token: grant.token,
        // ISO, so the client can schedule its own refresh without guessing.
        expiresAt: grant.expiresAt.toISOString(),
        // -1 means "every device in the account" (Super Admin). The client only
        // uses this for display and logging.
        deviceCount: grant.deviceCount,
        role: req.user.role,
        reused: grant.reused,
        /**
         * Vehicles registered in Settings whose IMEI matches no Flespi device.
         * Surfaced rather than silently dropped: it is the difference between
         * "this vehicle is offline" and "this vehicle's IMEI is wrong", and only
         * the server can tell them apart.
         */
        unmatchedImeis: grant.unmatchedImeis,
      },
    })
  })
)

router.post(
  '/revoke',
  asyncHandler(async (req, res) => {
    const out = await revokeGrant(req.user.id)
    res.json({ data: { revoked: out.revoked } })
  })
)

export default router
