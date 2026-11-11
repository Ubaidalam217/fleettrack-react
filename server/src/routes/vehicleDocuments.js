/**
 * /api/vehicles/:vehicleId/documents — a vehicle's papers (client spec 12):
 * permit, insurance, registration, certificate…, each with its dates, how many
 * days before expiry to warn, and an optional scanned copy (PDF or image, 5 MB).
 *
 * Until 2026-11-11 these lived only in each user's browser (src/services/
 * documentStore.js); now every user of the BG sees the same list, and the
 * Driver Licence & Document Expiry alert reads it (lib/alertEngine.js).
 *
 * Access is the vehicle's: whoever can see the vehicle sees its documents.
 * Writes need the vehicle write right (scope.js) and the Vehicle screen level
 * (app.js mounts this behind requireScreen): Edit to change one, Full to add or
 * delete. The bytes are served only from /:docId/file, behind the same checks.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, HttpError, notFound } from '../lib/http.js'
import { fromBase64, sniffDocument } from '../lib/files.js'
import { optionalDate, optionalText } from '../lib/fields.js'
import { assertCanWrite, findScopedOrThrow } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router({ mergeParams: true })

export const MAX_DOC_BYTES = 5 * 1024 * 1024
export const VEHICLE_DOC_TYPES = ['Permit', 'Insurance', 'Registration', 'Certificate', 'Other']

const SELECT = {
  id: true, vehicleId: true, name: true, docType: true, number: true, issueDate: true, expiryDate: true,
  notifyBeforeDays: true, note: true, fileName: true, mimeType: true, size: true, createdBy: true, createdAt: true, updatedAt: true,
}
const day = d => (d ? d.toISOString().slice(0, 10) : null)
const publicDoc = d => ({ ...d, issueDate: day(d.issueDate), expiryDate: day(d.expiryDate), hasFile: Boolean(d.fileName) })

const fileFields = {
  fileName: z.union([z.string().max(200), z.null()]).default(null),
  data: z.union([z.string().min(16).max(Math.ceil((MAX_DOC_BYTES * 4) / 3) + 64), z.null()]).default(null),
}

const docFields = {
  docType: z.enum(VEHICLE_DOC_TYPES).default('Other'),
  // Blank → the type ("Insurance").
  name: optionalText(120),
  number: optionalText(80),
  issueDate: optionalDate(),
  expiryDate: optionalDate(),
  notifyBeforeDays: z.coerce.number().int('Whole days').min(0, '0 – 365 days').max(365, '0 – 365 days').default(30),
  note: optionalText(500),
}

const createSchema = z.object({ ...docFields, ...fileFields })
// An edit keeps the file unless a new one is sent or `removeFile` is set.
const updateSchema = z.object({ ...docFields, ...fileFields, removeFile: z.boolean().default(false) })

/** The uploaded file as columns, or throws on a bad one. Nothing sent → null. */
function fileColumns(body) {
  if (!body.data) return null
  const data = fromBase64(body.data)
  const mimeType = sniffDocument(data)
  if (!mimeType) throw badRequest('Upload a PDF, JPEG, PNG or WebP file', { data: 'Unsupported file type' })
  if (data.length > MAX_DOC_BYTES) throw new HttpError(413, 'The file is too large (max 5 MB)')
  const fileName = String(body.fileName ?? '').trim().slice(0, 200) || `document.${mimeType.split('/')[1]}`
  return { fileName, mimeType, size: data.length, data }
}

const columns = body => ({
  docType: body.docType,
  name: body.name || body.docType,
  number: body.number,
  issueDate: body.issueDate,
  expiryDate: body.expiryDate,
  notifyBeforeDays: body.notifyBeforeDays,
  note: body.note,
})

const vehicleOf = req => findScopedOrThrow('vehicle', req.params.vehicleId, req.scope)

async function docOf(req) {
  const vehicle = await vehicleOf(req)
  const doc = await prisma.vehicleDocument.findFirst({ where: { id: req.params.docId, vehicleId: vehicle.id }, select: SELECT })
  if (!doc) throw notFound('Document')
  return doc
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const vehicle = await vehicleOf(req)
    const rows = await prisma.vehicleDocument.findMany({
      where: { vehicleId: vehicle.id },
      select: SELECT,
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    })
    res.json({ data: rows.map(publicDoc) })
  })
)

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const vehicle = await vehicleOf(req)
    const file = fileColumns(req.body)
    const row = await prisma.vehicleDocument.create({
      data: {
        vehicleId: vehicle.id,
        ...columns(req.body),
        ...(file ?? {}),
        createdBy: req.user?.shortName || req.user?.email || null,
      },
      select: SELECT,
    })
    res.status(201).json({ data: publicDoc(row) })
  })
)

router.put(
  '/:docId',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const doc = await docOf(req)
    const file = fileColumns(req.body)
    const cleared = req.body.removeFile ? { fileName: null, mimeType: null, size: null, data: null } : {}
    const row = await prisma.vehicleDocument.update({
      where: { id: doc.id },
      data: { ...columns(req.body), ...cleared, ...(file ?? {}) },
      select: SELECT,
    })
    res.json({ data: publicDoc(row) })
  })
)

router.delete(
  '/:docId',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'vehicle')
    const doc = await docOf(req)
    await prisma.vehicleDocument.delete({ where: { id: doc.id } })
    res.json({ data: { id: doc.id } })
  })
)

router.get(
  '/:docId/file',
  asyncHandler(async (req, res) => {
    const doc = await docOf(req)
    const row = await prisma.vehicleDocument.findUnique({ where: { id: doc.id }, select: { data: true } })
    if (!doc.fileName || !row?.data) throw notFound('File')
    res.set('Content-Type', doc.mimeType)
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${doc.fileName.replace(/["\\\r\n]/g, '_')}"`)
    res.set('Cache-Control', 'private, no-store')
    res.send(Buffer.from(row.data))
  })
)

export default router
