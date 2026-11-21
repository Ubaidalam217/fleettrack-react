/**
 * /api/journey-templates — journey templates and schedules (client
 * 2026-11-21, after Uffizio's Job module):
 *
 *   - a template WITHOUT a vehicle (Uffizio "Job type: without object") is a
 *     reusable plan: New Journey applies it to any vehicle;
 *   - a template WITH a vehicle can repeat: RELATIVE (daily / weekly on days /
 *     monthly on dates at a start time, Valid From – Valid To; the engine makes
 *     each day's journey horizonDays ahead) or AUTOMATIC (a journey each time
 *     the vehicle leaves the first stop). A one-off is just a journey (FIXED).
 *
 * HSE: a journey a schedule makes waits for HSE approval like any other —
 * unless an HSE approver approved the template itself ("auto-approved
 * template"), then its journeys start approved. Any change to the plan or the
 * schedule takes that approval away again. AUTOMATIC needs it: its journeys
 * are already on the road when they are made.
 *
 *   GET    /              list, with the next days and how many journeys each made
 *   POST   /              add          (Journeys = Edit)
 *   PUT    /:id           change       (Journeys = Edit)
 *   DELETE /:id           remove; its journeys stay (Journeys = Full)
 *   POST   /:id/approve   HSE approves the template (journey-approval; never your own)
 *   POST   /:id/unapprove
 *   POST   /:id/run       make the due days now
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, conflict, forbidden } from '../lib/http.js'
import { bgFleetWhere, bgWhere, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { atLeast, canApproveJourneys, journeysLevel } from '../lib/permissions.js'
import { validate } from '../middleware/validate.js'
import { stopSchema } from './journeys.js'
import { rollSchedules } from '../lib/journeySchedules.js'
import { describeSchedule, scheduleErrors, upcoming } from '../../../src/utils/journeyRecurrence.js'
import { vehicleLabel } from '../lib/vehicleLabel.js'

const router = Router()
const who = u => u?.shortName || u?.email || null

function need(req, level) {
  if (!atLeast(journeysLevel(req.user, req.scope.role), level)) throw forbidden(level === 'view' ? 'You do not have access to Journeys' : 'You do not have permission to change journey templates')
}
router.use((req, _res, next) => { try { need(req, 'view'); next() } catch (e) { next(e) } })

const nInt = (lo, hi) => z.union([z.coerce.number().int().min(lo).max(hi), z.null()]).optional()
const nNum = (lo, hi) => z.union([z.coerce.number().min(lo).max(hi), z.null()]).optional()
const nText = max => z.union([z.string().trim().max(max), z.null()]).optional().transform(v => v || null)

/** The journey a template makes, less the vehicle and the start time. */
const bodySchema = z.object({
  title: z.string().trim().min(1, 'Name the journey').max(160),
  customer: nText(120),
  priority: z.enum(['Normal', 'High', 'Urgent']).default('Normal'),
  type: z.enum(['ONE_WAY', 'ROUND_TRIP', 'MULTI_STOP']).optional(),
  instructions: nText(2000),
  routeSource: z.enum(['PAST_TRIP', 'DRAWN', 'STRAIGHT']).default('STRAIGHT'),
  plannedPath: z.union([z.array(z.array(z.number()).min(2)).max(20000), z.null()]).optional(),
  recordedFrom: z.union([z.record(z.string(), z.any()), z.null()]).optional(),
  routeTemplateId: z.union([z.string().trim().min(1), z.null()]).optional(),
  stops: z.array(stopSchema).min(2, 'A journey needs a start and a destination').max(60),
  startLogic: z.enum(['ANY_DATA', 'IGNITION_ON']).default('ANY_DATA'),
  startBufferMin: nInt(0, 720),
  routeToleranceM: nInt(20, 20000),
  forceCloseMin: nInt(0, 43200),
  convoy: z.array(z.string().trim().min(1)).max(5).default([]),
  convoyToleranceM: z.coerce.number().int().min(50).max(5000).default(200),
  loadState: nText(40),
  tempMin: nNum(-60, 120),
  tempMax: nNum(-60, 120),
})

