/**
 * Fuel calibrations (client, 2026-11-24): applying, replacing (the old one is
 * kept as history, never overwritten) and reading them back.
 *
 * Litres are COMPUTED ON READ: the report and the alerts convert each stored
 * raw reading with the vehicle's calibration in use now (src/utils/
 * fuelCalibration.js, shared with the web page). So applying a calibration
 * takes effect on every stored reading at once, with nothing to recompute or
 * migrate, and a wrong table is fixed by uploading the right one.
 * FuelReading.litres is only what the calibration in use at the time gave
 * when the reading was stored — a record, not what the report shows.
 */

import prisma from '../prisma.js'
import { badRequest } from './http.js'
import {
  validateCalibration, readingLitres, rawToLitres, calibrationPort, canonicalPort, samePort, METHOD_PORT,
} from '../../../src/utils/fuelCalibration.js'
import { cleanSeries, detectFuelEvents, fuelSummary, rawSummary, downsample } from '../../../src/utils/fuelEvents.js'
import { vehicleLabel as vehicleLabelOf } from './vehicleLabel.js'

export { readingLitres, rawToLitres, calibrationPort, canonicalPort, samePort }

/** The calibration in use per vehicle. */
export async function activeCalibrations(vehicleIds) {
  if (!vehicleIds?.length) return new Map()
  const rows = await prisma.fuelCalibration.findMany({ where: { vehicleId: { in: vehicleIds }, active: true } })
  return new Map(rows.map(r => [r.vehicleId, r]))
}

/** What the API sends for one calibration. */
export const calibrationView = c => c && ({
  id: c.id,
  vehicleId: c.vehicleId,
  method: c.method,
  port: c.port,
  tankCapacityL: c.tankCapacityL,
  points: Array.isArray(c.points) ? c.points : [],
  fileName: c.fileName,
  note: c.note,
  active: c.active,
  createdByName: c.createdByName,
  createdAt: c.createdAt,
  replacedAt: c.replacedAt,
  replacedByName: c.replacedByName,
})

/**
 * Check what was sent for a new calibration and put it in order.
 * Throws 400 with per-row details (`points.<row>`) on a bad table.
 */
export function checkCalibrationInput({ method, port, tankCapacityL, points }) {
  if (method === 'CAN') {
    if (!(tankCapacityL > 0)) throw badRequest('CAN reads the level in percent, so the tank capacity is needed', { tankCapacityL: 'Enter the tank capacity' })
    return { method, port: METHOD_PORT.CAN, tankCapacityL, points: [], warnings: [] }
  }
  // CAN litres: the vehicle reports litres itself; the tank is optional (it only catches a faulty figure).
  if (method === 'CAN_VOLUME') return { method, port: METHOD_PORT.CAN_VOLUME, tankCapacityL: tankCapacityL ?? null, points: [], warnings: [] }
  const usePort = method === 'PORT' ? String(port ?? '').trim() : METHOD_PORT[method]
  if (!usePort) throw badRequest('Choose the Uffizio fuel port this calibration is for', { port: 'Choose the port' })
  const v = validateCalibration(points, { tankCapacityL })
  if (v.errors.length) {
    const details = {}
    for (const e of v.errors) details[e.row === null ? 'points' : `points.${e.row}`] = e.message
    throw badRequest(v.errors[0].row === null ? v.errors[0].message : `Row ${v.errors[0].row}: ${v.errors[0].message}`, details)
  }
  return { method, port: usePort.slice(0, 80), tankCapacityL: tankCapacityL ?? null, points: v.points, warnings: v.warnings }
}

/**
 * Put a checked calibration in use on one vehicle: the one in use is kept as
 * history (active false, replacedAt, replacedByName).
 */
export async function applyCalibration(vehicleId, cal, { by, fileName = null, note = null } = {}) {
  return prisma.$transaction(async tx => {
    const now = new Date()
    await tx.fuelCalibration.updateMany({
      where: { vehicleId, active: true },
      data: { active: false, replacedAt: now, replacedByName: by?.name ?? null },
    })
    return tx.fuelCalibration.create({
      data: {
        vehicleId, method: cal.method, port: canonicalPort(cal.port), tankCapacityL: cal.tankCapacityL, points: cal.points,
        fileName, note, createdById: by?.id ?? null, createdByName: by?.name ?? null,
      },
    })
  })
}

