/**
 * /api/route-templates — saved routes ("Checkpoints & Routes", design §A.1 #11):
 * a route copied from a past trip, drawn on the map, or straight legs between
 * stops, kept for the next journey. BG-wide like geofences. A journey copies
 * the route onto itself, so editing or deleting a template never changes one.
 *
 * Journeys Edit to save one, Full to delete.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, conflict, forbidden } from '../lib/http.js'
import { findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { atLeast, journeysLevel } from '../lib/permissions.js'
import { validate } from '../middleware/validate.js'
import { simplifyPath, pathKm } from '../../../src/utils/journeyGeo.js'

const router = Router()

function need(req, level) {
  if (!atLeast(journeysLevel(req.user, req.scope.role), level)) throw forbidden('You do not have permission to change saved routes')
}

const stop = z.object({
  name: z.string().trim().min(1).max(120),
  arrivalType: z.enum(['RADIUS', 'GEOFENCE']).default('RADIUS'),
  geofenceId: z.union([z.string(), z.null()]).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusM: z.coerce.number().int().min(30).max(20000).optional(),
  stayMin: z.coerce.number().int().min(0).max(1440).default(0),
  legDriveMin: z.union([z.null(), z.coerce.number().int().min(0).max(4320)]).optional(),
  legSource: z.enum(['SPEED', 'TRIP', 'MANUAL', 'ROUTING']).nullable().optional(),
  signatureRequired: z.boolean().default(false),
})

const schema = z.object({
  bgId: z.union([z.string().trim().min(1), z.null()]).optional(),
  name: z.string().trim().min(1, 'Name the route').max(120),
  source: z.enum(['PAST_TRIP', 'DRAWN', 'STRAIGHT']),
  path: z.union([z.array(z.array(z.number()).min(2)).max(20000), z.null()]).optional(),
  driveMin: z.union([z.null(), z.coerce.number().int().min(0).max(4320)]).optional(),
  stops: z.array(stop).min(2).max(40),
  recordedFrom: z.union([z.record(z.string(), z.any()), z.null()]).optional(),
})

const columns = b => {
  const path = Array.isArray(b.path) && b.path.length >= 2 ? simplifyPath(b.path.map(p => [p[0], p[1]]), 15) : null
  return {
    name: b.name, source: b.source, path: path ?? undefined, distanceKm: path ? Math.round(pathKm(path) * 10) / 10 : null,
    driveMin: b.driveMin ?? null, stops: b.stops, recordedFrom: b.recordedFrom ?? undefined,
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    need(req, 'view')
    const rows = await prisma.routeTemplate.findMany({ where: scopedWhere('routeTemplate', req.scope), orderBy: { name: 'asc' }, take: 500 })
    res.json({ data: rows })
  })
)

router.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const bgId = req.scope.bgId ?? req.body.bgId
    await findScopedOrThrow('bg', bgId, req.scope)
    const taken = await prisma.routeTemplate.findUnique({ where: { bgId_name: { bgId, name: req.body.name } } })
    if (taken) throw conflict('A saved route already has this name', { name: 'Already in use' })
    const row = await prisma.routeTemplate.create({ data: { bgId, ...columns(req.body), createdByName: req.user.shortName || req.user.email } })
    res.status(201).json({ data: row })
  })
)

router.put(
  '/:id',
  validate(schema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const t = await findScopedOrThrow('routeTemplate', req.params.id, req.scope)
    const taken = await prisma.routeTemplate.findFirst({ where: { bgId: t.bgId, name: req.body.name, id: { not: t.id } } })
    if (taken) throw conflict('A saved route already has this name', { name: 'Already in use' })
    const row = await prisma.routeTemplate.update({ where: { id: t.id }, data: columns(req.body) })
    res.json({ data: row })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    need(req, 'addDelete')
    const t = await findScopedOrThrow('routeTemplate', req.params.id, req.scope)
    await prisma.routeTemplate.delete({ where: { id: t.id } })
    res.json({ data: { id: t.id } })
  })
)

export default router
