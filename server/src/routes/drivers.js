/**
 * /api/drivers — a BG's drivers, each optionally assigned to one of its vehicles.
 *
 * A vehicle has at most one driver (Driver.vehicleId is unique). Assigning a
 * vehicle that already has a driver MOVES it: the other driver is unassigned in
 * the same transaction, which is what an operator handing a truck to someone else
 * means, and the answer names who lost it so the form can say so.
 *
 * History is kept (client, 2026-11-13: "All the drivers names will stay as it
 * is"): every change of vehicle opens / closes a DriverAssignment row, every
 * change of tag a DriverTagHistory row, and removing a driver who has any
 * history archives it (deletedAt) instead of deleting it. GET /history hands
 * the reports all three, so a past trip shows who drove it then.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { Prisma } from '@prisma/client'
import { buildAcl } from '../lib/flespiGrant.js'
import * as flespi from '../lib/flespi.js'
import { ibuttonKey } from '../lib/alertEngine.js'
import { randomBytes } from 'node:crypto'
import { asyncHandler, badRequest, conflict, HttpError, notFound } from '../lib/http.js'
import { fromBase64, sniffDocument, sniffImage } from '../lib/files.js'
import { booleanField, optionalDate, optionalEmail, optionalId, optionalText, requiredId, requiredText } from '../lib/fields.js'
import { assertCanWrite, assertWritableParent, findScopedOrThrow, isSubUser, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'
import { assignmentSpan } from '../../../src/utils/driverHistory.js'

const router = Router()

/**
 * An iButton code as typed or copied: spaces, colons and dashes dropped,
 * upper-cased — the form the tracker reports in `ibutton.code`. An all-zero
 * code is what a reader sends with no tag in it, so it cannot belong to anyone.
 */
const ibuttonField = () =>
  z
    .union([z.string(), z.null()])
    .default(null)
    .transform(v => {
      const s = String(v ?? '').replace(/[\s:-]/g, '').toUpperCase()
      return s === '' ? null : s
    })
    .refine(v => v === null || /^[0-9A-F]{4,32}$/.test(v), 'Use the code as the tracker shows it, e.g. 94000001D9DF0801')
    .refine(v => v === null || !/^0+$/.test(v), 'An all-zero code means no tag is inserted')

/**
 * Departments are a fixed list (client, 2026-11-06), the same one the Driver
 * form offers (src/pages/settings/mockData.js DRIVER_DEPARTMENTS).
 */
export const DEPARTMENTS = ['Operations', 'Logistics', 'Delivery', 'Transport', 'Sales', 'Maintenance', 'Administration', 'Security', 'Other']

/** "Tag Via" in the reference: how the driver is identified on the tracker. */
export const TAG_TYPES = ['iButton', 'RFID', 'Beacon']
const listField = list => z.union([z.enum(list), z.literal(''), z.null()]).default(null).transform(v => v || null)

const driverFields = {
  name: requiredText('Name', 120),
  ibuttonCode: ibuttonField(),
  mobile: optionalText(30),
  email: optionalEmail(),
  nationality: optionalText(60),
  dateOfBirth: optionalDate(),
  employeeId: optionalText(60),
  department: z.union([z.enum(DEPARTMENTS), z.literal(''), z.null()]).default(null).transform(v => v || null),
  joiningDate: optionalDate(),
  licenseNo: optionalText(60),
  // One or more classes, comma separated ("Light Vehicle, Heavy Vehicle").
  licenseCategory: optionalText(300),
  licenseIssueDate: optionalDate(),
  licenseExpiry: optionalDate(),
  licenseCountry: optionalText(60),
  visaExpiry: optionalDate(),
  emiratesId: optionalText(30),
  emiratesIdExpiry: optionalDate(),
  medicalExpiry: optionalDate(),
  vehicleId: optionalId(),
  notes: optionalText(1000),
  // Drivers alone may be Suspended (kept on file, off duty).
  status: z.enum(['Active', 'Inactive', 'Suspended']).default('Active'),
  contactNumber2: optionalText(30),
  country: optionalText(60),
  state: optionalText(60),
  city: optionalText(60),
  zipCode: optionalText(20),
  street1: optionalText(200),
  street2: optionalText(200),
  tagType: listField(TAG_TYPES),
  leavingDate: optionalDate(),
  retirementDate: optionalDate(),
  drivingSince: optionalDate(),
  licenseAvailable: booleanField(true),
  lifeInsuranceNo: optionalText(60),
  lifeInsuranceExpiry: optionalDate(),
  mediclaimNo: optionalText(60),
  mediclaimExpiry: optionalDate(),
}

