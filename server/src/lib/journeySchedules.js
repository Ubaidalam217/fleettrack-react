/**
 * Journey templates and schedules (client 2026-11-21, after Uffizio's Job
 * module): the engine's side.
 *
 *   rollSchedules(now)   RELATIVE schedules: make each day's journey ahead of
 *                        time (horizonDays), once per day per schedule. A
 *                        journey from an HSE-approved template starts
 *                        Scheduled; otherwise it waits for HSE like any other.
 *   automaticStep(...)   AUTOMATIC schedules: watch the vehicle at the
 *                        template's first stop; when it leaves, make a journey
 *                        that has already started (pure, tested).
 *   forceClose(now)      an unfinished journey this long after its planned
 *                        arrival (Journey settings › force close, or its own)
 *                        is closed: Cancelled, with the reason, shown as
 *                        "Force closed".
 *
 * All three run from lib/journeyEngine.js runJourneyPass, on the alert tick.
 */

import prisma from '../prisma.js'
import { getJourneySettings } from './journeySettings.js'
import {
  ACTIVE, LIST_INCLUDE, approversOf, journeyColumns, recordEvent, stopRows, withVehicleCheck,
} from './journeys.js'
import { upcoming, uaeDateKey } from '../../../src/utils/journeyRecurrence.js'
import { inStop } from '../../../src/utils/journeyGeo.js'
import { haversineMeters } from '../../../src/utils/distance.js'

/** A schedule is looked at again at most this often. */
const ROLL_EVERY_MS = 15 * 60_000

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The geofences and forms a template's stops use, by id (checked when the template was saved). */
async function lookups(body) {
  const stops = Array.isArray(body?.stops) ? body.stops : []
  const gIds = [...new Set(stops.map(s => s.geofenceId).filter(Boolean))]
  const fIds = [...new Set(stops.map(s => s.formId).filter(Boolean))]
  const [g, f] = await Promise.all([
    gIds.length ? prisma.geofence.findMany({ where: { id: { in: gIds } } }) : [],
    fIds.length ? prisma.journeyFormTemplate.findMany({ where: { id: { in: fIds } } }) : [],
  ])
  return { geofences: new Map(g.map(x => [x.id, x])), forms: new Map(f.map(x => [x.id, x])) }
}

/**
 * Makes one journey from a template. kind RELATIVE: for the day `occurrenceKey`
 * at `plannedStart`. kind AUTOMATIC: already left the first stop at `startedAt`.
 * Returns the journey, or { skipped: reason }.
 */
export async function makeInstance(t, { plannedStart, occurrenceKey, kind = 'RELATIVE', startedAt = null, engineState = null }) {
  if (!t.vehicleId) return { skipped: 'The schedule has no vehicle' }
  const vehicle = await prisma.vehicle.findFirst({ where: { id: t.vehicleId, deletedAt: null } })
  if (!vehicle) return { skipped: 'The vehicle no longer exists' }
  const driver = t.driverId ? await prisma.driver.findFirst({ where: { id: t.driverId, deletedAt: null } }) : null
  const convoyIds = Array.isArray(t.body?.convoy) ? t.body.convoy : []
  const convoy = convoyIds.length ? await prisma.vehicle.findMany({ where: { id: { in: convoyIds }, deletedAt: null } }) : []
  const settings = await getJourneySettings(t.bgId)
  const { geofences, forms } = await lookups(t.body)
  let cols, plan
  try {
    ;({ data: cols, plan } = journeyColumns({ ...t.body, plannedStart }, { vehicle, driver, convoy, settings, geofences, forms }))
  } catch (err) {
    return { skipped: err.details ? Object.values(err.details)[0] : err.message }
  }
  const approved = t.autoApprove
  const now = new Date()
  const data = {
    ...cols,
    bgId: t.bgId, scheduleKind: kind, templateId: t.id, occurrenceKey,
    createdById: t.createdById, createdByName: `Schedule · ${t.name}`,
    ...(approved
      ? { status: kind === 'AUTOMATIC' ? 'Started' : 'Scheduled', approvalStatus: 'APPROVED', decidedById: t.approvedById, decidedByName: `${t.approvedByName ?? 'HSE'} (approved template)`, decidedAt: now }
      : { status: 'Draft', approvalStatus: 'PENDING', submittedAt: now, submittedByName: `Schedule · ${t.name}` }),
    ...(kind === 'AUTOMATIC' ? { actualStart: startedAt, engineState: engineState ?? undefined } : {}),
  }
  const stops = stopRows(plan.stops)
  if (kind === 'AUTOMATIC' && startedAt) Object.assign(stops[0], { status: 'DEPARTED', actualDepart: startedAt, checkInSource: 'AUTO' })
  let row
  try {
    row = await withVehicleCheck(data, tx => tx.journey.create({ data: { ...data, stops: { create: stops } }, include: LIST_INCLUDE }))
  } catch (err) {
    if (err.code === 'P2002') return { skipped: 'Already made' }
    if (err.status === 409) return { skipped: err.message }
    throw err
  }
  await recordEvent(row, { type: 'CREATED', message: `Made by the schedule "${t.name}"${approved ? ' (HSE-approved template)' : ''}` }, { settings, alert: false })
  if (!approved) {
    const people = (await approversOf(row.bgId)).filter(u => u.id !== t.createdById).map(u => u.id)
    await recordEvent(row, { type: 'SUBMITTED', message: `Sent for HSE approval by the schedule "${t.name}"` }, { settings, alert: true, notify: people })
  }
  return row
}

