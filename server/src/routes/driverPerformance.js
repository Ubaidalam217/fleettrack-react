/**
 * GET /api/driver-performance?from=ISO&to=ISO — every driver in the caller's
 * scope with distance, hours, exceptions, fatigue, incidents, a safety score
 * and the rule-based risk levels (lib/driverPerformance.js); plus the vehicles
 * that drove with no driver identified.
 *
 * GET/PUT /api/driver-performance/fatigue-rule — the fatigue thresholds.
 * Changing them is for the Super Admin and GGB admins.
 */

import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, badRequest, forbidden } from '../lib/http.js'
import { validate } from '../middleware/validate.js'
import { ROLES } from '../lib/scope.js'
import { getFatigueSettings, performanceReport, setFatigueSettings } from '../lib/driverPerformance.js'

const router = Router()
const MAX_DAYS = 31

const rangeSchema = z.object({ from: z.string().min(1), to: z.string().min(1) })

router.get(
  '/',
  validate(rangeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const fromTs = Math.floor(Date.parse(req.validatedQuery.from) / 1000)
    const toTs = Math.floor(Date.parse(req.validatedQuery.to) / 1000)
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs >= toTs) throw badRequest('Give a valid from / to range')
    if (toTs - fromTs > MAX_DAYS * 86_400) throw badRequest(`Choose ${MAX_DAYS} days or fewer`)
    res.json({ data: await performanceReport(req.scope, fromTs, toTs) })
  })
)

const minutes = (min, max) => z.coerce.number().int().min(min).max(max)
const ruleSchema = z.object({
  firstDriveMin: minutes(10, 720),
  breakMin: minutes(1, 240),
  driveMin: minutes(10, 720),
  dailyMaxMin: minutes(30, 1440),
})

router.get('/fatigue-rule', asyncHandler(async (_req, res) => res.json({ data: await getFatigueSettings() })))

router.put(
  '/fatigue-rule',
  validate(ruleSchema),
  asyncHandler(async (req, res) => {
    if (![ROLES.SUPER_ADMIN, ROLES.GGB_ADMIN].includes(req.scope.role)) throw forbidden('Only an administrator can change the fatigue rule')
    res.json({ data: await setFatigueSettings(req.body) })
  })
)

export default router