const DATE_FIELDS = [
  'dateOfBirth', 'joiningDate', 'licenseIssueDate', 'licenseExpiry', 'visaExpiry', 'emiratesIdExpiry', 'medicalExpiry',
  'leavingDate', 'retirementDate', 'drivingSince', 'lifeInsuranceExpiry', 'mediclaimExpiry',
]

const createSchema = z.object({ bgId: requiredId('Business Group'), ...driverFields })
const updateSchema = z.object(driverFields)
const listQuery = z.object({
  bgId: z.string().trim().min(1).optional(),
  // "1": the removed drivers instead (Settings › Driver, "Show removed drivers").
  removed: z.enum(['0', '1']).optional(),
})

const INCLUDE = {
  bg: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNo: true, fleetNo: true, imei: true } },
}

/** The API's date form: "YYYY-MM-DD", the same thing the form sends. */
function publicDriver(d) {
  if (!d) return null
  const out = { ...d }
  for (const k of DATE_FIELDS) out[k] = d[k] ? d[k].toISOString().slice(0, 10) : null
  return out
}

/**
 * A Suspended driver is off duty (client, 2026-11-06): no vehicle may be
 * assigned to them. Blocking their iButton on the tracker itself comes with
 * the device-settings editor.
 */
function assertAssignable(body) {
  if (body.status === 'Suspended' && body.vehicleId) {
    throw badRequest('A suspended driver cannot be assigned a vehicle', { vehicleId: 'Not for a suspended driver' })
  }
}

/**
 * Keep the Primary assignment history in step with Driver.vehicleId, inside
 * the save's transaction: the driver's open Primary row closes when the
 * vehicle changes, a new one opens for the new vehicle, and the driver the
 * vehicle was taken from has theirs closed.
 */
async function syncPrimary(tx, driverId, vehicleId, previous) {
  const now = new Date()
  await tx.driverAssignment.updateMany({
    where: { driverId, role: 'Primary', endDate: null, ...(vehicleId ? { NOT: { vehicleId } } : {}) },
    data: { endDate: now },
  })
  if (previous && vehicleId) {
    await tx.driverAssignment.updateMany({ where: { driverId: previous.id, vehicleId, role: 'Primary', endDate: null }, data: { endDate: now } })
  }
  if (vehicleId) {
    const open = await tx.driverAssignment.findFirst({ where: { driverId, vehicleId, role: 'Primary', endDate: null }, select: { id: true } })
    if (!open) await tx.driverAssignment.create({ data: { driverId, vehicleId, role: 'Primary', startDate: now } })
  }
}

/**
 * Keep the tag history in step with Driver.ibuttonCode, inside the save's
 * transaction: the driver's open row for another code closes, and a row opens
 * for the new one. A code no driver ever held before starts "since always"
 * (null): registering an Unregistered Driver ID names the trips already read
 * with it. A code someone held before starts now, so their trips keep their
 * name. Any other open row on the code closes too (the unique index means it
 * can only be stale).
 */
export async function syncTag(tx, driverId, code, now = new Date()) {
  await tx.driverTagHistory.updateMany({
    where: { driverId, endDate: null, ...(code ? { NOT: { code } } : {}) },
    data: { endDate: now },
  })
  if (!code) return
  await tx.driverTagHistory.updateMany({ where: { code, endDate: null, NOT: { driverId } }, data: { endDate: now } })
  const open = await tx.driverTagHistory.findFirst({ where: { driverId, code, endDate: null }, select: { id: true } })
  if (open) return
  const known = await tx.driverTagHistory.count({ where: { code } })
  await tx.driverTagHistory.create({ data: { driverId, code, startDate: known ? now : null } })
}

