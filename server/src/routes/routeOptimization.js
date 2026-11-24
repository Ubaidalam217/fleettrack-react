/**
 * /api/route-optimization — Journey › Route Optimization (client 2026-11-21,
 * after Uffizio): split delivery points into trips per vehicle within each
 * vehicle's load capacity and the radius, ordered to drive the least.
 *
 *   GET  /options              vehicles (with their type and Max Load Capacity),
 *                              the routing provider and which are set up
 *   POST /solve                the trips (lib/routeOptimizer.js) on the
 *                              distances of lib/distanceProvider.js
 *   PUT  /capacity/:vehicleId  save a vehicle's Max Load Capacity (a vehicle
 *                              custom field "Max Load Capacity"; Vehicle = Edit)
 *
 * Creating the journeys from the trips is New Journey's own API (POST
 * /api/journeys, one per trip, as drafts that HSE approves).
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, forbidden } from '../lib/http.js'
import { assertCanWrite, findScopedOrThrow, vehicleWhere } from '../lib/scope.js'
import { atLeast, journeysLevel, levelOf } from '../lib/permissions.js'
import { validate } from '../middleware/validate.js'
import { getJourneySettings } from '../lib/journeySettings.js'
import { vehicleLabel } from '../lib/vehicleLabel.js'
import { optimizeRoutes } from '../lib/routeOptimizer.js'
import { distanceMatrix, providerStatus } from '../lib/distanceProvider.js'

const router = Router()

function need(req, level) {
  if (!atLeast(journeysLevel(req.user, req.scope.role), level)) throw forbidden(level === 'view' ? 'You do not have access to Journeys' : 'You do not have permission to plan journeys')
}
router.use((req, _res, next) => { try { need(req, 'view'); next() } catch (e) { next(e) } })

/** The custom field the capacity lives in (no new vehicle column). */
export const CAPACITY_FIELD = 'Max Load Capacity'
const isCapacity = name => /^max\.?\s*load\s*capacity$/i.test(String(name ?? '').trim())

/** "12000", "12,000 kg", "12.5 t" → { value, unit }. */
export function readCapacity(customFields) {
  const f = (Array.isArray(customFields) ? customFields : []).find(x => isCapacity(x?.name))
  if (!f) return null
  const m = /(-?\d[\d,]*(?:\.\d+)?)\s*([a-zA-Z]*)/.exec(String(f.value ?? ''))
  if (!m) return null
  const value = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(value) && value > 0 ? { value, unit: m[2] || null } : null
}

router.get(
  '/options',
  asyncHandler(async (req, res) => {
    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere(req.scope),
      select: { id: true, bgId: true, plateNo: true, fleetNo: true, imei: true, vehicleType: true, customFields: true, driver: { select: { id: true, name: true } } },
      take: 2000,
    })
    const settings = await getJourneySettings(req.scope.bgId ?? vehicles[0]?.bgId ?? null)
    res.set('Cache-Control', 'no-store')
    res.json({
      data: {
        vehicles: vehicles.map(v => ({
          id: v.id, label: vehicleLabel(v), vehicleType: v.vehicleType, driver: v.driver, capacity: readCapacity(v.customFields),
        })).sort((a, b) => a.label.localeCompare(b.label)),
        routing: settings.routing,
        plannedSpeedKmh: settings.plannedSpeedKmh,
        providers: providerStatus(settings.routing),
        canSaveCapacity: req.scope.role === 'SUPER_ADMIN' || atLeast(levelOf(req.user?.screenAccess, '/settings/vehicle'), 'modify'),
      },
    })
  })
)

