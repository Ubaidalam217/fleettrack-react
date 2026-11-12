/**
 * Reminders (client 2026-11-10, after the reference system):
 *   /api/reminder-rules   Settings › Master › Reminder Rule — the rules and their vehicles
 *   /api/reminders        Reports › Reminder Status, Mark done, Acknowledgement History,
 *                         and the odometer / engine hours now (the Expense form fills from it)
 * The counting is in lib/reminders.js.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import * as flespi from '../lib/flespi.js'
import { asyncHandler, badRequest } from '../lib/http.js'
import { booleanField, optionalDate, optionalNumber, optionalText, requiredId, requiredText } from '../lib/fields.js'
import { assertCanWrite, assertWritableParent, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'
import { fetchTelemetry } from '../lib/alertEngine.js'
import { describe as describeStatus, metersFor, reminderStatus, REMINDER_TYPES } from '../lib/reminders.js'

export const ruleRouter = Router()
export const router = Router()

const day = d => (d ? d.toISOString().slice(0, 10) : null)
const positive = msg => optionalNumber().refine(v => v === null || v > 0, msg)
const zeroOrMore = optionalNumber().refine(v => v === null || v >= 0, 'Zero or more')

const vehicleRow = z.object({
  vehicleId: requiredId('Vehicle'),
  startDate: optionalDate(),
  kmBefore: zeroOrMore,
  hoursBefore: zeroOrMore,
  issueDate: optionalDate(),
  expiryDate: optionalDate(),
})

const ruleSchema = z.object({
  name: requiredText('Reminder name', 120),
  type: requiredText('Reminder type', 60),
  recurring: booleanField(true),
  byDuration: booleanField(true),
  byDistance: booleanField(false),
  byEngineHours: booleanField(false),
  frequency: z.enum(['Daily', 'Weekly', 'Monthly']).default('Monthly'),
  every: positive('Above 0'),
  notifyDays: zeroOrMore,
  everyKm: positive('Above 0'),
  notifyKm: zeroOrMore,
  everyHours: positive('Above 0'),
  notifyHours: zeroOrMore,
  notifyInApp: booleanField(true),
  notifyEmail: booleanField(false),
  emails: z.array(z.string().trim().toLowerCase().email('Not a valid email')).max(20).default([]),
  active: booleanField(true),
  vehicles: z.array(vehicleRow).max(1000).default([]),
})

/** The checks across fields, all reported at once. */
function checkRule(b) {
  const e = {}
  if (!b.byDuration && !b.byDistance && !b.byEngineHours) e.byDuration = 'Choose at least one: duration, distance or engine hours'
  if (b.byDuration && !b.every && !b.vehicles.every(v => v.expiryDate)) e.every = 'Required (or give every vehicle an expiry date)'
  if (b.byDistance && !b.everyKm) e.everyKm = 'Required'
  if (b.byEngineHours && !b.everyHours) e.everyHours = 'Required'
  if (b.byDistance && b.everyKm && b.notifyKm != null && b.notifyKm >= b.everyKm) e.notifyKm = 'Less than the distance'
  if (b.byEngineHours && b.everyHours && b.notifyHours != null && b.notifyHours >= b.everyHours) e.notifyHours = 'Less than the hours'
  if (b.notifyEmail && !b.emails.length) e.emails = 'Add at least one email'
  if (Object.keys(e).length) throw badRequest('Please check the highlighted fields', e)
}

const RULE_FIELDS = b => ({
  name: b.name, type: b.type, recurring: b.recurring,
  byDuration: b.byDuration, byDistance: b.byDistance, byEngineHours: b.byEngineHours,
  frequency: b.frequency, every: b.every, notifyDays: b.notifyDays,
  everyKm: b.everyKm, notifyKm: b.notifyKm, everyHours: b.everyHours, notifyHours: b.notifyHours,
  notifyInApp: b.notifyInApp, notifyEmail: b.notifyEmail, emails: b.notifyEmail ? b.emails : [], active: b.active,
})

const VEHICLE_SELECT = { id: true, imei: true, plateNo: true, fleetNo: true, bgId: true, branchId: true, odometerOffsetKm: true }

