/**
 * /api/vehicles — the asset register.
 *
 * `imei` is normalised to digits and globally unique: it is the join key against
 * a Flespi device's configuration.ident, and the same physical tracker registered
 * twice would make "which vehicle is this position for" unanswerable.
 *
 * No telemetry is stored or returned. Position, speed, temperature and ignition
 * all stay in Flespi and are joined client-side on the IMEI.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, conflict } from '../lib/http.js'
import { imeiField, optionalId, optionalText, requiredId } from '../lib/fields.js'
import { assertCanWrite, assertWritableParent, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const vehicleFields = {
  subGroup: optionalText(120),
  plateNo: optionalText(60),
  fleetNo: optionalText(60),
  imei: imeiField(),
  make: optionalText(80),
  model: optionalText(80),
  deviceType: optionalText(120),
  mobileNo: optionalText(40),
  vehicleType: optionalText(60),
  /**
   * Free text, not a number — the frontend's field is a text input and the value
   * is operator-maintained paperwork. Not the tracker's own ODO reading, which is
   * never stored here.
   */
  odometer: optionalText(40),
  /**
   * Only meaningful when the vehicle's BG has no group of its own; otherwise the
   * frontend derives it from the BG. Validated against the BG's GGB below so a row
   * cannot point at a group belonging to a different tenant.
   */
  groupId: optionalId(),
}

const createSchema = z.object({
  bgId: requiredId('Business group'),
  branchId: optionalId(),
  ...vehicleFields,
})

const updateSchema = z.object({
  branchId: optionalId(),
  ...vehicleFields,
})

const listQuerySchema = z.object({
  bgId: z.string().trim().min(1).optional(),
  branchId: z.string().trim().min(1).optional(),
})

/** Throws 409 if the IMEI is on another vehicle. Compares normalised digits. */
async function assertImeiFree(imei, exceptId = null) {
  const clash = await prisma.vehicle.findFirst({
    where: { imei, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) {
    throw conflict('That IMEI is already registered to another vehicle', {
      imei: 'Already in use',
    })
  }
}

/**
 * A branch, if one was named, must belong to the vehicle's own BG.
 *
 * Checked against the BG rather than the caller's scope for the same reason as
 * bgs.js resolveGroup(): a Super Admin can see every branch, and filing a vehicle
 * under a branch of a different BG would produce a row whose parents disagree
 * about which tenant owns it.
 */
async function resolveBranch(branchId, bgId) {
  if (!branchId) return null
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, bgId },
    select: { id: true },
  })
  if (!branch) {
    throw badRequest('Branch must belong to the same business group', {
      branchId: 'Invalid branch',
    })
  }
  return branch.id
}

/**
 * A group, if one was named, must belong to the same GGB as the vehicle's BG.
 *
 * Expressed as one query — "a group whose GGB owns this BG" — rather than fetching
 * the BG's ggbId first. The constraint is NOT "the group that owns this BG": the
 * field only applies when the BG has no group of its own, so the vehicle is being
 * filed under a sibling group within the same tenant.
 */
async function resolveGroup(groupId, bgId) {
  if (!groupId) return null
  const group = await prisma.group.findFirst({
    where: { id: groupId, ggb: { businessGroups: { some: { id: bgId } } } },
    select: { id: true },
  })
  if (!group) {
    throw badRequest('Group must belong to the same GGB as the vehicle’s business group', {
      groupId: 'Invalid group',
    })
  }
  return group.id
}

const VEHICLE_INCLUDE = {
  bg: { select: { id: true, name: true, groupId: true } },
  branch: { select: { id: true, name: true } },
}

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId, branchId } = req.validatedQuery
    const rows = await prisma.vehicle.findMany({
      where: scopedWhere(
        'vehicle',
        req.scope,
        bgId ? { bgId } : null,
        branchId ? { branchId } : null
      ),
      orderBy: [{ plateNo: 'asc' }, { imei: 'asc' }],
      include: VEHICLE_INCLUDE,
    })
    res.json({ data: rows })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('vehicle', req.params.id, req.scope, {
      include: VEHICLE_INCLUDE,
    })
    res.json({ data: row })
  })
)

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const bg = await assertWritableParent(req.scope, 'bg', req.body.bgId)
    await assertImeiFree(req.body.imei)

    const { bgId: _bgId, branchId, groupId, ...rest } = req.body
    const row = await prisma.vehicle.create({
      data: {
        ...rest,
        bgId: bg.id,
        branchId: await resolveBranch(branchId, bg.id),
        groupId: await resolveGroup(groupId, bg.id),
      },
      include: VEHICLE_INCLUDE,
    })
    res.status(201).json({ data: row })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('vehicle', req.params.id, req.scope)
    await assertImeiFree(req.body.imei, existing.id)

    // bgId is not editable here. Moving a vehicle between BGs would have to also
    // strip its sub-user assignments and its alert memberships in the old BG, and
    // that is a transfer operation rather than an edit — the Settings form does
    // not offer it either.
    const { branchId, groupId, ...rest } = req.body
    const row = await prisma.vehicle.update({
      where: { id: existing.id },
      data: {
        ...rest,
        branchId: await resolveBranch(branchId, existing.bgId),
        groupId: await resolveGroup(groupId, existing.bgId),
      },
      include: VEHICLE_INCLUDE,
    })
    res.json({ data: row })
  })
)

/**
 * Delete.
 *
 * SubuserVehicle and AlertVehicle rows cascade from the schema, which is what
 * keeps a sub-user's "n of m" count and an alert's "3 vehicles" from outliving
 * the vehicles they refer to. An alert with allVehicles set holds no ids and is
 * untouched — it simply covers one fewer vehicle from now on.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('vehicle', req.params.id, req.scope)

    const [subusers, alerts] = await Promise.all([
      prisma.subuserVehicle.count({ where: { vehicleId: existing.id } }),
      prisma.alertVehicle.count({ where: { vehicleId: existing.id } }),
    ])

    await prisma.vehicle.delete({ where: { id: existing.id } })
    res.json({
      data: {
        id: existing.id,
        subuserAssignmentsStripped: subusers,
        alertAssignmentsStripped: alerts,
      },
    })
  })
)

export default router
