// Geo Zone Visit Report — raw message fetch.
//
// One fetch per run, shared by all 5 sub-reports (Trip, Visited Summary,
// Address Visits, History, Geofence-to-Geofence Trip Summary) — the engine in
// geoZoneEngine.js derives every one of them from the same message set, so
// there is exactly one network cost per Generate click regardless of how many
// sub-reports get viewed afterward.
//
// Reuses replay.js's fetchFleetMessages, as the Movement Report does: one
// request per day for every selected device (Flespi applies `count` per device
// on a multi-device selector), a few days at a time, with the same 86400s
// chunking, 429 backoff and abort handling.
//
// Fields: position + ignition + mileage, the same set every other report in
// this app reuses for status/distance. `ble.sensor.temperature.1` is also
// requested — it is the only temperature field any device on this account
// reports (see sensorsData.js / the Sensors tab), and only the Test Bench unit
// (8414507) actually has live values for it; every other device simply omits
// it from its reply, which the derivation renders as "--". No fuel field
// exists anywhere on this account (re-probed for Phase 5 Movement Report), so
// fuel is never requested and always renders "--"/0.0 rather than invented.
import { fetchFleetMessages, isAbortError } from './replay'
import { DISTANCE_FIELDS } from './distance'

export { isAbortError }

export const GEO_ZONE_FIELDS = [
  'timestamp',
  'engine.ignition.status',
  ...DISTANCE_FIELDS,
  'ble.sensor.temperature.1',
].join(',')

/**
 * Fetch raw messages for every selected device over one arbitrary range.
 *
 * @param {number[]} deviceIds
 * @param {number} fromTs  unix seconds, inclusive
 * @param {number} toTs    unix seconds, inclusive
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {(p: {done: number, total: number, text: string}) => void} [opts.onProgress]
 * @returns {Promise<Map<number, {messages: object[], truncated: boolean}>>}
 */
export async function fetchGeoZoneMessages(deviceIds, fromTs, toTs, opts = {}) {
  const { onProgress, signal } = opts
  onProgress?.({ done: 0, total: 1, text: 'Generating report...' })
  const byDevice = await fetchFleetMessages(deviceIds, fromTs, toTs, {
    fields: GEO_ZONE_FIELDS,
    signal,
    onStatus: text => onProgress?.({ done: 0, total: 1, text: /busy/i.test(text) ? text : 'Generating report...' }),
  })
  onProgress?.({ done: 1, total: 1, text: 'Generating report...' })
  return byDevice
}

/** How many Flespi requests a range × device-count selection would cost — one per device per UTC day of range, the same shape Movement Report shows. */
export function estimateRequestCount(deviceCount, fromTs, toTs) {
  if (deviceCount <= 0 || !(toTs > fromTs)) return 0
  const days = Math.ceil((toTs - fromTs) / 86400)
  return deviceCount * Math.max(1, days)
}

/** Inclusive day span of a [fromTs, toTs] range, for the 31-day cap check. */
export function rangeDays(fromTs, toTs) {
  if (!(toTs > fromTs)) return 0
  return Math.ceil((toTs - fromTs) / 86400)
}
