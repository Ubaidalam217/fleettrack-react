/**
 * Journey Management, the parts the routes and the engine share: the plan
 * (stops + chained schedule), the one-vehicle-one-journey lock, the journey
 * event log with its bell entries and pushes, and the serialisers.
 *
 * Design: journey-design.md §A (client 2026-11-16) and the voice note of
 * 2026-11-17 (six arrival/departure events, chained schedule, signature).
 */

import crypto from 'node:crypto'
import prisma from '../prisma.js'
import { badRequest, conflict } from './http.js'
import { pushToUsers } from './push.js'
import { canApproveJourneys } from './permissions.js'
import { getJourneySettings } from './journeySettings.js'
import { vehicleLabel } from './vehicleLabel.js'
import { haversineMeters } from '../../../src/utils/distance.js'
import { stopsAlong, straightPath, pathKm, simplifyPath } from '../../../src/utils/journeyGeo.js'
import { computeSchedule, displayStatus, journeyRef, diffText } from '../../../src/utils/journeySchedule.js'

export const ACTIVE = Object.freeze(['Started', 'InProgress', 'Delayed', 'Interrupted'])
export const FINAL = Object.freeze(['Completed', 'Cancelled'])
/** Statuses a journey can still be edited in (the plan, not the actuals). */
export const EDITABLE = Object.freeze(['Draft', 'Scheduled'])

/**
 * Every journey event type: its label, default severity, and — for the six
 * arrival/departure events — the Journey settings switch that decides whether
 * it also rings the bell. `alert: true` always raises one; false never does.
 */
export const EVENT_TYPES = Object.freeze({
  STATUS: { label: 'Status', alert: false },
  SUBMITTED: { label: 'Sent for HSE approval', alert: false },
  APPROVED: { label: 'Approved by HSE', alert: false },
  REJECTED: { label: 'Rejected by HSE', alert: false },
  CANCELLED: { label: 'Cancelled', alert: false },
  NOTE: { label: 'Note', alert: false },
  SIGNATURE: { label: 'Signed', alert: false },
  DEPART_EARLY: { label: 'Early departure', severity: 'Low', setting: 'departEarly' },
  DEPART_ON_TIME: { label: 'On-time departure', severity: 'Low', setting: 'departOnTime' },
  DEPART_LATE: { label: 'Late departure', severity: 'Medium', setting: 'departLate' },
  ARRIVE_EARLY: { label: 'Early arrival', severity: 'Low', setting: 'arriveEarly' },
  ARRIVE_ON_TIME: { label: 'On-time arrival', severity: 'Low', setting: 'arriveOnTime' },
  ARRIVE_LATE: { label: 'Late arrival', severity: 'Medium', setting: 'arriveLate' },
  NOT_DEPARTED: { label: 'Not departed', severity: 'Medium', alert: true },
  DELAYED: { label: 'Running late', severity: 'Medium', alert: true },
  OFF_ROUTE: { label: 'Off route', severity: 'High', alert: true },
  UNPLANNED_STOP: { label: 'Unplanned stop', severity: 'Medium', alert: true },
  SKIPPED_STOP: { label: 'Stop missed', severity: 'Medium', alert: true },
  NO_SIGNAL: { label: 'No signal', severity: 'High', alert: true },
  SIGNAL_BACK: { label: 'Signal back', alert: false },
  BREAK_DUE: { label: 'Break due (HSE)', severity: 'Medium', alert: true },
  DAILY_LIMIT: { label: 'Daily driving limit (HSE)', severity: 'High', alert: true },
  // The rest of the Uffizio Job module (client 2026-11-21).
  CREATED: { label: 'Made by a schedule', alert: false },
  FORCE_CLOSED: { label: 'Force closed', severity: 'Medium', alert: true },
  DESTINATION_PASSED: { label: 'Drove past the destination', severity: 'Low', alert: false },
  CONVOY_SEPARATED: { label: 'Convoy separated', severity: 'High', alert: true },
  CONVOY_REJOINED: { label: 'Convoy back together', alert: false },
  TEMP_OUT_OF_RANGE: { label: 'Temperature out of range', severity: 'High', alert: true },
  TEMP_BACK: { label: 'Temperature back in range', alert: false },
  CHECK_IN: { label: 'Checked in', alert: false },
  FORM: { label: 'Form filled', alert: false },
  PHOTO: { label: 'Photo', alert: false },
  LINK: { label: 'Link shared', alert: false },
  EXPENSE: { label: 'Expense', alert: false },
})