const schema = z.object({
  bgId: z.union([z.string().trim().min(1), z.null()]).optional(),
  name: z.string().trim().min(1, 'Name the template').max(120),
  active: z.boolean().default(true),
  vehicleId: z.union([z.string().trim().min(1), z.null()]).optional().transform(v => v || null),
  driverId: z.union([z.string().trim().min(1), z.null()]).optional().transform(v => v || null),
  body: bodySchema,
  scheduleKind: z.enum(['NONE', 'RELATIVE', 'AUTOMATIC']).default('NONE'),
  repeat: z.union([z.enum(['DAILY', 'WEEKLY', 'MONTHLY']), z.null()]).optional(),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
  monthDays: z.array(z.coerce.number().int().min(1).max(31)).max(31).default([]),
  startTime: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'), z.null()]).optional(),
  validFrom: z.union([z.null(), z.coerce.date()]).optional(),
  validTo: z.union([z.null(), z.coerce.date()]).optional(),
  horizonDays: z.coerce.number().int().min(0).max(62).default(7),
})

async function bgIdOf(req, given, vehicle) {
  const id = req.scope.bgId ?? given ?? vehicle?.bgId ?? (await prisma.businessGroup.findFirst({ where: bgWhere(req.scope), select: { id: true }, orderBy: { name: 'asc' } }))?.id
  if (!id) throw badRequest('Pick a Business Group')
  await findScopedOrThrow('bg', id, req.scope)
  return id
}

/** Everything the template names must be the caller's: vehicle, driver, convoy, geofences, forms. */
async function check(req, b, bgId) {
  const errors = scheduleErrors(b)
  if (b.scheduleKind !== 'NONE' && !b.vehicleId) errors.vehicleId = 'A schedule needs a vehicle'
  if (Object.keys(errors).length) throw badRequest('Validation failed', errors)
  let vehicle = null
  if (b.vehicleId) {
    vehicle = await findScopedOrThrow('vehicle', b.vehicleId, req.scope)
    if (bgId && !(await prisma.vehicle.count({ where: { AND: [bgFleetWhere(bgId), { id: vehicle.id }] } }))) {
      throw badRequest('Validation failed', { vehicleId: 'This vehicle is not in that Business Group' })
    }
  }
  if (b.driverId) await findScopedOrThrow('driver', b.driverId, req.scope)
  for (const id of b.body.convoy) await findScopedOrThrow('vehicle', id, req.scope)
  const gIds = [...new Set(b.body.stops.map(s => s.geofenceId).filter(Boolean))]
  const fIds = [...new Set(b.body.stops.map(s => s.formId).filter(Boolean))]
  if (gIds.length && (await prisma.geofence.count({ where: scopedWhere('geofence', req.scope, { id: { in: gIds } }) })) !== gIds.length) {
    throw badRequest('Validation failed', { stops: 'A stop uses a geofence you cannot use' })
  }
  if (fIds.length && (await prisma.journeyFormTemplate.count({ where: scopedWhere('journeyForm', req.scope, { id: { in: fIds } }) })) !== fIds.length) {
    throw badRequest('Validation failed', { stops: 'A stop uses a form you cannot use' })
  }
  for (const [i, s] of b.body.stops.entries()) {
    if (s.arrivalType === 'GEOFENCE' && !s.geofenceId) throw badRequest('Validation failed', { [`body.stops.${i}.geofenceId`]: 'Pick a geofence' })
  }
  return vehicle
}

const columns = b => ({
  name: b.name, active: b.active, vehicleId: b.vehicleId, driverId: b.driverId, body: b.body,
  scheduleKind: b.scheduleKind, repeat: b.scheduleKind === 'RELATIVE' ? b.repeat : null,
  weekdays: b.scheduleKind === 'RELATIVE' && b.repeat === 'WEEKLY' ? [...new Set(b.weekdays)].sort() : [],
  monthDays: b.scheduleKind === 'RELATIVE' && b.repeat === 'MONTHLY' ? [...new Set(b.monthDays)].sort((x, y) => x - y) : [],
  startTime: b.scheduleKind === 'RELATIVE' ? b.startTime : null,
  validFrom: b.scheduleKind === 'NONE' ? null : b.validFrom ?? null,
  validTo: b.scheduleKind === 'NONE' ? null : b.validTo ?? null,
  horizonDays: b.horizonDays,
})

/** What HSE approved: everything but the name and the on/off switch. */
const approvedKey = t => JSON.stringify([t.vehicleId, t.driverId, t.body, t.scheduleKind, t.repeat, t.weekdays, t.monthDays, t.startTime,
  t.validFrom ? new Date(t.validFrom).getTime() : null, t.validTo ? new Date(t.validTo).getTime() : null])

