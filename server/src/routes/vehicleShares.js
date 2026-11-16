/**
 * /api/vehicle-shares — one vehicle in several places (client, 2026-11-13:
 * "One vehicle can be assigned to multiple Group, BG, Branch").
 *
 *   GET  /?vehicleId=                 that vehicle's shares, as the caller may see them
 *   PUT  /vehicle/:vehicleId          { targets: [{ level, id }] } — the vehicle
 *                                     form's "Also show in": make it this list
 *                                     (among the places the caller can see)
 *   POST /add     { vehicleIds, level, targetId }  — "Also show here", Bulk Action
 *   POST /remove  { vehicleIds, level, targetId }  — "Remove from here"
 *
 * A share is visibility only: the vehicle's owner keeps its tracker, its edits
 * and its records (lib/vehicleShares.js, lib/sharePolicy.js). Kept apart from
 * PUT /api/vehicles/:id on purpose — that one renames the Flespi device, and
 * showing a vehicle somewhere else must not touch the tracker.
 *
 * Mounted behind the Vehicle screen's permission (an assignment needs Edit).
 */

import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/http.js'
import { requiredId } from '../lib/fields.js'
import { assertCanWrite } from '../lib/scope.js'
import { actorOf } from '../lib/vehicleMoves.js'
import { SHARE_LEVELS } from '../lib/sharePolicy.js'
import { addShares, removeShares, setShares, sharesVisibleTo } from '../lib/vehicleShares.js'
import { validate } from '../middleware/validate.js'

const router = Router()

/** How many vehicles one Bulk Action call may share or unshare. */
export const MAX_SHARE_BATCH = 500

const level = z.enum(SHARE_LEVELS, { error: 'Choose a Group, Business Group or Branch' })

const batchSchema = z.object({
  vehicleIds: z
    .array(z.string().trim().min(1))
    .min(1, 'Choose at least one vehicle')
    .max(MAX_SHARE_BATCH, `Up to ${MAX_SHARE_BATCH} vehicles at a time`)
    .transform(ids => [...new Set(ids)]),
  level,
  targetId: requiredId('The place'),
})

const setSchema = z.object({
  targets: z
    .array(z.object({ level, id: requiredId('The place') }))
    .max(200, 'Up to 200 places')
    .default([]),
})

router.get(
  '/',
  validate(z.object({ vehicleId: requiredId('Vehicle') }), 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await sharesVisibleTo(req.scope, req.validatedQuery.vehicleId) })
  })
)

router.put(
  '/vehicle/:vehicleId',
  validate(setSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    res.json({ data: await setShares(req.scope, actorOf(req), req.params.vehicleId, req.body.targets) })
  })
)

router.post(
  '/add',
  validate(batchSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const { vehicleIds, level: lv, targetId } = req.body
    res.json({ data: await addShares(req.scope, actorOf(req), vehicleIds, lv, targetId) })
  })
)

router.post(
  '/remove',
  validate(batchSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const { vehicleIds, level: lv, targetId } = req.body
    res.json({ data: await removeShares(req.scope, actorOf(req), vehicleIds, lv, targetId) })
  })
)

export default router