/** Stop states (the address book's "state", Uffizio's loading / unloading). */
export const STOP_PURPOSES = Object.freeze(['LOADING', 'UNLOADING', 'DELIVERY', 'REST', 'OTHER'])

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** A stop's code: 6 characters, no 0/O or 1/I to misread when typed. */
export function newStopCode() {
  const bytes = crypto.randomBytes(6)
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/** Does this event ring the bell / push under these settings? */
export function isAlertWorthy(type, settings, { atEndpoint = true } = {}) {
  const t = EVENT_TYPES[type]
  if (!t) return false
  if (t.setting) {
    if (!atEndpoint && !settings.eventAlerts.atStops) return false
    return Boolean(settings.eventAlerts[t.setting])
  }
  if (t.alert && ['BREAK_DUE', 'DAILY_LIMIT'].includes(type)) return settings.hseBreaks
  return Boolean(t.alert)
}

const who = user => user?.shortName || user?.email || null

// ── the plan ────────────────────────────────────────────────────────────────

/** First and last stop within 300 m: a round trip. */
export function journeyTypeOf(stops, given) {
  if (given) return given
  if (stops.length > 2) return 'MULTI_STOP'
  const a = stops[0], b = stops[stops.length - 1]
  return a && b && haversineMeters(a.lat, a.lng, b.lat, b.lng) < 300 ? 'ROUND_TRIP' : 'ONE_WAY'
}

const centroid = pts => ({
  lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
  lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
})

/**
 * The stops as stored: geofence shapes snapshotted, positions along the
 * path, and the chained schedule. `geofences` = the caller's visible
 * geofences by id.
 */
export function buildPlan({ plannedStart, routeSource, plannedPath, stops, settings, geofences, forms = new Map(), keepCodes = new Map() }) {
  const usedCodes = new Set()
  const snap = stops.map((s, i) => {
    const base = {
      name: s.name.trim(),
      kind: i === 0 ? 'ORIGIN' : i === stops.length - 1 ? 'DESTINATION' : 'STOP',
      arrivalType: s.arrivalType === 'GEOFENCE' ? 'GEOFENCE' : 'RADIUS',
      geofenceId: null,
      lat: s.lat,
      lng: s.lng,
      radiusM: Math.round(s.radiusM ?? settings.defaultRadiusM),
      polygon: null,
      stayMin: s.stayMin ?? 0,
      legDriveMin: s.legDriveMin ?? null,
      legSource: s.legSource ?? null,
      signatureRequired: Boolean(s.signatureRequired),
      visitVia: s.visitVia === 'QR' ? 'QR' : 'MAP',
      purpose: STOP_PURPOSES.includes(s.purpose) ? s.purpose : null,
      loadState: s.loadState || null,
      addressId: s.addressId || null,
      formId: null, formName: null, formFields: null,
    }
    // Every stop has a code (its QR sheet, and what the driver types when the
    // camera cannot read it); an edit keeps a stop's code so printed sheets stay right.
    let code = keepCodes.get(base.name.toLowerCase()) ?? null
    while (!code || usedCodes.has(code)) code = newStopCode()
    usedCodes.add(code)
    base.code = code
    if (s.formId) {
      const f = forms.get(s.formId)
      if (!f) throw badRequest('Validation failed', { [`stops.${i}.formId`]: 'Pick one of your forms' })
      Object.assign(base, { formId: f.id, formName: f.name, formFields: f.fields })
    }
    if (base.arrivalType === 'GEOFENCE') {
      const g = s.geofenceId ? geofences.get(s.geofenceId) : null
      if (!g) throw badRequest('Validation failed', { [`stops.${i}.geofenceId`]: 'Pick a geofence' })
      base.geofenceId = g.id
      if (g.shape === 'CIRCLE' && g.centerLat != null) {
        Object.assign(base, { lat: g.centerLat, lng: g.centerLng, radiusM: Math.round(g.radius || base.radiusM) })
      } else if (Array.isArray(g.points) && g.points.length >= 3) {
        const pts = g.points.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }))
        const c = centroid(pts)
        const far = Math.max(...pts.map(p => haversineMeters(c.lat, c.lng, p.lat, p.lng)))
        Object.assign(base, { lat: c.lat, lng: c.lng, polygon: pts, radiusM: Math.round(far) })
      }
    }
    return base
  })

  const hasLine = routeSource !== 'STRAIGHT' && Array.isArray(plannedPath) && plannedPath.length >= 2
  const path = hasLine ? simplifyPath(plannedPath.map(p => [Number(p[0]), Number(p[1])]), 15) : null
  const along = stopsAlong(path, snap)
  snap.forEach((s, i) => {
    s.alongKm = Math.round(along[i] * 1000) / 1000
    s.legKm = i === 0 ? 0 : Math.max(0, along[i] - along[i - 1])
  })
  const schedule = computeSchedule({ plannedStart, speedKmh: settings.plannedSpeedKmh, stops: snap })
  const distanceKm = path ? Math.round(pathKm(path) * 10) / 10 : schedule.distanceKm
  return {
    stops: schedule.stops,
    plannedPath: path,
    expectedArrival: schedule.expectedArrival,
    plannedDistanceKm: distanceKm,
    plannedDriveMin: schedule.driveMin,
    plannedStayMin: schedule.stayMin,
  }
}

