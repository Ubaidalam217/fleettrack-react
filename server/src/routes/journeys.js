/**
 * /api/journeys — Journey Management (client 2026-11-13/16/17, design §A).
 *
 *   GET    /                         list (date window + everything on the road + waiting for HSE), with counts
 *   GET    /options                  what New Journey needs: vehicles, drivers, geofences, saved routes, settings, rights
 *   GET    /availability             is this vehicle free then? (the form's "Free at this time")
 *   GET    /route-from-trip          a past trip's track for "Copy a past trip" (GET-only telemetry read)
 *   GET    /:id                      the detail page: stops, events, path, violations in the window
 *   POST   /                         create (Draft; `submit: true` also sends it for HSE approval)
 *   PUT    /:id                      edit the plan; a material change sends it back for approval
 *   POST   /:id/submit               Draft / Rejected → Pending HSE approval
 *   POST   /:id/approve              Pending → Scheduled (journey-approval; never your own)
 *   POST   /:id/reject   { reason }  Pending → Rejected (back to Draft)
 *   POST   /:id/cancel   { reason }  any non-final state → Cancelled (Journeys = Full)
 *   POST   /:id/notes    { text }    an office note on the timeline
 *   DELETE /:id                      a draft (Journeys = Full)
 *   POST   /:id/stops/:seq/signature { data, signedByName }   proof of delivery (the driver app uses it in phase 2)
 *   GET    /:id/stops/:seq/signature the image, authenticated
 *
 * Permissions (design §A.6): Journeys View = read, Edit = create / edit / send,
 * Full = delete drafts and cancel. "Journey approval (HSE)" is deny-by-default
 * (lib/permissions.js) and nobody approves a journey they created or sent.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
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
  ACTIVE, EDITABLE, FINAL, LIST_INCLUDE, STOP_SELECT, approversOf, buildPlan, driverOverlap, driverProblems,
  findOverlap, journeyTypeOf, overlapMessage, publicJourney, publicStop, recordEvent, withVehicleCheck,
} from '../lib/journeys.js'
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

const stopSchema = z.object({
  name: z.string().trim().min(1, 'Name the stop').max(120),
  arrivalType: z.enum(['RADIUS', 'GEOFENCE']).default('RADIUS'),
  geofenceId: z.union([z.string().trim().min(1), z.null()]).optional(),
  lat, lng,
  radiusM: z.coerce.number().int().min(30, 'At least 30 m').max(20000).optional(),
  stayMin: z.coerce.number().int().min(0).max(1440).default(0),
  legDriveMin: z.union([z.coerce.number().int().min(0).max(4320), z.null()]).optional(),
  legSource: z.enum(['SPEED', 'TRIP', 'MANUAL']).optional(),
  signatureRequired: z.boolean().default(false),
})

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
  routeSource: z.enum(['PAST_TRIP', 'DRAWN', 'STRAIGHT']).default('STRAIGHT'),
  plannedPath: z.union([z.array(z.array(z.number()).min(2)).max(20000), z.null()]).optional(),
  recordedFrom: z.union([z.record(z.string(), z.any()), z.null()]).optional(),
  routeTemplateId: z.union([z.string().trim().min(1), z.null()]).optional(),
  stops: z.array(stopSchema).min(2, 'A journey needs a start and a destination').max(40),
  submit: z.boolean().default(false),
})

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
  return { vehicle, driver }
}

/** The fields a plan writes, from a validated body. */
async function planColumns(req, settings) {
  const b = req.body
  const geofences = await geofencesFor(req, b.stops)
  const plan = buildPlan({
    plannedStart: b.plannedStart, routeSource: b.routeSource, plannedPath: b.plannedPath,
    stops: b.stops, settings, geofences,
  })
  if (!plan.expectedArrival || plan.expectedArrival <= b.plannedStart) {
    throw badRequest('Validation failed', { stops: 'The arrival must be after the start' })
  }
  return { plan, type: journeyTypeOf(b.stops, b.type) }
}

const stopRows = stops => stops.map((s, seq) => ({
  seq, kind: s.kind, name: s.name, arrivalType: s.arrivalType, geofenceId: s.geofenceId, lat: s.lat, lng: s.lng,
  radiusM: s.radiusM, polygon: s.polygon ?? undefined, stayMin: s.stayMin, legKm: s.legKm, legDriveMin: s.legDriveMin,
  legSource: s.legSource, alongKm: s.alongKm, plannedArrive: s.plannedArrive, plannedDepart: s.plannedDepart,
  signatureRequired: s.signatureRequired,
}))

