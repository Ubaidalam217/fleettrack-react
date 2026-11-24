/**
 * /api/vehicles — the asset register.
 *
 * `imei` is normalised to digits and globally unique: it is the join key against
 * a Flespi device's configuration.ident, and the same physical tracker registered
 * twice would make "which vehicle is this position for" unanswerable.
 *
 * No telemetry is stored or returned. Position, speed, temperature and ignition
 * all stay in Flespi and are joined client-side on the IMEI.
 *
 * A vehicle may also be shared to other Groups, BGs and Branches
 * (routes/vehicleShares.js). Reads here include vehicles shared into the
 * caller's scope, each with `owned: false`; every write takes the vehicle
 * through the `ownedVehicle` scope, so only its owner's side may change it.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, conflict } from '../lib/http.js'
import { booleanField, imeiField, optionalDate, optionalId, optionalText, requiredId } from '../lib/fields.js'
import { assertCanWrite, assertWritableParent, findScoped, findScopedOrThrow, isSuperAdmin, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'
import { revokeGrantsForBg } from '../lib/flespiGrant.js'
import { actorOf, bgMoveRow, deviceRow, editMoves, renameRow } from '../lib/vehicleMoves.js'
import * as flespi from '../lib/flespi.js'
import { channelAddresses, deviceById, deviceName, deviceTypes, syncVehicleDevice, unregisteredDevices } from '../lib/flespiDevices.js'
import { assertSameBg, mergeInto, mergePlan, planView, removeRow, swapRows } from '../lib/trackers.js'
import { vehicleLabel } from '../lib/vehicleLabel.js'
import { TYPES as ALERT_TYPES } from '../lib/alertEngine.js'
import { applyOdometerReading, deviceOdometers, odometerRow, adjustmentRow } from '../lib/odometer.js'
import { importVehicles, MAX_IMPORT_ROWS } from '../lib/vehicleImport.js'
import { SHARES_INCLUDE, dropSharesForTransfer, stripLostAccess, withShares, withSharesOne } from '../lib/vehicleShares.js'

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
  // A vehicle with no tracker (Remove tracker, 2026-11-17) is edited without
  // one: an omitted or blank IMEI keeps what the vehicle has. Trackers are
  // changed through POST /:id/tracker, which keeps the history and a note.
  imei: z.preprocess(v => (v === '' || v === null ? undefined : v), imeiField().optional()),
})

const listQuerySchema = z.object({
  bgId: z.string().trim().min(1).optional(),
  branchId: z.string().trim().min(1).optional(),
})

/**
 * A vehicle whose data comes from somewhere other than our Flespi account
 * (dataSource 'UFFIZIO', lib/uffizio.js). Its IMEI is the join key with that
 * system, so its tracker is never changed, removed, merged or synced here, and
 * no Flespi device is ever created or renamed for it.
 */
const isExternal = v => !!v?.dataSource && v.dataSource !== 'FLESPI'
const EXTERNAL_TRACKER = 'This vehicle’s data comes from Uffizio: its tracker is kept in step with Uffizio and is not changed in FleetmaxX or Flespi'

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
  // The other places it also shows (VehicleShare). Every response passes the
  // row through withShares(), which adds `owned` and keeps only the shares the
  // caller may know about.
  shares: SHARES_INCLUDE,
}

/**
 * ?bgId= / ?branchId= match a vehicle filed there OR shared there — both are
 * "the vehicles of this BG / branch" to whoever asks.
 */
