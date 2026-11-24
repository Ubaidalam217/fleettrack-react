/**
 * /api/journeys — Journey Management (client 2026-11-13/16/17, design §A).
 *
 *   GET    /                         list (date window + everything on the road + waiting for approval), with counts
 *   GET    /options                  what New Journey needs: vehicles, drivers, geofences, saved routes, settings, rights
 *   GET    /availability             is this vehicle free then? (the form's "Free at this time")
 *   GET    /route-from-trip          a past trip's track for "Copy a past trip" (GET-only telemetry read)
 *   GET    /:id                      the detail page: stops, events, path, violations in the window
 *   POST   /                         create (Draft; `submit: true` also sends it for approval; `needsApproval: false` makes it Scheduled at once)
 *   PUT    /:id                      edit the plan; a material change sends it back for approval
 *   POST   /:id/submit               Draft / Rejected → Pending approval
 *   POST   /:id/approve              Pending → Scheduled (journey-approval; never your own)
 *   POST   /:id/reject   { reason }  Pending → Rejected (back to Draft)
 *   POST   /:id/cancel   { reason }  any non-final state → Cancelled (Journeys = Full)
 *   POST   /:id/notes    { text }    an office note on the timeline
 *   DELETE /:id                      a draft (Journeys = Full)
 *   POST   /:id/stops/:seq/signature { data, signedByName }   proof of delivery (the driver app uses it in phase 2)
 *   GET    /:id/stops/:seq/signature the image, authenticated
 *
 * Permissions (design §A.6): Journeys View = read, Edit = create / edit / send,
 * Full = delete drafts and cancel. "Journey approval" is deny-by-default
 * (lib/permissions.js) and nobody approves a journey they created or sent.
 */

import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import env from '../env.js'
import prisma from '../prisma.js'
import { roadRoute } from '../lib/roadRoute.js'
import { asyncHandler, badRequest, conflict, forbidden, HttpError, notFound } from '../lib/http.js'
import { bgWhere, findScopedOrThrow, scopedWhere, vehicleWhere, bgFleetWhere } from '../lib/scope.js'
import { atLeast, canApproveJourneys, journeysLevel } from '../lib/permissions.js'
import { validate } from '../middleware/validate.js'
import { getJourneySettings } from '../lib/journeySettings.js'
import { vehicleLabel } from '../lib/vehicleLabel.js'
import * as flespi from '../lib/flespi.js'
import { fetchRecent } from '../lib/alertEngine.js'
import { fromBase64, sniffImage } from '../lib/files.js'
import {
  ACTIVE, EDITABLE, FINAL, LIST_INCLUDE, STOP_SELECT, STOP_PURPOSES, approversOf, driverOverlap, driverProblems,
  findOverlap, overlapMessage, publicJourney, publicStop, recordEvent, withVehicleCheck,
  journeyColumns, stopRows, checkInStop,
} from '../lib/journeys.js'
import { checkAnswers } from '../../../src/utils/journeyForms.js'
import { probeTemperature } from '../../../src/utils/sensorReadings.js'
import { assertCanWrite } from '../lib/scope.js'
import { levelOf } from '../lib/permissions.js'
import { EXPENSE_TYPES } from './expenses.js'
import { journeyRef } from '../../../src/utils/journeySchedule.js'
import { simplifyPath, pathKm } from '../../../src/utils/journeyGeo.js'

const router = Router()

export const MAX_SIGNATURE_BYTES = 512 * 1024
const UAE_MS = 4 * 3600 * 1000
const who = user => user?.shortName || user?.email || null

// ── permission helpers ──────────────────────────────────────────────────────

const levelFor = req => journeysLevel(req.user, req.scope.role)
function need(req, level) {
  if (!atLeast(levelFor(req), level)) {
    throw forbidden(level === 'addDelete' ? 'You do not have permission to cancel or delete journeys' : level === 'view' ? 'You do not have access to Journeys' : 'You do not have permission to plan journeys')
  }
}
const viewGuard = (req, _res, next) => {
  try { need(req, 'view'); next() } catch (e) { next(e) }
}
router.use(viewGuard)

// ── schemas ─────────────────────────────────────────────────────────────────

const lat = z.coerce.number().min(-90).max(90)
const lng = z.coerce.number().min(-180).max(180)

export const stopSchema = z.object({
  name: z.string().trim().min(1, 'Name the stop').max(120),
  arrivalType: z.enum(['RADIUS', 'GEOFENCE']).default('RADIUS'),
  geofenceId: z.union([z.string().trim().min(1), z.null()]).optional(),
  lat, lng,
  radiusM: z.coerce.number().int().min(30, 'At least 30 m').max(20000).optional(),
  stayMin: z.coerce.number().int().min(0).max(1440).default(0),
  legDriveMin: z.union([z.null(), z.coerce.number().int().min(0).max(4320)]).optional(),
  legSource: z.enum(['SPEED', 'TRIP', 'MANUAL', 'ROUTING']).nullable().optional(),
  signatureRequired: z.boolean().default(false),
  visitVia: z.enum(['MAP', 'QR']).default('MAP'),
  purpose: z.union([z.enum(STOP_PURPOSES), z.null()]).optional(),
  loadState: z.union([z.string().trim().max(40), z.null()]).optional().transform(v => v || null),
  addressId: z.union([z.string().trim().min(1), z.null()]).optional(),
  formId: z.union([z.string().trim().min(1), z.null()]).optional(),
})

const nullableInt = (lo, hi) => z.union([z.null(), z.coerce.number().int().min(lo).max(hi)]).optional()
const nullableNum = (lo, hi) => z.union([z.null(), z.coerce.number().min(lo).max(hi)]).optional()

const journeySchema = z.object({
  bgId: z.union([z.string().trim().min(1), z.null()]).optional(),
  title: z.string().trim().min(1, 'Name the journey').max(160),
  customer: z.union([z.string().trim().max(120), z.null()]).optional().transform(v => v || null),
  priority: z.enum(['Normal', 'High', 'Urgent']).default('Normal'),
  type: z.enum(['ONE_WAY', 'ROUND_TRIP', 'MULTI_STOP']).optional(),
  instructions: z.union([z.string().trim().max(2000), z.null()]).optional().transform(v => v || null),
  vehicleId: z.string().trim().min(1, 'Pick a vehicle'),
  driverId: z.union([z.string().trim().min(1), z.null()]).optional().transform(v => v || null),
  plannedStart: z.coerce.date({ error: 'Pick the start time' }),
  routeSource: z.enum(['PAST_TRIP', 'DRAWN', 'ROAD', 'STRAIGHT']).default('STRAIGHT'),
  plannedPath: z.union([z.array(z.array(z.number()).min(2)).max(20000), z.null()]).optional(),
  recordedFrom: z.union([z.record(z.string(), z.any()), z.null()]).optional(),
  routeTemplateId: z.union([z.string().trim().min(1), z.null()]).optional(),
  stops: z.array(stopSchema).min(2, 'A journey needs a start and a destination').max(60),
  submit: z.boolean().default(false),
  // false: no approval step, created Scheduled (client 2026-11-24). Left out = the usual approval flow.
  needsApproval: z.boolean().optional(),
  // The rest of the Uffizio Job module (client 2026-11-21).
  startLogic: z.enum(['ANY_DATA', 'IGNITION_ON']).default('ANY_DATA'),
  startBufferMin: nullableInt(0, 720),
  routeToleranceM: nullableInt(20, 20000),
  forceCloseMin: nullableInt(0, 43200),
  convoy: z.array(z.string().trim().min(1)).max(5).default([]),
  convoyToleranceM: z.coerce.number().int().min(50).max(5000).default(200),
  loadState: z.union([z.string().trim().max(40), z.null()]).optional().transform(v => v || null),
  tempMin: nullableNum(-60, 120),
  tempMax: nullableNum(-60, 120),
}).refine(b => b.tempMin == null || b.tempMax == null || b.tempMin < b.tempMax, { message: 'The lowest must be below the highest', path: ['tempMax'] })
  .refine(b => !b.convoy.includes(b.vehicleId), { message: 'The lead vehicle is already in the journey', path: ['convoy'] })

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Say why').max(1000) })
const optionalReason = z.object({ reason: z.union([z.string().trim().max(1000), z.null()]).optional() })
const noteSchema = z.object({ text: z.string().trim().min(1).max(2000) })
const signatureSchema = z.object({
  data: z.string().min(16).max(Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 64),
  signedByName: z.union([z.string().trim().max(120), z.null()]).optional(),
  source: z.enum(['WEB', 'DRIVER_APP']).default('WEB'),
})

const listQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.string().trim().max(200).optional(),
  approval: z.enum(['pending', 'approved', 'rejected']).optional(),
  vehicleId: z.string().trim().min(1).optional(),
  q: z.string().trim().max(100).optional(),
  live: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})

// ── helpers ─────────────────────────────────────────────────────────────────

/** Today in the UAE, as [00:00, 24:00). */
function todayUae(now = Date.now()) {
  const d = new Date(now + UAE_MS)
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - UAE_MS
  return [new Date(start), new Date(start + 86_400_000)]
}

async function loadJourney(req, { full = true } = {}) {
  const row = await findScopedOrThrow('journey', req.params.id, req.scope, {
    include: { ...LIST_INCLUDE, ...(full ? { events: { orderBy: { occurredAt: 'asc' }, take: 500 } } : {}) },
  })
  return row
}

/** The BG a new journey lands in: the creator's own, else the one asked for, else the vehicle's. */
async function journeyBgId(req, vehicle) {
  const id = req.scope.bgId ?? req.body.bgId ?? vehicle.bgId
  await findScopedOrThrow('bg', id, req.scope)
  await assertInFleet(id, vehicle)
  return id
}

/** The vehicle must be in the BG's fleet (its own, or shared into it). */
async function assertInFleet(id, vehicle) {
  const ok = await prisma.vehicle.count({ where: { AND: [bgFleetWhere(id), { id: vehicle.id }] } })
  if (!ok) throw badRequest('Validation failed', { vehicleId: 'This vehicle is not in that Business Group' })
}

async function geofencesFor(req, stops) {
  const ids = [...new Set(stops.map(s => s.geofenceId).filter(Boolean))]
  if (!ids.length) return new Map()
  const rows = await prisma.geofence.findMany({ where: scopedWhere('geofence', req.scope, { id: { in: ids } }) })
  return new Map(rows.map(g => [g.id, g]))
}

async function resolveAssignment(req) {
  const vehicle = await findScopedOrThrow('vehicle', req.body.vehicleId, req.scope)
  let driver = null
  if (req.body.driverId) {
    driver = await findScopedOrThrow('driver', req.body.driverId, req.scope)
  }
  const convoy = []
  for (const id of [...new Set(req.body.convoy ?? [])]) convoy.push(await findScopedOrThrow('vehicle', id, req.scope))
  return { vehicle, driver, convoy }
}

/** The caller's forms used by these stops, by id. */
async function formsFor(req, stops) {
  const ids = [...new Set(stops.map(s => s.formId).filter(Boolean))]
  if (!ids.length) return new Map()
  const rows = await prisma.journeyFormTemplate.findMany({ where: scopedWhere('journeyForm', req.scope, { id: { in: ids } }) })
  return new Map(rows.map(f => [f.id, f]))
}

/** The columns a plan writes, from a validated body. */
async function planColumns(req, settings, assignment, keepCodes) {
  const [geofences, forms] = await Promise.all([geofencesFor(req, req.body.stops), formsFor(req, req.body.stops)])
  return journeyColumns(req.body, { ...assignment, settings, geofences, forms, keepCodes })
}

/** Does an edit change what was approved (vehicle, driver, route, stops, times)? */
function materialChange(before, after) {
  const key = j => JSON.stringify({
    v: j.vehicleId, d: j.driverId ?? null, s: new Date(j.plannedStart).getTime(), r: j.routeSource,
    p: j.plannedPath ?? null,
    st: j.stops.map(s => [s.name, s.arrivalType, s.geofenceId ?? null, +(+s.lat).toFixed(6), +(+s.lng).toFixed(6), s.radiusM, s.stayMin, s.legDriveMin, new Date(s.plannedArrive ?? 0).getTime()]),
  })
  return key(before) !== key(after)
}

/** A journey with no approval step is Scheduled at once (approvalStatus is a free string). */
const NO_APPROVAL_COLUMNS = Object.freeze({
  status: 'Scheduled', approvalStatus: 'NOT_REQUIRED',
  submittedAt: null, submittedById: null, submittedByName: null, decidedById: null, decidedByName: null, decidedAt: null, rejectReason: null,
})

function assertMaySkipApproval(settings) {
  if (!settings.allowNoApproval) throw forbidden('Journeys without approval are switched off in Journey settings')
}

/** A Scheduled journey the engine would never pick up (it gave up on a start long gone). */
function assertNotPast(plannedStart) {
  if (new Date(plannedStart).getTime() < Date.now() - 6 * 3600 * 1000) throw badRequest('This journey was planned for the past — change its start time first', { plannedStart: 'In the past' })
}

async function checkDriver(driver, at) {
  const problems = driverProblems(driver, at)
  if (problems.length) throw badRequest(problems[0], { driverId: problems[0] })
}

async function warningsFor(j) {
  const out = []
  const d = await driverOverlap(prisma, j)
  if (d) out.push(`${j.driverName} also drives ${journeyRef(d)} at this time.`)
  return out
}

async function notifyApproval(j, actor) {
  const approvers = (await approversOf(j.bgId)).filter(u => u.id !== actor?.id && u.id !== j.createdById)
  await recordEvent(j, { type: 'SUBMITTED', message: `Sent for approval by ${who(actor) ?? 'someone'}`, actor }, {
    alert: true, notify: approvers.map(u => u.id),
  })
}

// ── reads ───────────────────────────────────────────────────────────────────

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to, status, approval, vehicleId, q, live, limit } = req.validatedQuery
    const [d0, d1] = todayUae()
    const start = from ?? d0
    const end = to ?? d1
    // The day's journeys, plus everything still on the road and everything
    // waiting for HSE, whenever it was planned for (client 2026-11-17: "all
    // planned and ongoing journeys in one list").
    const window = live === 'true'
      ? { OR: [{ status: { in: ACTIVE } }, { status: 'Scheduled', plannedStart: { lt: end } }, { status: 'Completed', completedAt: { gte: start } }] }
      : { OR: [{ plannedStart: { gte: start, lt: end } }, { status: { in: ACTIVE } }, { status: 'Draft', approvalStatus: 'PENDING' }] }
    const base = scopedWhere('journey', req.scope, window, vehicleId ? { vehicleId } : null,
      q ? { OR: ['title', 'vehicleLabel', 'driverName', 'customer'].map(f => ({ [f]: { contains: q, mode: 'insensitive' } })).concat([{ stops: { some: { name: { contains: q, mode: 'insensitive' } } } }]) } : null)
    let rows = await prisma.journey.findMany({ where: base, include: LIST_INCLUDE, orderBy: { plannedStart: 'asc' }, take: limit })
    let out = rows.map(r => publicJourney(r))
    const counts = { all: out.length }
    for (const r of out) counts[r.display] = (counts[r.display] ?? 0) + 1
    counts.late = out.filter(r => ['InProgress', 'Delayed', 'Started'].includes(r.status) && (r.delayMin ?? 0) > 0).length
    if (status) {
      const want = new Set(status.split(','))
      out = out.filter(r => want.has(r.display) || (want.has('Late') && r.status === 'Delayed'))
    }
    if (approval === 'pending') out = out.filter(r => r.display === 'Pending')
    if (approval === 'rejected') out = out.filter(r => r.display === 'Rejected')
    if (approval === 'approved') out = out.filter(r => r.approvalStatus === 'APPROVED')
    res.set('Cache-Control', 'no-store')
    res.json({ data: out, counts, window: { from: start.toISOString(), to: end.toISOString() } })
  })
)

