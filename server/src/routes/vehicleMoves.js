/**
 * Reallocation History (client report list, 2026-11-10): read-only list of the
 * VehicleMove rows lib/vehicleMoves.js writes, newest first, inside the
 * caller's scope (a sub-user sees its own vehicles' moves only).
 *
 * Searchable (client, 2026-11-17: "keep the history of change and we can
 * search it"): `q` matches the vehicle's name as it was, the IMEI (old or new
 * tracker), the from / to names and the note; `user` who made the change;
 * `vehicleId` one vehicle (the Vehicle information dialog's History).
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
export const MOVE_LEVELS = ['branch', 'group', 'ggb', 'bg', 'device', 'share', 'rename', 'merge', 'archive']

const text = max => z.string().trim().max(max).optional().transform(v => v || undefined)

const listQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  level: z.enum(MOVE_LEVELS).optional(),
  q: text(100),
  user: text(100),
  vehicleId: text(40),
  limit: z.coerce.number().int().min(1).max(MOVE_LIMIT).optional(),
})

const contains = v => ({ contains: v, mode: 'insensitive' })

/** The search box: a word typed may be a vehicle, either tracker, a place or a note. */
function searchWhere(q) {
  const digits = q.replace(/\D/g, '')
  return {
    OR: [
      { vehicleLabel: contains(q) },
      { fromName: contains(q) },
      { toName: contains(q) },
      { note: contains(q) },
      { movedByName: contains(q) },
      // An IMEI typed with spaces or dashes still finds the tracker, and the
      // row of a tracker change that names it in its note ("Replaced 863…").
      { imei: { contains: digits.length >= 3 ? digits : q } },
      ...(digits.length >= 3 && digits !== q ? [{ note: { contains: digits } }] : []),
    ],
  }
}

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to, level, q, user, vehicleId, limit } = req.validatedQuery
    const filters = [
      from || to ? { movedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : null,
      level ? { level } : null,
      q ? searchWhere(q) : null,
      user ? { movedByName: contains(user) } : null,
      vehicleId ? { vehicleId } : null,
    ].filter(Boolean)
    // A vehicle moved to another BG stays in the history of the BG it left
    // (not for a sub-user, whose access ended with the move); a share row is
    // read by the BG it was shared into the same way (fromBgId).
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
      take: limit ?? MOVE_LIMIT,
    })
    res.json({ data: rows })
  })
)

export default router
