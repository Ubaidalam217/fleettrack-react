/**
 * /api/geofences — named map shapes over a BG's territory (the reference
 * system's "Address" and "Geofence" screens, one table — see the Geofence
 * model's own comment in schema.prisma for why).
 *
 * The geometry fields are deliberately NOT validated per-field by zod: which
 * ones even apply depends on `shape`, and "points required when shape is
 * POLYGON" is not expressible as one field's schema. assertValidGeometry() in
 * lib/geofences.js does that pass once the shape-agnostic shape has already
 * been checked here.
 */

import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler } from '../lib/http.js'
import { optionalText, requiredId, requiredText } from '../lib/fields.js'
import { assertNameFree, assertValidGeometry } from '../lib/geofences.js'
import {
  assertCanWrite,
  assertWritableParent,
  findScopedOrThrow,
  scopedWhere,
} from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const point = z.object({ lat: z.number(), lng: z.number() })

const geofenceFields = {
  name: requiredText('Name'),
  kind: z.enum(['GEOFENCE', 'ADDRESS'], { error: 'Kind must be GEOFENCE or ADDRESS' }),
  shape: z.enum(['POLYGON', 'CIRCLE'], { error: 'Shape must be POLYGON or CIRCLE' }),
  // "" / undefined → null for every optional geometry field below, mirroring
  // optionalId()/optionalText() — a POLYGON row simply omits the circle fields
  // and vice versa, and a stray "" must not become a bogus 0.
  points: z.union([z.array(point), z.null()]).default(null),
  centerLat: z.union([z.number(), z.null()]).default(null),
  centerLng: z.union([z.number(), z.null()]).default(null),
  radius: z.union([z.number(), z.null()]).default(null),
  category: optionalText(60),
  color: optionalText(20),
  description: optionalText(2000),
  active: z.boolean().default(true),
}

const createSchema = z.object({ bgId: requiredId('Business group'), ...geofenceFields })
const updateSchema = z.object(geofenceFields)

const listQuerySchema = z.object({
  bgId: z.string().trim().min(1).optional(),
  kind: z.enum(['GEOFENCE', 'ADDRESS']).optional(),
})

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId, kind } = req.validatedQuery
    const rows = await prisma.geofence.findMany({
      where: scopedWhere('geofence', req.scope, bgId ? { bgId } : null, kind ? { kind } : null),
      orderBy: { name: 'asc' },
      include: { bg: { select: { id: true, name: true } } },
    })
    res.json({ data: rows })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('geofence', req.params.id, req.scope, {
      include: { bg: { select: { id: true, name: true } } },
    })
    res.json({ data: row })
  })
)

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'geofence')
    const bg = await assertWritableParent(req.scope, 'bg', req.body.bgId)
    assertValidGeometry(req.body)
    await assertNameFree(bg.id, req.body.name)

    const row = await prisma.geofence.create({
      data: { ...fields(req.body), bgId: bg.id },
      include: { bg: { select: { id: true, name: true } } },
    })
    res.status(201).json({ data: row })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'geofence')
    const existing = await findScopedOrThrow('geofence', req.params.id, req.scope)
    assertValidGeometry(req.body)
    await assertNameFree(existing.bgId, req.body.name, existing.id)

    const row = await prisma.geofence.update({
      where: { id: existing.id },
      data: fields(req.body),
      include: { bg: { select: { id: true, name: true } } },
    })
    res.json({ data: row })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'geofence')
    const existing = await findScopedOrThrow('geofence', req.params.id, req.scope)
    await prisma.geofence.delete({ where: { id: existing.id } })
    res.json({ data: { id: existing.id } })
  })
)

/**
 * Everything except bgId, which only a create may set.
 *
 * `points` is a Json? column: Prisma treats a plain JS `null` there as
 * ambiguous (it historically meant "leave this field alone" in some write
 * shapes) and Prisma.DbNull is the sentinel that unambiguously means "set the
 * column to SQL NULL" — which is what clearing it on a CIRCLE row requires.
 */
function fields(body) {
  return {
    name: body.name,
    kind: body.kind,
    shape: body.shape,
    points: body.shape === 'POLYGON' ? body.points : Prisma.DbNull,
    centerLat: body.shape === 'CIRCLE' ? body.centerLat : null,
    centerLng: body.shape === 'CIRCLE' ? body.centerLng : null,
    radius: body.shape === 'CIRCLE' ? body.radius : null,
    category: body.category,
    color: body.color,
    description: body.description,
    active: body.active,
  }
}

export default router
