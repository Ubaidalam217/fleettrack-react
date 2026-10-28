/**
 * POST /api/flespi/token   — RETIRED (410). See below.
 * POST /api/flespi/revoke  — deletes a per-user token left over from before the
 *                            switch to /api/flespi/proxy (called on sign-out).
 */

import { Router } from 'express'
import { asyncHandler } from '../lib/http.js'
import { revokeGrant } from '../lib/flespiGrant.js'

const router = Router()

/**
 * RETIRED. Per-user tokens filled the client's Flespi account with one token per
 * login; the browser now calls /api/flespi/proxy with its login JWT and the server
 * uses its single Master token. 410 rather than 404 so an old cached frontend gets
 * a clear answer instead of looking like a routing bug.
 */
router.post('/token', (_req, res) => {
  res.status(410).json({
    error: {
      message: 'Per-user Flespi tokens are retired. Live data is served through /api/flespi/proxy.',
      code: 'FLESPI_TOKENS_RETIRED',
    },
  })
})

router.post(
  '/revoke',
  asyncHandler(async (req, res) => {
    const out = await revokeGrant(req.user.id)
    res.json({ data: { revoked: out.revoked } })
  })
)

export default router