const inBg = bgId => ({ OR: [{ bgId }, { shares: { some: { bgId } } }] })
const inBranch = branchId => ({ OR: [{ branchId }, { shares: { some: { branchId } } }] })

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId, branchId } = req.validatedQuery
    const rows = await prisma.vehicle.findMany({
      where: scopedWhere(
        'vehicle',
        req.scope,
        bgId ? inBg(bgId) : null,
        branchId ? inBranch(branchId) : null
      ),
      orderBy: [{ plateNo: 'asc' }, { imei: 'asc' }],
      include: VEHICLE_INCLUDE,
    })
    res.json({ data: await withShares(rows, req.scope) })
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
    const vehicles = await prisma.vehicle.findMany({ where: { imei: { not: null } }, select: { id: true, imei: true, flespiDeviceId: true } })
    const rows = await unregisteredDevices(vehicles.map(v => v.imei))
    await recordDeviceIds(vehicles)
    // The vehicle each tracker was last in, from the history, so a tracker taken
    // out of a vehicle reads "was in AD 149" rather than as a stranger.
    const last = rows.length
      ? await prisma.vehicleMove.findMany({
        where: { level: 'device', imei: { in: rows.map(r => r.imei) } },
        orderBy: { movedAt: 'desc' },
        select: { imei: true, vehicleLabel: true, movedAt: true, toName: true },
      })
      : []
    const lastOf = new Map()
    for (const m of last) if (!lastOf.has(m.imei)) lastOf.set(m.imei, m)
    res.json({
      data: rows.map(r => {
        const m = lastOf.get(r.imei)
        return m ? { ...r, lastVehicle: { label: m.vehicleLabel, at: m.movedAt, installed: !!m.toName } } : r
      }),
    })
  })
)

/**
 * Keep Vehicle.flespiDeviceId in step with the device that carries each
 * vehicle's IMEI now (the cached device list; no extra Flespi call). A record
 * only — the IMEI stays the join key — so a tracker later moved in the Flespi
 * panel can still be traced to the device the vehicle used.
 */
async function recordDeviceIds(vehicles) {
  try {
    const byImei = await flespi.deviceMap()
    const stale = vehicles.filter(v => byImei.has(v.imei) && byImei.get(v.imei) !== v.flespiDeviceId)
    for (const v of stale) {
      await prisma.vehicle.update({ where: { id: v.id }, data: { flespiDeviceId: byImei.get(v.imei) } })
    }
  } catch { /* a record only: never fail the list for it */ }
}

const ODOMETER_SELECT = { id: true, imei: true, odometerOffsetKm: true, odometerSetAt: true, odometerSetBy: true }

/**
 * Every visible vehicle's odometer: the tracker's reading, the correction and
 * the vehicle's reading (lib/odometer.js). One fleet telemetry read.
 */
router.get(
  '/odometers',
  asyncHandler(async (req, res) => {
    const vehicles = await prisma.vehicle.findMany({ where: scopedWhere('vehicle', req.scope), select: ODOMETER_SELECT })
    const readings = await deviceOdometers(vehicles)
    res.json({ data: vehicles.map(v => odometerRow(v, readings.get(v.id))) })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('vehicle', req.params.id, req.scope, {
      include: VEHICLE_INCLUDE,
    })
    res.json({ data: await withSharesOne(row, req.scope) })
  })
)

/**
 * Bulk import from the client's Master Data sheet (client, 2026-11-24). The
 * browser sends the rows it read; each is checked again here (lib/vehicleImport.js)
 * and `dryRun` only reports what would happen. An IMEI already on a Flespi device
 * is linked, never duplicated; creating a missing device is opt-in (`createDevices`
 * + `deviceType`) and goes through syncVehicleDevice like POST /api/vehicles.
 */
const importSchema = z.object({
  bgId: requiredId('Business Group'),
  branchId: optionalId(),
  dryRun: booleanField(false),
  createDevices: booleanField(false),
  deviceType: optionalText(120),
  rows: z
    .array(z.object({
      row: z.number().int().min(1),
      raw: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    }))
    .min(1, 'The file has no vehicle rows')
    .max(MAX_IMPORT_ROWS, `Up to ${MAX_IMPORT_ROWS} vehicles at a time`),
})