/**
 * A vehicle's fuel ports as last seen (newest reading per port within the last
 * 7 days), each with the litres its calibration gives.
 */
export async function latestPorts(vehicleId, cal) {
  const since = new Date(Date.now() - 7 * 86400_000)
  const ports = await prisma.fuelReading.groupBy({ by: ['port'], where: { vehicleId, ts: { gte: since } }, _max: { ts: true } })
  const out = []
  for (const p of ports) {
    const r = await prisma.fuelReading.findFirst({ where: { vehicleId, port: p.port, ts: p._max.ts } })
    if (!r) continue
    const conv = readingLitres(r, cal)
    out.push({ port: r.port, raw: r.raw, ts: r.ts, ign: r.ign, speed: r.speed, litres: conv.litres, flag: conv.flag })
  }
  return out.sort((a, b) => a.port.localeCompare(b.port))
}

// ── the Fuel report ─────────────────────────────────────────────────────────

/** The longest period one report may cover. */
export const REPORT_MAX_DAYS = 31

/**
 * The Fuel report of some vehicles over a period. Per vehicle: the port it
 * reads (the calibrated one, else the one with the most readings), the graph
 * series (litres, or raw when not calibrated; at most ~800 points), the
 * summary and the fill / drain events (src/utils/fuelEvents.js).
 *
 * @param {{ id, plateNo, fleetNo, imei, bg?: { name } }[]} vehicles  already scope-checked
 */
export async function buildFuelReport(vehicles, { from, to, threshold, allowanceLph = 0 }) {
  const ids = vehicles.map(v => v.id)
  const [cals, rows] = await Promise.all([
    activeCalibrations(ids),
    prisma.fuelReading.findMany({
      where: { vehicleId: { in: ids }, ts: { gte: from, lte: to } },
      orderBy: { ts: 'asc' },
      select: { vehicleId: true, ts: true, port: true, raw: true, ign: true, speed: true, lat: true, lng: true },
    }),
  ])
  const byVehicle = new Map(ids.map(id => [id, []]))
  for (const r of rows) byVehicle.get(r.vehicleId)?.push(r)

  return vehicles.map(v => {
    const cal = cals.get(v.id) ?? null
    const all = byVehicle.get(v.id) ?? []
    const counts = new Map()
    for (const r of all) counts.set(r.port, (counts.get(r.port) ?? 0) + 1)
    const port = (cal && calibrationPort(cal)) || [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    const mine = all.filter(r => samePort(r.port, port))
    const base = {
      vehicleId: v.id, label: vehicleLabelOf(v), company: v.bg?.name ?? null, port,
      ports: [...counts.keys()], calibration: calibrationView(cal),
    }
    if (!cal) {
      return {
        ...base, calibrated: false, unit: 'raw',
        series: downsample(mine.map(r => ({ ts: r.ts.getTime(), v: r.raw }))),
        summary: rawSummary(mine.map(r => ({ ts: r.ts.getTime(), raw: r.raw }))),
        events: [], outOfRange: 0,
      }
    }
    let outOfRange = 0
    const converted = mine.map(r => {
      const { litres, flag } = readingLitres(r, cal)
      if (flag === 'out_of_range') outOfRange++
      return { ts: r.ts.getTime(), litres, ign: r.ign, speed: r.speed, lat: r.lat, lng: r.lng }
    })
    const series = cleanSeries(converted, { threshold })
    // Any fall / rise of the threshold, moving or not (client, 2026-11-25).
    const events = detectFuelEvents(series, { threshold, allowanceLph })
    return {
      ...base, calibrated: true, unit: 'L',
      series: downsample(series.map(p => ({ ts: p.ts, v: p.litres }))),
      summary: fuelSummary(series, events),
      events, outOfRange,
    }
  })
}
