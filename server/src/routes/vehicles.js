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
import { imeiField, optionalDate, optionalId, optionalText, requiredId } from '../lib/fields.js'
import { assertCanWrite, assertWritableParent, findScopedOrThrow, isSuperAdmin, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'
import { revokeGrantsForBg } from '../lib/flespiGrant.js'
import { actorOf, bgMoveRow, deviceRow, editMoves } from '../lib/vehicleMoves.js'
import * as flespi from '../lib/flespi.js'
import { channelAddresses, deviceName, deviceTypes, syncVehicleDevice, unregisteredDevices } from '../lib/flespiDevices.js'

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
  /** Validity: "YYYY-MM-DD", the day the vehicle's service is valid until. */
  validUntil: optionalDate(),
  /**
   * Only meaningful when the vehicle's BG has no group of its own; otherwise the
   * frontend derives it from the BG. Validated against the BG's GGB below so a row
   * cannot point at a group belonging to a different tenant.
   */
  groupId: optionalId(),
}

/**
 * Custom fields: free name → value pairs. Blank rows are dropped; a value with
 * no name, or the same name twice (ignoring case), is refused with the row it
 * is on, so the form can point at it.
 */
export const MAX_CUSTOM_FIELDS = 100
const customFieldsSchema = z.object({
  fields: z
    .array(z.object({
      name: z.union([z.string(), z.null()]).default('').transform(v => String(v ?? '').trim()),
      value: z.union([z.string(), z.number(), z.null()]).default('').transform(v => String(v ?? '').trim()),
    }))
    .max(MAX_CUSTOM_FIELDS, `Up to ${MAX_CUSTOM_FIELDS} custom fields per vehicle`),
})

function cleanCustomFields(rows) {
  const errors = {}
  const seen = new Map()
  const out = []
  rows.forEach((f, i) => {
    if (!f.name && !f.value) return
    if (!f.name) { errors[`fields.${i}.name`] = 'Give this field a name'; return }
    if (f.name.length > 80) { errors[`fields.${i}.name`] = 'Up to 80 characters'; return }
    if (f.value.length > 1000) { errors[`fields.${i}.value`] = 'Up to 1000 characters'; return }
    const key = f.name.toLowerCase()
    if (seen.has(key)) { errors[`fields.${i}.name`] = 'This name is already used above'; return }
    seen.set(key, i)
    out.push({ name: f.name, value: f.value })
  })
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields', errors)
  return out
}

