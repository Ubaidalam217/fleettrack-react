/**
 * The alert engine: evaluates every active alert rule on the server and records
 * what fired as AlertEvent rows (plus an email when the rule asks for one).
 *
 * ── Why on the server ───────────────────────────────────────────────────────
 *
 * The Settings > Alerts rules used to be stored and never acted on, and the
 * notifications the app did show were computed in whichever browser happened to
 * be open. Here one pass every ALERT_ENGINE_INTERVAL_MS reads the whole fleet's
 * latest telemetry in a single Flespi request and runs every rule, so an alert
 * is raised at 3 a.m. with nobody signed in, and every user of the BG sees the
 * same history.
 *
 * ── What the trackers can support ───────────────────────────────────────────
 *
 * The ten devices report speed, ignition, position, odometer and (one unit) a
 * BLE temperature probe — no fuel, door, harsh-driving or power fields (see
 * memory notes on the sensor probe). TYPES below is exactly the set those
 * fields can back, plus the driver licence check, which needs no telemetry.
 * Harsh braking and acceleration are read off the speed between messages
 * (src/utils/harshEvents.js), so those two rules also read the messages since
 * the last pass, not only the latest telemetry.
 *
 * ── Edges, not levels ───────────────────────────────────────────────────────
 *
 * A rule fires on the CHANGE (speed crosses the limit, the vehicle enters the
 * fence), never on every pass the condition holds. What the last pass saw lives
 * in AlertState per rule and subject, so a restart or a deploy does not fire
 * everything again; the first observation of a subject only records a baseline.
 */

import env from '../env.js'
import prisma from '../prisma.js'
import * as flespi from './flespi.js'
import { sendAlertEmail } from './mailer.js'
import { pushEvents } from './push.js'
import { haversineMeters } from '../../../src/utils/distance.js'
import { telemetryResponse, isServing, coverageStart, messagesBetween } from './telemetry.js'
import { harshEpisodes, describeHarsh, HARSH_MS2 } from '../../../src/utils/harshEvents.js'
import { runReminderPass } from './reminders.js'
import { liveTemperature } from '../../../src/utils/sensorReadings.js'

const UAE_OFFSET_SEC = 4 * 3600
/** Telemetry older than this is not evaluated for speed / ignition / position rules. */
const FRESH_SEC = 15 * 60
/** The same rule never fires twice for one subject inside this window. */
const COOLDOWN_SEC = 5 * 60
/** Speed must fall this far under the limit before an Over Speed rule re-arms. */
const SPEED_HYSTERESIS_KMH = 5
/** Below this a vehicle counts as standing still. */
const STILL_KMH = 3

const TELEMETRY_FIELDS = [
  'position.latitude', 'position.longitude', 'position.speed',
  'engine.ignition.status', 'ble.sensor.temperature.1', 'timestamp', 'ibutton.code',
  // Probe 1's companions, to tell a no-probe 0 °C from a real one.
  'ble.sensor.humidity.1', 'ble.sensor.battery.voltage.1',
  // The odometer, for distance-based reminders (lib/reminders.js).
  'vehicle.mileage',
  // The iTriangle's tamper, power and panic flags (client, 2026-11-13).
  'device.tamper.status', 'external.powersource.status', 'sos.alarm',
].join(',')

/** An iButton code as stored on a driver: upper-case hex, '' when no tag is in. */
export const ibuttonKey = v => {
  const s = String(v ?? '').replace(/[\s:-]/g, '').toUpperCase()
  return /^0*$/.test(s) ? '' : s
}

/** Every alert type the engine knows, with its default parameters. */
export const TYPES = Object.freeze({
  overspeed:      { label: 'Over Speed',            defaults: { speedKmh: 120 } },
  idle:           { label: 'Idle',                  defaults: { minutes: 15 } },
  // Client, 2026-11-02: one "Geo Zone" type with Enter / Exit / Enter and Exit.
  // The two older single-direction types stay so rules saved under them still
  // run; the form now saves every geofence rule as `geofence`.
  geofence:       { label: 'Geo Zone',              defaults: { geofenceIds: [], direction: 'both' } },
  geofence_enter: { label: 'Geofence Entry',        defaults: { geofenceIds: [] } },
  geofence_exit:  { label: 'Geofence Exit',         defaults: { geofenceIds: [] } },
  // Client, 2026-11-09: each geo zone's own speed limit, with a grace time —
  // over the limit for less than the grace is only recorded, not alerted.
  geofence_speed: { label: 'Geo Zone Speed Violation', defaults: { geofenceIds: [] } },
  ignition_on:    { label: 'Ignition On',           defaults: {} },
  ignition_off:   { label: 'Ignition Off',          defaults: {} },
  offline:        { label: 'Offline',               defaults: { minutes: 60 } },
  temperature:    { label: 'Temperature High/Low',  defaults: {} },
  night_driving:  { label: 'Night Driving',         defaults: { from: '23:00', to: '05:00', minSpeedKmh: 10 } },
  // Client, 2026-11-06: the licence plus the visa, Emirates ID and medical fitness.
  license_expiry: { label: 'Driver Licence & Document Expiry', defaults: { days: 30 } },
  // Client, 2026-11-06: "Other" — any parameter the tracker reports, compared
  // with a value, for alerts the fixed types above do not cover.
  custom:         { label: 'Other (custom parameter)', defaults: { parameter: '', operator: '>', value: '' } },
  // Client, 2026-11-06: a suspended driver must not drive — raised when one's iButton is read.
  suspended_driver: { label: 'Suspended Driver Driving', defaults: {} },
  // Client, 2026-11-10: harsh driving counts as a violation too. Every hard
  // stop or launch is an event of its own (no cooldown), dated when it began.
  harsh_braking:      { label: 'Harsh Braking',      defaults: { thresholdMs2: HARSH_MS2 } },
  harsh_acceleration: { label: 'Harsh Acceleration', defaults: { thresholdMs2: HARSH_MS2 } },
  // Client, 2026-11-13: the iTriangle's own events, each with its start, end
  // and duration. Only a tracker that sends the flag can raise them.
  //   device.tamper.status         true = tampered, false = over
  //   external.powersource.status  false = power cut (battery tamper), true = back
  //   sos.alarm                    true = panic button pressed
  tamper:         { label: 'Tamper',         defaults: {}, severity: 'High' },
  battery_tamper: { label: 'Battery Tamper', defaults: {}, severity: 'Critical' },
  panic:          { label: 'Panic (SOS)',    defaults: {}, severity: 'Critical' },
})

