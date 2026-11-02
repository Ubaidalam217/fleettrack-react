/**
 * /api/alert-events — what the alert engine raised (lib/alertEngine.js).
 *
 *   GET  /api/alert-events?limit=50&before=<ISO>&unread=true
 *        newest first, scoped to the caller's BGs (and a sub-user's vehicles);
 *        `unreadCount` rides along so the bell needs no second request.
 *        &from=<ISO>&to=<ISO>&deviceIds=1,2,3 narrow it to a range and to some
 *        trackers — the Event Occurrence Report's query (up to 2000 rows).
 *   POST /api/alert-events/read   { ids?: string[] }   — omit ids to mark all read
 *
 * "Read" is shared by the BG rather than per user, the way a control room works:
 * once someone has looked at an alert it stops ringing for everyone.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler } from '../lib/http.js'
import { scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(50),
  before: z.string().datetime().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  deviceIds: z.string().trim().regex(/^\d+(,\d+)*$/).max(4000).optional(),
  unread: z.enum(['true', 'false']).optional(),
  type: z.string().trim().min(1).optional(),
})

const readBody = z.object({
  ids: z.array(z.string().trim().min(1)).max(500).optional(),
})

const INCLUDE = {
  vehicle: { select: { id: true, plateNo: true, fleetNo: true, imei: true } },
  driver: { select: { id: true, name: true } },
  bg: { select: { id: true, name: true } },
}

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { limit, before, unread, type, from, to, deviceIds } = req.validatedQuery
    const scope = scopedWhere('alertEvent', req.scope)
    const where = {
      AND: [
        scope,
        before ? { occurredAt: { lt: new Date(before) } } : {},
        unread === 'true' ? { readAt: null } : {},
        type ? { type } : {},
        from ? { occurredAt: { gte: new Date(from) } } : {},
        to ? { occurredAt: { lte: new Date(to) } } : {},
        deviceIds ? { deviceId: { in: deviceIds.split(',').map(Number) } } : {},
      ],
    }
    const [rows, unreadCount] = await Promise.all([
      prisma.alertEvent.findMany({ where, orderBy: { occurredAt: 'desc' }, take: limit, include: INCLUDE }),
      prisma.alertEvent.count({ where: { AND: [scope, { readAt: null }] } }),
    ])
    res.set('Cache-Control', 'no-store')
    res.json({ data: rows, unreadCount })
  })
)

router.post(
  '/read',
  validate(readBody),
  asyncHandler(async (req, res) => {
    const { ids } = req.body
    const { count } = await prisma.alertEvent.updateMany({
      where: { AND: [scopedWhere('alertEvent', req.scope), { readAt: null }, ids ? { id: { in: ids } } : {}] },
      data: { readAt: new Date() },
    })
    res.json({ data: { updated: count } })
  })
)

export default router
