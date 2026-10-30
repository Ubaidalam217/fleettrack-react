/**
 * /api/alerts — rules watching some slice of one BG's fleet.
 *
 * `allVehicles` is a mode, not a snapshot: when it is true the explicit vehicle
 * list is cleared rather than filled in, so a rule written today still covers a
 * vehicle added next month. Expanding "all" into ids at write time is the bug
 * where fleet coverage silently stops growing with the fleet.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest } from '../lib/http.js'
import {
  booleanField,
  idList,
  jsonObject,
  optionalNumber,
  requiredId,
  requiredText,
  statusField,
} from '../lib/fields.js'
import { publicAlert } from '../lib/serialize.js'
import { SEVERITIES, TYPES } from '../lib/alertEngine.js'
import { assertCanWrite, assertWritableParent, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const alertFields = {
  name: requiredText('Name'),
  /**
   * One of the engine's TYPES (lib/alertEngine.js). Still a string column, so a
   * new type is a code change, not a migration.
   */
  type: z.enum(Object.keys(TYPES)).default('temperature'),
  severity: z.enum(SEVERITIES).default('Medium'),
  params: jsonObject(),
  emails: z
    .array(z.string().trim().toLowerCase().email('Not a valid email address'))
    .max(20, 'At most 20 recipients')
    .default([])
    .transform(v => [...new Set(v)]),
  // booleanField, not z.coerce.boolean() — the latter reads the string "false" as
  // true, and this is the flag that decides "one vehicle" versus "the whole fleet".
  allVehicles: booleanField(true),
  vehicleIds: idList(),
  minTemp: optionalNumber(),
  maxTemp: optionalNumber(),
  notify: jsonObject(),
  status: statusField(),
}

const createSchema = z.object({ bgId: requiredId('Business group'), ...alertFields })
const updateSchema = z.object(alertFields)

const listQuerySchema = z.object({
  bgId: z.string().trim().min(1).optional(),
})

const ALERT_INCLUDE = {
  bg: { select: { id: true, name: true } },
  vehicles: { select: { vehicleId: true } },
}

/**
 * Shape rules that span fields, so they cannot live on the schema.
 *
 * The temperature pair is checked here rather than as a zod refine because the
 * message has to name a field for the form, and because a type other than
 * 'temperature' has no bounds to check at all.
 */
const positive = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** The type's own settings, filled from its defaults and checked; returns them clean. */
function cleanParams(body) {
  const p = { ...TYPES[body.type].defaults, ...(body.params ?? {}) }
  const num = k => (p[k] === '' || p[k] === null || p[k] === undefined ? NaN : Number(p[k]))
  switch (body.type) {
    case 'overspeed':
      if (!positive(num('speedKmh'), 10, 300)) throw badRequest('Set a speed limit between 10 and 300 km/h', { speedKmh: '10–300 km/h' })
      return { speedKmh: num('speedKmh') }
    case 'idle':
    case 'offline':
      if (!positive(num('minutes'), 1, 1440)) throw badRequest('Set the minutes between 1 and 1440', { minutes: '1–1440 minutes' })
      return { minutes: num('minutes') }
    case 'geofence_enter':
    case 'geofence_exit':
      return { geofenceIds: Array.isArray(p.geofenceIds) ? [...new Set(p.geofenceIds.map(String))] : [] }
    case 'night_driving':
      if (!HHMM.test(p.from) || !HHMM.test(p.to) || p.from === p.to) {
        throw badRequest('Set a night window such as 23:00 to 05:00', { from: 'HH:MM', to: 'HH:MM' })
      }
      if (!positive(num('minSpeedKmh'), 1, 200)) throw badRequest('Set a minimum speed between 1 and 200 km/h', { minSpeedKmh: '1–200 km/h' })
      return { from: p.from, to: p.to, minSpeedKmh: num('minSpeedKmh') }
    case 'license_expiry':
      if (!positive(num('days'), 1, 365)) throw badRequest('Warn between 1 and 365 days before expiry', { days: '1–365 days' })
      return { days: num('days') }
    default:
      return {}
  }
}

/** The geofences an entry/exit rule names, confirmed to be in its own BG. */
async function assertGeofences(bgId, params) {
  if (!params.geofenceIds?.length) return
  const n = await prisma.geofence.count({ where: { id: { in: params.geofenceIds }, bgId } })
  if (n !== params.geofenceIds.length) {
    throw badRequest('Geofences must belong to the alert’s own business group', { geofenceIds: 'Not in this business group' })
  }
}

