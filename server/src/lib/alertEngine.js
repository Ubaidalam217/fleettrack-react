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
import { haversineMeters } from '../../../src/utils/distance.js'
import { telemetryResponse } from './telemetry.js'

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
})

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
        if (s.over) return none
        s.over = true
        return { state: s, fire: { message: `Over speed: ${Math.round(speed)} km/h (limit ${limit} km/h)`, value: speed } }
      }
      if (speed < limit - SPEED_HYSTERESIS_KMH) s.over = false
      return none
    }

    case 'idle': {
      const minutes = num(Number(p.minutes))
      if (!fresh || minutes === null) return none
      const idling = tel.ignition === true && speed !== null && speed < STILL_KMH
      if (!idling) return { state: {}, fire: null }
      s.since ??= ts
      const idleMin = (now - s.since) / 60
      if (!s.fired && idleMin >= minutes) {
        s.fired = true
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
        return { state: s, fire: { message: `No data from the tracker for ${h ? `${h} h ` : ''}${m} min`, value: Math.round(silentMin) } }
      }
      return { state: s, fire: null }
    }

    case 'temperature': {
      const t = num(tel?.temperature)
      if (!fresh || t === null) return none
      const min = num(alert.minTemp), max = num(alert.maxTemp)
      const out = (min !== null && t < min) || (max !== null && t > max)
      if (out && !s.out) {
        s.out = true
        const why = max !== null && t > max ? `above the maximum ${max} °C` : `below the minimum ${min} °C`
        return { state: s, fire: { message: `Temperature ${t.toFixed(1)} °C, ${why}`, value: t } }
      }
      const back = (min === null || t >= min + 0.5) && (max === null || t <= max - 0.5)
      if (back) s.out = false
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
        if (s.tag) s.tag = null
        return { state: s, fire: null }
      }
      if (s.tag === tag) return none
      s.tag = tag
      return { state: s, fire: { message: `Suspended driver ${driver.name} is driving (iButton ${tag})`, value: null } }
    }

    case 'custom': {
      // The parameter's own timestamp: a value the tracker stopped reporting an
      // hour ago is not evaluated as if it were current.
      const reading = tel?.params?.[p.parameter]
      const pts = num(reading?.ts)
      if (!reading || pts === null || now - pts > FRESH_SEC) return none
      const met = customMatches(reading.value, p.operator, p.value)
      if (!met) {
        if (s.met) s.met = false
        return { state: s, fire: null }
      }
      if (s.met) return none
      s.met = true
      const rule = p.operator === 'true' || p.operator === 'false'
        ? `is ${p.operator}`
        : `${OPERATOR_TEXT[p.operator] ?? p.operator} ${p.value}`
      const value = typeof reading.value === 'number' ? reading.value : null
      return { state: s, fire: { message: `${p.parameter} = ${shownValue(reading.value)} (rule: ${rule})`, value } }
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

async function fetchTelemetry() {
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
      temperature: t['ble.sensor.temperature.1']?.value ?? null,
      ibutton: ibuttonKey(t['ibutton.code']?.value),
      ts: t.timestamp?.value ?? (stamps.length ? Math.max(...stamps) : null),
    })
  }
  return byDevice
}

const vehicleName = v => v.plateNo || v.fleetNo || v.imei

/** One pass over every active rule. Returns the events it created. */
export async function runAlertPass(now = Math.floor(Date.now() / 1000)) {
  const alerts = await prisma.alert.findMany({
    where: { status: 'Active', type: { in: Object.keys(TYPES) } },
    include: { vehicles: { select: { vehicleId: true } } },
  })
  if (!alerts.length) return []

  const bgIds = [...new Set(alerts.map(a => a.bgId))]
  const needsTelemetry = alerts.some(a => a.type !== 'license_expiry')
  const needsFences = alerts.some(a => a.type.startsWith('geofence'))
  const customNames = alerts.filter(a => a.type === 'custom').map(a => paramsOf(a).parameter)

  const [vehicles, drivers, geofences, states, telemetry, deviceByImei, customParams, tagged] = await Promise.all([
    prisma.vehicle.findMany({
      where: { bgId: { in: bgIds } },
      select: { id: true, bgId: true, imei: true, plateNo: true, fleetNo: true, driver: { select: { id: true, name: true } } },
    }),
    alerts.some(a => a.type === 'license_expiry')
      ? prisma.driver.findMany({
        where: { bgId: { in: bgIds }, status: 'Active', OR: DRIVER_EXPIRIES.map(([f]) => ({ [f]: { not: null } })) },
        include: { vehicle: { select: { id: true, plateNo: true, fleetNo: true, imei: true } } },
      })
      : [],
    needsFences ? prisma.geofence.findMany({ where: { bgId: { in: bgIds }, active: true } }) : [],
    prisma.alertState.findMany({ where: { alertId: { in: alerts.map(a => a.id) } } }),
    needsTelemetry ? fetchTelemetry() : new Map(),
    needsTelemetry ? flespi.deviceMap() : new Map(),
    customNames.length ? fetchCustomParams(customNames) : new Map(),
    // Drivers with an iButton tag: the one whose tag is in the reader is the one driving.
    prisma.driver.findMany({ where: { bgId: { in: bgIds }, ibuttonCode: { not: null } }, select: { id: true, name: true, bgId: true, ibuttonCode: true, status: true } }),
  ])
  const byTag = new Map(tagged.map(d => [d.ibuttonCode, d]))

  const stateOf = new Map(states.map(r => [`${r.alertId}|${r.subject}`, r.state]))
  const changed = []
  const events = []

  const record = (alert, subject, prev, result, event) => {
    const last = prev?.lastFiredAt ?? 0
    let next = result.state
    if (result.fire && now - last >= COOLDOWN_SEC) {
      next = { ...next, lastFiredAt: now }
      events.push({ ...event, alertId: alert.id, bgId: alert.bgId, type: alert.type, severity: alert.severity, title: alert.name, message: result.fire.message, value: result.fire.value ?? null, occurredAt: new Date(now * 1000) })
    }
    if (JSON.stringify(next) !== JSON.stringify(prev ?? {})) changed.push({ alertId: alert.id, subject, state: next })
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
      continue
    }

    const listed = new Set(alert.vehicles.map(v => v.vehicleId))
    const targets = vehicles.filter(v => v.bgId === alert.bgId && (alert.allVehicles || listed.has(v.id)))
    const fences = geofences.filter(g => g.bgId === alert.bgId)
    const suspendedByTag = new Map(tagged.filter(d => d.bgId === alert.bgId && d.status === 'Suspended').map(d => [d.ibuttonCode, d]))
    for (const v of targets) {
      const deviceId = deviceByImei.get(digits(v.imei))
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
  return created
}

/** Email each event to its rule's recipients, when the rule asks for email. */
async function emailEvents(events, alerts) {
  const byId = new Map(alerts.map(a => [a.id, a]))
  for (const e of events) {
    const alert = byId.get(e.alertId)
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
    const events = await runAlertPass()
    if (events.length) console.log(`[fleetmax] alerts: ${events.length} raised`)
  } catch (err) {
    console.error(`[fleetmax] alert pass failed: ${err.message}`)
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
