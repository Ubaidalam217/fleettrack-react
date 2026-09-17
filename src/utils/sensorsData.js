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

const FUEL_LEVEL_FIELD = 'fuel.sensor.value'
const FUEL_CONSUMED_FIELD = 'can.fuel.consumed.high.resolution'
const FUEL_CONSUMED_FALLBACK_FIELD = 'can.fuel.consumed'
const TEMPERATURE_FIELDS = [
  'ble.sensor.temperature.1',
  'ble.sensor.temperature.2',
  'ble.sensor.temperature.3',
  'ble.sensor.temperature.4',
]

// A same-step jump this large reads as a filling event rather than normal
// consumption drift.
const FILL_JUMP_PCT = 10
// A drop this large while the ignition is off cannot be engine consumption,
// so it reads as a theft/siphon event.
const THEFT_DROP_PCT = 10

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Average of whichever BLE probes this message actually reports — devices
// with one probe wired report only .1, so this degrades to that single value.
function avgTemperature(m) {
  const vals = TEMPERATURE_FIELDS.map(f => num(m[f])).filter(v => v != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function computeFuel(messages, liveSnapshot) {
  const levels = [] // { level, ignition } per message that reported one, in order
  let consumedFirst = null
  let consumedLast = null

  for (const m of messages) {
    const level = num(m[FUEL_LEVEL_FIELD])
    if (level != null) levels.push({ level, ignition: m['engine.ignition.status'] ?? null })

    const consumed = num(m[FUEL_CONSUMED_FIELD]) ?? num(m[FUEL_CONSUMED_FALLBACK_FIELD])
    if (consumed != null) {
      if (consumedFirst == null) consumedFirst = consumed
      consumedLast = consumed
    }
  }

  const currentLevel = num(liveSnapshot?.fuelLevel) ?? (levels.length ? levels[levels.length - 1].level : null)

  // Nothing at all for this vehicle — section is not configured, hide it.
  if (currentLevel == null && consumedFirst == null) return null

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
    currentLevel,
    consumedToday: consumedFirst != null && consumedLast != null ? consumedLast - consumedFirst : null,
    fillEvents,
    theftEvents,
  }
}

function computeTemperature(messages, liveSnapshot) {
  const temps = []
  for (const m of messages) {
    const t = avgTemperature(m)
    if (t != null) temps.push(t)
  }

  const current = num(liveSnapshot?.temperature) ?? (temps.length ? temps[temps.length - 1] : null)
  if (current == null && temps.length === 0) return null

  return {
    current,
    max: temps.length ? Math.max(...temps) : null,
    avg: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    min: temps.length ? Math.min(...temps) : null,
  }
}

/**
 * @param {object[]} messages     today's messages, sorted ascending (from fetchTodayMessages)
 * @param {object} [liveSnapshot] the vehicle's live object (from useFlespiMQTT) — supplies
 *                                fuelLevel/temperature fresher than the cached messages when available
 */
export function computeSensors(messages, liveSnapshot) {
  return {
    fuel: computeFuel(messages || [], liveSnapshot),
    temperature: computeTemperature(messages || [], liveSnapshot),
    sensors: null,
  }
}
