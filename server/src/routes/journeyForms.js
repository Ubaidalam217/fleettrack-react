/**
 * /api/journey-forms — custom stop forms per Business Group (client
 * 2026-11-21, after Uffizio's checkpoint Form): text, number, yes/no,
 * dropdown and photo fields. A stop copies the form's fields when the journey
 * is planned, so changing a form never changes a filled one.
 *
 *   GET / · POST / (Journeys = Edit) · PUT /:id (Edit) · DELETE /:id (Full)
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, conflict, forbidden } from '../lib/http.js'
import { bgWhere, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { atLeast, journeysLevel } from '../lib/permissions.js'
import { validate } from '../middleware/validate.js'
import { cleanFormFields } from '../../../src/utils/journeyForms.js'

const router = Router()

function need(req, level) {
  if (!atLeast(journeysLevel(req.user, req.scope.role), level)) throw forbidden(level === 'view' ? 'You do not have access to Journeys' : 'You do not have permission to change forms')
}
router.use((req, _res, next) => { try { need(req, 'view'); next() } catch (e) { next(e) } })

const schema = z.object({
  bgId: z.union([z.string().trim().min(1), z.null()]).optional(),
  name: z.string().trim().min(1, 'Name the form').max(120),
  fields: z.array(z.any()).max(30),
})

function clean(body) {
  const { fields, errors } = cleanFormFields(body.fields)
  if (Object.keys(errors).length) throw badRequest('Validation failed', Object.fromEntries(Object.entries(errors).map(([k, v]) => [`fields.${k}`, v])))
  return fields
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.journeyFormTemplate.findMany({ where: scopedWhere('journeyForm', req.scope), orderBy: { name: 'asc' }, take: 500 })
    res.set('Cache-Control', 'no-store')
    res.json({ data: rows })
  })
)

router.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const bgId = req.scope.bgId ?? req.body.bgId ?? (await prisma.businessGroup.findFirst({ where: bgWhere(req.scope), select: { id: true }, orderBy: { name: 'asc' } }))?.id
    if (!bgId) throw badRequest('Pick a Business Group')
    await findScopedOrThrow('bg', bgId, req.scope)
    const fields = clean(req.body)
    if (await prisma.journeyFormTemplate.findUnique({ where: { bgId_name: { bgId, name: req.body.name } } })) throw conflict('A form already has this name', { name: 'Already in use' })
    const row = await prisma.journeyFormTemplate.create({ data: { bgId, name: req.body.name, fields, createdByName: req.user.shortName || req.user.email } })
    res.status(201).json({ data: row })
  })
)

router.put(
  '/:id',
  validate(schema),
  asyncHandler(async (req, res) => {
    need(req, 'modify')
    const f = await findScopedOrThrow('journeyForm', req.params.id, req.scope)
    const fields = clean(req.body)
    if (await prisma.journeyFormTemplate.findFirst({ where: { bgId: f.bgId, name: req.body.name, id: { not: f.id } } })) throw conflict('A form already has this name', { name: 'Already in use' })
    const row = await prisma.journeyFormTemplate.update({ where: { id: f.id }, data: { name: req.body.name, fields } })
    res.json({ data: row })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    need(req, 'addDelete')
    const f = await findScopedOrThrow('journeyForm', req.params.id, req.scope)
    await prisma.journeyFormTemplate.delete({ where: { id: f.id } })
    res.json({ data: { id: f.id } })
  })
)

export default router