router.post(
  '/import',
  validate(importSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const bg = await assertWritableParent(req.scope, 'bg', req.body.bgId)
    const branchId = await resolveBranch(req.body.branchId, bg.id)
    if (req.body.createDevices && !req.body.dryRun && !req.body.deviceType) {
      throw badRequest('Choose the device type for the trackers that are not in Flespi yet', { deviceType: 'Choose the device type' })
    }
    const result = await importVehicles({
      scope: req.scope, bg, branchId, rows: req.body.rows, dryRun: req.body.dryRun,
      createDevices: req.body.createDevices, deviceType: req.body.deviceType, by: actorOf(req),
    })
    res.status(result.dryRun ? 200 : 201).json({ data: result })
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
      flespiDeviceId: flespiDevice?.deviceId ?? null,
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
    res.status(201).json({ data: await withSharesOne(row, req.scope), flespi: flespiDevice })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
    const external = isExternal(existing)
    if (external && req.body.imei && req.body.imei !== existing.imei) {
      throw badRequest(EXTERNAL_TRACKER, { imei: 'Kept in step with Uffizio' })
    }
    if (req.body.imei) await assertImeiFree(req.body.imei, existing.id)
    // An Uffizio vehicle has no Flespi device, and none may be made for it.
    const flespiDevice = external ? null : await syncVehicleDevice({
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
    // A new branch or group goes into the Reallocation History with the edit,
    // and so does a new plate or fleet no. (client, 2026-11-17).
    const history = await editMoves(existing, rest, next, actorOf(req))
    const renamed = renameRow(existing, { ...existing, ...rest }, actorOf(req))
    if (renamed) history.unshift(renamed)
    const [row] = await prisma.$transaction([
      prisma.vehicle.update({
        where: { id: existing.id },
        data: { ...rest, ...next, ...(flespiDevice ? { flespiDeviceId: flespiDevice.deviceId } : {}) },
        include: VEHICLE_INCLUDE,
      }),
      prisma.vehicleMove.createMany({ data: history }),
    ])
    // An edit can change the IMEI, which is the Flespi join key, so the ACL's
    // device ids may no longer match.
    await revokeGrantsForBg(existing.bgId)
    res.json({ data: await withSharesOne(row, req.scope), flespi: flespiDevice })
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
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
    const branchId = await resolveBranch(req.body.branchId, existing.bgId)
    const history = await editMoves(existing, {}, { branchId, groupId: existing.groupId }, actorOf(req))
    const [row] = await prisma.$transaction([
      prisma.vehicle.update({ where: { id: existing.id }, data: { branchId }, include: VEHICLE_INCLUDE }),
      prisma.vehicleMove.createMany({ data: history }),
    ])
    // A branch's sub-users gain or lose the vehicle, so their live Flespi
    // tokens are re-issued with the new list.
    await revokeGrantsForBg(existing.bgId)
    res.json({ data: await withSharesOne(row, req.scope) })
  })
)

/**
 * Move one vehicle to another Business Group (client, 2026-11-10: "Reallocation
 * will be from Business Group change"). Not an edit: what the old BG gave the
 * vehicle does not follow it — its sub-users lose it, its alert and reminder
 * rules drop it, its driver is unassigned and any open driver assignment ends.
 * The trips, alerts, expenses and history recorded so far stay with the old BG.
 * The caller must be able to write vehicles in both BGs.
 *
 * Its shares (VehicleShare) into the old BG, the new BG or the new BG's Group
 * go — it leaves the one and lives in the others now; shares to anywhere else
 * stay, and what those places gave it (their sub-users, their alert rules)
 * stays with them.
 */
router.post(
  '/:id/transfer',
  validate(z.object({ bgId: requiredId('Business Group'), branchId: optionalId() })),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
    const target = await assertWritableParent(req.scope, 'bg', req.body.bgId)
    if (target.id === existing.bgId) throw badRequest('The vehicle is already in this Business Group', { bgId: 'Same Business Group' })
    const branchId = await resolveBranch(req.body.branchId, target.id)
    const [fromBg, branch, reminders, driver] = await Promise.all([
      prisma.businessGroup.findUnique({ where: { id: existing.bgId }, select: { id: true, name: true } }),
      branchId ? prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } }) : null,
      prisma.reminderVehicle.count({ where: { vehicleId: existing.id } }),
      prisma.driver.findUnique({ where: { vehicleId: existing.id }, select: { id: true, name: true } }),
    ])
    const by = actorOf(req)
    const { row, lost, sharesRemoved } = await prisma.$transaction(async tx => {
      const moved = await tx.vehicle.update({
        where: { id: existing.id },
        data: { bgId: target.id, branchId, groupId: null },
        select: { id: true, bgId: true, plateNo: true, fleetNo: true, imei: true },
      })
      // Reminder rules are only ever the owner's, and so is the driver.
      await tx.reminderVehicle.deleteMany({ where: { vehicleId: existing.id } })
      await tx.driver.updateMany({ where: { vehicleId: existing.id }, data: { vehicleId: null } })
      await tx.driverAssignment.updateMany({ where: { vehicleId: existing.id, endDate: null }, data: { endDate: new Date() } })
      await tx.vehicleMove.create({ data: bgMoveRow(existing, fromBg, target, branch?.name, by) })
      const removed = await dropSharesForTransfer(tx, moved, existing.bgId, target, by)
      // The old BG (and any place whose share just went) no longer sees it:
      // its sub-users and alert rules lose it. A BG it is still shared into keeps both.
      const stripped = await stripLostAccess(tx, moved)
      const after = await tx.vehicle.findUnique({ where: { id: existing.id }, include: VEHICLE_INCLUDE })
      return { row: after, lost: stripped, sharesRemoved: removed }
    })
    // Both BGs' fleets changed, so their Flespi ACLs are stale.
    await revokeGrantsForBg(existing.bgId)
    await revokeGrantsForBg(target.id)
    res.json({
      data: await withSharesOne(row, req.scope),
      stripped: { ...lost, reminders, driver: driver?.name ?? null, sharesRemoved },
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
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
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
    res.json({ data: await withSharesOne(row, req.scope) })
  })
)