const hhmm = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'), z.null()]).optional()
const solveSchema = z.object({
  mode: z.enum(['DISTANCE', 'DISTANCE_WEIGHT']).default('DISTANCE'),
  loadType: z.enum(['FULL', 'PARTIAL']).default('PARTIAL'),
  product: z.union([z.string().trim().max(80), z.null()]).optional(),
  unit: z.union([z.string().trim().max(20), z.null()]).optional(),
  radiusKm: z.union([z.null(), z.coerce.number().min(0).max(2000)]).optional(),
  startAt: z.coerce.date(),
  maxTrips: z.coerce.number().int().min(1).max(10).default(3),
  returnToStart: z.boolean().default(true),
  start: z.object({ name: z.string().trim().min(1).max(120), lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
  vehicles: z.array(z.object({ vehicleId: z.string().trim().min(1), capacity: z.union([z.null(), z.coerce.number().min(0).max(1e7)]).optional() })).min(1, 'Pick at least one vehicle').max(50),
  points: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    weight: z.union([z.null(), z.coerce.number().min(0).max(1e7)]).optional(),
    stayMin: z.coerce.number().int().min(0).max(1440).default(0),
    windowFrom: hhmm,
    windowTo: hhmm,
    addressId: z.union([z.string(), z.null()]).optional(),
    purpose: z.union([z.string(), z.null()]).optional(),
    radiusM: z.union([z.null(), z.coerce.number().int().min(30).max(20000)]).optional(),
    signatureRequired: z.boolean().optional(),
  })).min(1, 'Add at least one delivery point').max(300),
})

router.post(
  '/solve',
  validate(solveSchema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const b = req.body
    const rows = []
    for (const v of b.vehicles) rows.push(await findScopedOrThrow('vehicle', v.vehicleId, req.scope))
    const settings = await getJourneySettings(req.scope.bgId ?? rows[0].bgId)
    const vehicles = rows.map((v, k) => ({
      id: v.id, label: vehicleLabel(v), vehicleType: v.vehicleType,
      capacity: b.vehicles[k].capacity ?? readCapacity(v.customFields)?.value ?? null,
    }))
    if (b.mode === 'DISTANCE_WEIGHT') {
      const missing = vehicles.filter(v => !(v.capacity > 0))
      if (missing.length === vehicles.length) throw badRequest('Validation failed', { vehicles: 'Set a Max Load Capacity on the vehicles to plan by weight' })
    }
    const places = [b.start, ...b.points]
    const matrix = await distanceMatrix(places, { routing: settings.routing, speedKmh: settings.plannedSpeedKmh })
    const out = optimizeRoutes({
      start: b.start, points: b.points, vehicles, mode: b.mode, loadType: b.loadType, radiusKm: b.radiusKm ?? null,
      km: matrix.km, min: matrix.min, startAt: b.startAt.getTime(), maxTrips: b.maxTrips, returnToStart: b.returnToStart,
    })
    res.json({
      data: {
        ...out,
        provider: matrix.provider, estimated: matrix.estimated, note: matrix.note,
        roadFactor: matrix.estimated ? settings.routing.roadFactor : null,
        start: b.start, mode: b.mode, loadType: b.loadType, product: b.product ?? null, unit: b.unit ?? null,
      },
    })
  })
)

router.put(
  '/capacity/:vehicleId',
  validate(z.object({ capacity: z.coerce.number().positive().max(1e7), unit: z.union([z.string().trim().max(10), z.null()]).optional() })),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    if (req.scope.role !== 'SUPER_ADMIN' && !atLeast(levelOf(req.user?.screenAccess, '/settings/vehicle'), 'modify')) {
      throw forbidden('You do not have permission to change vehicles')
    }
    const v = await findScopedOrThrow('ownedVehicle', req.params.vehicleId, req.scope)
    const value = `${req.body.capacity}${req.body.unit ? ` ${req.body.unit}` : ''}`
    const fields = (Array.isArray(v.customFields) ? v.customFields : []).filter(f => !isCapacity(f?.name))
    fields.push({ name: CAPACITY_FIELD, value })
    await prisma.vehicle.update({
      where: { id: v.id },
      data: { customFields: fields, customFieldsUpdatedAt: new Date(), customFieldsUpdatedBy: req.user?.shortName || req.user?.email || null },
    })
    res.json({ data: { vehicleId: v.id, capacity: readCapacity(fields) } })
  })
)

export default router
