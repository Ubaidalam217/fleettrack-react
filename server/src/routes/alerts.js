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
import { assertCanWrite, assertWritableParent, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const alertFields = {
  name: requiredText('Name'),
  /**
   * Registry-driven on the frontend (ALERT_TYPES), and 'temperature' is the only
   * entry today. A free string rather than an enum so adding the next type is a
   * frontend change plus a validator, not a migration.
   */
  type: z.string().trim().min(1).default('temperature'),
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
  if (!body.allVehicles && body.vehicleIds.length === 0) {
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

    // Cleared, not stored, when the mode is "all" — see the note at the top.
    const vehicleIds = req.body.allVehicles ? [] : await resolveVehicles(bg.id, req.body.vehicleIds)

    const row = await prisma.alert.create({
      data: {
        name: req.body.name,
        type: req.body.type,
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

    const vehicleIds = req.body.allVehicles
      ? []
      : await resolveVehicles(existing.bgId, req.body.vehicleIds)

    const row = await prisma.$transaction(async tx => {
      await tx.alertVehicle.deleteMany({ where: { alertId: existing.id } })
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