/** Does an edit change what HSE approved (vehicle, driver, route, stops, times)? */
function materialChange(before, after) {
  const key = j => JSON.stringify({
    v: j.vehicleId, d: j.driverId ?? null, s: new Date(j.plannedStart).getTime(), r: j.routeSource,
    p: j.plannedPath ?? null,
    st: j.stops.map(s => [s.name, s.arrivalType, s.geofenceId ?? null, +(+s.lat).toFixed(6), +(+s.lng).toFixed(6), s.radiusM, s.stayMin, s.legDriveMin, new Date(s.plannedArrive ?? 0).getTime()]),
  })
  return key(before) !== key(after)
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
  await recordEvent(j, { type: 'SUBMITTED', message: `Sent for HSE approval by ${who(actor) ?? 'someone'}`, actor }, {
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

/** The HSE queue: waiting, decided today, rejected — with the caller's right to decide. */
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
    const [vehicles, drivers, geofences, templates, customers, settings] = await Promise.all([
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
    ])
    res.set('Cache-Control', 'no-store')
    res.json({
      data: {
        bgs, bgId,
        vehicles: vehicles.map(v => ({ ...v, label: vehicleLabel(v) })).sort((a, b) => a.label.localeCompare(b.label)),
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
    res.set('Cache-Control', 'no-store')
    res.json({
      data: {
        ...publicJourney(j, { full: true }),
        events: j.events.map(e => ({ ...e, occurredAt: e.occurredAt.toISOString(), endedAt: e.endedAt?.toISOString() ?? null })),
        violations,
        settings: { onTimeMin: settings.onTimeMin, lateArrivalMin: settings.lateArrivalMin },
        can: {
          edit: atLeast(level, 'modify') && EDITABLE.includes(j.status),
          submit: atLeast(level, 'modify') && j.status === 'Draft' && j.approvalStatus !== 'PENDING',
          approve: j.approvalStatus === 'PENDING' && canApproveJourneys(req.user, req.scope.role) && !own,
          cancel: atLeast(level, 'addDelete') && !FINAL.includes(j.status),
          delete: atLeast(level, 'addDelete') && j.status === 'Draft',
          note: atLeast(level, 'modify'),
          sign: atLeast(level, 'modify'),
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
    const { vehicle, driver } = await resolveAssignment(req)
    const bgId = await journeyBgId(req, vehicle)
    const settings = await getJourneySettings(bgId)
    const { plan, type } = await planColumns(req, settings)
    const b = req.body
    const data = {
      bgId, title: b.title, customer: b.customer, priority: b.priority, type, instructions: b.instructions,
      vehicleId: vehicle.id, vehicleLabel: vehicleLabel(vehicle) || 'Vehicle', driverId: driver?.id ?? null, driverName: driver?.name ?? null,
      plannedStart: b.plannedStart, expectedArrival: plan.expectedArrival,
      plannedDistanceKm: plan.plannedDistanceKm, plannedDriveMin: plan.plannedDriveMin, plannedStayMin: plan.plannedStayMin,
      routeSource: b.routeSource, routeTemplateId: b.routeTemplateId ?? null,
      plannedPath: plan.plannedPath ?? undefined, recordedFrom: b.recordedFrom ?? undefined,
      createdById: req.user.id, createdByName: who(req.user),
    }
    if (b.submit) {
      await checkDriver(driver, b.plannedStart)
      Object.assign(data, { approvalStatus: 'PENDING', submittedAt: new Date(), submittedById: req.user.id, submittedByName: who(req.user) })
    }
    const create = db => db.journey.create({ data: { ...data, stops: { create: stopRows(plan.stops) } }, include: LIST_INCLUDE })
    const row = b.submit ? await withVehicleCheck(data, create) : await create(prisma)
    if (b.submit) await notifyApproval(row, req.user)
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
    const { vehicle, driver } = await resolveAssignment(req)
    await assertInFleet(before.bgId, vehicle)
    const settings = await getJourneySettings(before.bgId)
    const { plan, type } = await planColumns(req, settings)
    const b = req.body
    const after = {
      vehicleId: vehicle.id, driverId: driver?.id ?? null, plannedStart: b.plannedStart, routeSource: b.routeSource,
      plannedPath: plan.plannedPath ?? null, stops: plan.stops,
    }
    const material = materialChange({ ...before, plannedPath: before.plannedPath ?? null }, after)
    const wasSent = before.approvalStatus === 'PENDING' || before.approvalStatus === 'APPROVED'
    const resend = (material && wasSent) || (b.submit && before.approvalStatus !== 'PENDING')
    const data = {
      title: b.title, customer: b.customer, priority: b.priority, type, instructions: b.instructions,
      vehicleId: vehicle.id, vehicleLabel: vehicleLabel(vehicle) || before.vehicleLabel, driverId: driver?.id ?? null, driverName: driver?.name ?? null,
      plannedStart: b.plannedStart, expectedArrival: plan.expectedArrival,
      plannedDistanceKm: plan.plannedDistanceKm, plannedDriveMin: plan.plannedDriveMin, plannedStayMin: plan.plannedStayMin,
      routeSource: b.routeSource, routeTemplateId: b.routeTemplateId ?? null,
      plannedPath: plan.plannedPath ?? undefined, recordedFrom: b.recordedFrom ?? undefined,
    }
    if (resend) {
      await checkDriver(driver, b.plannedStart)
      // Edits to what HSE approved go back to HSE (design §A.2).
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
          await db.journeyStop.updateMany({ where: { journeyId: before.id, seq }, data: { name: s.name, signatureRequired: s.signatureRequired } })
        }
      }
      return db.journey.update({ where: { id: before.id }, data, include: LIST_INCLUDE })
    }
    const row = resend ? await withVehicleCheck({ ...data, id: before.id, excludeId: before.id }, write) : await prisma.$transaction(write)
    if (resend) await notifyApproval(row, req.user)
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
  if (!canApproveJourneys(req.user, req.scope.role)) throw forbidden('Only an HSE approver can approve or reject journeys')
  if (j.createdById === req.user.id || j.submittedById === req.user.id) {
    throw forbidden('You created or sent this journey, so another HSE approver must check it')
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

export default router
