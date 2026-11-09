/**
 * /api/expenses — what a vehicle costs (Settings › Master › Expense, client
 * 2026-11-09, after the reference system's Expense page).
 *
 * Two categories, as in the reference: a Variable expense is one cost on one
 * day (fuel, a fine, a repair), with the odometer and work hours at the time;
 * a Fix expense covers a period (insurance, financing, depreciation). Each
 * may carry up to three bills, PDF or image, stored like a driver's
 * documents. A row keeps the vehicle's plate as it was, so deleting the
 * vehicle later does not leave a cost with no name.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, HttpError, notFound } from '../lib/http.js'
import { fromBase64, sniffDocument } from '../lib/files.js'
import { optionalDate, optionalNumber, optionalText, requiredId, requiredText } from '../lib/fields.js'
import { assertCanWrite, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

/** The reference's Type list for each Category. The form offers the same lists. */
export const EXPENSE_TYPES = Object.freeze({
  Variable: ['Accidents', 'Bonuses', 'Breakdown', 'Cease', 'Fines', 'Fuel', 'Maintenance', 'Other', 'Substance', 'Tire', 'Toll Roads'],
  Fix: ['Depreciation', 'Drivers', 'Financing', 'Insurance', 'Taxes and Rates'],
})
export const MAX_BILLS = 3
const MAX_BILL_BYTES = 5 * 1024 * 1024

