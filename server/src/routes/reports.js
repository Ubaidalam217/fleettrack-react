/**
 * /api/reports — report figures the server has already computed.
 *
 * GET /api/reports/daywise?year=2026&month=10
 *   → { data: { year, month, devices: [{ deviceId, distanceKm[], ignitionSec[],
 *       totalKm, totalSec }], missingDays: ["2026-10-29", ...], capped } }
 *
 * The figures come from lib/dailyUsage.js's DailyUsage table, so the answer is
 * one query however long the month. Scoped to the caller's Flespi devices with
 * the same buildAcl() the Flespi proxy uses, so a report shows exactly the
 * vehicles the Live Map does.
 *
 * `missingDays` lists days not computed yet (a month older than the backfill
 * window, or a server that has just started). They are queued for the job, and
 * the browser fills them in itself meanwhile — so the report is never wrong,
 * only occasionally not instant.
 */

import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/http.js'
import { buildAcl } from '../lib/flespiGrant.js'
import { readMonth, requestDays } from '../lib/dailyUsage.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const monthQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})

router.get(
  '/daywise',
  validate(monthQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { year, month } = req.validatedQuery
    const { deviceIds } = await buildAcl(req.scope)
    const result = await readMonth(year, month, deviceIds)
    if (result.missingDays.length) requestDays(result.missingDays)
    res.set('Cache-Control', 'no-store')
    res.json({ data: { year, month, ...result } })
  })
)

export default router
