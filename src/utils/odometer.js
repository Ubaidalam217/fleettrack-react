/**
 * The vehicle's odometer (client, 2026-11-12: "Update the ODO meter reading").
 *
 * A tracker counts from where it was installed, so its `vehicle.mileage` is
 * not the number on the dashboard. The operator types the real reading once
 * (Settings › Bulk Action, or the Vehicle form) and the server keeps the
 * difference as the vehicle's `odometerOffsetKm`; the vehicle's odometer is
 * the tracker's reading plus that. Mirrors server/src/lib/odometer.js.
 */

const finite = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The tracker's reading plus the correction; null when the tracker has none. */
export function vehicleKm(deviceKm, offsetKm) {
  const d = finite(deviceKm)
  return d === null ? null : d + (finite(offsetKm) ?? 0)
}

/** True when a correction has been set for this vehicle. */
export const hasCorrection = offsetKm => finite(offsetKm) !== null

/** "150,000.0 km" — one decimal, grouped. */
export function fmtKm(km) {
  const v = finite(km)
  return v === null ? null : `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

/**
 * The odometer as the vehicle screens show it: the vehicle's reading, and the
 * tracker's own beside it once a correction is set ("150,000.0 km · Device
 * 1,200.5 km"). null when the tracker has sent no reading.
 */
export function odometerLabel(deviceKm, offsetKm) {
  const own = fmtKm(vehicleKm(deviceKm, offsetKm))
  if (own === null) return null
  return hasCorrection(offsetKm) ? `${own} · Device ${fmtKm(deviceKm)}` : own
}