/** 409 for a write to a removed driver: it stays on file for history only. */
function assertLive(driver) {
  if (driver.deletedAt) throw conflict('This driver was removed. Restore it first to change it.')
}

/** The driver by id in the caller's scope, refused when removed. */
async function findLive(id, scope) {
  const driver = await findScopedOrThrow('driver', id, scope)
  assertLive(driver)
  return driver
}

const actorOf = req => req.user?.shortName || req.user?.email || null

/** 409 when another driver already holds this tag (the unique index is the backstop). */
async function assertIbuttonFree(code, exceptId = null) {
  if (!code) return
  const clash = await prisma.driver.findFirst({ where: { ibuttonCode: code, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } })
  if (clash) throw conflict('That iButton code is already assigned to another driver', { ibuttonCode: 'Already in use' })
}

/** The vehicle, confirmed to be in the driver's own BG; returns who drove it before. */
async function resolveVehicle(bgId, vehicleId, driverId) {
  if (!vehicleId) return { previous: null }
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, bgId }, select: { id: true } })
  if (!vehicle) {
    throw badRequest('The vehicle must belong to the driver’s own business group', { vehicleId: 'Not in this business group' })
  }
  const previous = await prisma.driver.findFirst({
    where: { vehicleId, ...(driverId ? { NOT: { id: driverId } } : {}) },
    select: { id: true, name: true },
  })
  return { previous }
}

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId, removed } = req.validatedQuery
    // Removed drivers are kept for history only: not in the list, the pickers or the counts.
    const rows = await prisma.driver.findMany({
      where: scopedWhere('driver', req.scope, bgId ? { bgId } : null, { deletedAt: removed === '1' ? { not: null } : null }),
      orderBy: { name: 'asc' },
      include: INCLUDE,
    })
    res.json({ data: rows.map(publicDriver) })
  })
)

/**
 * Who drove which vehicle when, for the reports (src/utils/driverHistory.js):
 * the assignment rows of every vehicle the caller can see, the tag rows of its
 * drivers, and the drivers those rows name — removed ones included, so their
 * trips keep their name. ?from=&to= (ISO) narrows to rows overlapping the
 * period; without them, everything. Before `/:id`.
 */
const isoMoment = () => z.string().trim().refine(v => Number.isFinite(Date.parse(v)), 'Use an ISO date and time').optional()
const historyQuery = z.object({ from: isoMoment(), to: isoMoment() })

router.get(
  '/history',
  validate(historyQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to } = req.validatedQuery
    // Rows overlapping the period. A Temporary row's end is a calendar day, so
    // a day of slack keeps one that ends on `from`; a tag row may have no start.
    const endsAfter = from ? [{ OR: [{ endDate: null }, { endDate: { gte: new Date(Date.parse(from) - 86_400_000) } }] }] : []
    const assignmentOverlap = [...(to ? [{ startDate: { lte: new Date(to) } }] : []), ...endsAfter]
    const tagOverlap = [...(to ? [{ OR: [{ startDate: null }, { startDate: { lte: new Date(to) } }] }] : []), ...endsAfter]
    const vehicleIds = (await prisma.vehicle.findMany({ where: scopedWhere('vehicle', req.scope), select: { id: true } })).map(v => v.id)
    // The drivers of the caller's BGs, removed or not, whichever vehicle they hold now.
    const ofBgs = scopedWhere('driverHistory', req.scope)
    const assignments = await prisma.driverAssignment.findMany({
      where: { AND: [{ vehicleId: { in: vehicleIds } }, { driver: ofBgs }, ...assignmentOverlap] },
      select: { id: true, driverId: true, vehicleId: true, role: true, startDate: true, endDate: true },
      orderBy: { startDate: 'asc' },
    })
    // A sub-user sees the tags of the drivers it can see and of those who drove its vehicles.
    const tagOwners = isSubUser(req.scope)
      ? { driverId: { in: [...new Set([
        ...assignments.map(a => a.driverId),
        ...(await prisma.driver.findMany({ where: scopedWhere('driver', req.scope), select: { id: true } })).map(d => d.id),
      ])] } }
      : { driver: ofBgs }
    const tags = await prisma.driverTagHistory.findMany({
      where: { AND: [tagOwners, ...tagOverlap] },
      select: { id: true, driverId: true, code: true, startDate: true, endDate: true },
      orderBy: { startDate: 'asc' },
    })
    const ids = [...new Set([...assignments.map(a => a.driverId), ...tags.map(t => t.driverId)])]
    const drivers = ids.length
      ? await prisma.driver.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, driverNo: true, employeeId: true, bgId: true, deletedAt: true },
      })
      : []
    res.json({
      data: {
        drivers: drivers.map(d => ({ ...d, removed: !!d.deletedAt })),
        assignments,
        tags,
      },
    })
  })
)

