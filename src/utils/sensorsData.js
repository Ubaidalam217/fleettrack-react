// Sensors tab data source. Derives Fuel Monitoring and Temperature Monitoring
// from today's cached messages (see usageData.js) plus the vehicle's live
// snapshot for the "current" reading, mirroring how Vehicle Info's Speed
// (live) and Max/Avg Speed Today (cached messages) are split.
//
// Vehicle Sensors (seat belt / door / passenger / immobilizer) always comes
// back null: this fleet's devices (Teltonika, codec 142) expose no field for
// any of the four — only generic unlabeled din/dout digital I/O, and there is
// no per-vehicle config yet saying which physical wire is which sensor. That
// needs an Edit Vehicle wiring step before it can show real values, so the
// section stays hidden rather than guessing.
//
// Current Fuel Level is read as a percentage per the spec's own "10% jump"
// framing — Flespi does not confirm the sensor is calibrated that way.
//
// Placeholder readings are not readings (client, 2026-11-10): a probe slot
// with nothing paired reports 0 °C with 0 % humidity, a CAN bus with no fuel
// data reports 0 litres consumed, and a fuel level that never leaves 0 is no
// sensor at all. See utils/sensorReadings.js.

import { messageTemperature } from './sensorReadings'

const FUEL_LEVEL_FIELD = 'fuel.sensor.value'
const FUEL_CONSUMED_FIELD = 'can.fuel.consumed.high.resolution'
const FUEL_CONSUMED_FALLBACK_FIELD = 'can.fuel.consumed'
const CAN_VOLUME_FIELD = 'can.fuel.volume'

// A same-step jump this large reads as a filling event rather than normal
// consumption drift.
const FILL_JUMP_PCT = 10
// A drop this large while the ignition is off cannot be engine consumption,
// so it reads as a theft/siphon event.
const THEFT_DROP_PCT = 10

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// A cumulative fuel counter of 0 is a CAN bus with no fuel data, not an empty one.
const counter = v => { const n = num(v); return n != null && n > 0 ? n : null }

/**
 * The vehicle's fuel from the fuel pipeline (client, 2026-11-27: SMART5 sends
 * its fuel over CAN, so the percent logic below showed nothing). `info` is
 * GET /api/fuel/series for today: { calibrated, calibration, latest, series,
 * events, summary }. Level in litres from the latest calibrated reading (the
 * raw value with a 'not calibrated' note when there is no table), consumed
 * today from the device's day counter when it has one, else from the series
 * (start + fills - drains - end), and the fills / drains of the Fuel report.
 * Null when the vehicle has no fuel configuration or reading.
 */
export const FRESH_LEVEL_SEC = 30 * 60

function configuredFuel(messages, info, nowSec) {
  if (!info || (!info.calibration && !(info.series?.length) && !info.latest)) return null
  const latest = info.latest ?? null
  const calibrated = !!info.calibration
  const litres = calibrated && latest && latest.litres != null ? latest.litres : null
  const value = litres ?? (latest ? latest.raw : null)
  const fresh = latest?.ts ? nowSec - Math.floor(new Date(latest.ts).getTime() / 1000) <= FRESH_LEVEL_SEC : false
  const fromCounter = counterConsumed(messages)
  const used = info.calibrated && info.summary?.readings >= 2 ? info.summary.used : null
  const events = info.calibrated ? info.events ?? [] : null
  return {
    levelUnit: litres != null ? 'L' : 'raw',
    note: calibrated ? null : 'not calibrated',
    currentLevel: fresh ? value : null,
    lastLevel: !fresh ? value : null,
    lastLevelAt: !fresh && latest?.ts ? Math.floor(new Date(latest.ts).getTime() / 1000) : null,
    consumedToday: fromCounter ?? used,
    fillEvents: events ? events.filter(e => e.kind === 'fill').length : null,
    theftEvents: events ? events.filter(e => e.kind === 'drain').length : null,
  }
}

/** The day's consumption from the device's own counter (last - first), or null. */
function counterConsumed(messages) {
  let first = null
  let last = null
  for (const m of messages) {
    const c = counter(m[FUEL_CONSUMED_FIELD]) ?? counter(m[FUEL_CONSUMED_FALLBACK_FIELD])
    if (c != null) { if (first == null) first = c; last = c }
  }
  return first != null ? last - first : null
}

/**
 * A Flespi vehicle nobody has set a fuel input on, whose tracker reports the
 * CAN fuel volume: show it in litres, read-only (SMART5 shows its 22 L before
 * anyone configures it). Null when the device sends none above 0.
 */