/** How many past adjustments GET /:id/odometer returns, newest first. */
const ADJUSTMENTS_SHOWN = 10

/**
 * One vehicle's odometer for the Vehicle information dialog: the tracker's
 * reading, the correction, the vehicle's reading, and the latest adjustments.
 */
router.get(
  '/:id/odometer',
  asyncHandler(async (req, res) => {
    const existing = await findScopedOrThrow('vehicle', req.params.id, req.scope, { select: ODOMETER_SELECT })
    const [readings, adjustments] = await Promise.all([
      deviceOdometers([existing]),
      prisma.odometerAdjustment.findMany({
        where: { vehicleId: existing.id },
        orderBy: { setAt: 'desc' },
        take: ADJUSTMENTS_SHOWN,
      }),
    ])
    res.json({ data: { ...odometerRow(existing, readings.get(existing.id)), adjustments: adjustments.map(adjustmentRow) } })
  })
)

/**
 * Set the vehicle's odometer (client, 2026-11-12: "Update the ODO meter
 * reading"): `reading` is the vehicle's real odometer now; the correction kept
 * is that minus the tracker's own reading, so the vehicle's odometer keeps
 * counting from it. Nothing is written to Flespi. Reminder cycles that started
 * on the old reading move with it, so "km since the last service" does not jump.
 * Every call is kept in OdometerAdjustment (client, 2026-11-13), whichever
 * screen sent it.
 */
router.put(
  '/:id/odometer',
  validate(z.object({
    reading: z.union([z.number(), z.string()])
      .transform(v => (typeof v === 'number' ? v : Number(String(v).trim() || NaN)))
      .refine(v => Number.isFinite(v) && v >= 0 && v < 10_000_000, 'A reading from 0 to 9,999,999 km'),
    note: optionalText(200),
  })),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
    const reading = (await deviceOdometers([existing])).get(existing.id)
    if (reading?.deviceKm == null) {
      throw badRequest('The tracker has not sent an odometer reading yet, so there is nothing to correct', {
        reading: 'No reading from the tracker yet',
      })
    }
    const row = await applyOdometerReading(existing, {
      readingKm: req.body.reading,
      deviceKm: reading.deviceKm,
      by: req.user?.shortName || req.user?.email || null,
      note: req.body.note,
    })
    res.json({ data: odometerRow(row, reading) })
  })
)