/** Odometer and engine hours now, for these vehicles. A Flespi outage leaves them unknown. */
async function readMeters(vehicles) {
  if (!vehicles.length) return new Map()
  let telemetry = new Map(), deviceByImei = new Map()
  try {
    ;[telemetry, deviceByImei] = await Promise.all([fetchTelemetry(), flespi.deviceMap()])
  } catch { /* unknown until the next engine pass fills it */ }
  return metersFor(vehicles, telemetry, deviceByImei)
}

const publicRule = r => ({
  ...r,
  vehicles: (r.vehicles ?? []).map(v => ({
    ...v, startDate: day(v.startDate), issueDate: day(v.issueDate), expiryDate: day(v.expiryDate), completedAt: day(v.completedAt),
  })),
})

/**
 * Writes a rule's vehicle list. A row whose start point is unchanged keeps its
 * state; a new or changed one starts its count from the odometer and engine
 * hours now.
 */
async function writeVehicles(ruleId, bgId, rows, scope) {
  const ids = rows.map(r => r.vehicleId)
  const vehicles = ids.length
    ? await prisma.vehicle.findMany({ where: scopedWhere('vehicle', scope, { id: { in: ids } }, { bgId }), select: VEHICLE_SELECT })
    : []
  if (vehicles.length !== new Set(ids).size) throw badRequest('Choose vehicles of this Business Group', { vehicles: 'Not all of these vehicles are yours' })
  const meters = await readMeters(vehicles)
  const existing = new Map((await prisma.reminderVehicle.findMany({ where: { ruleId } })).map(r => [r.vehicleId, r]))
  const today = new Date(new Date().toISOString().slice(0, 10))
  const same = (a, b) => (a ? a.getTime() : null) === (b ? b.getTime() : null)

  await prisma.reminderVehicle.deleteMany({ where: { ruleId, vehicleId: { notIn: ids } } })
  for (const r of rows) {
    const old = existing.get(r.vehicleId)
    const startDate = r.startDate ?? old?.startDate ?? today
    const kmBefore = r.kmBefore ?? 0
    const hoursBefore = r.hoursBefore ?? 0
    const unchanged = old && same(old.startDate, startDate) && old.kmBefore === kmBefore && old.hoursBefore === hoursBefore
      && same(old.expiryDate, r.expiryDate)
    if (unchanged) {
      if (!same(old.issueDate, r.issueDate)) await prisma.reminderVehicle.update({ where: { id: old.id }, data: { issueDate: r.issueDate } })
      continue
    }
    const m = meters.get(r.vehicleId) ?? {}
    const data = {
      startDate, kmBefore, hoursBefore, issueDate: r.issueDate, expiryDate: r.expiryDate,
      startOdometer: m.odometer ?? null, startEngineHours: m.engineHours ?? null, alerted: null, completedAt: null,
    }
    await prisma.reminderVehicle.upsert({
      where: { ruleId_vehicleId: { ruleId, vehicleId: r.vehicleId } },
      create: { ruleId, vehicleId: r.vehicleId, ...data },
      update: data,
    })
  }
}

// ── /api/reminder-rules ─────────────────────────────────────────────────────

ruleRouter.get(
  '/types',
  asyncHandler(async (req, res) => res.json({ data: REMINDER_TYPES }))
)

ruleRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const bgId = typeof req.query.bgId === 'string' && req.query.bgId ? req.query.bgId : null
    const rows = await prisma.reminderRule.findMany({
      where: scopedWhere('reminderRule', req.scope, bgId ? { bgId } : null),
      include: { vehicles: true, bg: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    })
    res.json({ data: rows.map(publicRule) })
  })
)

ruleRouter.post(
  '/',
  validate(ruleSchema.extend({ bgId: requiredId('Business Group') })),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'reminderRule')
    const bg = await assertWritableParent(req.scope, 'bg', req.body.bgId)
    checkRule(req.body)
    const rule = await prisma.reminderRule.create({ data: { ...RULE_FIELDS(req.body), bgId: bg.id } })
    await writeVehicles(rule.id, bg.id, req.body.vehicles, req.scope)
    const row = await prisma.reminderRule.findUnique({ where: { id: rule.id }, include: { vehicles: true, bg: { select: { id: true, name: true } } } })
    res.status(201).json({ data: publicRule(row) })
  })
)

