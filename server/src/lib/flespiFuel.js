/**
 * Fuel readings from Flespi trackers (client, 2026-11-27: "Fuel data can be
 * fetched from Flespi for Smart5"). Only the SOURCE is new: the readings land
 * in FuelReading like the Uffizio ones and go through the same calibration,
 * Fuel report, alerts, Settings > Fuel page and vehicle Fuel section.
 *
 * Which input a vehicle reads is its fuel calibration (FuelCalibration.method):
 *   AIN1 / AIN2   analogue input 1 / 2. Flespi gives volts; stored as mV
 *                 (volts x 1000) so the client's Fuel Liter / mV tables apply.
 *   CAN           can.fuel.level, percent of the tank (needs the tank capacity).
 *   CAN_VOLUME    can.fuel.volume, litres as the vehicle reports them.
 * A Flespi vehicle with no such calibration is not touched at all.
 *
 * No Flespi traffic of its own: the alert engine already reads the latest
 * telemetry of every device each pass (our own copy, lib/telemetry.js, while
 * the webhook is delivering) and hands it in here (alertEngine.js tick).
 *
 * A reading is stored only when the device's own timestamp of that value moved
 * on, so a tracker that went quiet is not stored again with a fresh time.
 */

import prisma from '../prisma.js'
import { readingLitres, canonicalPort } from './fuel.js'
import { FLESPI_FUEL_SOURCES, FLESPI_FUEL_METHODS } from '../../../src/utils/fuelCalibration.js'

/** The telemetry parameters this job needs from the alert engine's read. */
export const FUEL_TELEMETRY_FIELDS = Object.freeze(Object.values(FLESPI_FUEL_SOURCES).map(s => s.field))

/** A clock this far in the future is a broken tracker clock, not a reading. */
const MAX_FUTURE_MS = 10 * 60_000

const digits = s => String(s ?? '').replace(/\D/g, '')
const isNum = v => typeof v === 'number' && Number.isFinite(v)

/**
 * { field: { value, ts } } of one device's telemetry → just the fuel inputs
 * that carry a number and a time. Used by the alert engine's reader.
 */
export function fuelInputsOf(telemetry) {
  const out = {}
  for (const field of FUEL_TELEMETRY_FIELDS) {
    const e = telemetry?.[field]
    if (e && isNum(e.value) && isNum(e.ts)) out[field] = { value: e.value, ts: e.ts }
  }
  return out
}

/**
 * One calibration's reading out of a device's fuel inputs, or null when there
 * is none to store.
 * @returns {{ port: string, raw: number, ts: number }|null}  ts in unix seconds
 */
export function readingOf(method, inputs) {
  const src = FLESPI_FUEL_SOURCES[method]
  const e = src && inputs?.[src.field]
  if (!e) return null
  // can.fuel.level of exactly 0 with no can.fuel.volume next to it is how some
  // trackers say "not provided", not an empty tank: no reading (a false drain).
  if (method === 'CAN' && e.value === 0 && !inputs['can.fuel.volume']) return null
  const raw = src.unit === 'V' ? Math.round(e.value * 1000) : e.value
  return { port: src.port, raw, ts: e.ts }
}

/**
 * Store the new fuel readings of every Flespi vehicle with a fuel calibration.
 *
 * @param {Map<number, { fuel?: object, ignition?: boolean|null, lat?: number|null, lng?: number|null, speed?: number|null }>} telemetry
 *        the alert engine's per-device read
 * @param {Map<string, number>} deviceByImei  IMEI digits -> Flespi device id
 * @returns {Promise<number>} readings stored
 */
export async function runFlespiFuelPass(telemetry, deviceByImei, nowMs = Date.now()) {
  const cals = await prisma.fuelCalibration.findMany({
    where: { active: true, method: { in: FLESPI_FUEL_METHODS }, vehicle: { dataSource: { not: 'UFFIZIO' } } },
    include: { vehicle: { select: { id: true, imei: true, flespiDeviceId: true } } },
  })
  if (!cals.length) return 0

  const ids = [...new Set(cals.map(c => c.vehicleId))]
  const last = await prisma.fuelReading.groupBy({ by: ['vehicleId', 'port'], where: { vehicleId: { in: ids } }, _max: { ts: true } })
  const lastOf = new Map(last.map(r => [`${r.vehicleId}|${r.port}`, r._max.ts?.getTime() ?? 0]))

  const data = []
  for (const cal of cals) {
    const v = cal.vehicle
    const deviceId = deviceByImei?.get(digits(v.imei)) ?? v.flespiDeviceId ?? null
    const t = deviceId != null ? telemetry?.get(deviceId) : null
    const r = readingOf(cal.method, t?.fuel)
    if (!r) continue
    const tsMs = r.ts * 1000
    if (tsMs <= (lastOf.get(`${v.id}|${r.port}`) ?? 0)) continue // the same value as last time
    if (tsMs > nowMs + MAX_FUTURE_MS) continue
    data.push({
      vehicleId: v.id, ts: new Date(tsMs), port: canonicalPort(r.port), raw: r.raw,
      litres: readingLitres({ port: r.port, raw: r.raw }, cal).litres,
      ign: typeof t.ignition === 'boolean' ? t.ignition : null,
      lat: t.lat ?? null, lng: t.lng ?? null, speed: t.speed ?? null,
    })
  }
  if (!data.length) return 0
  const res = await prisma.fuelReading.createMany({ data, skipDuplicates: true })
  if (res.count) {
    try {
      // Loaded here: fuelAlerts imports the alert engine, which imports this file.
      const { runFuelAlertPass } = await import('./fuelAlerts.js')
      await runFuelAlertPass(nowMs)
    } catch (err) { console.error(`[fleetmax] fuel alert pass failed: ${err.message}`) }
  }
  return res.count
}
