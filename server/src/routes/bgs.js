/**
 * /api/bgs — Business Groups, the tenant boundary. The mock calls these
 * companies.
 *
 * `email` is unique across the whole table because it is also the BG account's
 * login username. The pre-check below gives a per-field message; the unique index
 * is what actually guarantees it under concurrency (see translatePrisma in
 * middleware/errors.js).
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../lib/http.js'
import { optionalId, requiredEmail, requiredText } from '../lib/fields.js'
import {
  assertCanWrite,
  assertWritableParent,
  findScopedOrThrow,
  ROLES,
  scopedWhere,
} from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const createSchema = z.object({
  name: requiredText('Name'),
  email: requiredEmail('Email'),
  /**
   * Optional, and only a Super Admin has to supply it.
   *
   * A GGB admin's GGB and a group admin's GGB are both implied by who they are —
   * and a group admin cannot *see* any GGB at all (the tier above its own node),
   * so requiring it here would make "a group admin creates BGs inside its group"
   * impossible to satisfy. See resolveNewBgParents().
   */
  ggbId: optionalId(),
  // Nullable: blank means this BG is its own group.
  groupId: optionalId(),
})

const updateSchema = z.object({
  name: requiredText('Name'),
  email: requiredEmail('Email'),
  groupId: optionalId(),
})

const listQuerySchema = z.object({
  ggbId: z.string().trim().min(1).optional(),
  groupId: z.string().trim().min(1).optional(),
})

/** Throws 409 if another BG already uses this email. */
async function assertEmailFree(email, exceptId = null) {
  const clash = await prisma.businessGroup.findFirst({
    where: { email, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) {
    throw conflict('That email address is already used by another business group', {
      email: 'Already in use',
    })
  }
}

/**
 * A group, if one was named, must belong to the same GGB as the BG.
 *
 * Checked against the GGB rather than against the caller's scope, because a
 * Super Admin can see every group and would otherwise be able to file a BG under
 * a group in a different GGB — producing a row whose two parents disagree about
 * which tenant it is in, which every scope filter then answers differently.
 */
async function resolveGroup(groupId, ggbId) {
  if (!groupId) return null
  const group = await prisma.group.findFirst({
    where: { id: groupId, ggbId },
    select: { id: true },
  })
  if (!group) throw badRequest('Group must belong to the same GGB', { groupId: 'Invalid group' })
  return group.id
}

/**
 * Which GGB and group a new BG belongs to, decided per role.
 *
 * The three cases genuinely differ, which is why this is a switch and not one
 * expression:
 *
 *  - A Super Admin names the GGB, because it can see all of them and there is
 *    nothing to infer.
 *  - A GGB admin's GGB is itself. A body naming a different one is answered 404,
 *    the same as reading that GGB would be — a write must not confirm an id a read
 *    would hide.
 *  - A group admin can see no GGB at all, so it cannot be asked to name one: the
 *    GGB is read off its own group. The BG is also forced into that group, because
 *    a group admin that created a BG outside its group could not then see, edit or
 *    undo what it had just done.
 */
async function resolveNewBgParents(scope, body) {
  switch (scope.role) {
    case ROLES.SUPER_ADMIN: {
      if (!body.ggbId) throw badRequest('GGB is required', { ggbId: 'Required' })
      const ggb = await assertWritableParent(scope, 'ggb', body.ggbId)
      return { ggbId: ggb.id, groupId: await resolveGroup(body.groupId, ggb.id) }
    }

    case ROLES.GGB_ADMIN: {
      if (!scope.ggbId) throw forbidden('Your account is not linked to a GGB')
      if (body.ggbId && body.ggbId !== scope.ggbId) throw notFound('GGB')
      return { ggbId: scope.ggbId, groupId: await resolveGroup(body.groupId, scope.ggbId) }
    }

    case ROLES.GROUP_ADMIN: {
      const group = await prisma.group.findUnique({
        where: { id: String(scope.groupId ?? '') },
        select: { id: true, ggbId: true },
      })
      if (!group) throw forbidden('Your account is not linked to an existing group')
      if (body.ggbId && body.ggbId !== group.ggbId) throw notFound('GGB')
      if (body.groupId && body.groupId !== group.id) {
        throw badRequest('A group admin can only create business groups in its own group', {
          groupId: 'Must be your own group',
        })
      }
      return { ggbId: group.ggbId, groupId: group.id }
    }

    default:
      // BG users and sub-users never reach this — assertCanWrite rejects 'bg' for
      // both. The throw is the backstop if WRITABLE ever widens by accident.
      throw forbidden('Your role may not create business groups')
  }
}

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { ggbId, groupId } = req.validatedQuery
    const rows = await prisma.businessGroup.findMany({
      where: scopedWhere(
        'bg',
        req.scope,
        ggbId ? { ggbId } : null,
        groupId ? { groupId } : null
      ),
      orderBy: { name: 'asc' },
      include: {
        ggb: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        _count: { select: { branches: true, vehicles: true, users: true } },
      },
    })
    res.json({ data: rows })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('bg', req.params.id, req.scope, {
      include: {
        ggb: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        _count: { select: { branches: true, vehicles: true, users: true } },
      },
    })
    res.json({ data: row })
  })
)

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'bg')
    await assertEmailFree(req.body.email)

    const { ggbId, groupId } = await resolveNewBgParents(req.scope, req.body)

    const row = await prisma.businessGroup.create({
      data: { name: req.body.name, email: req.body.email, ggbId, groupId },
    })
    res.status(201).json({ data: row })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'bg')
    const existing = await findScopedOrThrow('bg', req.params.id, req.scope)
    await assertEmailFree(req.body.email, existing.id)

    // Resolved against the BG's existing ggbId: the GGB is not editable here, so
    // a group from anywhere else is invalid by definition.
    const groupId = await resolveGroup(req.body.groupId, existing.ggbId)

    if (req.scope.role === ROLES.GROUP_ADMIN && groupId !== req.scope.groupId) {
      // Otherwise a group admin could move a BG out of its own group and lose
      // the ability to see — or undo — what it just did.
      throw badRequest('A group admin cannot move a business group out of its own group', {
        groupId: 'Must be your own group',
      })
    }

    const row = await prisma.businessGroup.update({
      where: { id: existing.id },
      data: { name: req.body.name, email: req.body.email, groupId },
    })
    res.json({ data: row })
  })
)

/**
 * Delete. Takes the whole BG with it — branches, vehicles, accounts, alerts —
 * via the cascade rules in the schema. This is the one place that is meant to be
 * that destructive: a BG is the tenant, and a tenant with no fleet and no
 * accounts is not a BG, it is a stranded row.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'bg')
    const existing = await findScopedOrThrow('bg', req.params.id, req.scope)

    const [branches, vehicles, users, alerts] = await Promise.all([
      prisma.branch.count({ where: { bgId: existing.id } }),
      prisma.vehicle.count({ where: { bgId: existing.id } }),
      prisma.user.count({ where: { bgId: existing.id } }),
      prisma.alert.count({ where: { bgId: existing.id } }),
    ])

    await prisma.businessGroup.delete({ where: { id: existing.id } })
    res.json({ data: { id: existing.id, removed: { branches, vehicles, users, alerts } } })
  })
)

export default router