/**
 * Driver IDs (iButton tags) the caller's trackers have read lately that no
 * driver holds (client, 2026-11-09: "all unregistered driver IDs show in the
 * Driver menu, so we can select that"). From our own telemetry history:
 * each tag with the vehicle that read it last, when, and how many messages
 * carried it. Before `/:id`, which would otherwise take the path.
 */
export const UNREGISTERED_DAYS = 30

router.get(
  '/unregistered-ids',
  asyncHandler(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || UNREGISTERED_DAYS))
    const since = Math.floor(Date.now() / 1000) - days * 86_400
    let { deviceIds } = await buildAcl(req.scope)
    // Every device rather than "all": the history is keyed by device, so a
    // per-device range is an index scan where an open one is the whole table.
    if (deviceIds === null) deviceIds = flespi.isConfigured() ? await flespi.allDeviceIds() : []
    if (!deviceIds.length) { res.json({ data: [] }); return }

    const rows = await prisma.$queryRaw`
      SELECT extra->>'ibutton.code' AS code, "deviceId", max(ts)::int AS last, count(*)::int AS reads
      FROM "TelemetryMessage"
      WHERE "deviceId" IN (${Prisma.join(deviceIds)}) AND ts >= ${since} AND extra->>'ibutton.code' IS NOT NULL
      GROUP BY 1, 2`

    // A removed driver's tag was freed with it, so a read of it is unregistered again.
    const held = new Set((await prisma.driver.findMany({ where: { ibuttonCode: { not: null }, deletedAt: null }, select: { ibuttonCode: true } }))
      .map(d => ibuttonKey(d.ibuttonCode)))
    const byCode = new Map()
    for (const r of rows) {
      const code = ibuttonKey(r.code)
      if (!code || held.has(code)) continue
      const hit = byCode.get(code)
      if (!hit) byCode.set(code, { code, lastSeen: r.last, reads: r.reads, deviceId: r.deviceId })
      else {
        hit.reads += r.reads
        if (r.last > hit.lastSeen) { hit.lastSeen = r.last; hit.deviceId = r.deviceId }
      }
    }
    const list = [...byCode.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 200)

    // The vehicle each tag was last read in, through the tracker's IMEI.
    const imeiOf = new Map()
    try {
      for (const [imei, id] of await flespi.deviceMap()) imeiOf.set(id, imei)
    } catch { /* Flespi unreachable: the list still has the device ids */ }
    const imeis = [...new Set(list.map(u => imeiOf.get(u.deviceId)).filter(Boolean))]
    const vehicles = imeis.length
      ? await prisma.vehicle.findMany({
        where: scopedWhere('vehicle', req.scope, { imei: { in: imeis } }),
        select: { id: true, imei: true, plateNo: true, fleetNo: true, bgId: true, bg: { select: { name: true } } },
      })
      : []
    const byImei = new Map(vehicles.map(v => [v.imei, v]))
    res.json({
      data: list.map(u => {
        const v = byImei.get(imeiOf.get(u.deviceId))
        return { ...u, vehicle: v ? { id: v.id, plateNo: v.plateNo, fleetNo: v.fleetNo, bgId: v.bgId, bgName: v.bg?.name ?? '' } : null }
      }),
    })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('driver', req.params.id, req.scope, { include: INCLUDE })
    res.json({ data: publicDriver(row) })
  })
)

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const bg = await assertWritableParent(req.scope, 'bg', req.body.bgId)
    await assertIbuttonFree(req.body.ibuttonCode)
    assertAssignable(req.body)
    const { previous } = await resolveVehicle(bg.id, req.body.vehicleId, null)
    const { bgId: _ignored, ...fields } = req.body
    const row = await prisma.$transaction(async tx => {
      if (previous) await tx.driver.update({ where: { id: previous.id }, data: { vehicleId: null } })
      const created = await tx.driver.create({ data: { ...fields, bgId: bg.id }, include: INCLUDE })
      await syncPrimary(tx, created.id, created.vehicleId, previous)
      await syncTag(tx, created.id, created.ibuttonCode)
      return created
    })
    res.status(201).json({ data: publicDriver(row), movedFrom: previous })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const existing = await findLive(req.params.id, req.scope)
    await assertIbuttonFree(req.body.ibuttonCode, existing.id)
    assertAssignable(req.body)
    const { previous } = await resolveVehicle(existing.bgId, req.body.vehicleId, existing.id)
    const row = await prisma.$transaction(async tx => {
      if (previous) await tx.driver.update({ where: { id: previous.id }, data: { vehicleId: null } })
      const updated = await tx.driver.update({ where: { id: existing.id }, data: req.body, include: INCLUDE })
      await syncPrimary(tx, existing.id, updated.vehicleId, previous)
      await syncTag(tx, existing.id, updated.ibuttonCode)
      return updated
    })
    res.json({ data: publicDriver(row), movedFrom: previous })
  })
)

