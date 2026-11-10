/**
 * The Power Failure Report (client list, 2026-11-10): every time a tracker lost
 * its external (vehicle) power, for how long, and where. Pure: no React, no
 * network, no Date.now().
 *
 * What the trackers send (read-only probe of the live account, 2026-11-10):
 *   - `external.powersource.voltage`: the vehicle supply, ~12 V or ~24 V when
 *     present and 0-5 V once it is cut. Most, not all, devices send it.
 *   - `external.powersource.status`: a boolean on the few messages a device
 *     sends when its power changes. `false` has arrived with the voltage still
 *     normal, and `true` with it still low (the next message, a second later,
 *     has the voltage back) — the event leads the voltage reading.
 *   - `battery.voltage`: the tracker's own backup battery (3.5-4.2 V).
 *
 * ── A power cut ───────────────────────────────────────────────────────────
 * Each message reads as "no power" when its voltage is under the cut-below
 * threshold OR its status is `false`; as "power" when its voltage is at or
 * above the threshold (and the status is not `false`), or, with no voltage at
 * all, when its status is `true`. A message with neither says nothing and
 * leaves the state as it was. `true` is not allowed to end a cut while the
 * voltage on the same message is still low: on these devices that is the
 * restore event arriving a second ahead of the voltage, and honouring it split
 * one cut into two whenever the voltage then stayed low.
 *
 * A cut starts on the first "no power" message after a "power" one and ends on
 * the next "power" message (Power Restored). There is no time invented in
 * between: a tracker running on its battery may go quiet, and the first
 * message with power back is the first moment the power is known to be back.
 *   - The first reading of the period already "no power": the cut started
 *     before it, so it starts on that message and is marked `beforePeriod`
 *     (not when that reading is a `false` status — that is the cut itself).
 *   - Still "no power" on the last message: the cut is `open` and runs to the
 *     end of the period (`periodEndTs`), or to the last message without one.
 */

export const DEFAULT_POWER_OPTS = Object.freeze({
  cutBelowV: 6,
  minCutMin: 0,
})

/** The only fields the report reads. */
export const POWER_FIELDS = [
  'timestamp',
  'external.powersource.voltage',
  'external.powersource.status',
  'battery.voltage',
  'engine.ignition.status',
  'position.latitude',
  'position.longitude',
].join(',')

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const voltOf = m => num(m['external.powersource.voltage'])
const statusOf = m => (typeof m['external.powersource.status'] === 'boolean' ? m['external.powersource.status'] : null)

