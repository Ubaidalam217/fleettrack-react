/**
 * /api/journey-addresses — the address book of Checkpoints & Routes (client
 * 2026-11-21, after Uffizio's checkpoint Address Book): saved places per
 * Business Group — a point with a radius, or a Settings geofence — with their
 * state (loading / unloading / delivery / rest). New Journey and Route
 * Optimization pick stops from it; a stop keeps a copy, so editing or deleting
 * an address never changes a journey.
 *
 *   GET    /             the list
 *   POST   /             add one                         (Journeys = Edit)
 *   POST   /bulk         add many (from an Excel / CSV)  (Journeys = Edit)
 *   PUT    /:id          change one                      (Journeys = Edit)
 *   DELETE /:id          remove one                      (Journeys = Full)
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, conflict, forbidden, badRequest } from '../lib/http.js'
import { bgWhere, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { atLeast, journeysLevel } from '../lib/permissions.js'
import { validate } from '../middleware/validate.js'
import { STOP_PURPOSES } from '../lib/journeys.js'

const router = Router()

function need(req, level) {
  if (!atLeast(journeysLevel(req.user, req.scope.role), level)) throw forbidden(level === 'view' ? 'You do not have access to Journeys' : 'You do not have permission to change the address book')
}
router.use((req, _res, next) => { try { need(req, 'view'); next() } catch (e) { next(e) } })

const text = max => z.union([z.string().trim().max(max), z.null()]).optional().transform(v => v || null)
const addressSchema = z.object({
  bgId: z.union([z.string().trim().min(1), z.null()]).optional(),
  name: z.string().trim().min(1, 'Name the address').max(120),
  arrivalType: z.enum(['RADIUS', 'GEOFENCE']).default('RADIUS'),
  geofenceId: z.union([z.string().trim().min(1), z.null()]).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusM: z.coerce.number().int().min(30, 'At least 30 m').max(20000).default(300),
  purpose: z.enum(STOP_PURPOSES).default('OTHER'),
  code: text(60),
  contactName: text(120),
  contactPhone: text(40),
  notes: text(500),
}).refine(a => !(a.lat === 0 && a.lng === 0), { message: '0, 0 is not a real place', path: ['lat'] })

async function bgIdOf(req, given) {
  const id = req.scope.bgId ?? given ?? (await prisma.businessGroup.findFirst({ where: bgWhere(req.scope), select: { id: true }, orderBy: { name: 'asc' } }))?.id
  if (!id) throw badRequest('Pick a Business Group')
  await findScopedOrThrow('bg', id, req.scope)
  return id
}

async function checkGeofence(req, a) {
  if (a.arrivalType !== 'GEOFENCE') return { ...a, geofenceId: null }
  if (!a.geofenceId) throw badRequest('Validation failed', { geofenceId: 'Pick a geofence' })
  await findScopedOrThrow('geofence', a.geofenceId, req.scope)
  return a
}

const columns = a => ({
  name: a.name, arrivalType: a.arrivalType, geofenceId: a.geofenceId ?? null, lat: a.lat, lng: a.lng, radiusM: a.radiusM,
  purpose: a.purpose, code: a.code, contactName: a.contactName, contactPhone: a.contactPhone, notes: a.notes,
})

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.journeyAddress.findMany({ where: scopedWhere('journeyAddress', req.scope), orderBy: { name: 'asc' }, take: 5000 })
    res.set('Cache-Control', 'no-store')
    res.json({ data: rows })
  })
)

router.post(
  '/',
  validate(addressSchema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const bgId = await bgIdOf(req, req.body.bgId)
    const a = await checkGeofence(req, req.body)
    const taken = await prisma.journeyAddress.findUnique({ where: { bgId_name: { bgId, name: a.name } } })
    if (taken) throw conflict('The address book already has this name', { name: 'Already in use' })
    const row = await prisma.journeyAddress.create({ data: { bgId, ...columns(a), createdByName: req.user.shortName || req.user.email } })
    res.status(201).json({ data: row })
  })
)

/**
 * Many at once (the bulk upload's "Save as address"): each row is checked on
 * its own; a name already in the book is reported, not overwritten.
 */
router.post(
  '/bulk',
  validate(z.object({ bgId: z.union([z.string().trim().min(1), z.null()]).optional(), rows: z.array(z.any()).min(1).max(500) })),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const bgId = await bgIdOf(req, req.body.bgId)
    const existing = new Set((await prisma.journeyAddress.findMany({ where: { bgId }, select: { name: true } })).map(r => r.name.toLowerCase()))
    const created = []
    const errors = []
    for (const [i, raw] of req.body.rows.entries()) {
      const parsed = addressSchema.safeParse({ ...raw, arrivalType: 'RADIUS', geofenceId: null })
      const row = raw?.row ?? i + 1
      if (!parsed.success) { errors.push({ row, message: parsed.error.issues.map(x => x.message).join('; ') }); continue }
      const a = parsed.data
      if (existing.has(a.name.toLowerCase())) { errors.push({ row, message: `${a.name}: already in the address book` }); continue }
      existing.add(a.name.toLowerCase())
      created.push(await prisma.journeyAddress.create({ data: { bgId, ...columns(a), createdByName: req.user.shortName || req.user.email } }))
    }
    res.status(201).json({ data: created, errors })
  })
)

router.put(
  '/:id',
  validate(addressSchema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const t = await findScopedOrThrow('journeyAddress', req.params.id, req.scope)
    const a = await checkGeofence(req, req.body)
    const taken = await prisma.journeyAddress.findFirst({ where: { bgId: t.bgId, name: a.name, id: { not: t.id } } })
    if (taken) throw conflict('The address book already has this name', { name: 'Already in use' })
    const row = await prisma.journeyAddress.update({ where: { id: t.id }, data: columns(a) })
    res.json({ data: row })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    need(req, 'addDelete')
    const t = await findScopedOrThrow('journeyAddress', req.params.id, req.scope)
    await prisma.journeyAddress.delete({ where: { id: t.id } })
    res.json({ data: { id: t.id } })
  })
)

export default router