/**
 * Remove a driver (client, 2026-11-13: "All the drivers names will stay as it
 * is"). One who ever held a vehicle or a tag, or has alerts or incidents on
 * record, is archived: its open assignments and tag end now, the vehicle and
 * the tag are freed for someone else, and the row stays so every trip it drove
 * keeps its name. One with no history at all (added by mistake, say) is
 * deleted with its photo, documents and leave.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const existing = await findScopedOrThrow('driver', req.params.id, req.scope)
    if (existing.deletedAt) { res.json({ data: { id: existing.id, removed: 'archived' } }); return }

    const [assignments, tags, events, incidents] = await Promise.all([
      prisma.driverAssignment.count({ where: { driverId: existing.id } }),
      prisma.driverTagHistory.count({ where: { driverId: existing.id } }),
      prisma.alertEvent.count({ where: { driverId: existing.id } }),
      prisma.driverIncident.count({ where: { driverId: existing.id } }),
    ])
    if (!assignments && !tags && !events && !incidents && !existing.vehicleId && !existing.ibuttonCode) {
      await prisma.driver.delete({ where: { id: existing.id } })
      res.json({ data: { id: existing.id, removed: 'deleted' } })
      return
    }

    const now = new Date()
    const nowSec = Math.floor(now.getTime() / 1000)
    const temporary = await prisma.driverAssignment.findMany({ where: { driverId: existing.id, role: 'Temporary' } })
    const span = a => assignmentSpan(a)
    await prisma.$transaction(async tx => {
      await tx.driverAssignment.updateMany({ where: { driverId: existing.id, role: 'Primary', endDate: null }, data: { endDate: now } })
      // Cover that had not begun never happened; cover still running ends now.
      const unstarted = temporary.filter(a => span(a).from > nowSec).map(a => a.id)
      const running = temporary.filter(a => span(a).from <= nowSec && span(a).to > nowSec).map(a => a.id)
      if (unstarted.length) await tx.driverAssignment.deleteMany({ where: { id: { in: unstarted } } })
      if (running.length) await tx.driverAssignment.updateMany({ where: { id: { in: running } }, data: { endDate: now } })
      await syncTag(tx, existing.id, null, now)
      await tx.driver.update({
        where: { id: existing.id },
        data: { deletedAt: now, deletedBy: actorOf(req), vehicleId: null, ibuttonCode: null },
      })
    })
    res.json({ data: { id: existing.id, removed: 'archived' } })
  })
)

/** Bring a removed driver back to the list — without its old vehicle or tag, which may be someone else's now. */
router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const existing = await findScopedOrThrow('driver', req.params.id, req.scope)
    const row = await prisma.driver.update({ where: { id: existing.id }, data: { deletedAt: null, deletedBy: null }, include: INCLUDE })
    res.json({ data: publicDriver(row) })
  })
)

