/**
 * Which fuel and temperature readings are real (client, 2026-11-10; from a
 * read-only probe of every tracker on 2026-11-09).
 *
 * Trackers send sensor fields whether or not a sensor is there:
 * - a BLE temperature slot with no probe paired reports 0 °C with 0 %
 *   humidity on every message (AD 12411, KM 6168 E), and a real probe drops
 *   out the same way now and then: temperature, humidity and battery all 0;
 * - CAN fuel fields on a vehicle whose bus gives no fuel data read 0 on every
 *   message (AD 12944-R14);
 * - a field the device stopped sending months ago still sits in its telemetry
 *   with that old value (AD 12944-R14's fuel 0 % from July).
 *
 * So a 0 that comes with all its companions at 0 is "no reading", a fuel
 * series that never leaves 0 is "no sensor", and a live value whose own field
 * is older than SENSOR_FRESH_SEC is not "current". Shared by the web app and
 * the server (alert engine, telemetry copy), like utils/distance.js.
 */

export const SENSOR_FRESH_SEC = 15 * 60

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Probe n's temperature in a flat message (field → value), or null when there is none. */
export function probeTemperature(m, n = 1) {
  const t = num(m?.[`ble.sensor.temperature.${n}`])
  if (t === null) return null
  if (t !== 0) return t
  const companions = [`ble.sensor.humidity.${n}`, `ble.sensor.battery.voltage.${n}`, `ble.sensor.battery.level.${n}`]
    .map(k => num(m?.[k]))
    .filter(v => v !== null)
  // 0 °C alone can be real (a cold room); with 0 % humidity and a 0 V battery it is no probe.
  return companions.length && companions.every(v => v === 0) ? null : t
}

/** The average over the probes this message really reports, or null. */
export function messageTemperature(m) {
  const vals = [1, 2, 3, 4].map(n => probeTemperature(m, n)).filter(v => v !== null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/** Is a field reported at `ts` (seconds) recent enough to call current? */
export function isFresh(ts, nowSec = Date.now() / 1000) {
  return typeof ts === 'number' && nowSec - ts <= SENSOR_FRESH_SEC
}

/** Flespi telemetry ({ field: { value, ts } }) → a flat field → value map. */
export const flatTelemetry = t => Object.fromEntries(Object.entries(t ?? {}).map(([k, v]) => [k, v?.value]))

/**
 * The current probe-1 temperature from Flespi-shaped telemetry: null when the
 * field is stale or the reading is a placeholder.
 */
export function liveTemperature(t, nowSec) {
  if (!isFresh(t?.['ble.sensor.temperature.1']?.ts, nowSec)) return null
  return probeTemperature(flatTelemetry(t), 1)
}

/** The current fuel level from Flespi-shaped telemetry, or null when stale. */
export function liveFuelLevel(t, nowSec) {
  const f = t?.['fuel.sensor.value']
  return isFresh(f?.ts, nowSec) ? num(f?.value) : null
}
