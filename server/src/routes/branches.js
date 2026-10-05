/**
 * /api/branches — branches and sub-branches, nesting to any depth.
 *
 * Three rules the frontend already enforces against its mock and that are
 * repeated here because the frontend is not where they can be guaranteed:
 *  - a parent branch must belong to the same BG;
 *  - a branch cannot be its own ancestor (cycle prevention);
 *  - deleting a branch deletes its whole subtree, detaches that subtree's
 *    vehicles (branchId → null) and strips the matching sub-user assignments.
 *
 * All three live in lib/branches.js; this file is the HTTP shell around them.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler } from '../lib/http.js'
import { optionalId, requiredId, requiredText } from '../lib/fields.js'
import { assertValidParent, buildTree, subtreeIds } from '../lib/branches.js'
import {
  assertCanWrite,
  assertWritableParent,
  findScopedOrThrow,
  scopedWhere,
} from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const createSchema = z.object({
  name: requiredText('Name'),
  bgId: requiredId('Business group'),
  parentBranchId: optionalId(),
})

const updateSchema = z.object({
  name: requiredText('Name'),
  parentBranchId: optionalId(),
})

const listQuerySchema = z.object({
  bgId: z.string().trim().min(1).optional(),
  /**
   * `tree=1` adds a `depth` to each row and orders them depth-first — what the
   * Settings table and both branch pickers render. Off by default because the
   * flat list is what a count or a dropdown of one BG's branches wants.
   */
  tree: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
    .transform(v => v === '1' || v === 'true'),
})

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId, tree } = req.validatedQuery
    const rows = await prisma.branch.findMany({
      where: scopedWhere('branch', req.scope, bgId ? { bgId } : null),
      orderBy: { name: 'asc' },
      include: {
        bg: { select: { id: true, name: true } },
        _count: { select: { children: true, vehicles: true } },
      },
    })

    // Only meaningful within one BG — a depth-first order across several BGs
    // would interleave their trees. Asking for a tree without naming a BG gets
    // the flat list rather than a misleading one.
    res.json({ data: tree && bgId ? buildTree(rows) : rows })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('branch', req.params.id, req.scope, {
      include: {
        bg: { select: { id: true, name: true } },
        _count: { select: { children: true, vehicles: true } },
      },
    })
    res.json({ data: row })
  })
)

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'branch')
    const bg = await assertWritableParent(req.scope, 'bg', req.body.bgId)

    await assertValidParent({
      bgId: bg.id,
      branchId: null,
      parentBranchId: req.body.parentBranchId,
    })

    const row = await prisma.branch.create({
      data: { name: req.body.name, bgId: bg.id, parentBranchId: req.body.parentBranchId },
    })
    res.status(201).json({ data: row })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'branch')
    const existing = await findScopedOrThrow('branch', req.params.id, req.scope)

    // bgId is not editable: moving a branch between BGs would carry its vehicles
    // and its sub-user assignments across a tenant boundary.
    await assertValidParent({
      bgId: existing.bgId,
      branchId: existing.id,
      parentBranchId: req.body.parentBranchId,
    })

    const row = await prisma.branch.update({
      where: { id: existing.id },
      data: { name: req.body.name, parentBranchId: req.body.parentBranchId },
    })
    res.json({ data: row })
  })
)

/**
 * Delete a branch and everything below it.
 *
 * The subtree is walked first so the response can report what went — the counts
 * are read while the rows still point at the old ids, because afterwards there is
 * nothing left to count. The delete itself only removes the top branch: the
 * self-relation is `onDelete: Cascade`, so Postgres takes the descendants, and
 * Vehicle.branchId is `onDelete: SetNull`, so vehicles are detached rather than
 * deleted. SubuserBranch rows cascade from the branch.
 *
 * Doing it in one transaction with explicit deletes instead would be three more
 * round trips to re-implement what the schema already guarantees — and would stop
 * guaranteeing it for anything that writes to this database without going through
 * this route.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'branch')
    const existing = await findScopedOrThrow('branch', req.params.id, req.scope)

    const doomed = await subtreeIds(existing.bgId, existing.id)

    const [vehiclesDetached, assignmentsStripped] = await Promise.all([
      prisma.vehicle.count({ where: { branchId: { in: doomed } } }),
      prisma.subuserBranch.count({ where: { branchId: { in: doomed } } }),
    ])

    await prisma.branch.delete({ where: { id: existing.id } })

    res.json({
      data: {
        id: existing.id,
        removed: doomed.length,
        subBranches: doomed.length - 1,
        vehiclesDetached,
        subuserAssignmentsStripped: assignmentsStripped,
      },
    })
  })
)

export default router