// ── Assignment history (phase 2) ────────────────────────────────────────────
// GET the driver's rows; POST a dated Temporary assignment; PUT ends one;
// DELETE removes a Temporary row. Primary rows follow the Vehicle field.

const ROLES_ASSIGN = ['Primary', 'Temporary']
const assignmentSchema = z.object({
  vehicleId: requiredId('Vehicle'),
  startDate: optionalDate().refine(v => v !== null, 'Start date is required'),
  endDate: optionalDate(),
  notes: optionalText(300),
})
const endSchema = z.object({ endDate: optionalDate().refine(v => v !== null, 'End date is required') })
const ASSIGN_INCLUDE = { vehicle: { select: { id: true, plateNo: true, fleetNo: true, imei: true } } }
const day = d => (d ? d.toISOString().slice(0, 10) : null)
const publicAssignment = a => ({ ...a, startDate: day(a.startDate), endDate: day(a.endDate) })

router.get(
  '/:id/assignments',
  asyncHandler(async (req, res) => {
    const driver = await findScopedOrThrow('driver', req.params.id, req.scope)
    const rows = await prisma.driverAssignment.findMany({ where: { driverId: driver.id }, include: ASSIGN_INCLUDE, orderBy: { startDate: 'desc' } })
    res.json({ data: rows.map(publicAssignment) })
  })
)

router.post(
  '/:id/assignments',
  validate(assignmentSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const driver = await findLive(req.params.id, req.scope)
    if (driver.status === 'Suspended') throw badRequest('A suspended driver cannot be given a vehicle', { vehicleId: 'Not for a suspended driver' })
    const vehicle = await prisma.vehicle.findFirst({ where: { id: req.body.vehicleId, bgId: driver.bgId }, select: { id: true } })
    if (!vehicle) throw badRequest('The vehicle must belong to the driver’s own business group', { vehicleId: 'Not in this business group' })
    const { startDate, endDate, notes } = req.body
    if (endDate && endDate < startDate) throw badRequest('The end date is before the start date', { endDate: 'Before the start' })
    const row = await prisma.driverAssignment.create({
      data: { driverId: driver.id, vehicleId: vehicle.id, role: 'Temporary', startDate, endDate, notes },
      include: ASSIGN_INCLUDE,
    })
    res.status(201).json({ data: publicAssignment(row) })
  })
)

router.put(
  '/:id/assignments/:aid',
  validate(endSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const driver = await findLive(req.params.id, req.scope)
    // Primary rows follow the Vehicle field: ending one here would leave the
    // driver holding a vehicle the history says they gave up.
    const a = await prisma.driverAssignment.findFirst({ where: { id: req.params.aid, driverId: driver.id, role: 'Temporary' } })
    if (!a) throw notFound('Temporary assignment')
    if (req.body.endDate < a.startDate) throw badRequest('The end date is before the start date', { endDate: 'Before the start' })
    const row = await prisma.driverAssignment.update({ where: { id: a.id }, data: { endDate: req.body.endDate }, include: ASSIGN_INCLUDE })
    res.json({ data: publicAssignment(row) })
  })
)

router.delete(
  '/:id/assignments/:aid',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const driver = await findLive(req.params.id, req.scope)
    const { count } = await prisma.driverAssignment.deleteMany({ where: { id: req.params.aid, driverId: driver.id, role: 'Temporary' } })
    if (!count) throw notFound('Temporary assignment')
    res.json({ data: { id: req.params.aid } })
  })
)

// ── Incidents (phase 3) ─────────────────────────────────────────────────────

export const INCIDENT_TYPES = ['Accident', 'Incident', 'Traffic Fine', 'Complaint', 'Damage', 'Other']
const incidentSchema = z.object({
  date: optionalDate().refine(v => v !== null, 'Date is required'),
  type: z.enum(INCIDENT_TYPES),
  vehicleId: optionalId(),
  description: optionalText(1000),
  cost: z.union([z.number(), z.string(), z.null()]).default(null)
    .transform(v => (v === null || v === '' ? null : Number(v)))
    .refine(v => v === null || (Number.isFinite(v) && v >= 0), 'Must be a number'),
})
const publicIncident = i => ({ ...i, date: day(i.date) })

