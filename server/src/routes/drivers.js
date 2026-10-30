/**
 * /api/drivers — a BG's drivers, each optionally assigned to one of its vehicles.
 *
 * A vehicle has at most one driver (Driver.vehicleId is unique). Assigning a
 * vehicle that already has a driver MOVES it: the other driver is unassigned in
 * the same transaction, which is what an operator handing a truck to someone else
 * means, and the answer names who lost it so the form can say so.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest } from '../lib/http.js'
import { optionalId, optionalText, requiredId, requiredText, statusField } from '../lib/fields.js'
import { assertCanWrite, assertWritableParent, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

/** "YYYY-MM-DD" → UTC midnight, "" / null → null. */
const optionalDate = () =>
  z
    .union([z.string(), z.null()])
    .default(null)
    .transform(v => (v ? String(v).trim() : ''))
    .refine(v => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), 'Use a date like 2027-03-31')
    .transform(v => (v === '' ? null : new Date(`${v}T00:00:00Z`)))

const driverFields = {
  name: requiredText('Name', 120),
  mobile: optionalText(30),
  licenseNo: optionalText(60),
  licenseExpiry: optionalDate(),
  vehicleId: optionalId(),
  notes: optionalText(1000),
  status: statusField(),
}

const createSchema = z.object({ bgId: requiredId('Business group'), ...driverFields })
const updateSchema = z.object(driverFields)
const listQuery = z.object({ bgId: z.string().trim().min(1).optional() })

const INCLUDE = {
  bg: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNo: true, fleetNo: true, imei: true } },
}

/** The API's date form: "YYYY-MM-DD", the same thing the form sends. */
const publicDriver = d => (d ? { ...d, licenseExpiry: d.licenseExpiry ? d.licenseExpiry.toISOString().slice(0, 10) : null } : null)

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
    const { bgId } = req.validatedQuery
    const rows = await prisma.driver.findMany({
      where: scopedWhere('driver', req.scope, bgId ? { bgId } : null),
      orderBy: { name: 'asc' },
      include: INCLUDE,
    })
    res.json({ data: rows.map(publicDriver) })
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
    const { previous } = await resolveVehicle(bg.id, req.body.vehicleId, null)
    const { bgId: _ignored, ...fields } = req.body
    const row = await prisma.$transaction(async tx => {
      if (previous) await tx.driver.update({ where: { id: previous.id }, data: { vehicleId: null } })
      return tx.driver.create({ data: { ...fields, bgId: bg.id }, include: INCLUDE })
    })
    res.status(201).json({ data: publicDriver(row), movedFrom: previous })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const existing = await findScopedOrThrow('driver', req.params.id, req.scope)
    const { previous } = await resolveVehicle(existing.bgId, req.body.vehicleId, existing.id)
    const row = await prisma.$transaction(async tx => {
      if (previous) await tx.driver.update({ where: { id: previous.id }, data: { vehicleId: null } })
      return tx.driver.update({ where: { id: existing.id }, data: req.body, include: INCLUDE })
    })
    res.json({ data: publicDriver(row), movedFrom: previous })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'driver')
    const existing = await findScopedOrThrow('driver', req.params.id, req.scope)
    await prisma.driver.delete({ where: { id: existing.id } })
    res.json({ data: { id: existing.id } })
  })
)

export default router
