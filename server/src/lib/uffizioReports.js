/**
 * The Uffizio vehicles in the Daywise reports and the Dashboard (client,
 * 2026-11-26: "We can get the same standard reports").
 *
 *   uffizioDaywise(scope, year, month)  GET /api/reports/uffizio-daywise
 *
 * A Flespi vehicle's month comes from the DailyUsage job (lib/dailyUsage.js);
 * an Uffizio vehicle has no Flespi device, so its month is worked out here
 * from its own ~2-minute samples (UffizioPosition) with the SAME derivation
 * the browser uses (src/utils/uffizioReports.js deriveUffizioMonth, which is
 * deriveDeviceMonth plus the estimated share): distance from the odometer,
 * engine time from the ignition, UAE days. One small answer instead of a
 * month of samples per vehicle in the browser.
 *
 * A month is kept in memory per vehicle: for good once it has ended (the
 * samples arrive as they happen, so an hour after the end nothing changes),
 * else for CACHE_MS.
 */

import prisma from '../prisma.js'
import { scopedWhere } from './scope.js'
import { liveIdOf, positionToMessage } from './uffizioLive.js'
import { deriveUffizioMonth } from '../../../src/utils/uffizioReports.js'
import { daysInMonth, uaeDayStart } from '../../../src/utils/daywiseCore.js'

/** Samples before the month that still count (the interval across its first midnight is split). */
const LEAD_SEC = 6 * 3600
/** An unfinished month is worked out again after this long. */
const CACHE_MS = 2 * 60 * 1000
/** A month is final this long after it ends. */
const SETTLE_SEC = 3600
/** Kept months at most (vehicles x months). */
const MAX_CACHE = 2000

const cache = new Map() // `${vehicleId}|${year}-${month}` -> { at, final, value }

/** For tests. */
export function __resetUffizioReports() {
  cache.clear()
}

async function vehicleMonth(vehicleId, year, month, nowSec) {
  const key = `${vehicleId}|${year}-${month}`
  const monthEnd = uaeDayStart(year, month, daysInMonth(year, month)) + 86400
  const hit = cache.get(key)
  if (hit && (hit.final || Date.now() - hit.at < CACHE_MS)) return hit.value

  const from = uaeDayStart(year, month, 1) - LEAD_SEC
  const rows = await prisma.uffizioPosition.findMany({
    where: { vehicleId, ts: { gte: new Date(from * 1000), lt: new Date(monthEnd * 1000) } },
    orderBy: { ts: 'asc' },
    select: { ts: true, lat: true, lng: true, speed: true, heading: true, ign: true, odometerKm: true, driverTag: true, externalVolt: true },
  })
  const id = liveIdOf(vehicleId)
  const d = deriveUffizioMonth(rows.map(p => positionToMessage(p, id)), year, month)
  const value = {
    deviceId: id,
    distanceKm: d.distanceKm,
    ignitionSec: d.ignitionSec,
    estimatedKm: d.estimatedKm,
    samplesPerDay: d.samplesPerDay,
    totalKm: d.totalKm,
    totalSec: d.totalSec,
    totalEstimatedKm: d.totalEstimatedKm,
    noData: d.noData,
    source: d.source,
  }
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value)
  cache.set(key, { at: Date.now(), final: nowSec > monthEnd + SETTLE_SEC, value })
  return value
}

/** GET /api/reports/uffizio-daywise?year&month — every Uffizio vehicle the account may see. */
export async function uffizioDaywise(scope, year, month, nowSec = Math.floor(Date.now() / 1000)) {
  const vehicles = await prisma.vehicle.findMany({
    where: scopedWhere('vehicle', scope, { dataSource: 'UFFIZIO' }),
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const devices = []
  for (const v of vehicles) devices.push(await vehicleMonth(v.id, year, month, nowSec))
  return { year, month, devices, capped: false }
}