ruleRouter.put(
  '/:id',
  validate(ruleSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'reminderRule')
    const existing = await findScopedOrThrow('reminderRule', req.params.id, req.scope)
    checkRule(req.body)
    await prisma.reminderRule.update({ where: { id: existing.id }, data: RULE_FIELDS(req.body) })
    await writeVehicles(existing.id, existing.bgId, req.body.vehicles, req.scope)
    const row = await prisma.reminderRule.findUnique({ where: { id: existing.id }, include: { vehicles: true, bg: { select: { id: true, name: true } } } })
    res.json({ data: publicRule(row) })
  })
)

ruleRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'reminderRule')
    const existing = await findScopedOrThrow('reminderRule', req.params.id, req.scope)
    await prisma.reminderRule.delete({ where: { id: existing.id } })
    res.json({ data: { id: existing.id } })
  })
)

// ── /api/reminders ──────────────────────────────────────────────────────────

const statusQuery = z.object({
  bgId: z.string().trim().min(1).optional(),
  vehicleId: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).max(60).optional(),
  status: z.enum(['upcoming', 'due', 'overdue', 'completed']).optional(),
})

/** Reminder Status: every rule × vehicle the caller may see, worked out now. */
router.get(
  '/status',
  validate(statusQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId, vehicleId, type, status } = req.validatedQuery
    const rules = await prisma.reminderRule.findMany({
      where: scopedWhere('reminderRule', req.scope, bgId ? { bgId } : null, type ? { type } : null),
      include: { vehicles: true, bg: { select: { id: true, name: true } } },
    })
    const vehicleIds = [...new Set(rules.flatMap(r => r.vehicles.map(v => v.vehicleId)))]
    const vehicles = await prisma.vehicle.findMany({
      where: scopedWhere('vehicle', req.scope, { id: { in: vehicleIds } }, vehicleId ? { id: vehicleId } : null),
      select: { ...VEHICLE_SELECT, branch: { select: { id: true, name: true } } },
    })
    const byId = new Map(vehicles.map(v => [v.id, v]))
    const meters = await readMeters(vehicles)
    const lastAck = await prisma.reminderAck.groupBy({
      by: ['ruleId', 'vehicleId'], where: { ruleId: { in: rules.map(r => r.id) } }, _max: { doneAt: true },
    })
    const ackAt = new Map(lastAck.map(a => [`${a.ruleId}|${a.vehicleId}`, a._max.doneAt]))
    const now = new Date()
    const rows = []
    for (const rule of rules) {
      for (const rv of rule.vehicles) {
        const v = byId.get(rv.vehicleId)
        if (!v) continue
        const meter = meters.get(v.id) ?? {}
        const result = reminderStatus(rule, rv, meter, now)
        if (status && result.status !== status) continue
        rows.push({
          ruleId: rule.id, ruleName: rule.name, type: rule.type, recurring: rule.recurring, active: rule.active,
          frequency: rule.frequency, every: rule.every,
          bg: rule.bg, vehicle: { id: v.id, plateNo: v.plateNo, fleetNo: v.fleetNo, imei: v.imei, branch: v.branch },
          startDate: day(rv.startDate), issueDate: day(rv.issueDate), expiryDate: day(rv.expiryDate),
          lastDoneAt: day(ackAt.get(`${rule.id}|${v.id}`) ?? null),
          odometer: meter.odometer, engineHours: meter.engineHours == null ? null : Math.round(meter.engineHours * 10) / 10,
          status: result.status, parts: result.parts, detail: describeStatus(result),
        })
      }
    }
    const order = { overdue: 0, due: 1, upcoming: 2, completed: 3 }
    rows.sort((a, b) => order[a.status] - order[b.status] || a.ruleName.localeCompare(b.ruleName))
    res.json({ data: rows })
  })
)

