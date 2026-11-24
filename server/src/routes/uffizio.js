/**
 * /api/uffizio — the Uffizio fuel-vehicle feed (lib/uffizio.js), for the
 * "Uffizio (fuel vehicles)" card in Settings › Master › Fuel.
 *
 *   GET  /api/uffizio/status   set up?, last poll, last error (no secrets), vehicles
 *   POST /api/uffizio/poll     poll now — still within Uffizio's one call per 120 s;
 *                              429 with nextAllowedAt when it is too soon
 *   POST /api/uffizio/test     sign in only (does not use up the 120 s)
 *
 * Who: a Super Admin, or an account (not a sub-user) whose scope holds the
 * Business Group the feed fills (UFFIZIO_BG_ID).
 */

import { Router } from 'express'
import { asyncHandler, forbidden, HttpError } from '../lib/http.js'
import { findScoped, isSubUser, isSuperAdmin } from '../lib/scope.js'
import { config, nextAllowedAt, pollOnce, statusView, testConnection } from '../lib/uffizio.js'

const router = Router()

router.use(asyncHandler(async (req, _res, next) => {
  if (isSuperAdmin(req.scope)) return next()
  const { bgId } = config()
  const mine = bgId && !isSubUser(req.scope) ? await findScoped('bg', bgId, req.scope, { select: { id: true } }) : null
  if (!mine) throw forbidden('Only a Super Admin or the fuel Business Group’s admins can see the Uffizio feed')
  next()
}))

const send = (res, data, status = 200) => {
  res.set('Cache-Control', 'no-store')
  res.status(status).json({ data })
}

router.get('/status', asyncHandler(async (_req, res) => send(res, await statusView())))

router.post('/poll', asyncHandler(async (_req, res) => {
  const next = nextAllowedAt()
  if (Date.now() < next) {
    const waitSec = Math.ceil((next - Date.now()) / 1000)
    throw new HttpError(429, `Uffizio allows one call every 2 minutes. Try again in ${waitSec} s.`, { nextAllowedAt: new Date(next).toISOString(), waitSec })
  }
  const result = await pollOnce()
  if (result.idle) throw new HttpError(400, result.error)
  send(res, { result, status: await statusView() })
}))

router.post('/test', asyncHandler(async (_req, res) => {
  const result = await testConnection()
  send(res, result)
}))

export default router
