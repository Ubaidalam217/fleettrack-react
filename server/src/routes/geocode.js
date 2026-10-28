/**
 * POST /api/geocode/reverse — addresses for report points, from the shared
 * cache plus a bounded number of live lookups (lib/geocoder.js).
 *
 * Body: { points: [{ lat, lng }], resolve?: number }
 *   resolve = how many cache misses to look up live in THIS call (0-50). The
 *   browser asks with 0 first — every cached address comes back at once — then
 *   pages through the misses in small batches so it can show progress, and the
 *   report stays downloadable throughout.
 *
 * Any signed-in user may call it: a coordinate-to-street lookup reveals nothing
 * about any tenant, and the points sent are ones the caller already holds.
 */

import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/http.js'
import { reverseGeocodePoints } from '../lib/geocoder.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

const reverseSchema = z.object({
  points: z.array(point).min(1).max(2000),
  resolve: z.number().int().min(0).max(50).default(0),
})

router.post(
  '/reverse',
  validate(reverseSchema),
  asyncHandler(async (req, res) => {
    const { points, resolve } = req.body
    const result = await reverseGeocodePoints(points, { resolve })
    res.json({ data: result })
  })
)

export default router
