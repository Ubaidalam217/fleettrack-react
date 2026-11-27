/**
 * Uffizio vehicles on the Live Map (client, 2026-11-25: "show ALL data
 * here"). Uffizio vehicles have no Flespi device, so the website cannot read
 * them through the Flespi proxy; it reads them here instead:
 *
 *   liveUffizio(scope)          GET /api/live/uffizio — every Uffizio vehicle
 *                               the account may see, with its latest row
 *                               (UffizioState) and its latest fuel reading
 *                               (litres via the calibration in use, raw when
 *                               there is none).
 *   uffizioMessages(id, from, to)  GET /api/live/uffizio/:id/messages — the
 *                               ~2-minute position samples (UffizioPosition)
 *                               in FLESPI'S MESSAGE SHAPE, so the replay, the
 *                               vehicle panel's "today" and anything else that
 *                               reads messages works on them unchanged.
 *
 * Data is as fresh as the Uffizio poll (about every 2 minutes).
 */

import prisma from '../prisma.js'
import { findScopedOrThrow, scopedWhere } from './scope.js'
import { badRequest, notFound } from './http.js'
import { activeCalibrations, calibrationPort, readingLitres, samePort } from './fuel.js'

/** The web's id for an Uffizio vehicle in the live list (never a Flespi device id). */
export const liveIdOf = vehicleId => `uffizio:${vehicleId}`
/** The most samples one messages call returns (31 days of 2-minute samples is ~22 000). */
export const MAX_MESSAGES = 25_000
export const MAX_RANGE_SEC = 31 * 86400 + 3600

const sec = d => (d ? Math.floor(new Date(d).getTime() / 1000) : null)

/** One vehicle + its state + its latest fuel → what the Live Map reads (pure). */
export function stateToLive(v, s, fuel) {
  return {
    id: liveIdOf(v.id),
    vehicleId: v.id,
    imei: v.imei,
    source: 'UFFIZIO',
    ts: sec(s?.ts),
    gpsTs: sec(s?.gpsTs),
    lat: s?.lat ?? null,
    lng: s?.lng ?? null,
    speed: s?.speed ?? null,
    heading: s?.heading ?? null,
    ign: s?.ign ?? null,
    status: s?.status ?? null,
    odometerKm: s?.odometerKm ?? null,
    driverName: s?.driverName ?? null,
    driverTag: s?.driverTag ?? null,
    externalVolt: s?.externalVolt ?? null,
    batteryPct: s?.batteryPct ?? null,
    temperature: s?.temperature ?? null,
    sos: s?.sos ?? null,
    power: s?.power ?? null,
    satellites: s?.satellites ?? null,
    location: s?.location ?? null,
    vehicleType: s?.vehicleType ?? null,
    updatedAt: s?.updatedAt ? new Date(s.updatedAt).toISOString() : null,
    raw: s?.raw ?? null,
    fuel: fuel ?? null,
  }
}

/** One position sample → a Flespi-shaped message (pure). */
export function positionToMessage(p, liveId) {
  return {
    'device.id': liveId,
    timestamp: sec(p.ts),
    'position.latitude': p.lat,
    'position.longitude': p.lng,
    'position.speed': p.speed ?? 0,
    'position.direction': p.heading ?? null,
    'position.valid': true,
    'engine.ignition.status': p.ign ?? null,
    'vehicle.mileage': p.odometerKm ?? null,
    'ibutton.code': p.driverTag ?? null,
    'external.powersource.voltage': p.externalVolt ?? null,
  }
}

/** The latest fuel reading per vehicle: the calibrated port's, else the newest of any port. */
async function latestFuel(ids) {
  if (!ids.length) return new Map()
  const since = new Date(Date.now() - 7 * 86400_000)
  const [cals, rows] = await Promise.all([
    activeCalibrations(ids),
    prisma.fuelReading.findMany({
      where: { vehicleId: { in: ids }, ts: { gte: since } },
      distinct: ['vehicleId', 'port'],
      orderBy: [{ vehicleId: 'asc' }, { port: 'asc' }, { ts: 'desc' }],
      select: { vehicleId: true, port: true, raw: true, ts: true },
    }),
  ])
  const out = new Map()
  for (const id of ids) {
    const cal = cals.get(id) ?? null
    const mine = rows.filter(r => r.vehicleId === id)
    const pick = (cal && mine.find(r => samePort(r.port, calibrationPort(cal)))) || mine.sort((a, b) => b.ts - a.ts)[0]
    if (!pick) continue
    const conv = cal ? readingLitres(pick, cal) : { litres: null, flag: 'uncalibrated' }
    out.set(id, {
      port: pick.port, raw: pick.raw, ts: sec(pick.ts),
      litres: conv.litres, flag: conv.flag ?? null, calibrated: !!cal,
      tankCapacityL: cal?.tankCapacityL ?? null,
    })
  }
  return out
}

/** GET /api/live/uffizio */
export async function liveUffizio(scope) {
  const vehicles = await prisma.vehicle.findMany({
    where: scopedWhere('vehicle', scope, { dataSource: 'UFFIZIO' }),
    select: { id: true, imei: true, uffizioState: true },
  })
  const fuel = await latestFuel(vehicles.map(v => v.id))
  return vehicles.map(v => stateToLive(v, v.uffizioState, fuel.get(v.id)))
}

/** GET /api/live/uffizio/:vehicleId/messages?from&to (unix seconds) */
export async function uffizioMessages(scope, vehicleId, fromSec, toSec) {
  if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || toSec < fromSec) throw badRequest('Give from and to as unix seconds, from before to')
  if (toSec - fromSec > MAX_RANGE_SEC) throw badRequest('Up to 31 days at a time')
  const v = await findScopedOrThrow('vehicle', vehicleId, scope, { select: { id: true, dataSource: true } })
  if (v.dataSource !== 'UFFIZIO') throw notFound('Uffizio vehicle')
  const rows = await prisma.uffizioPosition.findMany({
    where: { vehicleId: v.id, ts: { gte: new Date(fromSec * 1000), lte: new Date(toSec * 1000) } },
    orderBy: { ts: 'asc' },
    take: MAX_MESSAGES,
  })
  const id = liveIdOf(v.id)
  return { result: rows.map(p => positionToMessage(p, id)), truncated: rows.length >= MAX_MESSAGES }
}