/** Odometer and engine hours now, for the Expense form. GET ?vehicleIds=a,b */
router.get(
  '/meters',
  asyncHandler(async (req, res) => {
    const ids = String(req.query.vehicleIds ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 200)
    const vehicles = ids.length
      ? await prisma.vehicle.findMany({ where: scopedWhere('vehicle', req.scope, { id: { in: ids } }), select: VEHICLE_SELECT })
      : []
    const meters = await readMeters(vehicles)
    res.json({
      data: Object.fromEntries([...meters].map(([id, m]) => [id, {
        odometer: m.odometer == null ? null : Math.round(m.odometer * 10) / 10,
        engineHours: m.engineHours == null ? null : Math.round(m.engineHours * 10) / 10,
      }])),
    })
  })
)

const ackSchema = z.object({
  ruleId: requiredId('Reminder'),
  vehicleId: requiredId('Vehicle'),
  doneAt: optionalDate(),
  odometer: zeroOrMore,
  note: optionalText(300),
  expenseId: z.string().trim().max(60).optional().nullable().default(null),
  // A renewal's next expiry (the new insurance end date, say).
  newExpiry: optionalDate(),
})

/** Mark done: logs it and starts the next cycle (or completes a One Time reminder). */
router.post(
  '/ack',
  validate(ackSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'reminderRule')
    const rule = await findScopedOrThrow('reminderRule', req.body.ruleId, req.scope)
    const rv = await prisma.reminderVehicle.findUnique({ where: { ruleId_vehicleId: { ruleId: rule.id, vehicleId: req.body.vehicleId } } })
    if (!rv) throw badRequest('That vehicle is not on this reminder', { vehicleId: 'Not on this reminder' })
    const vehicle = await findScopedOrThrow('vehicle', rv.vehicleId, req.scope)
    const doneAt = req.body.doneAt ?? new Date(new Date().toISOString().slice(0, 10))
    if (doneAt > new Date()) throw badRequest('The date is in the future', { doneAt: 'Today or earlier' })
    const meter = (await readMeters([vehicle])).get(vehicle.id) ?? {}
    // Done some km ago: those km already count towards the next cycle.
    const kmBefore = req.body.odometer != null && meter.odometer != null ? Math.max(0, meter.odometer - req.body.odometer) : 0

    const [ack] = await prisma.$transaction([
      prisma.reminderAck.create({
        data: {
          bgId: rule.bgId, ruleId: rule.id, ruleName: rule.name, type: rule.type,
          vehicleId: vehicle.id, vehicleLabel: vehicle.plateNo || vehicle.fleetNo || vehicle.imei,
          doneAt, odometer: req.body.odometer ?? meter.odometer ?? null, engineHours: meter.engineHours ?? null,
          note: req.body.note, expenseId: req.body.expenseId, byName: req.user.shortName || req.user.email,
        },
      }),
      prisma.reminderVehicle.update({
        where: { id: rv.id },
        data: rule.recurring
          ? {
              startDate: doneAt, kmBefore, hoursBefore: 0,
              startOdometer: meter.odometer ?? null, startEngineHours: meter.engineHours ?? null,
              expiryDate: req.body.newExpiry ?? null, alerted: null,
            }
          : { completedAt: doneAt, alerted: null },
      }),
    ])
    res.status(201).json({ data: { ...ack, doneAt: day(ack.doneAt) } })
  })
)

const historyQuery = z.object({
  bgId: z.string().trim().min(1).optional(),
  vehicleId: z.string().trim().min(1).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/** Acknowledgement History: what was marked done, when and by whom. */
router.get(
  '/acks',
  validate(historyQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId, vehicleId, from, to } = req.validatedQuery
    const rows = await prisma.reminderAck.findMany({
      where: scopedWhere(
        'reminderAck', req.scope,
        bgId ? { bgId } : null,
        vehicleId ? { vehicleId } : null,
        from || to ? { doneAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : null,
      ),
      orderBy: { doneAt: 'desc' },
      take: 2000,
    })
    res.json({ data: rows.map(a => ({ ...a, doneAt: day(a.doneAt) })) })
  })
)