const createSchema = z.object({
  bgId: requiredId('Business Group'),
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
    throw badRequest('Group must belong to the same Group Global Admin as the vehicle’s Business Group', {
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

/**
 * The Flespi device types the Add Vehicle form offers, and the address each
 * protocol's trackers must be set to send to. Empty when Flespi is not set up.
 */
router.get(
  '/device-types',
  asyncHandler(async (_req, res) => {
    if (!flespi.isConfigured()) {
      res.json({ data: { types: [], addresses: {} } })
      return
    }
    const [types, addresses] = await Promise.all([deviceTypes(), channelAddresses()])
    res.json({ data: { types, addresses } })
  })
)

/**
 * Flespi devices no vehicle in the register points at. Super Admin only: the
 * Flespi account spans every tenant, so anyone narrower would see trackers that
 * belong to someone else. Checked against every vehicle, not the caller's scope,
 * for the same reason — registered elsewhere is still registered.
 */
router.get(
  '/unregistered',
  asyncHandler(async (req, res) => {
    if (!isSuperAdmin(req.scope) || !flespi.isConfigured()) {
      res.json({ data: [] })
      return
    }
    const vehicles = await prisma.vehicle.findMany({ select: { imei: true } })
    res.json({ data: await unregisteredDevices(vehicles.map(v => v.imei)) })
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
    // Flespi first, so a refused tracker (device limit, bad IMEI) saves nothing.
    const flespiDevice = await syncVehicleDevice({
      imei: req.body.imei, name: deviceName(req.body), deviceType: req.body.deviceType, requireType: true,
    })

    const { bgId: _bgId, branchId, groupId, ...rest } = req.body
    const data = {
      ...rest,
      bgId: bg.id,
      branchId: await resolveBranch(branchId, bg.id),
      groupId: await resolveGroup(groupId, bg.id),
    }
    // The tracker's install goes into the Reallocation History with the vehicle.
    const row = await prisma.$transaction(async tx => {
      const created = await tx.vehicle.create({ data, include: VEHICLE_INCLUDE })
      await tx.vehicleMove.create({ data: deviceRow(created, created.imei, true, actorOf(req)) })
      return created
    })
    // The BG's fleet changed, so every live Flespi ACL under it is now too narrow.
    // Dropping the grants makes the next refresh mint one that includes this
    // vehicle; leaving them would hide a brand-new vehicle until the token expired.
    await revokeGrantsForBg(bg.id)
    res.status(201).json({ data: row, flespi: flespiDevice })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('vehicle', req.params.id, req.scope)
    await assertImeiFree(req.body.imei, existing.id)
    const flespiDevice = await syncVehicleDevice({
      imei: req.body.imei ?? existing.imei,
      oldImei: existing.imei,
      name: deviceName({ ...existing, ...req.body }),
      deviceType: req.body.deviceType ?? existing.deviceType,
    })

    // bgId is not editable here. Moving a vehicle between BGs would have to also
    // strip its sub-user assignments and its alert memberships in the old BG, and
    // that is a transfer operation rather than an edit — the Settings form does
    // not offer it either.
    const { branchId, groupId, ...rest } = req.body
    const next = {
      branchId: await resolveBranch(branchId, existing.bgId),
      groupId: await resolveGroup(groupId, existing.bgId),
    }
    // A new branch or group goes into the Reallocation History with the edit.
    const history = await editMoves(existing, rest, next, actorOf(req))
    const [row] = await prisma.$transaction([
      prisma.vehicle.update({
        where: { id: existing.id },
        data: { ...rest, ...next },
        include: VEHICLE_INCLUDE,
      }),
      prisma.vehicleMove.createMany({ data: history }),
    ])
    // An edit can change the IMEI, which is the Flespi join key, so the ACL's
    // device ids may no longer match.
    await revokeGrantsForBg(existing.bgId)
    res.json({ data: row, flespi: flespiDevice })
  })
)

/**
 * Put a vehicle in another branch of its own Business Group (client,
 * 2026-11-10: "add vehicles from the BG, Group, GGB or Branch itself" — the
 * Vehicles panel on those pages). Only the branch changes, so unlike PUT /:id
 * the Flespi device is not touched. No branch means the BG is its branch.
 * The change goes into the Reallocation History.
 */
router.put(
  '/:id/branch',
  validate(z.object({ branchId: optionalId() })),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('vehicle', req.params.id, req.scope)
    const branchId = await resolveBranch(req.body.branchId, existing.bgId)
    const history = await editMoves(existing, {}, { branchId, groupId: existing.groupId }, actorOf(req))
    const [row] = await prisma.$transaction([
      prisma.vehicle.update({ where: { id: existing.id }, data: { branchId }, include: VEHICLE_INCLUDE }),
      prisma.vehicleMove.createMany({ data: history }),
    ])
    res.json({ data: row })
  })
)

/**
 * Move one vehicle to another Business Group (client, 2026-11-10: "Reallocation
 * will be from Business Group change"). Not an edit: what the old BG gave the
 * vehicle does not follow it — its sub-users lose it, its alert and reminder
 * rules drop it, its driver is unassigned and any open driver assignment ends.
 * The trips, alerts, expenses and history recorded so far stay with the old BG.
 * The caller must be able to write vehicles in both BGs.
 */
router.post(
  '/:id/transfer',
  validate(z.object({ bgId: requiredId('Business Group'), branchId: optionalId() })),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('vehicle', req.params.id, req.scope)
    const target = await assertWritableParent(req.scope, 'bg', req.body.bgId)
    if (target.id === existing.bgId) throw badRequest('The vehicle is already in this Business Group', { bgId: 'Same Business Group' })
    const branchId = await resolveBranch(req.body.branchId, target.id)
    const [fromBg, branch, subusers, alerts, reminders, driver] = await Promise.all([
      prisma.businessGroup.findUnique({ where: { id: existing.bgId }, select: { id: true, name: true } }),
      branchId ? prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } }) : null,
      prisma.subuserVehicle.count({ where: { vehicleId: existing.id } }),
      prisma.alertVehicle.count({ where: { vehicleId: existing.id } }),
      prisma.reminderVehicle.count({ where: { vehicleId: existing.id } }),
      prisma.driver.findUnique({ where: { vehicleId: existing.id }, select: { id: true, name: true } }),
    ])
    const [row] = await prisma.$transaction([
      prisma.vehicle.update({
        where: { id: existing.id },
        data: { bgId: target.id, branchId, groupId: null },
        include: VEHICLE_INCLUDE,
      }),
      prisma.subuserVehicle.deleteMany({ where: { vehicleId: existing.id } }),
      prisma.alertVehicle.deleteMany({ where: { vehicleId: existing.id } }),
      prisma.reminderVehicle.deleteMany({ where: { vehicleId: existing.id } }),
      prisma.driver.updateMany({ where: { vehicleId: existing.id }, data: { vehicleId: null } }),
      prisma.driverAssignment.updateMany({ where: { vehicleId: existing.id, endDate: null }, data: { endDate: new Date() } }),
      prisma.vehicleMove.create({ data: bgMoveRow(existing, fromBg, target, branch?.name, actorOf(req)) }),
    ])
    // Both BGs' fleets changed, so their Flespi ACLs are stale.
    await revokeGrantsForBg(existing.bgId)
    await revokeGrantsForBg(target.id)
    res.json({
      data: row,
      stripped: { subuserAssignments: subusers, alertAssignments: alerts, reminders, driver: driver?.name ?? null },
    })
  })
)

/**
 * Custom fields only. Separate from PUT /:id on purpose: that one also updates
 * the Flespi device, and a note about a contract must not touch the tracker.
 */
router.put(
  '/:id/custom-fields',
  validate(customFieldsSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('vehicle', req.params.id, req.scope)
    const fields = cleanCustomFields(req.body.fields)
    const row = await prisma.vehicle.update({
      where: { id: existing.id },
      data: {
        customFields: fields,
        customFieldsUpdatedAt: new Date(),
        customFieldsUpdatedBy: req.user?.shortName || req.user?.email || null,
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

    // Its tracker comes out in the Reallocation History; the row outlives the vehicle.
    await prisma.$transaction([
      prisma.vehicleMove.create({ data: deviceRow(existing, existing.imei, false, actorOf(req)) }),
      prisma.vehicle.delete({ where: { id: existing.id } }),
    ])
    // Revoked so a token minted before the delete cannot keep reading a device the
    // account is no longer entitled to.
    await revokeGrantsForBg(existing.bgId)
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