/**
 * RELATIVE schedules: the days in the horizon not made yet. A day is tried
 * once (generatedUntil moves on even when the vehicle was busy; lastError says
 * why it was skipped), so a journey deleted by hand does not come back.
 */
export async function rollSchedules(now = Date.now(), { templateId = null, force = false } = {}) {
  const templates = await prisma.journeyTemplate.findMany({
    where: { active: true, scheduleKind: 'RELATIVE', vehicleId: { not: null }, ...(templateId ? { id: templateId } : {}) },
  })
  let made = 0
  for (const t of templates) {
    if (!force && t.lastRunAt && now - t.lastRunAt.getTime() < ROLL_EVERY_MS) continue
    const due = upcoming(t, now).filter(o => !t.generatedUntil || o.key > t.generatedUntil)
    const errors = []
    let until = t.generatedUntil
    for (const o of due) {
      try {
        const r = await makeInstance(t, { plannedStart: o.start, occurrenceKey: o.key })
        if (r?.skipped) { if (r.skipped !== 'Already made') errors.push(`${o.key}: ${r.skipped}`) } else made++
      } catch (err) {
        errors.push(`${o.key}: ${err.message}`)
      }
      until = o.key
    }
    await prisma.journeyTemplate.update({
      where: { id: t.id },
      data: { lastRunAt: new Date(now), generatedUntil: until, ...(due.length ? { lastError: errors.length ? errors.join(' · ').slice(0, 1000) : null } : {}) },
    })
  }
  return made
}

// ── AUTOMATIC ───────────────────────────────────────────────────────────────

/**
 * One AUTOMATIC schedule against its vehicle's new fixes: seen inside the
 * template's first stop, then outside for departAfterSec (or well clear of
 * it) = it left. Ignition logic: with IGNITION_ON, the ignition switching on
 * inside the stop is the start. Returns { state, startedAt? (unix s) }.
 */
export function automaticStep({ state, origin, fixes, settings, startLogic = 'ANY_DATA' }) {
  const st = { lastTs: null, inside: false, insideAt: null, outSince: null, ignOn: null, ...(state ?? {}) }
  let startedAt = null
  for (const f of fixes) {
    if (st.lastTs != null && f.ts <= st.lastTs) continue
    st.lastTs = f.ts
    if (startedAt) continue
    const isIn = inStop(f.lat, f.lng, origin)
    if (isIn) {
      st.inside = true
      st.insideAt ??= f.ts
      st.outSince = null
      if (startLogic === 'IGNITION_ON' && f.ign === true && st.ignOn === false) startedAt = f.ts
      st.ignOn = f.ign
      continue
    }
    if (!st.inside) continue
    st.outSince ??= f.ts
    const far = haversineMeters(f.lat, f.lng, origin.lat, origin.lng) > (origin.radiusM || 300) + 200
    if (f.ts - st.outSince >= settings.departAfterSec || far) startedAt = st.outSince
  }
  if (startedAt) Object.assign(st, { inside: false, insideAt: null, outSince: null, ignOn: null })
  return { state: st, startedAt }
}

const fixOf = m => {
  const lat = num(m['position.latitude']), lng = num(m['position.longitude'])
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null
  const ign = m['engine.ignition.status']
  return { lat, lng, ts: m.timestamp, speed: num(m['position.speed']) ?? 0, ign: typeof ign === 'boolean' ? ign : null }
}