/** The approvals queue: waiting, decided today, rejected — with the caller's right to decide. */
router.get(
  '/approvals',
  asyncHandler(async (req, res) => {
    const [d0] = todayUae()
    const rows = await prisma.journey.findMany({
      where: scopedWhere('journey', req.scope, {
        OR: [{ approvalStatus: 'PENDING' }, { decidedAt: { gte: new Date(d0.getTime() - 6 * 86_400_000) } }],
      }),
      include: LIST_INCLUDE,
      orderBy: [{ submittedAt: 'asc' }, { plannedStart: 'asc' }],
      take: 300,
    })
    const canApprove = canApproveJourneys(req.user, req.scope.role)
    const drivers = await prisma.driver.findMany({
      where: { id: { in: [...new Set(rows.map(r => r.driverId).filter(Boolean))] } },
      select: { id: true, name: true, status: true, deletedAt: true, licenseExpiry: true, medicalExpiry: true },
    })
    const byId = new Map(drivers.map(d => [d.id, d]))
    res.set('Cache-Control', 'no-store')
    res.json({
      data: rows.map(r => ({
        ...publicJourney(r),
        ownJourney: r.createdById === req.user.id || r.submittedById === req.user.id,
        driverProblems: driverProblems(byId.get(r.driverId), r.plannedStart),
      })),
      canApprove,
    })
  })
)

router.get(
  '/options',
  asyncHandler(async (req, res) => {
    const bgs = await prisma.businessGroup.findMany({ where: bgWhere(req.scope), select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 })
    const bgId = req.scope.bgId ?? (typeof req.query.bgId === 'string' ? req.query.bgId : null) ?? bgs[0]?.id ?? null
    const [vehicles, drivers, geofences, templates, customers, settings, addresses, forms, journeyTemplates] = await Promise.all([
      prisma.vehicle.findMany({
        where: vehicleWhere(req.scope),
        select: { id: true, bgId: true, plateNo: true, fleetNo: true, imei: true, vehicleType: true, make: true, model: true, driver: { select: { id: true, name: true } } },
        take: 2000,
      }),
      prisma.driver.findMany({
        where: scopedWhere('driver', req.scope, { deletedAt: null }),
        select: { id: true, bgId: true, name: true, mobile: true, status: true, licenseExpiry: true, medicalExpiry: true, vehicleId: true },
        orderBy: { name: 'asc' },
        take: 2000,
      }),
      prisma.geofence.findMany({
        where: scopedWhere('geofence', req.scope, { active: true }),
        select: { id: true, bgId: true, name: true, shape: true, centerLat: true, centerLng: true, radius: true, points: true, category: true },
        orderBy: { name: 'asc' },
        take: 2000,
      }),
      prisma.routeTemplate.findMany({ where: scopedWhere('routeTemplate', req.scope), orderBy: { name: 'asc' }, take: 300 }),
      prisma.journey.findMany({ where: scopedWhere('journey', req.scope, { customer: { not: null } }), distinct: ['customer'], select: { customer: true }, take: 200 }),
      getJourneySettings(bgId),
      prisma.journeyAddress.findMany({ where: scopedWhere('journeyAddress', req.scope), orderBy: { name: 'asc' }, take: 2000 }),
      prisma.journeyFormTemplate.findMany({ where: scopedWhere('journeyForm', req.scope), orderBy: { name: 'asc' }, take: 200 }),
      prisma.journeyTemplate.findMany({
        where: scopedWhere('journeyTemplate', req.scope),
        select: { id: true, name: true, vehicleId: true, scheduleKind: true, body: true, active: true },
        orderBy: { name: 'asc' }, take: 300,
      }),
    ])
    const temps = await temperatureVehicles(vehicles)
    res.set('Cache-Control', 'no-store')
    res.json({
      data: {
        bgs, bgId,
        vehicles: vehicles.map(v => ({ ...v, label: vehicleLabel(v), hasTemperature: temps.has(v.id) })).sort((a, b) => a.label.localeCompare(b.label)),
        addresses, forms, journeyTemplates,
        drivers: drivers.map(d => ({ ...d, problems: driverProblems(d, new Date()) })),
        geofences,
        templates,
        customers: customers.map(c => c.customer).filter(Boolean).sort(),
        settings,
        me: { id: req.user.id, level: levelFor(req), canApprove: canApproveJourneys(req.user, req.scope.role) },
      },
    })
  })
)