/**
 * Bulk Object Update (Settings › Bulk Action): the fields that do not touch the
 * Flespi device, each only when sent — PUT /:id renames the tracker and needs
 * the whole record, so plate, fleet no, IMEI and device type stay with it.
 */
const detailsSchema = z.object({
  branchId: optionalId(),
  subGroup: optionalText(120),
  make: optionalText(80),
  model: optionalText(80),
  vehicleType: optionalText(60),
  mobileNo: optionalText(40),
  validUntil: optionalDate(),
})
// The schema fills a missing field with null, so the keys actually sent are
// noted first and only those are written.
const noteSentKeys = (req, _res, next) => { req.sentKeys = new Set(Object.keys(req.body ?? {})); next() }


// ── Alerts switched off for one vehicle (client, 2026-11-21) ──
//
// "Battery tamper" while a tanker is refilled, or a driver rests with the battery
// off, is no tamper: the client switches that type off for the vehicle, and the
// alert engine raises none of it. Own endpoint, so nothing goes to Flespi.

const mutedAlertsSchema = z.object({ types: z.array(z.string().max(60)).max(60) })
const mutableTypes = () => Object.entries(ALERT_TYPES).map(([key, t]) => ({ key, label: t.label }))

router.get(
  '/:id/muted-alerts',
  asyncHandler(async (req, res) => {
    const v = await findScopedOrThrow('vehicle', req.params.id, req.scope, { select: { id: true, mutedAlerts: true } })
    res.json({ data: { muted: v.mutedAlerts ?? [], types: mutableTypes() } })
  })
)

router.put(
  '/:id/muted-alerts',
  validate(mutedAlertsSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const v = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope, { select: { id: true } })
    const types = [...new Set(req.body.types)]
    const bad = types.filter(t => !(t in ALERT_TYPES))
    if (bad.length) throw badRequest(`Unknown alert type: ${bad.join(', ')}`)
    const row = await prisma.vehicle.update({ where: { id: v.id }, data: { mutedAlerts: types }, select: { mutedAlerts: true } })
    res.json({ data: { muted: row.mutedAlerts, types: mutableTypes() } })
  })
)

router.patch(
  '/:id/details',
  noteSentKeys,
  validate(detailsSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => req.sentKeys.has(k)))
    let history = []
    if ('branchId' in data) {
      data.branchId = await resolveBranch(data.branchId, existing.bgId)
      history = await editMoves(existing, {}, { branchId: data.branchId, groupId: existing.groupId }, actorOf(req))
    }
    const [row] = await prisma.$transaction([
      prisma.vehicle.update({ where: { id: existing.id }, data, include: VEHICLE_INCLUDE }),
      prisma.vehicleMove.createMany({ data: history }),
    ])
    // A branch's sub-users gain or lose the vehicle, as with PUT /:id/branch.
    if (history.length) await revokeGrantsForBg(existing.bgId)
    res.json({ data: await withSharesOne(row, req.scope) })
  })
)

// ── Trackers: changed here, never in the Flespi panel (client, 2026-11-17) ──
//
// lib/trackers.js says what each one does on the Flespi side and in our
// database. Every one writes a history row (Reallocation History) with the
// user's note, and drops the BG's live Flespi grants, whose device list changed.

const noteField = optionalText(300)

/**
 * How the vehicle's tracker stands against Flespi, for the tracker dialog:
 *   state 'ok'       its IMEI is on a Flespi device (device = that device)
 *         'missing'  no Flespi device has its IMEI
 *         'none'     the vehicle has no tracker
 *         'unknown'  Flespi is not set up on this server
 * and, when it is not 'ok' and the device it last used is known, what that
 * device carries now (suggestion): another vehicle's tracker → merge into it;
 * a tracker nobody registered → link to it. GETs only.
 */
