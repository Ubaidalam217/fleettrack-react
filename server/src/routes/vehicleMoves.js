/**
 * Reallocation History (client report list, 2026-11-10): read-only list of the
 * VehicleMove rows lib/vehicleMoves.js writes, newest first, inside the
 * caller's scope (a sub-user sees its own vehicles' moves only).
 *
 * The history starts the day this shipped; moves made before were not kept.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler } from '../lib/http.js'
import { scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

export const MOVE_LIMIT = 5000

const listQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  level: z.enum(['branch', 'group', 'ggb']).optional(),
})

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to, level } = req.validatedQuery
    const rows = await prisma.vehicleMove.findMany({
      where: scopedWhere(
        'vehicleMove', req.scope,
        from || to ? { movedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : null,
        level ? { level } : null,
      ),
      include: { bg: { select: { id: true, name: true } } },
      orderBy: { movedAt: 'desc' },
      take: MOVE_LIMIT,
    })
    res.json({ data: rows })
  })
)

export default router