/** The flag each device event reads, and the value that means "it is happening". */
const FLAG_EVENTS = Object.freeze({
  tamper:         { key: 'tamper', field: 'device.tamper.status', active: true,
    start: 'Device tamper detected' },
  battery_tamper: { key: 'power', field: 'external.powersource.status', active: false,
    start: 'Battery tamper: the external power was cut' },
  panic:          { key: 'sos', field: 'sos.alarm', active: true,
    start: 'Panic button (SOS) pressed' },
})

/** The harsh types and which way the speed changes. */
const HARSH_KIND = Object.freeze({ harsh_braking: 'braking', harsh_acceleration: 'acceleration' })
/** How far back a harsh rule reads on its first pass, and at most after a pause. */
const HARSH_FIRST_SEC = 120
const HARSH_MAX_SEC = 15 * 60
/** Read this far before the last pass too, so a stop split across two passes is whole. */
const HARSH_OVERLAP_SEC = 60
/** At most this many harsh events per vehicle and rule in one pass. */
const HARSH_MAX_EVENTS = 20
const HARSH_FIELDS = 'device.id,timestamp,position.speed,position.latitude,position.longitude'

/** Operators an "Other" rule may use. `true` / `false` take no value. */
export const CUSTOM_OPERATORS = ['>', '>=', '<', '<=', '=', '!=', 'true', 'false']
/** A Flespi parameter name: dotted lower-case words, digits and dashes. */
export const PARAMETER_NAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i

const truthy = v => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'
const falsy = v => v === false || v === 0 || v === '0' || String(v).toLowerCase() === 'false'

/** Whether a reported value meets an "Other" rule's condition. */
export function customMatches(actual, operator, expected) {
  if (actual === null || actual === undefined || typeof actual === 'object') return false
  if (operator === 'true') return truthy(actual)
  if (operator === 'false') return falsy(actual)
  const a = Number(actual), e = Number(expected)
  const numeric = typeof actual !== 'boolean' && String(actual).trim() !== '' && String(expected).trim() !== '' && Number.isFinite(a) && Number.isFinite(e)
  if (operator === '=' || operator === '!=') {
    const same = numeric ? a === e
      : typeof actual === 'boolean' ? actual === truthy(expected)
        : String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase()
    return operator === '=' ? same : !same
  }
  if (!numeric) return false
  if (operator === '>') return a > e
  if (operator === '>=') return a >= e
  if (operator === '<') return a < e
  if (operator === '<=') return a <= e
  return false
}

const OPERATOR_TEXT = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '=': '=', '!=': '≠' }
const shownValue = v => (typeof v === 'number' ? String(+v.toFixed(3)) : String(v))

export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical']

// ── episodes ────────────────────────────────────────────────────────────────
//
// A violation that lasts — over speed, idle, a tamper — is one AlertEvent from
// its start to its end (client, 2026-11-13: From, To, Duration, Max Speed).
// The rule's state carries the open episode as `ep`:
//   { at, since, peak }  at    = the pass that raised it (the event's occurredAt)
//                        since = telemetry time it began; peak = worst reading
// When it ends, evaluate() returns `end` and the pass fills endedAt /
// durationSec / peakValue on that event (closeEpisodes below).

function openEpisode(s, now, since, peak = null) {
  s.ep = { at: now, since, peak: num(peak) }
}
function bumpPeak(s, v) {
  if (s.ep && num(v) !== null && (s.ep.peak === null || v > s.ep.peak)) s.ep = { ...s.ep, peak: v }
}
function closeEpisode(s, endTs) {
  const ep = s.ep
  delete s.ep
  return ep ? { at: ep.at, since: ep.since, endTs, peak: ep.peak } : null
}

// ── helpers ─────────────────────────────────────────────────────────────────

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const paramsOf = alert => ({ ...(TYPES[alert.type]?.defaults ?? {}), ...(alert.params ?? {}) })

/** "HH:MM" → minutes after midnight, or null. */
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''))
  if (!m) return null
  const h = Number(m[1]), mm = Number(m[2])
  return h < 24 && mm < 60 ? h * 60 + mm : null
}

/** UAE local minutes after midnight for unix seconds. */
const uaeMinutes = ts => Math.floor(((ts + UAE_OFFSET_SEC) % 86400) / 60)
/** UAE local date "YYYY-MM-DD" for unix seconds. */
const uaeDate = ts => new Date((ts + UAE_OFFSET_SEC) * 1000).toISOString().slice(0, 10)

/**
 * Whether `ts` falls in a daily window, and which night it belongs to — a
 * 23:00-05:00 window started the evening before for the morning half, so both
 * halves of one night share one key and fire once.
 */
export function nightWindow(ts, from, to) {
  const f = minutesOf(from), t = minutesOf(to)
  if (f === null || t === null || f === t) return { inside: false, key: null }
  const m = uaeMinutes(ts)
  const wraps = f > t
  const inside = wraps ? m >= f || m < t : m >= f && m < t
  if (!inside) return { inside: false, key: null }
  const startedYesterday = wraps && m < t
  return { inside: true, key: uaeDate(ts - (startedYesterday ? 86400 : 0)) }
}