router.get(
  '/:id/tracker-status',
  asyncHandler(async (req, res) => {
    const v = await findScopedOrThrow('vehicle', req.params.id, req.scope)
    const out = { imei: v.imei ?? null, flespiDeviceId: v.flespiDeviceId ?? null, state: v.imei ? 'missing' : 'none', device: null, suggestion: null }
    // Not a Flespi tracker at all: never "missing" from Flespi.
    if (isExternal(v)) {
      res.json({ data: { ...out, state: 'external', source: v.dataSource } })
      return
    }
    if (!flespi.isConfigured()) {
      res.json({ data: { ...out, state: v.imei ? 'unknown' : 'none' } })
      return
    }
    const byImei = await flespi.deviceMap()
    const id = v.imei ? byImei.get(v.imei) : undefined
    if (id) {
      out.state = 'ok'
      out.device = await deviceById(id)
    } else if (v.flespiDeviceId) {
      const was = await deviceById(v.flespiDeviceId).catch(() => null)
      if (was?.imei && was.imei !== v.imei) {
        const owner = await prisma.vehicle.findUnique({ where: { imei: was.imei }, select: { id: true } })
        const seen = owner ? await findScoped('vehicle', owner.id, req.scope, { select: { id: true, plateNo: true, fleetNo: true, imei: true } }) : null
        out.suggestion = owner
          ? { kind: 'merge', deviceId: was.deviceId, imei: was.imei, target: seen ? { id: seen.id, label: vehicleLabel(seen) } : null }
          : { kind: 'link', deviceId: was.deviceId, imei: was.imei, name: was.name, deviceType: was.deviceType }
      }
    }
    res.json({ data: out })
  })
)

/**
 * Change tracker: the vehicle gets another IMEI and keeps everything else.
 * `imei` is an unregistered tracker already in Flespi, or a new one (then
 * `deviceType` is needed whenever Flespi has no device for it).
 */
router.post(
  '/:id/tracker',
  validate(z.object({ imei: imeiField(), deviceType: optionalText(120), note: noteField })),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
    if (isExternal(existing)) throw badRequest(EXTERNAL_TRACKER)
    const { imei, note } = req.body
    if (imei === existing.imei) throw badRequest('This is already the vehicle’s tracker', { imei: 'Same IMEI' })
    await assertImeiFree(imei)
    // A tracker already in Flespi keeps its own device type, whatever was
    // typed; a tracker new to Flespi needs one, to re-type the vehicle's device
    // (another model) or to create one.
    // (The device's type is never sent for it: a type outside our channels'
    // list, such as an iTriangle's, must not be overwritten with a guess.)
    let deviceType = req.body.deviceType ?? existing.deviceType
    let alreadyInFlespi = false
    if (flespi.isConfigured()) {
      const onDevice = (await flespi.deviceMap({ force: true })).get(imei)
      if (onDevice) {
        alreadyInFlespi = true
        deviceType = (await deviceById(onDevice))?.deviceType || req.body.deviceType || null
      } else if (!req.body.deviceType) {
        throw badRequest('Choose the new tracker’s device type so Flespi can read it', { deviceType: 'Choose the device type' })
      }
    }
    // Flespi first, so a refused tracker changes nothing here.
    const flespiDevice = await syncVehicleDevice({
      imei, oldImei: existing.imei, name: deviceName(existing), deviceType: alreadyInFlespi ? null : deviceType, requireType: true,
    })
    const by = actorOf(req)
    const [row] = await prisma.$transaction([
      prisma.vehicle.update({
        where: { id: existing.id },
        data: { imei, deviceType, flespiDeviceId: flespiDevice?.deviceId ?? null },
        include: VEHICLE_INCLUDE,
      }),
      prisma.vehicleMove.createMany({ data: swapRows(existing, { ...existing, imei }, by, note) }),
    ])
    await revokeGrantsForBg(existing.bgId)
    res.json({ data: await withSharesOne(row, req.scope), flespi: flespiDevice })
  })
)

/**
 * Remove tracker: the vehicle stays, with no tracker and its history. Flespi
 * is not touched — the device keeps its IMEI and messages and, if it is still
 * there, shows as an unregistered tracker that can go into another vehicle.
 */
