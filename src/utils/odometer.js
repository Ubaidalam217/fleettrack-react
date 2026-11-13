/**
 * The vehicle's odometer (client, 2026-11-12: "Update the ODO meter reading").
 *
 * A tracker counts from where it was installed, so its `vehicle.mileage` is
 * not the number on the dashboard. The operator types the real reading once
 * (Vehicle information, Settings › Bulk Action or the Vehicle form) and the server keeps the
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

/** The server's limit for a typed reading (routes/vehicles.js). */
export const MAX_READING_KM = 10_000_000
/** A rise this big over the current total is more likely a typo than a trip. */
export const BIG_JUMP_KM = 100_000

/**
 * A typed odometer reading against the vehicle's current total.
 * `error` blocks the save (not a number, below 0, past the server's limit);
 * `warning` needs a second click: a reading lower than the current total
 * (odometers only go up, so it is for fixing a wrong earlier entry) or one
 * more than BIG_JUMP_KM above it (an extra digit).
 * @returns {{ value: number|null, error: string|null, warning: string|null }}
 */
export function checkReading(text, currentKm) {
  const raw = String(text ?? '').replace(/,/g, '').trim()
  if (!raw) return { value: null, error: 'Type the odometer reading', warning: null }
  const value = Number(raw)
  if (!Number.isFinite(value)) return { value: null, error: 'A number of km, e.g. 150000', warning: null }
  if (value < 0 || value >= MAX_READING_KM) return { value: null, error: 'A reading from 0 to 9,999,999 km', warning: null }
  const cur = finite(currentKm)
  if (cur !== null && value < cur) {
    return { value, error: null, warning: `Lower than the current ${fmtKm(cur)} — odometers only go up. Save only to fix a wrong earlier reading.` }
  }
  if (cur !== null && value - cur > BIG_JUMP_KM) {
    return { value, error: null, warning: `${fmtKm(value - cur)} more than the current ${fmtKm(cur)} — check the digits.` }
  }
  return { value, error: null, warning: null }
}