function assertConsistent(body) {
  if (body.type === 'temperature') {
    if (body.minTemp === null && body.maxTemp === null) {
      throw badRequest('A temperature alert needs a minimum, a maximum, or both', {
        maxTemp: 'Set at least one bound',
      })
    }
    if (body.minTemp !== null && body.maxTemp !== null && body.minTemp > body.maxTemp) {
      throw badRequest('Minimum temperature cannot be above the maximum', {
        minTemp: 'Must not exceed the maximum',
      })
    }
  }
  if (body.notify?.email && body.emails.length === 0) {
    throw badRequest('Add at least one email address, or turn email off', { emails: 'Add an email address' })
  }
  if (body.type !== 'license_expiry' && !body.allVehicles && body.vehicleIds.length === 0) {
    // An alert scoped to specific vehicles but naming none watches nothing, and
    // reads on the page as covering something.
    throw badRequest('Select at least one vehicle, or switch the alert to all vehicles', {
      vehicleIds: 'Select at least one vehicle',
    })
  }
}

/** The named vehicles, confirmed to be in this alert's own BG. */
async function resolveVehicles(bgId, ids) {
  if (!ids.length) return []
  const rows = await prisma.vehicle.findMany({
    where: { id: { in: ids }, bgId },
    select: { id: true },
  })
  if (rows.length !== ids.length) {
    const found = new Set(rows.map(r => r.id))
    throw badRequest('Vehicles must belong to the alert’s own business group', {
      vehicleIds: `Not in this business group: ${ids.filter(id => !found.has(id)).join(', ')}`,
    })
  }
  return rows.map(r => r.id)
}

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId } = req.validatedQuery
    const rows = await prisma.alert.findMany({
      where: scopedWhere('alert', req.scope, bgId ? { bgId } : null),
      orderBy: { name: 'asc' },
      include: ALERT_INCLUDE,
    })
    res.json({ data: rows.map(publicAlert) })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('alert', req.params.id, req.scope, {
      include: ALERT_INCLUDE,
    })
    res.json({ data: publicAlert(row) })
  })
)

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'alert')
    const bg = await assertWritableParent(req.scope, 'bg', req.body.bgId)
    assertConsistent(req.body)
    const params = cleanParams(req.body)
    await assertGeofences(bg.id, params)

    // Cleared, not stored, when the mode is "all" — see the note at the top.
    const vehicleIds = req.body.allVehicles ? [] : await resolveVehicles(bg.id, req.body.vehicleIds)

    const row = await prisma.alert.create({
      data: {
        name: req.body.name,
        type: req.body.type,
        severity: req.body.severity,
        params,
        emails: req.body.emails,
        bgId: bg.id,
        allVehicles: req.body.allVehicles,
        minTemp: req.body.minTemp,
        maxTemp: req.body.maxTemp,
        notify: req.body.notify ?? undefined,
        status: req.body.status,
        vehicles: { create: vehicleIds.map(vehicleId => ({ vehicleId })) },
      },
      include: ALERT_INCLUDE,
    })
    res.status(201).json({ data: publicAlert(row) })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'alert')
    const existing = await findScopedOrThrow('alert', req.params.id, req.scope)
    assertConsistent(req.body)
    const params = cleanParams(req.body)
    await assertGeofences(existing.bgId, params)

    const vehicleIds = req.body.allVehicles
      ? []
      : await resolveVehicles(existing.bgId, req.body.vehicleIds)

    const row = await prisma.$transaction(async tx => {
      await tx.alertVehicle.deleteMany({ where: { alertId: existing.id } })
      // A changed rule starts over: what the engine remembered under the old
      // settings (inside which fence, over which limit) no longer applies.
      await tx.alertState.deleteMany({ where: { alertId: existing.id } })
      if (vehicleIds.length) {
        await tx.alertVehicle.createMany({
          data: vehicleIds.map(vehicleId => ({ alertId: existing.id, vehicleId })),
        })
      }
      return tx.alert.update({
        where: { id: existing.id },
        data: {
          name: req.body.name,
          type: req.body.type,
          severity: req.body.severity,
          params,
          emails: req.body.emails,
          allVehicles: req.body.allVehicles,
          minTemp: req.body.minTemp,
          maxTemp: req.body.maxTemp,
          notify: req.body.notify ?? undefined,
          status: req.body.status,
        },
        include: ALERT_INCLUDE,
      })
    })

    res.json({ data: publicAlert(row) })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'alert')
    const existing = await findScopedOrThrow('alert', req.params.id, req.scope)
    await prisma.alert.delete({ where: { id: existing.id } })
    res.json({ data: { id: existing.id } })
  })
)

export default router