function shape(t, now = Date.now()) {
  return {
    ...t,
    vehicleLabel: t.vehicle ? vehicleLabel(t.vehicle) : null,
    vehicle: undefined,
    journeysMade: t._count?.journeys ?? 0,
    _count: undefined,
    engineState: undefined,
    describe: describeSchedule(t),
    next: t.scheduleKind === 'RELATIVE' && t.active ? upcoming(t, now, Math.max(t.horizonDays, 14)).slice(0, 5).map(o => ({ key: o.key, start: o.start.toISOString() })) : [],
  }
}

const INCLUDE = { vehicle: { select: { id: true, plateNo: true, fleetNo: true, imei: true } }, _count: { select: { journeys: true } } }

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.journeyTemplate.findMany({ where: scopedWhere('journeyTemplate', req.scope), include: INCLUDE, orderBy: { name: 'asc' }, take: 500 })
    res.set('Cache-Control', 'no-store')
    res.json({ data: rows.map(t => shape(t)), canApprove: canApproveJourneys(req.user, req.scope.role) })
  })
)

router.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const vehicle = req.body.vehicleId ? await findScopedOrThrow('vehicle', req.body.vehicleId, req.scope) : null
    const bgId = await bgIdOf(req, req.body.bgId, vehicle)
    await check(req, req.body, bgId)
    if (await prisma.journeyTemplate.findUnique({ where: { bgId_name: { bgId, name: req.body.name } } })) throw conflict('A template already has this name', { name: 'Already in use' })
    const row = await prisma.journeyTemplate.create({
      data: { bgId, ...columns(req.body), createdById: req.user.id, createdByName: who(req.user) },
      include: INCLUDE,
    })
    res.status(201).json({ data: shape(row) })
  })
)

router.put(
  '/:id',
  validate(schema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const t = await findScopedOrThrow('journeyTemplate', req.params.id, req.scope)
    await check(req, req.body, t.bgId)
    if (await prisma.journeyTemplate.findFirst({ where: { bgId: t.bgId, name: req.body.name, id: { not: t.id } } })) throw conflict('A template already has this name', { name: 'Already in use' })
    const cols = columns(req.body)
    const changed = approvedKey(t) !== approvedKey(cols)
    const row = await prisma.journeyTemplate.update({
      where: { id: t.id },
      data: {
        ...cols,
        // A new plan or schedule: HSE approves it again, and the days are worked out again.
        ...(changed ? { autoApprove: false, approvedById: null, approvedByName: null, approvedAt: null, generatedUntil: null, engineState: undefined, lastError: null } : {}),
      },
      include: INCLUDE,
    })
    res.json({ data: shape(row), approvalReset: changed && t.autoApprove })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    need(req, 'addDelete')
    const t = await findScopedOrThrow('journeyTemplate', req.params.id, req.scope)
    await prisma.journeyTemplate.delete({ where: { id: t.id } })
    res.json({ data: { id: t.id } })
  })
)

router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const t = await findScopedOrThrow('journeyTemplate', req.params.id, req.scope)
    if (!canApproveJourneys(req.user, req.scope.role)) throw forbidden('Only an HSE approver can approve a template')
    if (t.createdById === req.user.id) throw forbidden('You made this template, so another HSE approver must check it')
    const row = await prisma.journeyTemplate.update({
      where: { id: t.id },
      data: { autoApprove: true, approvedById: req.user.id, approvedByName: who(req.user), approvedAt: new Date() },
      include: INCLUDE,
    })
    res.json({ data: shape(row) })
  })
)

router.post(
  '/:id/unapprove',
  asyncHandler(async (req, res) => {
    const t = await findScopedOrThrow('journeyTemplate', req.params.id, req.scope)
    if (!canApproveJourneys(req.user, req.scope.role) && !atLeast(journeysLevel(req.user, req.scope.role), 'modify')) throw forbidden('Not permitted')
    const row = await prisma.journeyTemplate.update({
      where: { id: t.id },
      data: { autoApprove: false, approvedById: null, approvedByName: null, approvedAt: null },
      include: INCLUDE,
    })
    res.json({ data: shape(row) })
  })
)

router.post(
  '/:id/run',
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const t = await findScopedOrThrow('journeyTemplate', req.params.id, req.scope)
    if (t.scheduleKind !== 'RELATIVE') throw badRequest('Only a repeating schedule makes journeys ahead of time')
    if (!t.active) throw badRequest('Switch the schedule on first')
    const made = await rollSchedules(Date.now(), { templateId: t.id, force: true })
    const row = await prisma.journeyTemplate.findUnique({ where: { id: t.id }, include: INCLUDE })
    res.json({ data: shape(row), made })
  })
)

export default router
