/**
 * /api/groups — the optional tier between a GGB and its BGs.
 *
 * A group's ggbId is fixed at creation. Moving a group to another GGB would move
 * every BG, branch, vehicle and account under it across a tenant boundary in one
 * request, which is not an edit — it is a migration, and it is not something the
 * Settings form offers.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler } from '../lib/http.js'
import { requiredId, requiredText } from '../lib/fields.js'
import { assertCanWrite, assertWritableParent, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const createSchema = z.object({
  name: requiredText('Name'),
  ggbId: requiredId('GGB'),
})

const updateSchema = z.object({
  name: requiredText('Name'),
})

const listQuerySchema = z.object({
  ggbId: z.string().trim().min(1).optional(),
})

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { ggbId } = req.validatedQuery
    const rows = await prisma.group.findMany({
      // The caller's filter is ANDed with the scope, never merged over it: a
      // ggbId in the query string can only ever narrow what the role already
      // sees.
      where: scopedWhere('group', req.scope, ggbId ? { ggbId } : null),
      orderBy: { name: 'asc' },
      include: { _count: { select: { businessGroups: true } } },
    })
    res.json({ data: rows })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('group', req.params.id, req.scope, {
      include: { _count: { select: { businessGroups: true } } },
    })
    res.json({ data: row })
  })
)

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'group')
    // 404s if the GGB is outside the caller's scope — indistinguishable from a
    // GGB that does not exist, so a GGB admin cannot discover its neighbours by
    // POSTing ids at this route.
    const ggb = await assertWritableParent(req.scope, 'ggb', req.body.ggbId)

    const row = await prisma.group.create({ data: { name: req.body.name, ggbId: ggb.id } })
    res.status(201).json({ data: row })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'group')
    const existing = await findScopedOrThrow('group', req.params.id, req.scope)
    const row = await prisma.group.update({
      where: { id: existing.id },
      data: { name: req.body.name },
    })
    res.json({ data: row })
  })
)

/**
 * Delete.
 *
 * Detaches its BGs rather than deleting them: BusinessGroup.groupId is
 * `onDelete: SetNull`, and a null groupId is a legitimate documented state
 * meaning "this BG is its own group". Cascading instead would make removing one
 * optional grouping tier destroy every vehicle and account beneath it, which is
 * not what "delete a group" means on the Settings page.
 *
 * The detached count is reported because nothing else on screen would reveal
 * that those BGs just moved to their own group — and because any GROUP_ADMIN
 * account scoped to this group IS deleted (User.groupId cascades), so somebody
 * has to be told.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'group')
    const existing = await findScopedOrThrow('group', req.params.id, req.scope)

    const [bgs, admins] = await Promise.all([
      prisma.businessGroup.count({ where: { groupId: existing.id } }),
      prisma.user.count({ where: { groupId: existing.id } }),
    ])

    await prisma.group.delete({ where: { id: existing.id } })
    res.json({
      data: {
        id: existing.id,
        businessGroupsDetached: bgs,
        groupAdminsRemoved: admins,
      },
    })
  })
)

export default router