const day = d => (d ? d.toISOString().slice(0, 10) : null)
const toMinutes = hhmm => {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const toHhmm = mins => (mins == null ? null : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`)

const expenseSchema = z.object({
  vehicleId: requiredId('Vehicle'),
  category: z.enum(['Variable', 'Fix']),
  type: requiredText('Type', 40),
  subType: optionalText(80),
  expenseDate: optionalDate(),
  fromDate: optionalDate(),
  toDate: optionalDate(),
  odometer: optionalNumber().refine(v => v === null || v >= 0, 'Zero or more'),
  // "Work Hour" in the reference: hours:minutes.
  workHours: z.union([z.string(), z.null()]).default(null)
    .transform(v => String(v ?? '').trim() || null)
    .refine(v => v === null || /^\d{1,5}:[0-5]\d$/.test(v), 'Use hours:minutes, e.g. 2:30'),
  fuelSource: optionalText(40),
  vendor: optionalText(120),
  amount: optionalNumber().refine(v => v !== null && v > 0, 'Enter an amount above 0'),
  referenceNo: optionalText(60),
  description: optionalText(1000),
})

const listQuery = z.object({
  bgId: z.string().trim().min(1).optional(),
  vehicleId: z.string().trim().min(1).optional(),
  category: z.enum(['Variable', 'Fix']).optional(),
  type: z.string().trim().min(1).max(40).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/**
 * The checks that span fields, all reported at once. Returns the row to store:
 * a Fix expense has no single date, odometer or work hours, and only Fuel has
 * a fuel source.
 */
function toRow(body) {
  const errors = {}
  if (!EXPENSE_TYPES[body.category].includes(body.type)) errors.type = `Not a ${body.category} expense type`
  if (body.category === 'Variable') {
    if (!body.expenseDate) errors.expenseDate = 'Expense date is required'
  } else {
    if (!body.fromDate) errors.fromDate = 'From date is required'
    if (!body.toDate) errors.toDate = 'To date is required'
    else if (body.fromDate && body.toDate < body.fromDate) errors.toDate = 'On or after the From date'
  }
  if (Object.keys(errors).length) throw badRequest('Please check the highlighted fields', errors)

  const variable = body.category === 'Variable'
  return {
    category: body.category,
    type: body.type,
    subType: body.subType,
    expenseDate: variable ? body.expenseDate : null,
    fromDate: variable ? null : body.fromDate,
    toDate: variable ? null : body.toDate,
    odometer: variable ? body.odometer : null,
    workMinutes: variable ? toMinutes(body.workHours) : null,
    fuelSource: body.type === 'Fuel' ? body.fuelSource : null,
    vendor: body.vendor,
    amount: body.amount,
    referenceNo: body.referenceNo,
    description: body.description,
  }
}

const BILL_SELECT = { id: true, fileName: true, mimeType: true, size: true, createdAt: true }
const INCLUDE = {
  bg: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNo: true, fleetNo: true, imei: true, branch: { select: { id: true, name: true } } } },
  bills: { select: BILL_SELECT, orderBy: { createdAt: 'asc' } },
}

function publicExpense(e) {
  const { workMinutes, ...rest } = e
  return {
    ...rest,
    expenseDate: day(e.expenseDate),
    fromDate: day(e.fromDate),
    toDate: day(e.toDate),
    workHours: toHhmm(workMinutes),
  }
}

/** The vehicle, confirmed to be one the caller may see; its BG is the expense's. */
async function resolveVehicle(scope, vehicleId) {
  try {
    return await findScopedOrThrow('vehicle', vehicleId, scope)
  } catch {
    throw badRequest('Choose one of your vehicles', { vehicleId: 'Not one of your vehicles' })
  }
}

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId, vehicleId, category, type, from, to } = req.validatedQuery
    const range = from || to
      ? {
          OR: [
            { expenseDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } },
            // A Fix expense counts when its period overlaps the range.
            { AND: [...(to ? [{ fromDate: { lte: new Date(to) } }] : []), ...(from ? [{ toDate: { gte: new Date(from) } }] : []), { category: 'Fix' }] },
          ],
        }
      : null
    const rows = await prisma.expense.findMany({
      where: scopedWhere(
        'expense', req.scope,
        bgId ? { bgId } : null,
        vehicleId ? { vehicleId } : null,
        category ? { category } : null,
        type ? { type } : null,
        range,
      ),
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })
    // Newest first by the expense's own date (a Fix one by its start).
    const at = e => (e.expenseDate ?? e.fromDate)?.getTime() ?? 0
    rows.sort((a, b) => at(b) - at(a) || b.createdAt - a.createdAt)
    res.json({ data: rows.map(publicExpense) })
  })
)

router.post(
  '/',
  validate(expenseSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'expense')
    const vehicle = await resolveVehicle(req.scope, req.body.vehicleId)
    const row = await prisma.expense.create({
      data: {
        ...toRow(req.body),
        bgId: vehicle.bgId,
        vehicleId: vehicle.id,
        vehicleLabel: vehicle.plateNo || vehicle.fleetNo || vehicle.imei,
        createdById: req.user.id,
        createdByName: req.user.shortName || req.user.email,
      },
      include: INCLUDE,
    })
    res.status(201).json({ data: publicExpense(row) })
  })
)

router.put(
  '/:id',
  validate(expenseSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'expense')
    const existing = await findScopedOrThrow('expense', req.params.id, req.scope)
    const vehicle = await resolveVehicle(req.scope, req.body.vehicleId)
    const row = await prisma.expense.update({
      where: { id: existing.id },
      data: {
        ...toRow(req.body),
        bgId: vehicle.bgId,
        vehicleId: vehicle.id,
        vehicleLabel: vehicle.plateNo || vehicle.fleetNo || vehicle.imei,
      },
      include: INCLUDE,
    })
    res.json({ data: publicExpense(row) })
  })
)

/** DELETE /api/expenses?ids=a,b,c — the list's "delete selected". */
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'expense')
    const ids = [...new Set(String(req.query.ids ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 500)
    if (!ids.length) throw badRequest('Choose the expenses to delete', { ids: 'Required' })
    const { count } = await prisma.expense.deleteMany({ where: scopedWhere('expense', req.scope, { id: { in: ids } }) })
    res.json({ data: { deleted: count } })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'expense')
    const existing = await findScopedOrThrow('expense', req.params.id, req.scope)
    await prisma.expense.delete({ where: { id: existing.id } })
    res.json({ data: { id: existing.id } })
  })
)

// ── Bills ───────────────────────────────────────────────────────────────────

const billSchema = z.object({
  fileName: requiredText('File name', 200),
  data: z.string().min(16).max(Math.ceil((MAX_BILL_BYTES * 4) / 3) + 64),
})

router.post(
  '/:id/bills',
  validate(billSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'expense')
    const expense = await findScopedOrThrow('expense', req.params.id, req.scope)
    if ((await prisma.expenseBill.count({ where: { expenseId: expense.id } })) >= MAX_BILLS) {
      throw badRequest(`Up to ${MAX_BILLS} bills per expense`, { data: 'Limit reached' })
    }
    const data = fromBase64(req.body.data)
    const mimeType = sniffDocument(data)
    if (!mimeType) throw badRequest('Upload a PDF, JPEG, PNG or WebP file', { data: 'Unsupported file type' })
    if (data.length > MAX_BILL_BYTES) throw new HttpError(413, 'The file is too large (max 5 MB)')
    const row = await prisma.expenseBill.create({
      data: { expenseId: expense.id, fileName: req.body.fileName, mimeType, size: data.length, data },
      select: BILL_SELECT,
    })
    res.status(201).json({ data: row })
  })
)

router.get(
  '/:id/bills/:billId/file',
  asyncHandler(async (req, res) => {
    const expense = await findScopedOrThrow('expense', req.params.id, req.scope)
    const bill = await prisma.expenseBill.findFirst({ where: { id: req.params.billId, expenseId: expense.id } })
    if (!bill) throw notFound('Bill')
    res.set('Content-Type', bill.mimeType)
    res.set('Content-Disposition', `inline; filename="${bill.fileName.replace(/["\\\r\n]/g, '_')}"`)
    res.set('Cache-Control', 'private, no-store')
    res.send(Buffer.from(bill.data))
  })
)

router.delete(
  '/:id/bills/:billId',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'expense')
    const expense = await findScopedOrThrow('expense', req.params.id, req.scope)
    const { count } = await prisma.expenseBill.deleteMany({ where: { id: req.params.billId, expenseId: expense.id } })
    if (!count) throw notFound('Bill')
    res.json({ data: { id: req.params.billId } })
  })
)

export default router