/** The line the engine measures against: the planned path, else straight legs. */
export const lineOf = (journey, stops) =>
  (Array.isArray(journey.plannedPath) && journey.plannedPath.length >= 2 ? journey.plannedPath : straightPath(stops))

// ── one vehicle, one journey ────────────────────────────────────────────────

/** Statuses that hold a vehicle: sent for approval, approved, or on the road. */
const HOLDING = { OR: [{ status: 'Draft', approvalStatus: 'PENDING' }, { status: { in: ['Scheduled', ...ACTIVE] } }] }

/**
 * Another journey that already holds this vehicle at this time. Global, not
 * per BG: a vehicle shared into two BGs is still one truck. A journey on the
 * road blocks until it is Completed or Cancelled, even past its own window.
 */
export async function findOverlap(db, { vehicleId, plannedStart, expectedArrival, excludeId }) {
  if (!vehicleId) return null
  return db.journey.findFirst({
    where: {
      vehicleId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      AND: [
        HOLDING,
        {
          OR: [
            { plannedStart: { lt: expectedArrival }, expectedArrival: { gt: plannedStart } },
            { status: { in: ACTIVE }, plannedStart: { lt: expectedArrival } },
          ],
        },
      ],
    },
    select: { id: true, journeyNo: true, plannedStart: true, expectedArrival: true, vehicleLabel: true, title: true, status: true, approvalStatus: true },
    orderBy: { plannedStart: 'asc' },
  })
}

const UAE = 4 * 3600 * 1000
const hhmm = d => new Date(new Date(d).getTime() + UAE).toISOString().slice(11, 16)
const dayHHmm = d => {
  const x = new Date(new Date(d).getTime() + UAE)
  return `${x.toISOString().slice(8, 10)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()]} ${x.toISOString().slice(11, 16)}`
}

export function overlapMessage(label, other) {
  return `${label} already has a journey at this time: ${journeyRef(other)} · ${dayHHmm(other.plannedStart)}–${hhmm(other.expectedArrival)}. One vehicle can only have one journey at a time.`
}

/**
 * Runs `fn(tx)` holding the vehicle's advisory lock, after refusing (409) when
 * another journey holds the vehicle. Two planners sending the same truck at
 * the same moment queue on the lock; the second sees the first's journey.
 */
