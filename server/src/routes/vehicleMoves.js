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
import { ROLES, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

export const MOVE_LIMIT = 5000

const listQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  level: z.enum(['branch', 'group', 'ggb', 'bg', 'device']).optional(),
})

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to, level } = req.validatedQuery
    const filters = [
      from || to ? { movedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : null,
      level ? { level } : null,
    ].filter(Boolean)
    // A vehicle moved to another BG stays in the history of the BG it left
    // (not for a sub-user, whose access ended with the move).
    let left = null
    if (req.scope.role !== ROLES.SUB_USER) {
      const mine = await prisma.businessGroup.findMany({ where: scopedWhere('bg', req.scope), select: { id: true } })
      left = { AND: [{ fromBgId: { in: mine.map(b => b.id) } }, ...filters] }
    }
    const own = scopedWhere('vehicleMove', req.scope, ...filters)
    // Prisma drops an empty `{}` from an OR, so a scope that already sees
    // everything (a Super Admin with no filter) is used on its own.
    const all = Object.keys(own).length === 0
    const rows = await prisma.vehicleMove.findMany({
      where: left && !all ? { OR: [own, left] } : own,
      include: { bg: { select: { id: true, name: true } } },
      orderBy: { movedAt: 'desc' },
      take: MOVE_LIMIT,
    })
    res.json({ data: rows })
  })
)

export default router