router.post(
  '/:id/tracker/remove',
  validate(z.object({ note: noteField })),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
    if (isExternal(existing)) throw badRequest(EXTERNAL_TRACKER)
    if (!existing.imei) throw badRequest('This vehicle has no tracker')
    const [row] = await prisma.$transaction([
      prisma.vehicle.update({ where: { id: existing.id }, data: { imei: null, flespiDeviceId: null }, include: VEHICLE_INCLUDE }),
      prisma.vehicleMove.create({ data: removeRow(existing, actorOf(req), req.body.note) }),
    ])
    await revokeGrantsForBg(existing.bgId)
    res.json({ data: await withSharesOne(row, req.scope) })
  })
)

/**
 * Put the vehicle's number on its Flespi device again ("Flespi name differs"):
 * the same rename every vehicle save makes. Only the name; the IMEI and the
 * device type stay.
 */
router.post(
  '/:id/tracker/sync',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
    if (isExternal(existing)) throw badRequest(EXTERNAL_TRACKER)
    if (!existing.imei) throw badRequest('This vehicle has no tracker')
    if (!flespi.isConfigured()) throw badRequest('Flespi is not set up on this server')
    const byImei = await flespi.deviceMap({ force: true })
    if (!byImei.has(existing.imei)) throw badRequest('No Flespi device has this IMEI — change the tracker instead')
    const flespiDevice = await syncVehicleDevice({ imei: existing.imei, name: deviceName(existing) })
    await prisma.vehicle.update({ where: { id: existing.id }, data: { flespiDeviceId: flespiDevice?.deviceId ?? null } })
    res.json({ data: { flespi: flespiDevice } })
  })
)

/**
 * Merge this vehicle into `targetId`, the vehicle that has its tracker now
 * (lib/trackers.js): history, drivers, papers, expenses, reminders, shares
 * and memberships move over, and this one is archived. `dryRun` answers what
 * would move without changing anything. Same Business Group only.
 */
router.post(
  '/:id/merge',
  validate(z.object({
    targetId: requiredId('Vehicle'),
    note: noteField,
    dryRun: z.boolean().default(false),
    // The target keeps its number and takes this vehicle's tracker: "AD 149
    // stays, the tracker registered as iTriangle is its tracker now".
    takeTracker: z.boolean().default(false),
  })),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const source = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)
    const target = await findScopedOrThrow('ownedVehicle', req.body.targetId, req.scope)
    if (isExternal(source) || isExternal(target)) throw badRequest('Uffizio vehicles are kept in step with Uffizio and cannot be merged')
    const bg = source.bgId !== target.bgId
      ? await prisma.businessGroup.findUnique({ where: { id: target.bgId }, select: { name: true } })
      : null
    assertSameBg(source, target, bg?.name)
    const takeTracker = req.body.takeTracker && !!source.imei
    const plan = await mergePlan(source, target, { takeTracker })
    const view = { source: { id: source.id, label: vehicleLabel(source) }, target: { id: target.id, label: vehicleLabel(target) }, plan: planView(plan) }
    if (req.body.dryRun) {
      res.json({ data: view })
      return
    }
    // The tracker's Flespi device takes the name of the vehicle it is in now.
    const flespiDevice = takeTracker ? await syncVehicleDevice({ imei: source.imei, name: deviceName(target) }) : null
    await prisma.$transaction(tx => mergeInto(tx, source, target, plan, actorOf(req), req.body.note, { flespiDeviceId: flespiDevice?.deviceId ?? source.flespiDeviceId ?? null }))
    await revokeGrantsForBg(source.bgId)
    const row = await prisma.vehicle.findUnique({ where: { id: target.id }, include: VEHICLE_INCLUDE })
    res.json({ data: await withSharesOne(row, req.scope), merge: view })
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
    const existing = await findScopedOrThrow('ownedVehicle', req.params.id, req.scope)

    const [subusers, alerts] = await Promise.all([
      prisma.subuserVehicle.count({ where: { vehicleId: existing.id } }),
      prisma.alertVehicle.count({ where: { vehicleId: existing.id } }),
    ])

    // Its tracker comes out in the Reallocation History; the row outlives the vehicle.
    await prisma.$transaction([
      ...(existing.imei ? [prisma.vehicleMove.create({ data: deviceRow(existing, existing.imei, false, actorOf(req)) })] : []),
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