export async function withVehicleCheck(journey, fn) {
  return prisma.$transaction(async tx => {
    if (journey.vehicleId) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${journey.vehicleId}))::text AS locked`
      const other = await findOverlap(tx, journey)
      if (other) throw conflict(overlapMessage(journey.vehicleLabel || other.vehicleLabel, other), { vehicleId: 'Busy at this time', journeyId: other.id })
    }
    return fn(tx)
  })
}

/** The same driver on another journey at the same time: a warning only (open point 5). */
export async function driverOverlap(db, { driverId, plannedStart, expectedArrival, excludeId }) {
  if (!driverId) return null
  return db.journey.findFirst({
    where: {
      driverId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      AND: [HOLDING, { plannedStart: { lt: expectedArrival }, expectedArrival: { gt: plannedStart } }],
    },
    select: { id: true, journeyNo: true, plannedStart: true, expectedArrival: true },
  })
}

/** Why this driver may not take this journey; [] when fine. */
export function driverProblems(driver, at) {
  if (!driver) return []
  const out = []
  if (driver.deletedAt) out.push(`${driver.name} has been removed`)
  if (driver.status === 'Suspended') out.push(`${driver.name} is suspended`)
  else if (driver.status === 'Inactive') out.push(`${driver.name} is inactive`)
  const t = new Date(at).getTime()
  if (driver.licenseExpiry && driver.licenseExpiry.getTime() < t) out.push(`${driver.name}'s driving licence expired on ${driver.licenseExpiry.toISOString().slice(0, 10)}`)
  if (driver.medicalExpiry && driver.medicalExpiry.getTime() < t) out.push(`${driver.name}'s medical expired on ${driver.medicalExpiry.toISOString().slice(0, 10)}`)
  return out
}

// ── who hears about it ──────────────────────────────────────────────────────

/** Accounts that may approve journeys of this BG (not counting Super Admins, who are not told). */
export async function approversOf(bgId) {
  const bg = await prisma.businessGroup.findUnique({ where: { id: bgId }, select: { id: true, groupId: true, ggbId: true } })
  if (!bg) return []
  const users = await prisma.user.findMany({
    where: {
      status: 'Active',
      role: { not: 'SUPER_ADMIN' },
      OR: [{ bgId }, ...(bg.groupId ? [{ groupId: bg.groupId }] : []), { ggbId: bg.ggbId }],
    },
    select: { id: true, role: true, screenAccess: true, shortName: true, email: true },
  })
  return users.filter(u => canApproveJourneys(u, u.role))
}

/** The BG's own admin accounts (stage 2 of the escalation). */
export async function bgAdminsOf(bgId) {
  return prisma.user.findMany({ where: { bgId, role: 'BG_USER', status: 'Active' }, select: { id: true } })
}

/**
 * Records one journey event. When it is alert-worthy it also becomes a bell
 * entry (an AlertEvent with no rule, type journey_<type>) and a push to the
 * creator and the approver (stage 1); stage 2 is lib/journeyEngine.js
 * escalate(). Returns the JourneyEvent.
 *
 * @param {object} j        the journey row (id, bgId, vehicleId, driverId, createdById, decidedById, …)
 * @param {object} e        { type, message, severity?, stopSeq?, value?, lat?, lng?, occurredAt?, fromStatus?, toStatus?, actor?, endedAt?, durationSec? }
 * @param {object} opts     { settings, alert?: boolean (force), atEndpoint?: boolean, notify?: userIds (instead of creator + approver) }
 */
export async function recordEvent(j, e, { settings, alert, atEndpoint = true, notify } = {}) {
  const meta = EVENT_TYPES[e.type] ?? {}
  const st = settings ?? await getJourneySettings(j.bgId)
  const ring = alert ?? isAlertWorthy(e.type, st, { atEndpoint })
  const occurredAt = e.occurredAt ?? new Date()
  let alertEventId = null
  const title = `Journey · ${meta.label ?? e.type}`
  const message = `${j.vehicleLabel} · ${journeyRef(j)} ${j.title}: ${e.message}`
  if (ring) {
    const a = await prisma.alertEvent.create({
      data: {
        alertId: null, bgId: j.bgId, vehicleId: j.vehicleId ?? null, driverId: j.driverId ?? null,
        type: `journey_${e.type.toLowerCase()}`, severity: e.severity ?? meta.severity ?? 'Medium',
        title, message, value: e.value ?? null, lat: e.lat ?? null, lng: e.lng ?? null, occurredAt,
        // Web channel off: kept in Notifications, but the bell does not ring.
        readAt: st.channels.web ? null : new Date(),
      },
    })
    alertEventId = a.id
  }
  const row = await prisma.journeyEvent.create({
    data: {
      journeyId: j.id, bgId: j.bgId, type: e.type, severity: e.severity ?? meta.severity ?? null,
      fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null, stopSeq: e.stopSeq ?? null,
      message: e.message, value: e.value ?? null, lat: e.lat ?? null, lng: e.lng ?? null, occurredAt,
      endedAt: e.endedAt ?? null, durationSec: e.durationSec ?? null,
      auto: !e.actor, actorId: e.actor?.id ?? null, actorName: who(e.actor),
      alertEventId,
    },
  })
  if (ring) {
    const people = notify ?? (st.recipients.creatorAndApprover ? [j.createdById, j.decidedById] : [])
    await sendNotices(row, people, { title, body: message, stage: 1, settings: st, journeyId: j.id })
  }
  return row
}