router.get(
  '/availability',
  validate(z.object({ vehicleId: z.string().min(1), from: z.coerce.date(), to: z.coerce.date(), excludeId: z.string().optional(), driverId: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { vehicleId, from, to, excludeId, driverId } = req.validatedQuery
    const vehicle = await findScopedOrThrow('vehicle', vehicleId, req.scope)
    const other = await findOverlap(prisma, { vehicleId, plannedStart: from, expectedArrival: to, excludeId })
    const d = driverId ? await driverOverlap(prisma, { driverId, plannedStart: from, expectedArrival: to, excludeId }) : null
    res.set('Cache-Control', 'no-store')
    res.json({
      data: {
        free: !other,
        // Only what the caller may see of the other journey: its number and times.
        message: other ? overlapMessage(vehicleLabel(vehicle), other) : null,
        driverWarning: d ? `This driver also has ${journeyRef(d)} at this time.` : null,
      },
    })
  })
)

/** The device a vehicle's tracker is, from Flespi's list (GET) or our own copy. */
async function deviceIdOf(vehicle) {
  const imei = String(vehicle.imei ?? '').replace(/\D/g, '')
  if (!imei) return null
  if (flespi.isConfigured()) {
    try {
      const map = await flespi.deviceMap()
      if (map.has(imei)) return map.get(imei)
    } catch { /* our own copy below */ }
  }
  const st = await prisma.deviceState.findFirst({ where: { ident: imei }, select: { deviceId: true } })
  return st?.deviceId ?? null
}

const TRIP_FIELDS = 'device.id,timestamp,position.latitude,position.longitude,position.speed,engine.ignition.status'

router.get(
  '/route-from-trip',
  validate(z.object({ vehicleId: z.string().min(1), from: z.coerce.date(), to: z.coerce.date() }), 'query'),
  asyncHandler(async (req, res) => {
    const { vehicleId, from, to } = req.validatedQuery
    const vehicle = await findScopedOrThrow('vehicle', vehicleId, req.scope)
    const f = Math.floor(from.getTime() / 1000), t = Math.floor(to.getTime() / 1000)
    if (t <= f) throw badRequest('Validation failed', { to: 'The end must be after the start' })
    if (t - f > 36 * 3600) throw badRequest('Validation failed', { to: 'Pick at most 36 hours' })
    const deviceId = await deviceIdOf(vehicle)
    if (deviceId == null) throw badRequest('This vehicle has no tracker to copy a trip from')
    const msgs = (await fetchRecent([deviceId], f, t, TRIP_FIELDS)).get(deviceId) ?? []
    const pts = msgs
      .filter(m => Number.isFinite(m['position.latitude']) && Number.isFinite(m['position.longitude']) && !(m['position.latitude'] === 0 && m['position.longitude'] === 0))
      .map(m => [m['position.latitude'], m['position.longitude'], m.timestamp])
    if (pts.length < 2) throw badRequest('No positions in that time — pick another day or time')
    // Trim the parked minutes at both ends: the trip is from the first move to the last.
    const moving = msgs.filter(m => (m['position.speed'] ?? 0) > 5)
    const t0 = moving[0]?.timestamp ?? pts[0][2]
    const t1 = moving[moving.length - 1]?.timestamp ?? pts[pts.length - 1][2]
    const trip = pts.filter(p => p[2] >= t0 - 60 && p[2] <= t1 + 60)
    // Driving seconds so far at each message (moving, gaps under 10 min): a
    // leg copied from this trip takes its DRIVING time, not the hours it was parked.
    const driveAt = new Map()
    let driveSec = 0
    for (let i = 0; i < msgs.length; i++) {
      const dt = i ? msgs[i].timestamp - msgs[i - 1].timestamp : 0
      if (dt > 0 && dt <= 600 && (msgs[i]['position.speed'] ?? 0) > 3) driveSec += dt
      driveAt.set(msgs[i].timestamp, driveSec)
    }
    const path = simplifyPath((trip.length >= 2 ? trip : pts).map(p => [...p, driveAt.get(p[2]) ?? 0]), 25)
    res.json({
      data: {
        vehicleId: vehicle.id,
        vehicleLabel: vehicleLabel(vehicle),
        from: new Date(path[0][2] * 1000).toISOString(),
        to: new Date(path[path.length - 1][2] * 1000).toISOString(),
        path, // [lat, lng, unix seconds, driving seconds so far]
        distanceKm: Math.round(pathKm(path) * 10) / 10,
        driveMin: Math.round(driveSec / 60),
        points: pts.length,
      },
    })
  })
)

// ── the road route through the stops ───────────────────────────────────────

const routeSchema = z.object({
  bgId: z.union([z.string().trim().min(1), z.null()]).optional(),
  points: z.array(z.object({ lat, lng })).min(2, 'Place at least two stops').max(60),
})

// Each call may cost the provider's free daily quota: per account, not per address.
const routeLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  keyGenerator: req => `route:${req.user?.id ?? 'anon'}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: { message: 'Too many route requests. Try again in a minute.' } },
})

/**
 * The best road route through the stops (client 2026-11-24): its line, each
 * leg's distance and driving time. No provider set up or a provider that fails
 * is NOT an error: the answer is the estimate with `estimated: true` (and a note).
 */
router.post(
  '/route',
  routeLimiter,
  validate(routeSchema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    let bgId = req.scope.bgId ?? req.body.bgId ?? null
    if (bgId) await findScopedOrThrow('bg', bgId, req.scope)
    const settings = await getJourneySettings(bgId)
    const route = await roadRoute(req.body.points, { routing: settings.routing, speedKmh: settings.plannedSpeedKmh })
    res.set('Cache-Control', 'no-store')
    res.json({ data: route })
  })
)

/**
 * Vehicles whose tracker reports a real temperature (a probe, not the 0 °C a
 * BLE slot with no probe sends), from our own copy of each device's last
 * state — no Flespi call. Only these may set a journey's temperature limits.
 */
const TEMP_SEEN_SEC = 7 * 86_400
async function temperatureVehicles(vehicles) {
  const byImei = new Map(vehicles.map(v => [String(v.imei ?? '').replace(/\D/g, ''), v.id]).filter(([k]) => k))
  if (!byImei.size) return new Set()
  const rows = await prisma.deviceState.findMany({
    where: { ident: { in: [...byImei.keys()] }, ts: { gte: Math.floor(Date.now() / 1000) - TEMP_SEEN_SEC } },
    select: { ident: true, temperature: true, extra: true },
  })
  const out = new Set()
  for (const r of rows) {
    const flat = { 'ble.sensor.temperature.1': r.temperature, ...(r.extra && typeof r.extra === 'object' ? r.extra : {}) }
    if ([1, 2, 3, 4].some(n => probeTemperature(flat, n) !== null)) out.add(byImei.get(r.ident))
  }
  return out
}

// ── Journey Alerts, reports, copy from a previous journey ──────────────────

const eventsQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  type: z.string().trim().max(400).optional(),
  severity: z.string().trim().max(100).optional(),
  vehicleId: z.string().trim().min(1).optional(),
  journeyId: z.string().trim().min(1).optional(),
  q: z.string().trim().max(100).optional(),
  alertsOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
})

/** Journey Alerts: every journey event (or only those that rang the bell) in a period. */
router.get(
  '/events',
  validate(eventsQuery, 'query'),
  asyncHandler(async (req, res) => {
    // The Journey alerts page is its own screen in the permission editor.
    if (req.scope.role !== 'SUPER_ADMIN' && levelOf(req.user?.screenAccess, '/journeys/alerts') === 'none') throw forbidden('You do not have access to Journey alerts')
    const { from, to, type, severity, vehicleId, journeyId, q, alertsOnly, limit } = req.validatedQuery
    const [d0, d1] = todayUae()
    const start = from ?? new Date(d0.getTime() - 6 * 86_400_000)
    const end = to ?? d1
    const journey = scopedWhere('journey', req.scope, vehicleId ? { vehicleId } : null, journeyId ? { id: journeyId } : null,
      q ? { OR: ['title', 'vehicleLabel', 'driverName', 'customer'].map(f => ({ [f]: { contains: q, mode: 'insensitive' } })) } : null)
    const rows = await prisma.journeyEvent.findMany({
      where: {
        occurredAt: { gte: start, lt: end },
        journey,
        ...(type ? { type: { in: type.split(',') } } : {}),
        ...(severity ? { severity: { in: severity.split(',') } } : {}),
        ...(alertsOnly === 'true' ? { alertEventId: { not: null } } : {}),
      },
      include: { journey: { select: { id: true, journeyNo: true, plannedStart: true, title: true, vehicleLabel: true, driverName: true, customer: true, status: true } } },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    })
    res.set('Cache-Control', 'no-store')
    res.json({
      data: rows.map(({ journey: jr, ...e }) => ({
        ...e, occurredAt: e.occurredAt.toISOString(), endedAt: e.endedAt?.toISOString() ?? null, alert: Boolean(e.alertEventId),
        journey: { ...jr, ref: journeyRef(jr), plannedStart: jr.plannedStart.toISOString() },
      })),
      window: { from: start.toISOString(), to: end.toISOString() },
    })
  })
)

const reportQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  vehicleId: z.string().trim().min(1).optional(),
  driverId: z.string().trim().min(1).optional(),
  customer: z.string().trim().max(120).optional(),
})

/**
 * Everything the Journey reports (Reports › Journey) read: the journeys
 * planned in the period with their stops (planned vs actual, timing, form
 * and signature state), their events and their cost.
 */
router.get(
  '/report',
  validate(reportQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to, vehicleId, driverId, customer } = req.validatedQuery
    if (to <= from) throw badRequest('Validation failed', { to: 'The end must be after the start' })
    if (to - from > 93 * 86_400_000) throw badRequest('Validation failed', { to: 'Pick at most three months' })
    const rows = await prisma.journey.findMany({
      where: scopedWhere('journey', req.scope, { plannedStart: { gte: from, lt: to } },
        vehicleId ? { vehicleId } : null, driverId ? { driverId } : null,
        customer ? { customer: { equals: customer, mode: 'insensitive' } } : null),
      include: {
        ...LIST_INCLUDE,
        events: { select: { type: true, severity: true, stopSeq: true, occurredAt: true, message: true, value: true, alertEventId: true, durationSec: true }, orderBy: { occurredAt: 'asc' }, take: 300 },
      },
      orderBy: { plannedStart: 'asc' },
      take: 2000,
    })
    const costs = rows.length
      ? await prisma.expense.groupBy({ by: ['journeyId'], where: { journeyId: { in: rows.map(r => r.id) } }, _sum: { amount: true }, _count: true })
      : []
    const costOf = new Map(costs.map(c => [c.journeyId, { amount: c._sum.amount ?? 0, count: c._count }]))
    res.set('Cache-Control', 'no-store')
    res.json({
      data: rows.map(r => ({
        ...publicJourney(r),
        vehicleImei: r.vehicle?.imei ?? null,
        events: r.events.map(e => ({ ...e, occurredAt: e.occurredAt.toISOString(), alert: Boolean(e.alertEventId) })),
        alertCount: r.events.filter(e => e.alertEventId).length,
        cost: costOf.get(r.id)?.amount ?? 0,
        expenseCount: costOf.get(r.id)?.count ?? 0,
      })),
      window: { from: from.toISOString(), to: to.toISOString() },
    })
  })
)

/** "Copy from a previous journey": the latest journeys, searchable. */
router.get(
  '/recent',
  validate(z.object({ q: z.string().trim().max(100).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { q } = req.validatedQuery
    const rows = await prisma.journey.findMany({
      where: scopedWhere('journey', req.scope, q ? { OR: ['title', 'vehicleLabel', 'customer'].map(f => ({ [f]: { contains: q, mode: 'insensitive' } })) } : null),
      select: { id: true, journeyNo: true, title: true, vehicleLabel: true, plannedStart: true, status: true, customer: true, plannedDistanceKm: true, _count: { select: { stops: true } } },
      orderBy: { plannedStart: 'desc' },
      take: 60,
    })
    res.set('Cache-Control', 'no-store')
    res.json({ data: rows.map(r => ({ ...r, ref: journeyRef(r), stopCount: r._count.stops, _count: undefined })) })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const j = await loadJourney(req)
    const settings = await getJourneySettings(j.bgId)
    // Violations the devices and the alert rules already report for this
    // vehicle in the journey's window (design §A.4): a query, nothing copied.
    const fromT = j.actualStart ?? j.plannedStart
    const toT = j.completedAt ?? j.actualArrival ?? (FINAL.includes(j.status) ? j.expectedArrival : new Date())
    const violations = j.vehicleId && (ACTIVE.includes(j.status) || j.status === 'Completed')
      ? await prisma.alertEvent.findMany({
        where: { vehicleId: j.vehicleId, occurredAt: { gte: fromT, lte: toT }, NOT: { type: { startsWith: 'journey_' } }, alertId: { not: null } },
        select: { id: true, type: true, severity: true, title: true, message: true, occurredAt: true, value: true, lat: true, lng: true },
        orderBy: { occurredAt: 'asc' },
        take: 200,
      })
      : []
    const level = levelFor(req)
    const own = j.createdById === req.user.id || j.submittedById === req.user.id
    const [cost, links] = await Promise.all([
      prisma.expense.aggregate({ where: { journeyId: j.id }, _sum: { amount: true }, _count: true }),
      prisma.journeyLink.count({ where: { journeyId: j.id, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ])
    res.set('Cache-Control', 'no-store')
    res.json({
      data: {
        ...publicJourney(j, { full: true }),
        events: j.events.map(e => ({ ...e, occurredAt: e.occurredAt.toISOString(), endedAt: e.endedAt?.toISOString() ?? null })),
        violations,
        settings: { onTimeMin: settings.onTimeMin, lateArrivalMin: settings.lateArrivalMin, destinationRule: settings.destinationRule, forceCloseHours: settings.forceCloseHours, offRouteKm: settings.offRouteKm },
        cost: { total: Math.round((cost._sum.amount ?? 0) * 100) / 100, count: cost._count },
        openLinks: links,
        can: {
          edit: atLeast(level, 'modify') && EDITABLE.includes(j.status),
          submit: atLeast(level, 'modify') && j.status === 'Draft' && j.approvalStatus !== 'PENDING',
          approve: j.approvalStatus === 'PENDING' && canApproveJourneys(req.user, req.scope.role) && !own,
          cancel: atLeast(level, 'addDelete') && !FINAL.includes(j.status),
          delete: atLeast(level, 'addDelete') && j.status === 'Draft',
          note: atLeast(level, 'modify'),
          sign: atLeast(level, 'modify'),
          links: atLeast(level, 'modify') && j.status !== 'Cancelled',
          checkIn: atLeast(level, 'modify') && ACTIVE.includes(j.status),
          form: atLeast(level, 'modify') && j.status !== 'Cancelled',
          expenses: atLeast(level, 'modify'),
        },
      },
    })
  })
)

// ── writes ──────────────────────────────────────────────────────────────────

router.post(
  '/',
  validate(journeySchema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const assignment = await resolveAssignment(req)
    const { vehicle, driver } = assignment
    const bgId = await journeyBgId(req, vehicle)
    const settings = await getJourneySettings(bgId)
    const { plan, data: cols } = await planColumns(req, settings, assignment)
    const b = req.body
    const data = { bgId, ...cols, createdById: req.user.id, createdByName: who(req.user) }
    // No approval needed (client 2026-11-24: "we only create them and follow them"): created
    // Scheduled at once. Every check that is not about approval still runs.
    const skip = b.needsApproval === false
    if (skip) {
      assertMaySkipApproval(settings)
      assertNotPast(b.plannedStart)
      await checkDriver(driver, b.plannedStart)
      Object.assign(data, NO_APPROVAL_COLUMNS)
    } else if (b.submit) {
      await checkDriver(driver, b.plannedStart)
      Object.assign(data, { approvalStatus: 'PENDING', submittedAt: new Date(), submittedById: req.user.id, submittedByName: who(req.user) })
    }
    const create = db => db.journey.create({ data: { ...data, stops: { create: stopRows(plan.stops) } }, include: LIST_INCLUDE })
    const row = skip || b.submit ? await withVehicleCheck(data, create) : await create(prisma)
    if (skip) await recordEvent(row, { type: 'CREATED_WITHOUT_APPROVAL', message: `Created without approval by ${who(req.user) ?? 'someone'}`, actor: req.user, toStatus: 'Scheduled' }, { settings, alert: false })
    else if (b.submit) await notifyApproval(row, req.user)
    res.status(201).json({ data: publicJourney(row), warnings: await warningsFor(row) })
  })
)

router.put(
  '/:id',
  validate(journeySchema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const before = await loadJourney(req, { full: false })
    if (!EDITABLE.includes(before.status)) throw conflict('A journey on the road or finished cannot be changed')
    const assignment = await resolveAssignment(req)
    const { vehicle, driver } = assignment
    await assertInFleet(before.bgId, vehicle)
    const settings = await getJourneySettings(before.bgId)
    const keepCodes = new Map(before.stops.filter(x => x.code).map(x => [x.name.toLowerCase(), x.code]))
    const { plan, data: cols } = await planColumns(req, settings, assignment, keepCodes)
    const b = req.body
    const after = {
      vehicleId: vehicle.id, driverId: driver?.id ?? null, plannedStart: b.plannedStart, routeSource: b.routeSource,
      plannedPath: plan.plannedPath ?? null, stops: plan.stops,
    }
    const material = materialChange({ ...before, plannedPath: before.plannedPath ?? null }, after)
    const wasSent = before.approvalStatus === 'PENDING' || before.approvalStatus === 'APPROVED'
    // No approval: a journey made that way stays that way when edited (an older client that does not
    // send the choice changes nothing), and is never pushed back to Draft or Pending. One that was
    // sent for approval (or rejected) cannot skip it by editing.
    const wasNoApproval = before.approvalStatus === 'NOT_REQUIRED'
    const sentBefore = wasSent || before.approvalStatus === 'REJECTED'
    if (b.needsApproval === false && sentBefore) throw badRequest('Validation failed', { needsApproval: 'A journey that was sent for approval cannot skip it' })
    const skip = b.needsApproval === false || (wasNoApproval && b.needsApproval === undefined)
    const resend = !skip && ((material && wasSent) || (b.submit && before.approvalStatus !== 'PENDING'))
    const data = { ...cols, vehicleLabel: cols.vehicleLabel || before.vehicleLabel, convoy: cols.convoy ?? Prisma.DbNull }
    if (skip) {
      if (!wasNoApproval) assertMaySkipApproval(settings)
      if (!wasNoApproval || new Date(b.plannedStart).getTime() !== new Date(before.plannedStart).getTime()) assertNotPast(b.plannedStart)
      await checkDriver(driver, b.plannedStart)
      if (!wasNoApproval) Object.assign(data, NO_APPROVAL_COLUMNS)
    } else if (wasNoApproval && !resend) {
      // The planner switched "Needs approval" on again: back to a draft, not yet sent.
      Object.assign(data, { status: 'Draft', approvalStatus: 'NONE' })
    }
    if (resend) {
      await checkDriver(driver, b.plannedStart)
      // Edits to what was approved go back for approval (design §A.2).
      Object.assign(data, {
        status: 'Draft', approvalStatus: 'PENDING', submittedAt: new Date(), submittedById: req.user.id, submittedByName: who(req.user),
        decidedById: null, decidedByName: null, decidedAt: null, rejectReason: null,
      })
    }
    const write = async db => {
      if (material) {
        await db.journeyStop.deleteMany({ where: { journeyId: before.id } })
        await db.journeyStop.createMany({ data: stopRows(plan.stops).map(s => ({ ...s, journeyId: before.id, polygon: s.polygon ?? undefined })) })
      } else {
        // Same plan: only the per-stop flags that are not part of the plan.
        for (const [seq, s] of plan.stops.entries()) {
          await db.journeyStop.updateMany({
            where: { journeyId: before.id, seq },
            data: {
              name: s.name, signatureRequired: s.signatureRequired, visitVia: s.visitVia, purpose: s.purpose, loadState: s.loadState,
              addressId: s.addressId, formId: s.formId, formName: s.formName, formFields: s.formFields ?? undefined,
            },
          })
        }
      }
      return db.journey.update({ where: { id: before.id }, data, include: LIST_INCLUDE })
    }
    // A Scheduled journey holds its vehicle, so a no-approval edit takes the same lock as a send.
    const row = resend || skip ? await withVehicleCheck({ ...data, id: before.id, excludeId: before.id }, write) : await prisma.$transaction(write)
    if (resend) await notifyApproval(row, req.user)
    else if (skip && !wasNoApproval) {
      await recordEvent(row, { type: 'CREATED_WITHOUT_APPROVAL', message: `Saved without approval by ${who(req.user) ?? 'someone'}`, actor: req.user, fromStatus: before.status, toStatus: 'Scheduled' }, { settings, alert: false })
    }
    res.json({ data: publicJourney(row), resent: resend, warnings: await warningsFor(row) })
  })
)

router.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const j = await loadJourney(req, { full: false })
    if (j.status !== 'Draft' || j.approvalStatus === 'PENDING') throw conflict('Only a draft or a rejected journey can be sent for approval')
    if (j.plannedStart.getTime() < Date.now() - 6 * 3600 * 1000) throw badRequest('This journey was planned for the past — change its start time first')
    if (j.driverId) await checkDriver(await prisma.driver.findUnique({ where: { id: j.driverId } }), j.plannedStart)
    const row = await withVehicleCheck({ ...j, excludeId: j.id }, tx => tx.journey.update({
      where: { id: j.id },
      data: { approvalStatus: 'PENDING', submittedAt: new Date(), submittedById: req.user.id, submittedByName: who(req.user), rejectReason: null, decidedAt: null, decidedById: null, decidedByName: null },
      include: LIST_INCLUDE,
    }))
    await notifyApproval(row, req.user)
    res.json({ data: publicJourney(row), warnings: await warningsFor(row) })
  })
)

function assertApprover(req, j) {
  if (!canApproveJourneys(req.user, req.scope.role)) throw forbidden('Only an approver can approve or reject journeys')
  if (j.createdById === req.user.id || j.submittedById === req.user.id) {
    throw forbidden('You created or sent this journey, so another approver must check it')
  }
  if (j.approvalStatus !== 'PENDING' || j.status !== 'Draft') throw conflict('This journey is not waiting for approval')
}

router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const j = await loadJourney(req, { full: false })
    assertApprover(req, j)
    if (j.driverId) await checkDriver(await prisma.driver.findUnique({ where: { id: j.driverId } }), j.plannedStart)
    const row = await withVehicleCheck({ ...j, excludeId: j.id }, tx => tx.journey.update({
      where: { id: j.id },
      data: { status: 'Scheduled', approvalStatus: 'APPROVED', decidedById: req.user.id, decidedByName: who(req.user), decidedAt: new Date(), rejectReason: null },
      include: LIST_INCLUDE,
    }))
    await recordEvent(row, { type: 'APPROVED', message: `Approved by ${who(req.user)}`, actor: req.user, fromStatus: 'Draft', toStatus: 'Scheduled' }, {
      alert: true, notify: [row.createdById, row.submittedById].filter(id => id !== req.user.id),
    })
    res.json({ data: publicJourney(row) })
  })
)

router.post(
  '/:id/reject',
  validate(reasonSchema),
  asyncHandler(async (req, res) => {
    const j = await loadJourney(req, { full: false })
    assertApprover(req, j)
    const row = await prisma.journey.update({
      where: { id: j.id },
      data: { approvalStatus: 'REJECTED', decidedById: req.user.id, decidedByName: who(req.user), decidedAt: new Date(), rejectReason: req.body.reason },
      include: LIST_INCLUDE,
    })
    await recordEvent(row, { type: 'REJECTED', message: `Rejected by ${who(req.user)}: ${req.body.reason}`, actor: req.user }, {
      alert: true, notify: [row.createdById, row.submittedById].filter(id => id !== req.user.id),
    })
    res.json({ data: publicJourney(row) })
  })
)

router.post(
  '/:id/cancel',
  validate(optionalReason),
  asyncHandler(async (req, res) => {
    need(req, 'addDelete')
    const j = await loadJourney(req, { full: false })
    if (FINAL.includes(j.status)) throw conflict('This journey is already finished')
    const reason = req.body.reason || null
    if (ACTIVE.includes(j.status) && !reason) throw badRequest('Validation failed', { reason: 'Say why a journey on the road is cancelled' })
    const row = await prisma.journey.update({
      where: { id: j.id },
      data: { status: 'Cancelled', cancelledAt: new Date(), cancelReason: reason, cancelledByName: who(req.user), etaAt: null },
      include: LIST_INCLUDE,
    })
    await recordEvent(row, { type: 'CANCELLED', message: `Cancelled by ${who(req.user)}${reason ? `: ${reason}` : ''}`, actor: req.user, fromStatus: j.status, toStatus: 'Cancelled' }, { alert: false })
    res.json({ data: publicJourney(row) })
  })
)

router.post(
  '/:id/notes',
  validate(noteSchema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const j = await loadJourney(req, { full: false })
    const e = await recordEvent(j, { type: 'NOTE', message: req.body.text, actor: req.user }, { alert: false })
    res.status(201).json({ data: e })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    need(req, 'addDelete')
    const j = await loadJourney(req, { full: false })
    if (j.status !== 'Draft') throw conflict('Only a draft can be deleted — cancel an approved journey instead')
    await prisma.journey.delete({ where: { id: j.id } })
    res.json({ data: { id: j.id } })
  })
)

// ── proof of delivery ───────────────────────────────────────────────────────

async function stopOf(req) {
  const j = await loadJourney(req, { full: false })
  const seq = Number(req.params.seq)
  const stop = j.stops.find(s => s.seq === seq)
  if (!Number.isInteger(seq) || !stop) throw notFound('Stop')
  return { j, stop }
}

router.post(
  '/:id/stops/:seq/signature',
  validate(signatureSchema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const { j, stop } = await stopOf(req)
    if (j.status === 'Cancelled') throw conflict('This journey was cancelled')
    if (stop.signature) throw conflict('This stop is already signed')
    const data = fromBase64(req.body.data)
    const mimeType = sniffImage(data)
    if (!mimeType) throw badRequest('Upload the signature as a PNG, JPEG or WebP image', { data: 'Unsupported file type' })
    if (data.length > MAX_SIGNATURE_BYTES) throw new HttpError(413, 'The signature image is too large (max 512 KB)')
    const signedByName = req.body.signedByName || null
    await prisma.journeySignature.create({
      data: { stopId: stop.id, signedByName, source: req.body.source, mimeType, size: data.length, data, uploadedByName: who(req.user) },
    })
    await recordEvent(j, { type: 'SIGNATURE', stopSeq: stop.seq, message: `${stop.name}: signed${signedByName ? ` by ${signedByName}` : ''}`, actor: req.user }, { alert: false })
    const fresh = await prisma.journeyStop.findUnique({ where: { id: stop.id }, select: STOP_SELECT })
    res.status(201).json({ data: publicStop(fresh) })
  })
)

router.get(
  '/:id/stops/:seq/signature',
  asyncHandler(async (req, res) => {
    const { stop } = await stopOf(req)
    const sig = await prisma.journeySignature.findUnique({ where: { stopId: stop.id }, select: { mimeType: true, data: true } })
    if (!sig) throw notFound('Signature')
    res.set('Content-Type', sig.mimeType)
    res.set('Cache-Control', 'private, no-store')
    res.send(Buffer.from(sig.data))
  })
)

// ── at a stop: check in, form, photos (the office; the driver uses its link) ──

router.post(
  '/:id/stops/:seq/check-in',
  validate(z.object({ at: z.coerce.date().optional() })),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const { j, stop } = await stopOf(req)
    const at = req.body.at ?? new Date()
    if (at.getTime() > Date.now() + 60_000) throw badRequest('Validation failed', { at: 'Not in the future' })
    const row = await checkInStop(j, stop, { source: 'OFFICE', byName: who(req.user), at, via: 'OFFICE' })
    res.json({ data: publicStop(row) })
  })
)

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024
const photoSchema = z.object({
  data: z.string().min(16).max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 64),
  fieldKey: z.union([z.string().trim().max(40), z.null()]).optional(),
  caption: z.union([z.string().trim().max(200), z.null()]).optional(),
})

/** Stores one stop photo; shared with the driver link. */
export async function savePhoto(j, stop, body, { source, byName }) {
  const data = fromBase64(body.data)
  const mimeType = sniffImage(data)
  if (!mimeType) throw badRequest('Upload the photo as a PNG, JPEG or WebP image', { data: 'Unsupported file type' })
  if (data.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'The photo is too large (max 3 MB)')
  const count = await prisma.journeyStopPhoto.count({ where: { stopId: stop.id } })
  if (count >= 20) throw conflict('A stop keeps up to 20 photos')
  const row = await prisma.journeyStopPhoto.create({
    data: { stopId: stop.id, fieldKey: body.fieldKey || null, caption: body.caption || null, source, mimeType, size: data.length, data, uploadedByName: byName },
    select: { id: true, fieldKey: true, caption: true, source: true, takenAt: true },
  })
  await recordEvent(j, { type: 'PHOTO', stopSeq: stop.seq, message: `${stop.name}: photo${body.caption ? ` (${body.caption})` : ''}${byName ? ` by ${byName}` : ''}` }, { alert: false })
  return row
}

/** Stores the stop's form answers; shared with the driver link. */
export async function saveForm(j, stop, answersIn, { source, byName }) {
  if (!Array.isArray(stop.formFields) || !stop.formFields.length) throw badRequest('This stop has no form')
  if (stop.form) throw conflict('The form of this stop is already filled')
  const photoIds = new Set((await prisma.journeyStopPhoto.findMany({ where: { stopId: stop.id }, select: { id: true } })).map(p => p.id))
  const { answers, errors } = checkAnswers(stop.formFields, answersIn)
  for (const f of stop.formFields) {
    if (f.type === 'PHOTO' && answers[f.key] && !photoIds.has(answers[f.key])) errors[f.key] = 'Take the photo again'
  }
  if (Object.keys(errors).length) throw badRequest('Validation failed', errors)
  await prisma.journeyStopForm.create({
    data: { stopId: stop.id, formName: stop.formName ?? 'Form', fields: stop.formFields, answers, source, submittedByName: byName },
  })
  await recordEvent(j, { type: 'FORM', stopSeq: stop.seq, message: `${stop.name}: ${stop.formName ?? 'form'} filled${byName ? ` by ${byName}` : ''}` }, { alert: false })
}

router.post(
  '/:id/stops/:seq/photos',
  validate(photoSchema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const { j, stop } = await stopOf(req)
    res.status(201).json({ data: await savePhoto(j, stop, req.body, { source: 'WEB', byName: who(req.user) }) })
  })
)

router.get(
  '/:id/stops/:seq/photos/:photoId',
  asyncHandler(async (req, res) => {
    const { stop } = await stopOf(req)
    const p = await prisma.journeyStopPhoto.findFirst({ where: { id: req.params.photoId, stopId: stop.id }, select: { mimeType: true, data: true } })
    if (!p) throw notFound('Photo')
    res.set('Content-Type', p.mimeType)
    res.set('Cache-Control', 'private, no-store')
    res.send(Buffer.from(p.data))
  })
)

router.post(
  '/:id/stops/:seq/form',
  validate(z.object({ answers: z.record(z.string(), z.any()) })),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const { j, stop } = await stopOf(req)
    await saveForm(j, stop, req.body.answers, { source: 'WEB', byName: who(req.user) })
    const fresh = await prisma.journeyStop.findUnique({ where: { id: stop.id }, select: STOP_SELECT })
    res.status(201).json({ data: publicStop(fresh) })
  })
)

// ── public links: tracking (customer) and driver ───────────────────────────

const newLinkToken = () => crypto.randomBytes(24).toString('base64url')
const linkShape = l => ({
  id: l.id, kind: l.kind, token: l.token, expiresAt: l.expiresAt.toISOString(), revokedAt: l.revokedAt?.toISOString() ?? null,
  createdByName: l.createdByName, createdAt: l.createdAt.toISOString(), lastOpenedAt: l.lastOpenedAt?.toISOString() ?? null,
})

router.get(
  '/:id/links',
  asyncHandler(async (req, res) => {
    const j = await loadJourney(req, { full: false })
    const rows = await prisma.journeyLink.findMany({ where: { journeyId: j.id }, orderBy: { createdAt: 'desc' }, take: 50 })
    res.set('Cache-Control', 'no-store')
    res.json({ data: rows.map(linkShape) })
  })
)

router.post(
  '/:id/links',
  validate(z.object({ kind: z.enum(['TRACK', 'DRIVER']), hours: z.coerce.number().int().min(1).max(24 * 31).optional() })),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const j = await loadJourney(req, { full: false })
    if (j.status === 'Cancelled') throw conflict('This journey was cancelled')
    const settings = await getJourneySettings(j.bgId)
    const hours = req.body.hours ?? (req.body.kind === 'TRACK' ? settings.trackLinkHours : settings.driverLinkHours)
    const row = await prisma.journeyLink.create({
      data: { journeyId: j.id, kind: req.body.kind, token: newLinkToken(), expiresAt: new Date(Date.now() + hours * 3600_000), createdByName: who(req.user) },
    })
    await recordEvent(j, { type: 'LINK', message: `${req.body.kind === 'TRACK' ? 'Tracking' : 'Driver'} link made by ${who(req.user)}, open ${hours} h`, actor: req.user }, { alert: false })
    res.status(201).json({ data: linkShape(row) })
  })
)

router.delete(
  '/:id/links/:linkId',
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const j = await loadJourney(req, { full: false })
    const l = await prisma.journeyLink.findFirst({ where: { id: req.params.linkId, journeyId: j.id } })
    if (!l) throw notFound('Link')
    const row = await prisma.journeyLink.update({ where: { id: l.id }, data: { revokedAt: l.revokedAt ?? new Date() } })
    res.json({ data: linkShape(row) })
  })
)

// ── expenses on a journey ───────────────────────────────────────────────────

/** Expense = Edit on Settings › Expense (as /api/expenses), and a role that may write expenses. */
function needExpenseWrite(req) {
  assertCanWrite(req.scope, 'expense')
  if (req.scope.role !== 'SUPER_ADMIN' && !atLeast(levelOf(req.user?.screenAccess, '/settings/expense'), 'modify')) {
    throw forbidden('You do not have permission to change expenses')
  }
}

const expenseShape = e => ({
  id: e.id, category: e.category, type: e.type, subType: e.subType, amount: e.amount, vendor: e.vendor, referenceNo: e.referenceNo,
  description: e.description, expenseDate: e.expenseDate?.toISOString().slice(0, 10) ?? null, vehicleLabel: e.vehicleLabel,
  journeyId: e.journeyId, createdByName: e.createdByName,
})

/** The journey's expenses, and the vehicle's unlinked ones around its dates to pick from. */
router.get(
  '/:id/expenses',
  asyncHandler(async (req, res) => {
    const j = await loadJourney(req, { full: false })
    const from = new Date((j.actualStart ?? j.plannedStart).getTime() - 3 * 86_400_000)
    const to = new Date((j.completedAt ?? j.expectedArrival).getTime() + 3 * 86_400_000)
    const [linked, candidates] = await Promise.all([
      prisma.expense.findMany({ where: { journeyId: j.id }, orderBy: { expenseDate: 'asc' } }),
      j.vehicleId
        ? prisma.expense.findMany({
          where: scopedWhere('expense', req.scope, { vehicleId: j.vehicleId, journeyId: null, OR: [{ expenseDate: { gte: from, lte: to } }, { createdAt: { gte: from, lte: to } }] }),
          orderBy: { expenseDate: 'desc' }, take: 50,
        })
        : [],
    ])
    res.set('Cache-Control', 'no-store')
    res.json({
      data: {
        linked: linked.map(expenseShape), candidates: candidates.map(expenseShape),
        total: Math.round(linked.reduce((s, e) => s + e.amount, 0) * 100) / 100,
        types: EXPENSE_TYPES.Variable,
      },
    })
  })
)

router.post(
  '/:id/expenses',
  validate(z.object({
    type: z.string().trim().min(1).max(40),
    amount: z.coerce.number().positive().max(100_000_000),
    expenseDate: z.coerce.date().optional(),
    vendor: z.union([z.string().trim().max(120), z.null()]).optional(),
    referenceNo: z.union([z.string().trim().max(60), z.null()]).optional(),
    description: z.union([z.string().trim().max(1000), z.null()]).optional(),
  })),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    needExpenseWrite(req)
    const j = await loadJourney(req, { full: false })
    if (!EXPENSE_TYPES.Variable.includes(req.body.type)) throw badRequest('Validation failed', { type: 'Not an expense type' })
    if (!j.vehicleId) throw badRequest('This journey has no vehicle to charge the expense to')
    const vehicle = await prisma.vehicle.findUnique({ where: { id: j.vehicleId } })
    const e = await prisma.expense.create({
      data: {
        bgId: vehicle?.bgId ?? j.bgId, vehicleId: j.vehicleId, vehicleLabel: j.vehicleLabel, category: 'Variable', type: req.body.type,
        expenseDate: req.body.expenseDate ?? new Date(), amount: req.body.amount, vendor: req.body.vendor || null,
        referenceNo: req.body.referenceNo || null, description: req.body.description || `${journeyRef(j)} ${j.title}`,
        journeyId: j.id, createdById: req.user.id, createdByName: who(req.user),
      },
    })
    await recordEvent(j, { type: 'EXPENSE', message: `${e.type} ${e.amount.toFixed(2)} added by ${who(req.user)}`, value: e.amount, actor: req.user }, { alert: false })
    res.status(201).json({ data: expenseShape(e) })
  })
)

router.post(
  '/:id/expenses/link',
  validate(z.object({ expenseId: z.string().trim().min(1) })),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    needExpenseWrite(req)
    const j = await loadJourney(req, { full: false })
    const e = await findScopedOrThrow('expense', req.body.expenseId, req.scope)
    if (e.journeyId && e.journeyId !== j.id) throw conflict('This expense belongs to another journey')
    const row = await prisma.expense.update({ where: { id: e.id }, data: { journeyId: j.id } })
    res.json({ data: expenseShape(row) })
  })
)

router.delete(
  '/:id/expenses/:expenseId',
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    needExpenseWrite(req)
    const j = await loadJourney(req, { full: false })
    const e = await prisma.expense.findFirst({ where: { id: req.params.expenseId, journeyId: j.id } })
    if (!e) throw notFound('Expense')
    // Unlinked only: the expense stays on the vehicle.
    const row = await prisma.expense.update({ where: { id: e.id }, data: { journeyId: null } })
    res.json({ data: expenseShape(row) })
  })
)

export default router