router.get(
  '/:id/incidents',
  asyncHandler(async (req, res) => {
    const driver = await findScopedOrThrow('driver', req.params.id, req.scope)
    const rows = await prisma.driverIncident.findMany({ where: { driverId: driver.id }, include: ASSIGN_INCLUDE, orderBy: { date: 'desc' } })
    res.json({ data: rows.map(publicIncident) })
  })
)

router.post(
  '/:id/incidents',
  validate(incidentSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const driver = await findLive(req.params.id, req.scope)
    if (req.body.vehicleId) {
      const v = await prisma.vehicle.findFirst({ where: { id: req.body.vehicleId, bgId: driver.bgId }, select: { id: true } })
      if (!v) throw badRequest('The vehicle must belong to the driver’s own business group', { vehicleId: 'Not in this business group' })
    }
    const row = await prisma.driverIncident.create({ data: { ...req.body, driverId: driver.id }, include: ASSIGN_INCLUDE })
    res.status(201).json({ data: publicIncident(row) })
  })
)

router.delete(
  '/:id/incidents/:iid',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const driver = await findLive(req.params.id, req.scope)
    const { count } = await prisma.driverIncident.deleteMany({ where: { id: req.params.iid, driverId: driver.id } })
    if (!count) throw notFound('Incident')
    res.json({ data: { id: req.params.iid } })
  })
)

// ── Leave ───────────────────────────────────────────────────────────────────

export const LEAVE_TYPES = ['Annual', 'Sick', 'Emergency', 'Unpaid', 'Maternity / Paternity', 'Other']
const leaveSchema = z.object({
  leaveType: z.enum(LEAVE_TYPES),
  days: z.union([z.number(), z.string(), z.null()]).default(null)
    .transform(v => (v === null || v === '' ? null : Number(v)))
    .refine(v => v === null || (Number.isInteger(v) && v >= 0 && v <= 366), 'Whole days, 0 to 366'),
  validFrom: optionalDate().refine(v => v !== null, 'From date is required'),
  validTo: optionalDate(),
  notes: optionalText(300),
})
const publicLeave = l => ({ ...l, validFrom: day(l.validFrom), validTo: day(l.validTo) })

router.get(
  '/:id/leaves',
  asyncHandler(async (req, res) => {
    const driver = await findScopedOrThrow('driver', req.params.id, req.scope)
    const rows = await prisma.driverLeave.findMany({ where: { driverId: driver.id }, orderBy: { validFrom: 'desc' } })
    res.json({ data: rows.map(publicLeave) })
  })
)

router.post(
  '/:id/leaves',
  validate(leaveSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const driver = await findLive(req.params.id, req.scope)
    if (req.body.validTo && req.body.validTo < req.body.validFrom) {
      throw badRequest('The leave ends before it starts', { validTo: 'On or after the From date' })
    }
    const row = await prisma.driverLeave.create({ data: { ...req.body, driverId: driver.id } })
    res.status(201).json({ data: publicLeave(row) })
  })
)

router.delete(
  '/:id/leaves/:lid',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const driver = await findLive(req.params.id, req.scope)
    const { count } = await prisma.driverLeave.deleteMany({ where: { id: req.params.lid, driverId: driver.id } })
    if (!count) throw notFound('Leave')
    res.json({ data: { id: req.params.lid } })
  })
)

// ── Photo ───────────────────────────────────────────────────────────────────
// PUT { image: base64 } / DELETE. Shown through GET /api/driver-photos/:key
// (routes/driverPhotos.js), public like the profile photo: the key is 128
// random bits, new on every upload.

const MAX_PHOTO_BYTES = 512 * 1024
const photoSchema = z.object({ image: z.string().min(16).max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 64) })