/** Push to these accounts and log one JourneyNotice per person (and channel). */
export async function sendNotices(event, userIds, { title, body, stage, settings, journeyId }) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return []
  const rows = []
  if (settings.channels.push) {
    const res = await pushToUsers(ids, { title, body, data: { kind: 'journey', journeyId, eventId: event.alertEventId ?? '' } })
    for (const id of ids) rows.push({ journeyEventId: event.id, userId: id, channel: 'PUSH', stage, status: res[id] ?? 'FAILED' })
  }
  if (settings.channels.whatsapp) {
    // lib/whatsapp.js is a stub until the client's account exists.
    for (const id of ids) rows.push({ journeyEventId: event.id, userId: id, channel: 'WHATSAPP', stage, status: 'SKIPPED_NOT_CONFIGURED' })
  }
  if (!rows.length) {
    // Push off: still remember who was told on the web, so stage 2 is not repeated.
    for (const id of ids) rows.push({ journeyEventId: event.id, userId: id, channel: 'WEB', stage, status: 'SENT' })
  }
  await prisma.journeyNotice.createMany({ data: rows })
  return rows
}

// ── serialisers ─────────────────────────────────────────────────────────────

export const STOP_SELECT = {
  id: true, seq: true, kind: true, name: true, arrivalType: true, geofenceId: true, lat: true, lng: true, radiusM: true,
  polygon: true, stayMin: true, legKm: true, legDriveMin: true, legSource: true, alongKm: true, plannedArrive: true,
  plannedDepart: true, signatureRequired: true, status: true, actualArrive: true, actualDepart: true, dwellSec: true,
  arriveTiming: true, arriveDiffMin: true, departTiming: true, departDiffMin: true, detectedBy: true,
  checkInSource: true, checkedInAt: true, checkedInByName: true,
  visitVia: true, code: true, purpose: true, loadState: true, addressId: true, formId: true, formName: true, formFields: true,
  signature: { select: { signedByName: true, signedAt: true, source: true, size: true } },
  form: { select: { formName: true, fields: true, answers: true, source: true, submittedByName: true, submittedAt: true } },
  photos: { select: { id: true, fieldKey: true, caption: true, source: true, takenAt: true, uploadedByName: true }, orderBy: { takenAt: 'asc' } },
}

const VEHICLE_SELECT = { select: { id: true, plateNo: true, fleetNo: true, imei: true, vehicleType: true } }
const DRIVER_SELECT = { select: { id: true, name: true, mobile: true, photoKey: true } }

export const LIST_INCLUDE = {
  stops: { select: STOP_SELECT, orderBy: { seq: 'asc' } },
  vehicle: VEHICLE_SELECT,
  driver: DRIVER_SELECT,
}

const iso = d => (d ? new Date(d).toISOString() : null)

export function publicStop(s) {
  return {
    ...s,
    plannedArrive: iso(s.plannedArrive), plannedDepart: iso(s.plannedDepart),
    actualArrive: iso(s.actualArrive), actualDepart: iso(s.actualDepart), checkedInAt: iso(s.checkedInAt),
    signature: s.signature ? { signedByName: s.signature.signedByName, signedAt: iso(s.signature.signedAt), source: s.signature.source } : null,
    form: s.form ? { ...s.form, submittedAt: iso(s.form.submittedAt) } : null,
    photos: (s.photos ?? []).map(p => ({ ...p, takenAt: iso(p.takenAt) })),
  }
}

