/**
 * /api/fuel — fuel calibrations and readings (client, 2026-11-24).
 *
 *   GET    /api/fuel/calibrations            the calibration in use of every visible vehicle
 *   GET    /api/fuel/series                  one vehicle's fuel over a period (panel + Replay)
 *   GET    /api/fuel/vehicles/:id            one vehicle: its calibration, history, ports as last seen
 *   POST   /api/fuel/calibrations            apply one table to one or many vehicles
 *   DELETE /api/fuel/calibrations/:id        stop using a calibration (it stays in the history)
 *
 * Reads follow the vehicle scope; writes need the vehicle as the caller's own
 * (not shared in) and the Fuel calibration screen at Edit (app.js).
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, notFound } from '../lib/http.js'
import { assertCanWrite, findScopedOrThrow, scopedWhere } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'
import { actorOf } from '../lib/vehicleMoves.js'
import { vehicleLabel } from '../lib/vehicleLabel.js'
import {
  activeCalibrations, applyCalibration, buildFuelReport, calibrationView, checkCalibrationInput, latestPorts, readingLitres, samePort, REPORT_MAX_DAYS,
} from '../lib/fuel.js'
import { METHOD_VALUES, MAX_POINTS } from '../../../src/utils/fuelCalibration.js'
import { DEFAULT_THRESHOLD_L } from '../../../src/utils/fuelEvents.js'

const router = Router()

const cell = z.union([z.null(), z.number(), z.string().max(40)])

const applySchema = z.object({
  vehicleIds: z.array(z.string().trim().min(1)).min(1, 'Choose at least one vehicle').max(200),
  method: z.enum(METHOD_VALUES, { message: 'Choose the reading method' }),
  port: z.union([z.null(), z.string().trim().max(80)]).optional(),
  // z.null() first: a blank capacity must stay null, not become 0.
  tankCapacityL: z.union([z.null(), z.coerce.number().positive('Must be more than 0').max(100_000)]).optional().default(null),
  points: z.array(z.object({ litres: cell, mv: cell, row: z.number().int().optional() })).max(MAX_POINTS).default([]),
  fileName: z.union([z.null(), z.string().trim().max(200)]).optional(),
  note: z.union([z.null(), z.string().trim().max(300)]).optional(),
})

router.get('/calibrations', asyncHandler(async (req, res) => {
  const vehicles = await prisma.vehicle.findMany({ where: scopedWhere('vehicle', req.scope), select: { id: true } })
  const cals = await activeCalibrations(vehicles.map(v => v.id))
  res.json({ data: [...cals.values()].map(calibrationView) })
}))

/**
 * Every visible vehicle with a calibration or a fuel reading in the last 7
 * days: its calibration and each port's newest reading, converted.
 */
router.get('/overview', asyncHandler(async (req, res) => {
  const vehicles = await prisma.vehicle.findMany({ where: scopedWhere('vehicle', req.scope), select: { id: true } })
  const ids = vehicles.map(v => v.id)
  if (!ids.length) return res.json({ data: [] })
  const [cals, latest] = await Promise.all([
    activeCalibrations(ids),
    prisma.$queryRaw`
      SELECT DISTINCT ON ("vehicleId", port) "vehicleId", port, raw, ts, ign, speed
      FROM "FuelReading"
      WHERE "vehicleId" = ANY(${ids}) AND ts > ${new Date(Date.now() - 7 * 86400_000)}
      ORDER BY "vehicleId", port, ts DESC`,
  ])
  const byVehicle = new Map()
  for (const r of latest) {
    const list = byVehicle.get(r.vehicleId) ?? []
    list.push(r)
    byVehicle.set(r.vehicleId, list)
  }
  const out = []
  for (const id of ids) {
    const cal = cals.get(id) ?? null
    const ports = (byVehicle.get(id) ?? []).map(r => ({ port: r.port, raw: r.raw, ts: r.ts, ign: r.ign, speed: r.speed, ...readingLitres(r, cal) }))
    if (!cal && !ports.length) continue
    out.push({ vehicleId: id, calibration: calibrationView(cal), ports })
  }
  res.json({ data: out })
}))

/**
 * GET /api/fuel/report?from&to&vehicleIds=a,b&threshold=15&allowance=0 — the Fuel report
 * (lib/fuel.js buildFuelReport). No vehicleIds: every visible vehicle with a
 * calibration or a reading in the period.
 */
const reportQuery = z.object({
  from: z.coerce.date({ message: 'Choose the From date' }),
  to: z.coerce.date({ message: 'Choose the To date' }),
  vehicleIds: z.string().trim().max(10_000).optional(),
  threshold: z.union([z.null(), z.coerce.number().min(1, 'At least 1 litre').max(1000)]).optional(),
  // Optional: litres per hour the engine may use, taken off a fall (default 0).
  allowance: z.union([z.null(), z.coerce.number().min(0, 'Not below 0').max(200, 'Up to 200 L/h')]).optional(),
})