router.put(
  '/:id/photo',
  validate(photoSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const existing = await findLive(req.params.id, req.scope)
    const data = fromBase64(req.body.image)
    const mimeType = sniffImage(data)
    if (!mimeType) throw badRequest('The photo must be a JPEG, PNG or WebP image')
    if (data.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'The photo is too large (max 512 KB)')
    const key = randomBytes(16).toString('hex')
    const [, row] = await prisma.$transaction([
      prisma.driverPhoto.upsert({ where: { driverId: existing.id }, create: { driverId: existing.id, key, mimeType, data }, update: { key, mimeType, data } }),
      prisma.driver.update({ where: { id: existing.id }, data: { photoKey: key }, include: INCLUDE }),
    ])
    res.json({ data: publicDriver(row) })
  })
)

router.delete(
  '/:id/photo',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const existing = await findLive(req.params.id, req.scope)
    const [, row] = await prisma.$transaction([
      prisma.driverPhoto.deleteMany({ where: { driverId: existing.id } }),
      prisma.driver.update({ where: { id: existing.id }, data: { photoKey: null }, include: INCLUDE }),
    ])
    res.json({ data: publicDriver(row) })
  })
)

// ── Documents ───────────────────────────────────────────────────────────────
// Scanned copies (PDF or image, 5 MB each). Listing returns details only; the
// file itself comes from /file, behind the same login and scope as the driver.

const MAX_DOC_BYTES = 5 * 1024 * 1024
export const DOC_TYPES = ['Driving Licence', 'Visa', 'Emirates ID', 'Passport', 'Medical Fitness', 'Other']
const DOC_SELECT = { id: true, title: true, docType: true, issueDate: true, expiryDate: true, fileName: true, mimeType: true, size: true, createdAt: true }
const publicDoc = d => ({ ...d, issueDate: day(d.issueDate), expiryDate: day(d.expiryDate) })

const documentSchema = z.object({
  title: requiredText('Title', 120),
  docType: z.enum(DOC_TYPES).default('Other'),
  issueDate: optionalDate(),
  expiryDate: optionalDate(),
  fileName: requiredText('File name', 200),
  data: z.string().min(16).max(Math.ceil((MAX_DOC_BYTES * 4) / 3) + 64),
})

router.get(
  '/:id/documents',
  asyncHandler(async (req, res) => {
    const driver = await findScopedOrThrow('driver', req.params.id, req.scope)
    const rows = await prisma.driverDocument.findMany({ where: { driverId: driver.id }, select: DOC_SELECT, orderBy: { createdAt: 'desc' } })
    res.json({ data: rows.map(publicDoc) })
  })
)

router.post(
  '/:id/documents',
  validate(documentSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const driver = await findLive(req.params.id, req.scope)
    const data = fromBase64(req.body.data)
    const mimeType = sniffDocument(data)
    if (!mimeType) throw badRequest('Upload a PDF, JPEG, PNG or WebP file', { data: 'Unsupported file type' })
    if (data.length > MAX_DOC_BYTES) throw new HttpError(413, 'The file is too large (max 5 MB)')
    const { title, docType, issueDate, expiryDate, fileName } = req.body
    const row = await prisma.driverDocument.create({
      data: { driverId: driver.id, title, docType, issueDate, expiryDate, fileName, mimeType, size: data.length, data },
      select: DOC_SELECT,
    })
    res.status(201).json({ data: publicDoc(row) })
  })
)

router.get(
  '/:id/documents/:docId/file',
  asyncHandler(async (req, res) => {
    const driver = await findScopedOrThrow('driver', req.params.id, req.scope)
    const doc = await prisma.driverDocument.findFirst({ where: { id: req.params.docId, driverId: driver.id } })
    if (!doc) throw notFound('Document')
    res.set('Content-Type', doc.mimeType)
    res.set('Content-Disposition', `inline; filename="${doc.fileName.replace(/["\\\r\n]/g, '_')}"`)
    res.set('Cache-Control', 'private, no-store')
    res.send(Buffer.from(doc.data))
  })
)

router.delete(
  '/:id/documents/:docId',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const driver = await findLive(req.params.id, req.scope)
    const { count } = await prisma.driverDocument.deleteMany({ where: { id: req.params.docId, driverId: driver.id } })
    if (!count) throw notFound('Document')
    res.json({ data: { id: req.params.docId } })
  })
)

export default router