/** A stop as a public link shows it: no code (the QR is the proof), no photos' bytes. */
export function linkStop(s, { driver = false } = {}) {
  const { code: _code, addressId: _a, formId: _f, geofenceId: _g, polygon, photos, form, signature, ...rest } = publicStop(s)
  return {
    ...rest,
    polygon: driver ? polygon : undefined,
    formFields: driver ? rest.formFields : undefined,
    formDone: Boolean(form),
    photoCount: (photos ?? []).length,
    signed: Boolean(signature),
  }
}

/** A journey as the API sends it. `full` adds the path and the engine-free detail. */
export function publicJourney(j, { full = false } = {}) {
  const { engineState, plannedPath, vehicle, driver, stops, ...rest } = j
  const out = {
    ...rest,
    ref: journeyRef(j),
    display: displayStatus(j),
    // The vehicle's name now (a rename shows at once); the snapshot when it is gone.
    vehicleLabel: vehicle ? vehicleLabel(vehicle) || j.vehicleLabel : j.vehicleLabel,
    vehicleType: vehicle?.vehicleType ?? null,
    driverMobile: driver?.mobile ?? null,
    driverPhotoKey: driver?.photoKey ?? null,
    stops: (stops ?? []).map(publicStop),
    plannedStart: iso(j.plannedStart), expectedArrival: iso(j.expectedArrival), etaAt: iso(j.etaAt),
    actualStart: iso(j.actualStart), actualArrival: iso(j.actualArrival), completedAt: iso(j.completedAt),
    lastFixAt: iso(j.lastFixAt), submittedAt: iso(j.submittedAt), decidedAt: iso(j.decidedAt), cancelledAt: iso(j.cancelledAt),
    hasPath: Array.isArray(plannedPath) && plannedPath.length >= 2,
    stopsDone: (stops ?? []).filter((s, i) => i > 0 && ['ARRIVED', 'DEPARTED', 'PASSED', 'SKIPPED'].includes(s.status)).length,
    nextBreakAt: engineState?.nextBreakAt ?? null,
  }
  if (full) out.plannedPath = plannedPath ?? null
  return out
}

export { diffText }

// ── shared by New Journey, the schedules and route optimization ─────────────

export const JOURNEY_EXTRA_KEYS = Object.freeze([
  'startLogic', 'startBufferMin', 'routeToleranceM', 'forceCloseMin', 'convoyToleranceM', 'loadState', 'tempMin', 'tempMax',
])

/**
 * The columns of a journey from a validated body (routes/journeys.js
 * journeySchema), with its stops planned. `vehicle`, `driver` and `convoy`
 * are rows already checked against the caller's scope; `geofences` and
 * `forms` are Maps by id of the ones the caller may use.
 */
export function journeyColumns(b, { vehicle, driver, convoy = [], settings, geofences, forms, keepCodes }) {
  const plan = buildPlan({
    plannedStart: b.plannedStart, routeSource: b.routeSource, plannedPath: b.plannedPath,
    stops: b.stops, settings, geofences, forms, keepCodes,
  })
  if (!plan.expectedArrival || plan.expectedArrival <= new Date(b.plannedStart)) {
    throw badRequest('Validation failed', { stops: 'The arrival must be after the start' })
  }
  const data = {
    title: b.title, customer: b.customer ?? null, priority: b.priority ?? 'Normal', type: journeyTypeOf(b.stops, b.type), instructions: b.instructions ?? null,
    vehicleId: vehicle.id, vehicleLabel: vehicleLabel(vehicle) || 'Vehicle', driverId: driver?.id ?? null, driverName: driver?.name ?? null,
    plannedStart: new Date(b.plannedStart), expectedArrival: plan.expectedArrival,
    plannedDistanceKm: plan.plannedDistanceKm, plannedDriveMin: plan.plannedDriveMin, plannedStayMin: plan.plannedStayMin,
    routeSource: b.routeSource ?? 'STRAIGHT', routeTemplateId: b.routeTemplateId ?? null,
    plannedPath: plan.plannedPath ?? undefined, recordedFrom: b.recordedFrom ?? undefined,
    startLogic: b.startLogic === 'IGNITION_ON' ? 'IGNITION_ON' : 'ANY_DATA',
    startBufferMin: b.startBufferMin ?? settings.startBufferMin,
    routeToleranceM: b.routeToleranceM ?? null,
    forceCloseMin: b.forceCloseMin ?? null,
    convoy: convoy.length ? convoy.map(v => ({ vehicleId: v.id, vehicleLabel: vehicleLabel(v) || 'Vehicle' })) : undefined,
    convoyToleranceM: b.convoyToleranceM ?? 200,
    loadState: b.loadState ?? null,
    tempMin: b.tempMin ?? null,
    tempMax: b.tempMax ?? null,
  }
  return { data, plan }
}