router.get('/report', validate(reportQuery, 'query'), asyncHandler(async (req, res) => {
  const { from, to, vehicleIds, threshold, allowance } = req.validatedQuery
  if (to < from) throw badRequest('The From date must be before the To date', { from: 'After To' })
  if (to - from > REPORT_MAX_DAYS * 86400_000 + 3600_000) throw badRequest(`Up to ${REPORT_MAX_DAYS} days at a time`, { to: `Up to ${REPORT_MAX_DAYS} days` })
  const wanted = vehicleIds ? [...new Set(vehicleIds.split(',').map(s => s.trim()).filter(Boolean))].slice(0, 100) : null
  const select = { id: true, plateNo: true, fleetNo: true, imei: true, bg: { select: { name: true } } }
  let vehicles
  if (wanted) {
    vehicles = await prisma.vehicle.findMany({ where: scopedWhere('vehicle', req.scope, { id: { in: wanted } }), select })
  } else {
    const visible = await prisma.vehicle.findMany({ where: scopedWhere('vehicle', req.scope), select: { id: true } })
    const ids = visible.map(v => v.id)
    const [withReadings, withCal] = await Promise.all([
      prisma.fuelReading.groupBy({ by: ['vehicleId'], where: { vehicleId: { in: ids }, ts: { gte: from, lte: to } } }),
      prisma.fuelCalibration.findMany({ where: { vehicleId: { in: ids }, active: true }, select: { vehicleId: true } }),
    ])
    const keep = [...new Set([...withReadings.map(r => r.vehicleId), ...withCal.map(c => c.vehicleId)])].slice(0, 100)
    vehicles = keep.length ? await prisma.vehicle.findMany({ where: { id: { in: keep } }, select }) : []
  }
  const report = await buildFuelReport(vehicles, { from, to, threshold: threshold ?? undefined, allowanceLph: allowance ?? 0 })
  report.sort((a, b) => a.label.localeCompare(b.label))
  res.set('Cache-Control', 'no-store')
  res.json({ data: { from, to, threshold: threshold ?? DEFAULT_THRESHOLD_L, allowanceLph: allowance ?? 0, vehicles: report } })
}))

/**
 * GET /api/fuel/series?vehicleId&from&to — one vehicle's fuel over a period, for the
 * vehicle panel's Fuel Monitoring and the Replay fuel line: the Fuel report's entry
 * (graph series in litres or raw, fill / drain events with the report's thresholds,
 * summary) plus `latest`, the newest reading of the port in use. Scoped like the
 * other fuel reads; the period is capped like the report.
 */
const seriesQuery = z.object({
  vehicleId: z.string().trim().min(1, 'Choose the vehicle'),
  from: z.coerce.date({ message: 'Choose the From time' }),
  to: z.coerce.date({ message: 'Choose the To time' }),
  threshold: z.union([z.null(), z.coerce.number().min(1).max(1000)]).optional(),
})

router.get('/series', validate(seriesQuery, 'query'), asyncHandler(async (req, res) => {
  const { vehicleId, from, to, threshold } = req.validatedQuery
  if (to < from) throw badRequest('From must be before To', { from: 'After To' })
  if (to - from > REPORT_MAX_DAYS * 86400_000 + 3600_000) throw badRequest(`Up to ${REPORT_MAX_DAYS} days at a time`, { to: `Up to ${REPORT_MAX_DAYS} days` })
  const v = await findScopedOrThrow('vehicle', vehicleId, req.scope, {
    select: { id: true, plateNo: true, fleetNo: true, imei: true, bg: { select: { name: true } } },
  })
  const [entry] = await buildFuelReport([v], { from, to, threshold: threshold ?? undefined })
  const cal = entry.calibration ? { method: entry.calibration.method, port: entry.calibration.port, points: entry.calibration.points, tankCapacityL: entry.calibration.tankCapacityL } : null
  const ports = await latestPorts(v.id, cal)
  const latest = ports.find(p => entry.port && samePort(p.port, entry.port)) ?? ports[0] ?? null
  res.set('Cache-Control', 'no-store')
  res.json({ data: { ...entry, latest } })
}))

router.get('/vehicles/:id', asyncHandler(async (req, res) => {
  const v = await findScopedOrThrow('vehicle', req.params.id, req.scope, {
    select: { id: true, plateNo: true, fleetNo: true, imei: true, dataSource: true, bgId: true },
  })
  const history = await prisma.fuelCalibration.findMany({ where: { vehicleId: v.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  const cal = history.find(c => c.active) ?? null
  res.json({
    data: {
      vehicle: { id: v.id, label: vehicleLabel(v), dataSource: v.dataSource },
      calibration: calibrationView(cal),
      history: history.filter(c => !c.active).map(calibrationView),
      ports: await latestPorts(v.id, cal),
    },
  })
}))

router.post('/calibrations', validate(applySchema), asyncHandler(async (req, res) => {
  assertCanWrite(req.scope, 'vehicle')
  const ids = [...new Set(req.body.vehicleIds)]
  // Every vehicle first, so one out of reach applies nothing.
  const vehicles = []
  for (const id of ids) vehicles.push(await findScopedOrThrow('ownedVehicle', id, req.scope, { select: { id: true } }))
  const cal = checkCalibrationInput(req.body)
  const by = actorOf(req)
  const applied = []
  for (const v of vehicles) {
    const row = await applyCalibration(v.id, cal, { by, fileName: req.body.fileName ?? null, note: req.body.note ?? null })
    applied.push(calibrationView(row))
  }
  res.status(201).json({ data: { applied, warnings: cal.warnings } })
}))

router.delete('/calibrations/:id', asyncHandler(async (req, res) => {
  assertCanWrite(req.scope, 'vehicle')
  const cal = await prisma.fuelCalibration.findUnique({ where: { id: req.params.id } })
  if (!cal) throw notFound('Calibration')
  await findScopedOrThrow('ownedVehicle', cal.vehicleId, req.scope, { select: { id: true } })
  if (!cal.active) throw badRequest('This calibration is not in use')
  const row = await prisma.fuelCalibration.update({
    where: { id: cal.id },
    data: { active: false, replacedAt: new Date(), replacedByName: actorOf(req).name },
  })
  res.json({ data: calibrationView(row) })
}))

export default router