/** The AUTOMATIC schedules the engine watches (approved, active, valid today, with a vehicle). */
export async function automaticTemplates(now = Date.now()) {
  const today = uaeDateKey(now)
  const rows = await prisma.journeyTemplate.findMany({
    where: { active: true, scheduleKind: 'AUTOMATIC', autoApprove: true, vehicleId: { not: null } },
    include: { vehicle: { select: { imei: true } } },
  })
  return rows.filter(t => (!t.validFrom || uaeDateKey(t.validFrom) <= today) && (!t.validTo || uaeDateKey(t.validTo) >= today))
}

/**
 * The AUTOMATIC pass: `messagesOf(template)` gives the vehicle's messages
 * since the last pass. A vehicle already on a journey is not watched.
 */
export async function runAutomatic(templates, messagesOf, now = Math.floor(Date.now() / 1000)) {
  let made = 0
  for (const t of templates) {
    const busy = await prisma.journey.count({ where: { vehicleId: t.vehicleId, status: { in: ACTIVE } } })
    const origin = t.body?.stops?.[0]
    if (!origin || !Number.isFinite(origin.lat)) continue
    const settings = await getJourneySettings(t.bgId)
    const fixes = (messagesOf(t) ?? []).map(fixOf).filter(Boolean)
    if (busy) {
      // On a journey: only keep the clock, so its fixes are not replayed later.
      const last = fixes[fixes.length - 1]
      if (last) await prisma.journeyTemplate.update({ where: { id: t.id }, data: { engineState: { lastTs: last.ts, inside: false } } })
      continue
    }
    const { state, startedAt } = automaticStep({ state: t.engineState, origin: { ...origin, radiusM: origin.radiusM ?? settings.defaultRadiusM }, fixes, settings, startLogic: t.body?.startLogic })
    if (startedAt) {
      const at = new Date(startedAt * 1000)
      const r = await makeInstance(t, {
        plannedStart: at, occurrenceKey: `${uaeDateKey(at)}T${at.toISOString().slice(11, 19)}`, kind: 'AUTOMATIC', startedAt: at,
        engineState: { lastTs: startedAt, originSeen: true, next: 1 },
      })
      if (!r?.skipped) made++
      else await prisma.journeyTemplate.update({ where: { id: t.id }, data: { lastError: String(r.skipped).slice(0, 1000) } })
    }
    await prisma.journeyTemplate.update({ where: { id: t.id }, data: { engineState: state, lastRunAt: new Date(now * 1000) } })
  }
  return made
}

// ── force close ─────────────────────────────────────────────────────────────

/** Minutes after its planned arrival that this journey closes itself (0 = never). */
export const forceCloseAfterMin = (j, settings) => (j.forceCloseMin ?? Math.round(settings.forceCloseHours * 60))

/** Should it be closed at `now` (ms)? Pure, for the tests. */
export function dueForceClose(j, settings, now = Date.now()) {
  const after = forceCloseAfterMin(j, settings)
  if (!(after > 0)) return false
  if (!['Scheduled', ...ACTIVE].includes(j.status)) return false
  return now >= new Date(j.expectedArrival).getTime() + after * 60_000
}

export async function forceClose(now = Date.now()) {
  const rows = await prisma.journey.findMany({
    where: { status: { in: ['Scheduled', ...ACTIVE] }, expectedArrival: { lt: new Date(now) } },
    take: 500,
  })
  let closed = 0
  for (const j of rows) {
    const settings = await getJourneySettings(j.bgId)
    if (!dueForceClose(j, settings, now)) continue
    const after = forceCloseAfterMin(j, settings)
    const h = after % 60 ? `${after} min` : `${after / 60} h`
    const reason = j.status === 'Scheduled'
      ? `Force closed: it never started, ${h} after its planned arrival`
      : `Force closed: not finished ${h} after its planned arrival`
    const at = new Date(now)
    // Only if it is still in the state read (the engine may have just finished it).
    const { count } = await prisma.journey.updateMany({
      where: { id: j.id, status: j.status },
      data: { status: 'Cancelled', cancelledAt: at, cancelReason: reason, cancelledByName: 'Force close', forceClosedAt: at, etaAt: null },
    })
    if (!count) continue
    await recordEvent(j, { type: 'FORCE_CLOSED', fromStatus: j.status, toStatus: 'Cancelled', occurredAt: at, message: reason }, { settings })
    closed++
  }
  return closed
}