function posOf(m) {
  const lat = num(m['position.latitude'])
  const lng = num(m['position.longitude'])
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

/** true = power, false = no power, null = this message does not say. */
export function powerState(m, cutBelowV = DEFAULT_POWER_OPTS.cutBelowV) {
  const v = voltOf(m)
  const s = statusOf(m)
  if (s === false) return false
  if (v !== null) return v >= cutBelowV
  return s
}

/** Whether a message carries any external-power reading (voltage or status). */
export const hasPowerReading = m => voltOf(m) !== null || statusOf(m) !== null

/**
 * One vehicle's power cuts from its messages (ascending by timestamp).
 * @param {object[]} messages
 * @param {object} [opts]  { cutBelowV, periodEndTs }
 * @returns {object[]} cuts: { startTs, endTs, open, beforePeriod, durationSec,
 *          minVoltage, batteryV, ignition, lat, lng }
 */
export function derivePowerCuts(messages, opts = {}) {
  const cutBelowV = num(opts.cutBelowV) ?? DEFAULT_POWER_OPTS.cutBelowV
  const msgs = (messages ?? []).filter(m => num(m.timestamp) !== null)

  const cuts = []
  let state = null      // last known: true power, false no power, null unknown yet
  let cut = null
  let lastPos = null, lastIgn = null, lastBat = null, lastTs = null

  for (const m of msgs) {
    const ts = m.timestamp
    const pos = posOf(m)
    const ign = typeof m['engine.ignition.status'] === 'boolean' ? m['engine.ignition.status'] : null
    const bat = num(m['battery.voltage'])
    const on = powerState(m, cutBelowV)

    if (on === false && !cut) {
      // Values from the message that shows the cut, or the last known before it
      // when this message lacks one; filled from inside the cut further down if
      // neither has one. A `false` status is the tracker's own "power lost"
      // event, so the cut begins right there even on the period's first reading.
      cut = {
        startTs: ts, endTs: null, open: false, beforePeriod: state === null && statusOf(m) !== false, durationSec: 0,
        minVoltage: null, batteryV: bat ?? lastBat, ignition: ign ?? lastIgn,
        lat: (pos ?? lastPos)?.lat ?? null, lng: (pos ?? lastPos)?.lng ?? null,
      }
    }
    if (on === true && cut) {
      cut.endTs = ts
      cut.durationSec = ts - cut.startTs
      cuts.push(cut)
      cut = null
    }
    if (cut) {
      const v = voltOf(m)
      if (v !== null && (cut.minVoltage === null || v < cut.minVoltage)) cut.minVoltage = v
      if (cut.batteryV === null) cut.batteryV = bat
      if (cut.ignition === null) cut.ignition = ign
      if (cut.lat === null && pos) { cut.lat = pos.lat; cut.lng = pos.lng }
    }

    if (on !== null) state = on
    if (pos) lastPos = pos
    if (ign !== null) lastIgn = ign
    if (bat !== null) lastBat = bat
    lastTs = ts
  }

  if (cut) {
    const end = Math.max(cut.startTs, num(opts.periodEndTs) ?? lastTs)
    cut.open = true
    cut.durationSec = end - cut.startTs
    cuts.push(cut)
  }
  return cuts
}

/** Totals over a list of cuts. */
export function sumCuts(cuts) {
  const t = { cuts: cuts.length, offSec: 0, lowestV: null, open: 0 }
  for (const c of cuts) {
    t.offSec += c.durationSec ?? 0
    if (c.minVoltage !== null && (t.lowestV === null || c.minVoltage < t.lowestV)) t.lowestV = c.minVoltage
    if (c.open) t.open += 1
  }
  return t
}

/**
 * Cuts with the short ones optionally taken out; how many were hidden. A cut
 * still open at the end of the period is never hidden — how long it will last
 * is not known yet.
 */
export function visibleCuts(cuts, minCutMin) {
  const minSec = (num(minCutMin) ?? 0) * 60
  if (minSec <= 0) return { cuts, hidden: 0 }
  const kept = cuts.filter(c => c.open || c.durationSec >= minSec)
  return { cuts: kept, hidden: cuts.length - kept.length }
}

/**
 * Every selected vehicle's power cuts, in vehicle-name order.
 *
 * `reports` is false for a tracker that sent messages in the period but no
 * external-power reading at all — it cannot report a cut, so "no cuts" would
 * be a claim the data does not make. `hasData` is false when it sent nothing.
 *
 * @param {Map<number,{messages:object[], truncated:boolean}>} byDevice  fetchFleetMessages' result
 * @param {object[]} vehicles  from useFlespiData (id, name, master)
 * @param {object} [opts]  { cutBelowV, periodEndTs }
 */
export function powerCutsByVehicle(byDevice, vehicles, opts = {}) {
  const nameOf = v => v.master?.plateNo || v.name || String(v.id)
  const out = []
  for (const [deviceId, entry] of byDevice ?? []) {
    const vehicle = vehicles.find(v => v.id === deviceId) ?? { id: deviceId, name: String(deviceId) }
    const messages = entry?.messages ?? []
    out.push({
      deviceId, vehicle, vehicleId: nameOf(vehicle), truncated: !!entry?.truncated,
      hasData: messages.length > 0,
      reports: messages.some(hasPowerReading),
      cuts: derivePowerCuts(messages, opts),
    })
  }
  return out.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId))
}

/** "11.6" — one decimal for the vehicle supply; "—" for no reading. */
export const volts = v => (Number.isFinite(v) ? v.toFixed(1) : '—')
/** "3.87" — the backup battery moves in hundredths. */
export const batteryVolts = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
