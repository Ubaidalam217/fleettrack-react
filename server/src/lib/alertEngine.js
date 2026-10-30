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
  'engine.ignition.status', 'ble.sensor.temperature.1', 'timestamp',
].join(',')

/** Every alert type the engine knows, with its default parameters. */
export const TYPES = Object.freeze({
  overspeed:      { label: 'Over Speed',            defaults: { speedKmh: 120 } },
  idle:           { label: 'Idle',                  defaults: { minutes: 15 } },
  geofence_enter: { label: 'Geofence Entry',        defaults: { geofenceIds: [] } },
  geofence_exit:  { label: 'Geofence Exit',         defaults: { geofenceIds: [] } },
  ignition_on:    { label: 'Ignition On',           defaults: {} },
  ignition_off:   { label: 'Ignition Off',          defaults: {} },
  offline:        { label: 'Offline',               defaults: { minutes: 60 } },
  temperature:    { label: 'Temperature High/Low',  defaults: {} },
  night_driving:  { label: 'Night Driving',         defaults: { from: '23:00', to: '05:00', minSpeedKmh: 10 } },
  license_expiry: { label: 'Driver Licence Expiry', defaults: { days: 30 } },
})

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

    case 'geofence_enter':
    case 'geofence_exit': {
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
        if (alert.type === 'geofence_enter' && inside && !prev[g.id]) fire = { message: `Entered ${g.name}`, value: null }
        if (alert.type === 'geofence_exit' && !inside && prev[g.id]) fire = { message: `Left ${g.name}`, value: null }
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

    default:
      return none
  }
}

/**
 * Driver licence expiry, per driver: fires when the licence enters the warning
 * window and again when it expires — two events in its whole life, not daily.
 */
export function evaluateLicence(alert, driver, state, now) {
  const days = num(Number(paramsOf(alert).days)) ?? 30
  const s = { ...(state ?? {}) }
  if (!driver.licenseExpiry) return { state: s, fire: null }
  const today = Date.parse(`${uaeDate(now)}T00:00:00Z`)
  const expiry = Date.parse(new Date(driver.licenseExpiry).toISOString().slice(0, 10) + 'T00:00:00Z')
  const daysLeft = Math.round((expiry - today) / 86400000)
  const stage = daysLeft < 0 ? 'expired' : daysLeft <= days ? 'due' : 'ok'
  const prev = s.stage
  s.stage = stage
  if (stage === prev || stage === 'ok') return { state: s, fire: null }
  const message = stage === 'expired'
    ? `Driving licence expired ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago`
    : `Driving licence expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
  return { state: s, fire: { message, value: daysLeft } }
}

// ── the pass ────────────────────────────────────────────────────────────────

const digits = v => String(v ?? '').replace(/\D/g, '')

async function fetchTelemetry() {
  const res = await flespi.forward(`/gw/devices/all/telemetry/${TELEMETRY_FIELDS}`, { timeoutMs: 20_000 })
  if (res.status !== 200) throw new Error(`Flespi telemetry answered ${res.status}`)
  const byDevice = new Map()
  for (const item of JSON.parse(res.text).result ?? []) {
    const t = item.telemetry ?? {}
    const stamps = Object.values(t).map(v => v?.ts).filter(Boolean)
    byDevice.set(item.id, {
      speed: t['position.speed']?.value ?? null,
      lat: t['position.latitude']?.value ?? null,
      lng: t['position.longitude']?.value ?? null,
      ignition: t['engine.ignition.status']?.value ?? null,
      temperature: t['ble.sensor.temperature.1']?.value ?? null,
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
  const needsFences = alerts.some(a => a.type.startsWith('geofence_'))

  const [vehicles, drivers, geofences, states, telemetry, deviceByImei] = await Promise.all([
    prisma.vehicle.findMany({
      where: { bgId: { in: bgIds } },
      select: { id: true, bgId: true, imei: true, plateNo: true, fleetNo: true, driver: { select: { id: true, name: true } } },
    }),
    alerts.some(a => a.type === 'license_expiry')
      ? prisma.driver.findMany({
        where: { bgId: { in: bgIds }, status: 'Active', licenseExpiry: { not: null } },
        include: { vehicle: { select: { id: true, plateNo: true, fleetNo: true, imei: true } } },
      })
      : [],
    needsFences ? prisma.geofence.findMany({ where: { bgId: { in: bgIds }, active: true } }) : [],
    prisma.alertState.findMany({ where: { alertId: { in: alerts.map(a => a.id) } } }),
    needsTelemetry ? fetchTelemetry() : new Map(),
    needsTelemetry ? flespi.deviceMap() : new Map(),
  ])

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
        const subject = `drv:${d.id}`
        const prev = stateOf.get(`${alert.id}|${subject}`)
        const result = evaluateLicence(alert, d, prev, now)
        const who = d.vehicle ? `${d.name} (${vehicleName(d.vehicle)})` : d.name
        if (result.fire) result.fire.message = `${who}: ${result.fire.message}`
        record(alert, subject, prev, result, { driverId: d.id, vehicleId: d.vehicle?.id ?? null })
      }
      continue
    }

    const listed = new Set(alert.vehicles.map(v => v.vehicleId))
    const targets = vehicles.filter(v => v.bgId === alert.bgId && (alert.allVehicles || listed.has(v.id)))
    const fences = geofences.filter(g => g.bgId === alert.bgId)
    for (const v of targets) {
      const deviceId = deviceByImei.get(digits(v.imei))
      const tel = deviceId !== undefined ? telemetry.get(deviceId) : undefined
      if (!tel) continue
      const subject = `d:${deviceId}`
      const prev = stateOf.get(`${alert.id}|${subject}`)
      const result = evaluate(alert, tel, prev, now, { geofences: fences })
      if (result.fire) {
        const driver = v.driver ? ` · Driver: ${v.driver.name}` : ''
        result.fire.message = `${vehicleName(v)}: ${result.fire.message}${driver}`
      }
      record(alert, subject, prev, result, {
        vehicleId: v.id, deviceId, driverId: v.driver?.id ?? null,
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