export const stopRows = stops => stops.map((s, seq) => ({
  seq, kind: s.kind, name: s.name, arrivalType: s.arrivalType, geofenceId: s.geofenceId, lat: s.lat, lng: s.lng,
  radiusM: s.radiusM, polygon: s.polygon ?? undefined, stayMin: s.stayMin, legKm: s.legKm, legDriveMin: s.legDriveMin,
  legSource: s.legSource, alongKm: s.alongKm, plannedArrive: s.plannedArrive, plannedDepart: s.plannedDepart,
  signatureRequired: s.signatureRequired, visitVia: s.visitVia ?? 'MAP', code: s.code ?? null, purpose: s.purpose ?? null,
  loadState: s.loadState ?? null, addressId: s.addressId ?? null, formId: s.formId ?? null, formName: s.formName ?? null,
  formFields: s.formFields ?? undefined,
}))

/**
 * A manual check-in at a stop: the driver (driver link, or its QR scan) or
 * the office. Marks it arrived — or, at the destination, completes the
 * journey — and records the event. The engine picks the state up on its
 * next pass (lib/journeyEngine.js reconcile). Returns the updated stop.
 */
export async function checkInStop(j, stop, { source, byName, at = new Date(), lat = null, lng = null, via = null }) {
  if (FINAL.includes(j.status)) throw conflict('This journey is already finished')
  if (j.status === 'Draft') throw conflict('This journey has not been approved yet')
  if (stop.status !== 'PENDING') throw conflict(`${stop.name} is already checked in`)
  const last = j.stops.length - 1
  const t = stop.plannedArrive ? Math.round((at.getTime() - new Date(stop.plannedArrive).getTime()) / 60000) : null
  const settings = await getJourneySettings(j.bgId)
  const timing = t == null ? null : Math.abs(t) <= settings.onTimeMin ? 'ON_TIME' : t > 0 ? 'LATE' : 'EARLY'
  const isOrigin = stop.seq === 0
  const data = isOrigin
    ? { status: 'ARRIVED', actualArrive: at, checkInSource: source, checkedInAt: at, checkedInByName: byName, detectedBy: via }
    : {
      status: 'ARRIVED', actualArrive: at, checkInSource: source, checkedInAt: at, checkedInByName: byName, detectedBy: via,
      arriveTiming: timing, arriveDiffMin: t,
    }
  const row = await prisma.journeyStop.update({ where: { id: stop.id }, data, select: STOP_SELECT })
  const how = source === 'DRIVER' ? (via === 'QR' ? 'driver scanned the QR' : 'driver checked in') : `checked in by ${byName ?? 'the office'}`
  await recordEvent(j, {
    type: 'CHECK_IN', stopSeq: stop.seq, lat, lng, occurredAt: at, value: t,
    message: `${stop.name}: ${how}${t != null && !isOrigin ? ` (${timing === 'ON_TIME' ? 'on time' : `${diffText(t)}`})` : ''}`,
  }, { settings, alert: false })
  if (stop.seq === last && !isOrigin) {
    // The destination: the journey is done.
    const now = new Date()
    await prisma.journey.update({
      where: { id: j.id },
      data: {
        status: 'Completed', actualArrival: at, completedAt: now, etaAt: null, remainingKm: 0,
        progressKm: j.plannedDistanceKm ?? j.progressKm, delayMin: t,
        actualStart: j.actualStart ?? at,
      },
    })
    await recordEvent(j, { type: 'STATUS', fromStatus: j.status, toStatus: 'Completed', occurredAt: at, message: `Reached ${stop.name} (${how})` }, { settings, alert: false })
  }
  return row
}
