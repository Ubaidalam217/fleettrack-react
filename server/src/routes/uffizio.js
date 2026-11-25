/**
 * /api/uffizio — the Uffizio fuel-vehicle feed (lib/uffizio.js), for the
 * "Uffizio (fuel vehicles)" card in Settings › Master › Fuel.
 *
 *   GET  /api/uffizio/status   set up?, last poll, last error (no secrets), vehicles
 *   POST /api/uffizio/poll     poll now — still within Uffizio's one call per 120 s;
 *                              429 with nextAllowedAt when it is too soon
 *   POST /api/uffizio/test     sign in only (does not use up the 120 s)
 *   POST /api/uffizio/vehicles/:id/restore   a vehicle removed in FleetmaxX back
 *
 * Who: a Super Admin, or an account (not a sub-user) whose scope holds the
 * Business Group the feed fills (UFFIZIO_BG_ID).
 */

import { Router } from 'express'
import prisma from '../prisma.js'
import { asyncHandler, forbidden, HttpError, notFound } from '../lib/http.js'
import { assertCanWrite, findScoped, isSubUser, isSuperAdmin } from '../lib/scope.js'
import { revokeGrantsForBg } from '../lib/flespiGrant.js'
import { actorOf } from '../lib/vehicleMoves.js'
import { config, nextAllowedAt, pollOnce, restoreUffizioVehicle, statusView, testConnection } from '../lib/uffizio.js'

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

/**
 * POST /api/uffizio/vehicles/:id/restore — bring back an Uffizio vehicle that
 * was removed in FleetmaxX (it stays archived, so polls do not re-add it).
 * Needs vehicle write access and the vehicle's Business Group in scope.
 */
router.post('/vehicles/:id/restore', asyncHandler(async (req, res) => {
  assertCanWrite(req.scope, 'vehicle')
  const v = await prisma.vehicle.findFirst({ where: { id: req.params.id, dataSource: 'UFFIZIO', deletedAt: { not: null }, mergedIntoId: null }, select: { id: true, bgId: true } })
  const bg = v ? await findScoped('bg', v.bgId, req.scope, { select: { id: true } }) : null
  if (!v || !bg) throw notFound('Removed Uffizio vehicle')
  const row = await restoreUffizioVehicle(v.id, actorOf(req))
  await revokeGrantsForBg(v.bgId)
  send(res, { id: row.id, plateNo: row.plateNo, status: await statusView() })
}))

export default router
