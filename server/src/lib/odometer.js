/**
 * The vehicle's odometer (client, 2026-11-12: "Update the ODO meter reading").
 *
 * A tracker counts from wherever it was installed, so its vehicle.mileage is
 * not the number on the dashboard. The operator types the real reading once;
 * Vehicle.odometerOffsetKm keeps the difference, and the vehicle's odometer is
 * the tracker's reading plus that from then on. Reading only: nothing here
 * writes to Flespi.
 */

import * as flespi from './flespi.js'

const digits = v => String(v ?? '').replace(/\D/g, '')
const finite = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The tracker's reading plus the vehicle's correction; null when the tracker has none. */
export function vehicleKm(deviceKm, offsetKm) {
  const d = finite(deviceKm)
  return d === null ? null : d + (finite(offsetKm) ?? 0)
}

/**
 * The trackers' own odometers now, per vehicle id: { deviceKm, ts }. One fleet
 * telemetry read (our telemetry copy first, else one Flespi GET). A Flespi
 * outage leaves every reading unknown rather than failing the caller.
 */
export async function deviceOdometers(vehicles) {
  const out = new Map()
  if (!vehicles.length) return out
  let telemetry = new Map(), byImei = new Map()
  try {
    // Imported here: alertEngine → reminders → this file would otherwise be a cycle.
    const { fetchTelemetry } = await import('./alertEngine.js')
    ;[telemetry, byImei] = await Promise.all([fetchTelemetry(), flespi.deviceMap()])
  } catch { /* unknown */ }
  for (const v of vehicles) {
    const dev = byImei.get(digits(v.imei))
    const t = dev !== undefined ? telemetry.get(dev) : undefined
    out.set(v.id, { deviceKm: finite(t?.mileage), ts: t?.ts ?? null })
  }
  return out
}

/** One vehicle's odometer as the API returns it. */
export function odometerRow(v, reading) {
  const deviceKm = reading?.deviceKm ?? null
  return {
    vehicleId: v.id,
    deviceKm,
    offsetKm: finite(v.odometerOffsetKm),
    vehicleKm: vehicleKm(deviceKm, v.odometerOffsetKm),
    ts: reading?.ts ?? null,
    setAt: v.odometerSetAt ?? null,
    setBy: v.odometerSetBy ?? null,
  }
}
