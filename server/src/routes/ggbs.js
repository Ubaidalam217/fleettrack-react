/**
 * /api/ggbs — the top tier below Super Admin. The mock calls these resellers.
 *
 * Only a Super Admin writes here: a GGB admin's own GGB is the root of its world
 * and renaming or deleting it is not an operation it should have. A GGB admin can
 * read its own row (so Settings can show the name) and nothing else.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler } from '../lib/http.js'
import { optionalEmail, requiredText } from '../lib/fields.js'
import { assertCanWrite, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const bodySchema = z.object({
  name: requiredText('Name'),
  email: optionalEmail(),
})

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.ggb.findMany({
      where: scopedWhere('ggb', req.scope),
      orderBy: { name: 'asc' },
      include: { _count: { select: { groups: true, businessGroups: true } } },
    })
    res.json({ data: rows })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('ggb', req.params.id, req.scope, {
      include: { _count: { select: { groups: true, businessGroups: true } } },
    })
    res.json({ data: row })
  })
)

router.post(
  '/',
  validate(bodySchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'ggb')
    const row = await prisma.ggb.create({ data: req.body })
    res.status(201).json({ data: row })
  })
)

router.put(
  '/:id',
  validate(bodySchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'ggb')
    // Scoped first: the id has to be one this caller could already see, so a
    // Super-Admin-only route still cannot be used to probe for ids by a role
    // that somehow reaches it.
    const existing = await findScopedOrThrow('ggb', req.params.id, req.scope)
    const row = await prisma.ggb.update({ where: { id: existing.id }, data: req.body })
    res.json({ data: row })
  })
)

/**
 * Delete.
 *
 * Cascades all the way down — groups, BGs, branches, vehicles, users, alerts —
 * through the onDelete rules in the schema. The counts come back in the response
 * because nothing else on the page would reveal how much went with it.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'ggb')
    const existing = await findScopedOrThrow('ggb', req.params.id, req.scope)

    const [groups, bgs, vehicles] = await Promise.all([
      prisma.group.count({ where: { ggbId: existing.id } }),
      prisma.businessGroup.count({ where: { ggbId: existing.id } }),
      prisma.vehicle.count({ where: { bg: { ggbId: existing.id } } }),
    ])

    await prisma.ggb.delete({ where: { id: existing.id } })
    res.json({ data: { id: existing.id, removed: { groups, businessGroups: bgs, vehicles } } })
  })
)

export default router