function canVolumeFuel(messages, nowSec) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const v = num(messages[i][CAN_VOLUME_FIELD])
    if (v != null && v > 0) {
      const ts = messages[i].timestamp ?? null
      const fresh = ts != null && nowSec - ts <= FRESH_LEVEL_SEC
      return {
        levelUnit: 'L', note: 'from the vehicle’s CAN, not set up in Fuel',
        currentLevel: fresh ? v : null, lastLevel: fresh ? null : v, lastLevelAt: fresh ? null : ts,
        consumedToday: counterConsumed(messages), fillEvents: null, theftEvents: null,
      }
    }
  }
  return null
}

function computeFuel(messages, liveSnapshot, fuelInfo, nowSec = Math.floor(Date.now() / 1000)) {
  const configured = configuredFuel(messages, fuelInfo, nowSec)
  if (configured) return configured
  const hasPercent = messages.some(m => num(m[FUEL_LEVEL_FIELD]) != null) || num(liveSnapshot?.fuelLevel) != null
  if (!hasPercent) {
    const can = canVolumeFuel(messages, nowSec)
    if (can) return can
  }
  let levels = [] // { level, ignition, ts } per message that reported one, in order
  let consumedFirst = null
  let consumedLast = null

  for (const m of messages) {
    const level = num(m[FUEL_LEVEL_FIELD])
    if (level != null) levels.push({ level, ignition: m['engine.ignition.status'] ?? null, ts: m.timestamp ?? null })

    const consumed = counter(m[FUEL_CONSUMED_FIELD]) ?? counter(m[FUEL_CONSUMED_FALLBACK_FIELD])
    if (consumed != null) {
      if (consumedFirst == null) consumedFirst = consumed
      consumedLast = consumed
    }
  }

  // A level that never leaves 0 all day is no sensor.
  const live = num(liveSnapshot?.fuelLevel)
  if (levels.length && levels.every(l => l.level === 0) && (live == null || live === 0)) levels = []
  const currentLevel = live != null && (live !== 0 || levels.length) ? live : null
  const last = levels.length ? levels[levels.length - 1] : null

  // Nothing at all for this vehicle — section is not configured, hide it.
  if (currentLevel == null && !last && consumedFirst == null) return null

  // Fill/theft need at least two level samples to see a jump between them.
  let fillEvents = null
  let theftEvents = null
  if (levels.length > 1) {
    fillEvents = 0
    theftEvents = 0
    for (let i = 1; i < levels.length; i++) {
      const delta = levels[i].level - levels[i - 1].level
      if (delta >= FILL_JUMP_PCT) fillEvents += 1
      else if (delta <= -THEFT_DROP_PCT && levels[i - 1].ignition === false) theftEvents += 1
    }
  }

  return {
    levelUnit: '%',
    currentLevel,
    // When the live value is not current, the last reading today and its time.
    lastLevel: currentLevel == null && last ? last.level : null,
    lastLevelAt: currentLevel == null && last ? last.ts : null,
    consumedToday: consumedFirst != null && consumedLast != null ? consumedLast - consumedFirst : null,
    fillEvents,
    theftEvents,
  }
}

function computeTemperature(messages, liveSnapshot) {
  const temps = []
  let lastAt = null
  for (const m of messages) {
    const t = messageTemperature(m)
    if (t != null) {
      temps.push(t)
      lastAt = m.timestamp ?? lastAt
    }
  }

  const current = num(liveSnapshot?.temperature)
  // Nothing today: the device's last real reading, however old, still tells something.
  const older = temps.length ? null : num(liveSnapshot?.temperatureLast)
  if (current == null && temps.length === 0 && older == null) return null

  return {
    current,
    // When there is no current reading, the last real one and its time.
    last: current == null ? (temps.length ? temps[temps.length - 1] : older) : null,
    lastAt: current == null ? (temps.length ? lastAt : liveSnapshot?.temperatureLastTs ?? null) : null,
    max: temps.length ? Math.max(...temps) : null,
    avg: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    min: temps.length ? Math.min(...temps) : null,
  }
}

/**
 * @param {object[]} messages     today's messages, sorted ascending (from fetchTodayMessages)
 * @param {object} [liveSnapshot] the vehicle's live object (from useFlespiMQTT) — supplies
 *                                fuelLevel/temperature fresher than the cached messages when available
 * @param {object} [fuelInfo]     today's GET /api/fuel/series of the vehicle (null: none / not loaded)
 */
export function computeSensors(messages, liveSnapshot, fuelInfo = null, nowSec) {
  return {
    fuel: computeFuel(messages || [], liveSnapshot, fuelInfo, nowSec),
    temperature: computeTemperature(messages || [], liveSnapshot),
    sensors: null,
  }
}