function pointInPolygon(lat, lng, points) {
  if (!Array.isArray(points) || points.length < 3) return false
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng, yi = points[i].lat
    const xj = points[j].lng, yj = points[j].lat
    if (((yi > lat) !== (yj > lat)) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function inGeofence(lat, lng, g) {
  if (g.shape === 'CIRCLE') {
    return num(g.centerLat) !== null && g.radius > 0 && haversineMeters(lat, lng, g.centerLat, g.centerLng) <= g.radius
  }
  return pointInPolygon(lat, lng, g.points)
}

// ── evaluation (pure) ───────────────────────────────────────────────────────

/**
 * One rule against one vehicle's latest telemetry.
 *
 * @param {object} alert   the rule: { type, params, minTemp, maxTemp }
 * @param {object} tel     { speed, lat, lng, ignition, temperature, ts }
 * @param {object} state   what the previous pass stored for this rule + vehicle
 * @param {number} now     unix seconds
 * @param {object} ctx     { geofences: [...] } for the geofence types
 * @returns {{ state: object, fire: null | { message: string, value: number|null } }}
 */
export function evaluate(alert, tel, state, now, ctx = {}) {
  const p = paramsOf(alert)
  const s = { ...(state ?? {}) }
  const speed = num(tel?.speed)
  const ts = num(tel?.ts)
  const fresh = ts !== null && now - ts <= FRESH_SEC
  const none = { state: s, fire: null }

  switch (alert.type) {
    case 'overspeed': {
      const limit = num(Number(p.speedKmh))
      if (!fresh || speed === null || limit === null) return none
      if (speed > limit) {
        if (s.over) {
          bumpPeak(s, speed)
          return none
        }
        s.over = true
        openEpisode(s, now, ts, speed)
        return { state: s, fire: { message: `Over speed: ${Math.round(speed)} km/h (limit ${limit} km/h)`, value: speed } }
      }
      if (speed < limit - SPEED_HYSTERESIS_KMH) {
        const end = s.over ? closeEpisode(s, ts) : null
        s.over = false
        return { state: s, fire: null, end }
      }
      bumpPeak(s, speed) // still inside the hysteresis band: the same episode
      return none
    }

    case 'idle': {
      const minutes = num(Number(p.minutes))
      if (!fresh || minutes === null) return none
      const idling = tel.ignition === true && speed !== null && speed < STILL_KMH
      if (!idling) return { state: {}, fire: null, end: s.fired ? closeEpisode(s, ts) : null }
      s.since ??= ts
      const idleMin = (now - s.since) / 60
      if (!s.fired && idleMin >= minutes) {
        s.fired = true
        openEpisode(s, now, s.since) // the idle began at `since`, not when it was noticed
        return { state: s, fire: { message: `Idling with the engine on for ${Math.round(idleMin)} min`, value: Math.round(idleMin) } }
      }
      return none
    }

    case 'geofence':
    case 'geofence_enter':
    case 'geofence_exit': {
      const dir = alert.type === 'geofence_enter' ? 'enter' : alert.type === 'geofence_exit' ? 'exit' : p.direction
      const onEnter = dir === 'enter' || dir === 'both'
      const onExit  = dir === 'exit'  || dir === 'both'
      const lat = num(tel?.lat), lng = num(tel?.lng)
      if (!fresh || lat === null || lng === null) return none
      const wanted = Array.isArray(p.geofenceIds) && p.geofenceIds.length ? new Set(p.geofenceIds) : null
      const fences = (ctx.geofences ?? []).filter(g => !wanted || wanted.has(g.id))
      const prev = s.inside ?? {}
      const next = {}
      let fire = null
      for (const g of fences) {
        const inside = inGeofence(lat, lng, g)
        next[g.id] = inside
        if (!(g.id in prev) || fire) continue // baseline, or one event per pass
        if (onEnter && inside && !prev[g.id]) fire = { message: `Entered ${g.name}`, value: null }
        else if (onExit && !inside && prev[g.id]) fire = { message: `Left ${g.name}`, value: null }
      }
      s.inside = next
      return { state: s, fire }
    }

    case 'geofence_speed': {
      // Per zone: { since, lastTs, peak, fired } while over its limit inside it.
      // The grace is measured between messages — the tracker's reporting
      // interval sets how finely it can be told apart.
      const lat = num(tel?.lat), lng = num(tel?.lng)
      if (!fresh || lat === null || lng === null || speed === null) return none
      const wanted = Array.isArray(p.geofenceIds) && p.geofenceIds.length ? new Set(p.geofenceIds) : null
      const fences = (ctx.geofences ?? []).filter(g => (!wanted || wanted.has(g.id)) && Number(g.speedLimitKmh) > 0)
      const prev = s.zones ?? {}
      const next = {}
      let fire = null
      const ends = []
      for (const g of fences) {
        const limit = Number(g.speedLimitKmh)
        const grace = Math.max(0, Number(g.speedGraceSec) || 0)
        const inside = inGeofence(lat, lng, g)
        const was = prev[g.id]
        if (inside && speed > limit) {
          const z = was ? { ...was, lastTs: ts, peak: Math.max(was.peak, speed) } : { since: ts, lastTs: ts, peak: speed, fired: false }
          if (!z.fired && ts - z.since >= grace && !fire) {
            z.fired = true
            z.at = now // the pass that raised it: the event's occurredAt, for closing it
            const held = ts - z.since
            fire = {
              message: `Geo Zone speed violation in ${g.name}: ${Math.round(z.peak)} km/h (limit ${limit} km/h${held ? `, over for ${held} s` : ''})`,
              value: z.peak,
            }
          }
          next[g.id] = z
        } else if (was) {
          // Still within a few km/h of the limit inside the zone: the same episode.
          if (inside && speed > limit - SPEED_HYSTERESIS_KMH) { next[g.id] = was; continue }
          // Ended before the grace ran out: recorded, not alerted — already whole.
          if (!was.fired && !fire) {
            const held = Math.max(0, was.lastTs - was.since)
            fire = {
              message: `Over the speed limit in ${g.name} ${held ? `for ${held} s` : 'on one reading'}, within the ${grace} s grace: ${Math.round(was.peak)} km/h (limit ${limit} km/h)`,
              value: was.peak,
              recordOnly: true,
              episode: { startTs: was.since, endTs: ts, peak: was.peak },
            }
          }
          // An alerted one ends here.
          if (was.fired && num(was.at) !== null) ends.push({ at: was.at, since: was.since, endTs: ts, peak: was.peak })
        }
      }
      // A zone that dropped out of the rule (or the vehicle left every zone at
      // once) ends its episode too.
      for (const [id, was] of Object.entries(prev)) {
        if (!(id in next) && !fences.some(g => g.id === id) && was.fired && num(was.at) !== null) {
          ends.push({ at: was.at, since: was.since, endTs: ts, peak: was.peak })
        }
      }
      s.zones = next
      return { state: s, fire, end: ends.length ? ends : null }
    }

    case 'ignition_on':
    case 'ignition_off': {
      if (!fresh || typeof tel.ignition !== 'boolean') return none
      const prev = s.ign
      s.ign = tel.ignition
      if (prev === undefined || prev === tel.ignition) return { state: s, fire: null }
      const on = alert.type === 'ignition_on'
      if (tel.ignition !== on) return { state: s, fire: null }
      return { state: s, fire: { message: on ? 'Ignition switched on' : 'Ignition switched off', value: null } }
    }

    case 'offline': {
      const minutes = num(Number(p.minutes))
      if (ts === null || minutes === null) return none
      const silentMin = (now - ts) / 60
      const off = silentMin >= minutes
      const was = s.off
      s.off = off
      if (off && !was) {
        const h = Math.floor(silentMin / 60), m = Math.round(silentMin % 60)
        openEpisode(s, now, ts) // silent since its last message
        return { state: s, fire: { message: `No data from the tracker for ${h ? `${h} h ` : ''}${m} min`, value: Math.round(silentMin) } }
      }
      // Reporting again: the gap ends at the first new message.
      if (!off && was) return { state: s, fire: null, end: closeEpisode(s, ts) }
      return { state: s, fire: null }
    }

    case 'temperature': {
      const t = num(tel?.temperature)
      if (!fresh || t === null) return none
      const min = num(alert.minTemp), max = num(alert.maxTemp)
      const out = (min !== null && t < min) || (max !== null && t > max)
      if (out && !s.out) {
        s.out = true
        openEpisode(s, now, ts, t)
        const why = max !== null && t > max ? `above the maximum ${max} °C` : `below the minimum ${min} °C`
        return { state: s, fire: { message: `Temperature ${t.toFixed(1)} °C, ${why}`, value: t } }
      }
      const back = (min === null || t >= min + 0.5) && (max === null || t <= max - 0.5)
      if (back && s.out) {
        s.out = false
        return { state: s, fire: null, end: closeEpisode(s, ts) }
      }
      // The worst reading: the highest when over the maximum, the lowest when under the minimum.
      if (s.out && s.ep) {
        const worse = max !== null && t > max ? (s.ep.peak === null || t > s.ep.peak) : (s.ep.peak === null || t < s.ep.peak)
        if (worse) s.ep = { ...s.ep, peak: t }
      }
      return { state: s, fire: null }
    }

    case 'night_driving': {
      const minSpeed = num(Number(p.minSpeedKmh)) ?? 10
      if (!fresh || speed === null || speed < minSpeed) return none
      const { inside, key } = nightWindow(now, p.from, p.to)
      if (!inside || s.night === key) return none
      s.night = key
      return { state: s, fire: { message: `Driving at night (${p.from}–${p.to}) at ${Math.round(speed)} km/h`, value: speed } }
    }

    case 'suspended_driver': {
      // ctx.suspendedByTag: this BG's suspended drivers by iButton code.
      const tag = tel?.ibutton || ''
      const driver = tag ? ctx.suspendedByTag?.get(tag) : null
      const active = fresh && !!driver && (tel.ignition === true || (speed ?? 0) > 0)
      if (!active) {
        const end = s.tag ? closeEpisode(s, ts) : null
        if (s.tag) s.tag = null
        return { state: s, fire: null, end }
      }
      if (s.tag === tag) {
        bumpPeak(s, speed)
        return none
      }
      const end = s.tag ? closeEpisode(s, ts) : null // another suspended driver's tag replaced it
      s.tag = tag
      openEpisode(s, now, ts, speed)
      return { state: s, fire: { message: `Suspended driver ${driver.name} is driving (iButton ${tag})`, value: null }, end }
    }

    case 'custom': {
      // The parameter's own timestamp: a value the tracker stopped reporting an
      // hour ago is not evaluated as if it were current.
      const reading = tel?.params?.[p.parameter]
      const pts = num(reading?.ts)
      if (!reading || pts === null || now - pts > FRESH_SEC) return none
      const met = customMatches(reading.value, p.operator, p.value)
      if (!met) {
        if (!s.met) return { state: s, fire: null }
        s.met = false
        return { state: s, fire: null, end: closeEpisode(s, pts) }
      }
      if (s.met) {
        if (typeof reading.value === 'number') bumpPeak(s, reading.value)
        return none
      }
      s.met = true
      openEpisode(s, now, pts, typeof reading.value === 'number' ? reading.value : null)
      const rule = p.operator === 'true' || p.operator === 'false'
        ? `is ${p.operator}`
        : `${OPERATOR_TEXT[p.operator] ?? p.operator} ${p.value}`
      const value = typeof reading.value === 'number' ? reading.value : null
      return { state: s, fire: { message: `${p.parameter} = ${shownValue(reading.value)} (rule: ${rule})`, value } }
    }

    case 'tamper':
    case 'battery_tamper':
    case 'panic': {
      const f = FLAG_EVENTS[alert.type]
      const raw = tel?.[f.key]
      // Only a tracker that sends the flag, and only a current reading.
      if (!fresh || typeof raw !== 'boolean') return none
      const active = raw === f.active
      if (s.on === undefined) {
        // First sight records a baseline, like every edge rule here.
        s.on = active
        return { state: s, fire: null }
      }
      if (active === s.on) return none
      s.on = active
      if (active) {
        openEpisode(s, now, ts)
        return { state: s, fire: { message: f.start, value: null } }
      }
      return { state: s, fire: null, end: closeEpisode(s, ts) }
    }

    default:
      return none
  }
}

/**
 * Driver licence expiry, per driver: fires when the licence enters the warning
 * window and again when it expires — two events in its whole life, not daily.
 */
/** The driver dates the expiry alert watches: field, what to call it, and the state subject suffix. */
export const DRIVER_EXPIRIES = [
  ['licenseExpiry', 'Driving licence', ''],
  ['visaExpiry', 'Visa', ':visa'],
  ['emiratesIdExpiry', 'Emirates ID', ':eid'],
  ['medicalExpiry', 'Medical fitness', ':medical'],
  ['lifeInsuranceExpiry', 'Life insurance', ':insurance'],
  ['mediclaimExpiry', 'Mediclaim', ':mediclaim'],
]

export function evaluateLicence(alert, driver, state, now, field = 'licenseExpiry', label = 'Driving licence') {
  const days = num(Number(paramsOf(alert).days)) ?? 30
  const s = { ...(state ?? {}) }
  if (!driver[field]) return { state: s, fire: null }
  const today = Date.parse(`${uaeDate(now)}T00:00:00Z`)
  const expiry = Date.parse(new Date(driver[field]).toISOString().slice(0, 10) + 'T00:00:00Z')
  const daysLeft = Math.round((expiry - today) / 86400000)
  const stage = daysLeft < 0 ? 'expired' : daysLeft <= days ? 'due' : 'ok'
  const prev = s.stage
  s.stage = stage
  if (stage === prev || stage === 'ok') return { state: s, fire: null }
  const message = stage === 'expired'
    ? `${label} expired ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago`
    : `${label} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
  return { state: s, fire: { message, value: daysLeft } }
}

/**
 * A vehicle document (permit, insurance…) under the same rule, but warned the
 * document's own notify-before days ahead — the number entered with it.
 */
export function evaluateVehicleDocument(doc, state, now) {
  return evaluateLicence({ params: { days: doc.notifyBeforeDays } }, doc, state, now, 'expiryDate', doc.name)
}

// ── the pass ────────────────────────────────────────────────────────────────

const digits = v => String(v ?? '').replace(/\D/g, '')

/**
 * The parameters "Other" rules watch, for the whole fleet in one Flespi read:
 * deviceId → { parameter: { value, ts } }. Our own telemetry copy keeps only the
 * fields the app reads, so these always come from Flespi — one request a pass,
 * naming only the parameters some rule uses.
 */
async function fetchCustomParams(names) {
  const fields = [...new Set(names)].filter(n => PARAMETER_NAME.test(n))
  if (!fields.length) return new Map()
  const res = await flespi.forward(`/gw/devices/all/telemetry/${fields.join(',')}`, { timeoutMs: 20_000 })
  if (res.status !== 200) throw new Error(`Flespi telemetry answered ${res.status}`)
  const out = new Map()
  for (const item of JSON.parse(res.text).result ?? []) out.set(item.id, item.telemetry ?? {})
  return out
}

export async function fetchTelemetry() {
  // Our own copy first (lib/telemetry.js) — no Flespi call while the webhook delivers.
  let payload = telemetryResponse(null)
  if (!payload) {
    const res = await flespi.forward(`/gw/devices/all/telemetry/${TELEMETRY_FIELDS}`, { timeoutMs: 20_000 })
    if (res.status !== 200) throw new Error(`Flespi telemetry answered ${res.status}`)
    payload = JSON.parse(res.text)
  }
  const byDevice = new Map()
  for (const item of payload.result ?? []) {
    const t = item.telemetry ?? {}
    const stamps = Object.values(t).map(v => v?.ts).filter(Boolean)
    byDevice.set(item.id, {
      speed: t['position.speed']?.value ?? null,
      lat: t['position.latitude']?.value ?? null,
      lng: t['position.longitude']?.value ?? null,
      ignition: t['engine.ignition.status']?.value ?? null,
      // Only a real probe reading the device still sends: a field left over
      // from older messages, or a no-probe 0 °C, would raise a false "below
      // the minimum" (src/utils/sensorReadings.js). Judged against the
      // device's own newest message; evaluate() checks that one for age.
      temperature: liveTemperature(t, t.timestamp?.value ?? (stamps.length ? Math.max(...stamps) : undefined)),
      ibutton: ibuttonKey(t['ibutton.code']?.value),
      mileage: t['vehicle.mileage']?.value ?? null,
      // The device events (tamper, battery tamper, panic): booleans, or null
      // from a tracker that does not send them.
      tamper: typeof t['device.tamper.status']?.value === 'boolean' ? t['device.tamper.status'].value : null,
      power: typeof t['external.powersource.status']?.value === 'boolean' ? t['external.powersource.status'].value : null,
      sos: typeof t['sos.alarm']?.value === 'boolean' ? t['sos.alarm'].value : null,
      ts: t.timestamp?.value ?? (stamps.length ? Math.max(...stamps) : null),
    })
  }
  return byDevice
}

const vehicleName = v => v.plateNo || v.fleetNo || v.imei

/**
 * The devices' messages between two times, oldest first: from our own history
 * when it holds that stretch, else one Flespi read for all of them.
 * @returns {Promise<Map<number, object[]>>}
 */
export async function fetchRecent(deviceIds, fromTs, toTs, fields = HARSH_FIELDS) {
  const byDevice = new Map(deviceIds.map(id => [id, []]))
  if (!deviceIds.length) return byDevice
  const start = isServing() ? await coverageStart() : null
  let rows
  if (start !== null && start <= fromTs) {
    rows = await messagesBetween(deviceIds, fromTs, toTs, { limit: 50_000 })
  } else {
    const data = encodeURIComponent(JSON.stringify({ from: fromTs, to: toTs, fields }))
    const res = await flespi.forward(`/gw/devices/${deviceIds.join(',')}/messages?data=${data}`, { timeoutMs: 20_000 })
    if (res.status !== 200) throw new Error(`Flespi messages answered ${res.status}`)
    rows = JSON.parse(res.text).result ?? []
  }
  for (const m of rows) byDevice.get(m['device.id'])?.push(m)
  for (const list of byDevice.values()) list.sort((a, b) => a.timestamp - b.timestamp)
  return byDevice
}

// ── closing episodes ────────────────────────────────────────────────────────

/** Fields the exact start / end of an episode is read from. */
const EPISODE_FIELDS = 'device.id,timestamp,position.speed,engine.ignition.status,device.tamper.status,external.powersource.status,sos.alarm'
/** An episode longer than this is closed from the passes alone, not re-read. */
const REFINE_MAX_SEC = 24 * 3600
/** How far before the pass that noticed it an episode may really have begun. */
const REFINE_LOOKBACK_SEC = 10 * 60

/**
 * What decides, per type, that a message belongs to the episode: `has` — the
 * message carries the reading at all (status packets without speed are
 * skipped); `on` — it starts / is the episode; `stays` — it keeps it going
 * (over speed holds inside the 5 km/h hysteresis band); `peak` — the reading
 * the worst value is taken from.
 */
export function episodeRule(alert) {
  const p = paramsOf(alert)
  const speedOf = m => num(m['position.speed'])
  switch (alert.type) {
    case 'overspeed': {
      const limit = num(Number(p.speedKmh))
      if (limit === null) return null
      return {
        has: m => speedOf(m) !== null,
        on: m => speedOf(m) > limit,
        stays: m => speedOf(m) >= limit - SPEED_HYSTERESIS_KMH,
        peak: speedOf,
      }
    }
    case 'idle': {
      const idle = m => m['engine.ignition.status'] === true && speedOf(m) !== null && speedOf(m) < STILL_KMH
      return { has: m => typeof m['engine.ignition.status'] === 'boolean' && speedOf(m) !== null, on: idle, stays: idle, peak: null }
    }
    case 'tamper':
    case 'battery_tamper':
    case 'panic': {
      const f = FLAG_EVENTS[alert.type]
      const on = m => m[f.field] === f.active
      return { has: m => typeof m[f.field] === 'boolean', on, stays: on, peak: null }
    }
    default:
      return null
  }
}

/**
 * The exact run of an episode in a device's messages (ascending): from the
 * first message of the unbroken stretch that holds `since`, to the first
 * message after it that no longer does. Null when the messages do not show it.
 *
 * @returns {{ startTs: number, endTs: number, peak: number|null } | null}
 */
export function refineEpisode(msgs, rule, { since, endTs }) {
  if (!rule) return null
  const list = (msgs ?? []).filter(m => num(m.timestamp) !== null && rule.has(m))
  const i = list.findIndex(m => m.timestamp >= since && rule.on(m))
  if (i < 0) return null
  // A message just before `since` may already belong to it.
  let s = i
  while (s > 0 && rule.on(list[s - 1])) s--
  let e = i
  while (e + 1 < list.length && rule.stays(list[e + 1])) e++
  const after = list[e + 1]
  const stop = after ? after.timestamp : Math.max(endTs, list[e].timestamp)
  let peak = null
  if (rule.peak) {
    for (let k = s; k <= e; k++) {
      const v = rule.peak(list[k])
      if (v !== null && (peak === null || v > peak)) peak = v
    }
  }
  return { startTs: list[s].timestamp, endTs: stop, peak }
}

/**
 * Fill each ended episode's event: where it began (occurredAt), where it ended,
 * how long it lasted and its worst reading. The start and end are read off the
 * device's messages when they are at hand, else taken from the passes.
 * Matched by rule, device and the pass that raised it, so an episode whose
 * event the cooldown suppressed updates nothing.
 */
export async function closeEpisodes(closes, now) {
  if (!closes.length) return
  const refinable = closes.filter(c => c.deviceId != null && episodeRule(c.alert) && c.endTs - c.since <= REFINE_MAX_SEC)
  let msgs = new Map()
  if (refinable.length) {
    const from = Math.min(...refinable.map(c => c.since)) - REFINE_LOOKBACK_SEC
    try {
      msgs = await fetchRecent([...new Set(refinable.map(c => c.deviceId))], from, now, EPISODE_FIELDS)
    } catch (err) {
      console.error(`[fleetmax] episode messages read failed: ${err.message}`)
    }
  }
  for (const c of closes) {
    const exact = refinable.includes(c) ? refineEpisode(msgs.get(c.deviceId), episodeRule(c.alert), c) : null
    const startTs = exact?.startTs ?? c.since
    const endTs = Math.max(startTs, exact?.endTs ?? c.endTs)
    const peak = exact?.peak ?? num(c.peak)
    await prisma.alertEvent.updateMany({
      where: { alertId: c.alert.id, deviceId: c.deviceId, occurredAt: new Date(c.at * 1000), endedAt: null },
      data: {
        occurredAt: new Date(startTs * 1000),
        endedAt: new Date(endTs * 1000),
        durationSec: Math.round(endTs - startTs),
        peakValue: peak === null ? null : Math.round(peak * 10) / 10,
      },
    })
  }
}

/**
 * One pass over every active rule. Returns the events it created. `pre` may
 * carry telemetry and the IMEI map already fetched this tick (the reminder
 * pass shares them), so the fleet is read once.
 */
export async function runAlertPass(now = Math.floor(Date.now() / 1000), pre = {}) {
  const alerts = await prisma.alert.findMany({
    where: { status: 'Active', type: { in: Object.keys(TYPES) } },
    include: { vehicles: { select: { vehicleId: true } } },
  })
  if (!alerts.length) return []

  const bgIds = [...new Set(alerts.map(a => a.bgId))]
  const needsTelemetry = alerts.some(a => a.type !== 'license_expiry')
  const needsFences = alerts.some(a => a.type.startsWith('geofence'))
  const customNames = alerts.filter(a => a.type === 'custom').map(a => paramsOf(a).parameter)

  const [vehicles, drivers, vehicleDocs, geofences, states, telemetry, deviceByImei, customParams, tagged] = await Promise.all([
    prisma.vehicle.findMany({
      where: { bgId: { in: bgIds } },
      select: { id: true, bgId: true, imei: true, plateNo: true, fleetNo: true, driver: { select: { id: true, name: true } } },
    }),
    alerts.some(a => a.type === 'license_expiry')
      ? prisma.driver.findMany({
        // A removed driver (kept for history only) has no papers to watch.
        where: { bgId: { in: bgIds }, status: 'Active', deletedAt: null, OR: DRIVER_EXPIRIES.map(([f]) => ({ [f]: { not: null } })) },
        include: { vehicle: { select: { id: true, plateNo: true, fleetNo: true, imei: true } } },
      })
      : [],
    alerts.some(a => a.type === 'license_expiry')
      ? prisma.vehicleDocument.findMany({
        where: { expiryDate: { not: null }, vehicle: { bgId: { in: bgIds } } },
        select: { id: true, name: true, expiryDate: true, notifyBeforeDays: true, vehicle: { select: { id: true, bgId: true, plateNo: true, fleetNo: true, imei: true } } },
      })
      : [],
    needsFences ? prisma.geofence.findMany({ where: { bgId: { in: bgIds }, active: true } }) : [],
    prisma.alertState.findMany({ where: { alertId: { in: alerts.map(a => a.id) } } }),
    needsTelemetry ? (pre.telemetry ?? fetchTelemetry()) : new Map(),
    needsTelemetry ? (pre.deviceByImei ?? flespi.deviceMap()) : new Map(),
    customNames.length ? fetchCustomParams(customNames) : new Map(),
    // Drivers with an iButton tag: the one whose tag is in the reader is the one driving.
    prisma.driver.findMany({ where: { bgId: { in: bgIds }, ibuttonCode: { not: null }, deletedAt: null }, select: { id: true, name: true, bgId: true, ibuttonCode: true, status: true } }),
  ])
  const byTag = new Map(tagged.map(d => [d.ibuttonCode, d]))

  const stateOf = new Map(states.map(r => [`${r.alertId}|${r.subject}`, r.state]))
  const changed = []
  const events = []
  const closes = []

  // Harsh rules read the messages since their last pass: one read for every
  // device they cover, from the oldest place any of them stopped.
  let recent = new Map()
  const harshRules = alerts.filter(a => HARSH_KIND[a.type])
  if (harshRules.length) {
    const ids = new Set()
    let from = now
    for (const alert of harshRules) {
      const listed = new Set(alert.vehicles.map(v => v.vehicleId))
      for (const v of vehicles) {
        if (v.bgId !== alert.bgId || !(alert.allVehicles || listed.has(v.id))) continue
        const deviceId = deviceByImei.get(digits(v.imei))
        if (deviceId === undefined) continue
        ids.add(deviceId)
        const last = stateOf.get(`${alert.id}|d:${deviceId}`)?.lastTs ?? now - HARSH_FIRST_SEC
        from = Math.min(from, last - HARSH_OVERLAP_SEC)
      }
    }
    from = Math.max(from, now - HARSH_MAX_SEC)
    try {
      recent = pre.recent ?? await fetchRecent([...ids], from, now)
    } catch (err) {
      console.error(`[fleetmax] harsh messages read failed: ${err.message}`)
    }
  }

  const record = (alert, subject, prev, result, event) => {
    const last = prev?.lastFiredAt ?? 0
    let next = result.state
    // A within-grace excursion is a record, not an alert: it is stored already
    // read (no bell), never emailed, and does not start the cooldown.
    if (result.fire?.recordOnly) {
      const ep = result.fire.episode
      events.push({
        ...event, alertId: alert.id, bgId: alert.bgId, type: alert.type, severity: 'Low', title: `${alert.name} · recorded`, message: result.fire.message, value: result.fire.value ?? null,
        occurredAt: new Date((ep?.startTs ?? now) * 1000), readAt: new Date(now * 1000),
        ...(ep ? { endedAt: new Date(ep.endTs * 1000), durationSec: Math.round(ep.endTs - ep.startTs), peakValue: num(ep.peak) } : {}),
      })
    } else if (result.fire && now - last >= COOLDOWN_SEC) {
      next = { ...next, lastFiredAt: now }
      events.push({ ...event, alertId: alert.id, bgId: alert.bgId, type: alert.type, severity: alert.severity, title: alert.name, message: result.fire.message, value: result.fire.value ?? null, occurredAt: new Date(now * 1000) })
    }
    if (JSON.stringify(next) !== JSON.stringify(prev ?? {})) changed.push({ alertId: alert.id, subject, state: next })
    // Episodes that ended this pass (an over speed back under the limit…).
    for (const end of [].concat(result.end ?? [])) {
      if (end && num(end.at) !== null && event.deviceId != null) closes.push({ alert, deviceId: event.deviceId, ...end })
    }
  }

  // Each hard stop or launch since the last pass is its own event, dated when it began.
  function harshPass(alert, v, deviceId) {
    const subject = `d:${deviceId}`
    const prev = stateOf.get(`${alert.id}|${subject}`)
    const since = prev?.lastTs ?? now - HARSH_FIRST_SEC
    const msgs = recent.get(deviceId) ?? []
    if (!msgs.length) return
    const kind = HARSH_KIND[alert.type]
    const threshold = num(Number(paramsOf(alert).thresholdMs2)) ?? HARSH_MS2
    const found = harshEpisodes(msgs, { kind, thresholdMs2: threshold }).filter(e => e.startTs > since)
    const tagDriver = telemetry.get(deviceId)?.ibutton ? byTag.get(telemetry.get(deviceId).ibutton) : undefined
    const who = tagDriver && tagDriver.bgId === v.bgId ? tagDriver : v.driver
    for (const e of found.slice(0, HARSH_MAX_EVENTS)) {
      events.push({
        alertId: alert.id, bgId: alert.bgId, type: alert.type, severity: alert.severity, title: alert.name,
        message: `${vehicleName(v)}: ${describeHarsh(kind, e)}${who ? ` · Driver: ${who.name}` : ''}`,
        value: Math.round(e.peakMs2 * 10) / 10,
        occurredAt: new Date(e.startTs * 1000),
        vehicleId: v.id, deviceId, driverId: who?.id ?? null, lat: e.lat, lng: e.lng,
      })
    }
    // Up to the last stop found, or the newest message less the overlap, so a
    // stop still going on at the end of this read is caught whole next time.
    const lastTs = Math.max(since, ...found.map(e => e.startTs), msgs[msgs.length - 1].timestamp - HARSH_OVERLAP_SEC)
    if (lastTs !== prev?.lastTs) changed.push({ alertId: alert.id, subject, state: { lastTs } })
  }

  for (const alert of alerts) {
    if (alert.type === 'license_expiry') {
      for (const d of drivers.filter(x => x.bgId === alert.bgId)) {
        for (const [field, label, suffix] of DRIVER_EXPIRIES) {
          if (!d[field]) continue
          const subject = `drv:${d.id}${suffix}`
          const prev = stateOf.get(`${alert.id}|${subject}`)
          const result = evaluateLicence(alert, d, prev, now, field, label)
          const who = d.vehicle ? `${d.name} (${vehicleName(d.vehicle)})` : d.name
          if (result.fire) result.fire.message = `${who}: ${result.fire.message}`
          record(alert, subject, prev, result, { driverId: d.id, vehicleId: d.vehicle?.id ?? null })
        }
      }
      // The vehicles' own documents (Documents tab), for the vehicles the rule covers.
      const listed = new Set(alert.vehicles.map(v => v.vehicleId))
      for (const doc of vehicleDocs) {
        const v = doc.vehicle
        if (v.bgId !== alert.bgId || !(alert.allVehicles || listed.has(v.id))) continue
        const subject = `vdoc:${doc.id}`
        const prev = stateOf.get(`${alert.id}|${subject}`)
        const result = evaluateVehicleDocument(doc, prev, now)
        if (result.fire) result.fire.message = `${vehicleName(v)}: ${result.fire.message}`
        record(alert, subject, prev, result, { vehicleId: v.id })
      }
      continue
    }

    const listed = new Set(alert.vehicles.map(v => v.vehicleId))
    const targets = vehicles.filter(v => v.bgId === alert.bgId && (alert.allVehicles || listed.has(v.id)))
    const fences = geofences.filter(g => g.bgId === alert.bgId)
    const suspendedByTag = new Map(tagged.filter(d => d.bgId === alert.bgId && d.status === 'Suspended').map(d => [d.ibuttonCode, d]))
    for (const v of targets) {
      const deviceId = deviceByImei.get(digits(v.imei))
      if (HARSH_KIND[alert.type]) {
        if (deviceId !== undefined) harshPass(alert, v, deviceId)
        continue
      }
      const base = deviceId !== undefined ? telemetry.get(deviceId) : undefined
      if (!base) continue
      const tel = alert.type === 'custom' ? { ...base, params: customParams.get(deviceId) ?? {} } : base
      const subject = `d:${deviceId}`
      const prev = stateOf.get(`${alert.id}|${subject}`)
      const result = evaluate(alert, tel, prev, now, { geofences: fences, suspendedByTag })
      // The tag in the reader names the driver; the vehicle's assigned driver otherwise.
      const tagDriver = tel.ibutton ? byTag.get(tel.ibutton) : undefined
      const who = tagDriver && tagDriver.bgId === v.bgId ? tagDriver : v.driver
      if (result.fire) {
        const driver = who ? ` · Driver: ${who.name}` : ''
        result.fire.message = `${vehicleName(v)}: ${result.fire.message}${driver}`
      }
      record(alert, subject, prev, result, {
        vehicleId: v.id, deviceId, driverId: who?.id ?? null,
        lat: num(tel.lat), lng: num(tel.lng),
      })
    }
  }

  if (changed.length) {
    await prisma.$transaction(changed.map(c => prisma.alertState.upsert({
      where: { alertId_subject: { alertId: c.alertId, subject: c.subject } },
      create: c,
      update: { state: c.state },
    })))
  }

  const created = []
  for (const e of events) created.push(await prisma.alertEvent.create({ data: e }))
  if (created.length) emailEvents(created, alerts).catch(err => console.error(`[fleetmax] alert email failed: ${err.message}`))
  // The mobile app's notifications (lib/push.js); never throws.
  if (created.length) pushEvents(created)
  try {
    await closeEpisodes(closes, now)
  } catch (err) {
    console.error(`[fleetmax] closing alert episodes failed: ${err.message}`)
  }
  return created
}

/** Email each event to its rule's recipients, when the rule asks for email. */
async function emailEvents(events, alerts) {
  const byId = new Map(alerts.map(a => [a.id, a]))
  for (const e of events) {
    const alert = byId.get(e.alertId)
    if (e.readAt) continue // a within-grace record, not an alert
    if (!alert?.notify?.email || !alert.emails?.length) continue
    const sent = await sendAlertEmail(alert.emails, e)
    if (sent) await prisma.alertEvent.update({ where: { id: e.id }, data: { emailedAt: new Date() } })
  }
}

// ── the job ─────────────────────────────────────────────────────────────────

let running = false

async function tick() {
  if (running) return
  running = true
  try {
    // Read the fleet once for both passes.
    const pre = { telemetry: await fetchTelemetry(), deviceByImei: await flespi.deviceMap() }
    try {
      const events = await runAlertPass(undefined, pre)
      if (events.length) console.log(`[fleetmax] alerts: ${events.length} raised`)
    } catch (err) {
      console.error(`[fleetmax] alert pass failed: ${err.message}`)
    }
    try {
      const reminders = await runReminderPass(pre.telemetry, pre.deviceByImei)
      if (reminders.length) console.log(`[fleetmax] reminders: ${reminders.length} raised`)
    } catch (err) {
      console.error(`[fleetmax] reminder pass failed: ${err.message}`)
    }
  } catch (err) {
    console.error(`[fleetmax] telemetry read failed: ${err.message}`)
  } finally {
    running = false
  }
}

/** Start the background engine. Returns a stop function. No-op under test or when off. */
export function startAlertEngine() {
  if (env.isTest || !env.ALERT_ENGINE_ENABLED || !flespi.isConfigured()) return () => {}
  const first = setTimeout(tick, 10_000)
  const timer = setInterval(tick, env.ALERT_ENGINE_INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
