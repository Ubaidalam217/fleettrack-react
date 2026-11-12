/**
 * The trip-based reports: Full Usage, Trip, Summary Usage, Time Sheet, Private
 * Usage and GYR (client list, 2026-11-06). All six are views of one thing —
 * each vehicle's trips — so one pass derives the trips and every report is a
 * grouping of them. Pure: no React, no network, no Date.now().
 *
 * Columns follow the Ctrack MaXx manual (Ctrack-Reports-Catalog.md, §3.3/3.4),
 * minus what these trackers cannot back: no RPM / green band (no CAN), no
 * driver tag (the Driver column is the vehicle's driver now, as on Movement).
 *
 * ── A trip ───────────────────────────────────────────────────────────────
 * One ignition-on run: it starts on the first message with the ignition on and
 * ends on the first with it off. A gap in the data longer than maxGapSec also
 * ends it (the tracker was off or out of coverage; the time is not invented).
 * A device that never reports ignition falls back to movement (speed > 0).
 * Inside a trip each interval is classified the way computeUsage() and the
 * Daywise reports do: speed > 0 is driving, speed 0 is idling — so the numbers
 * here agree with those reports.
 *
 * Exceptions, per trip:
 *   - Over Speed: an episode each time the speed rises above the limit, ending
 *     only once it falls 5 km/h under it (hovering at the limit is one
 *     episode, not dozens); its duration is the time spent above the limit.
 *   - Excess Idle (XI): an idle run of at least xiMinutes.
 *   - Harsh Brake / Harsh Acceleration: the speed derivative between samples
 *     1-10 s apart beyond ±harshMs2, discarding physically impossible values
 *     (the same guards as utils/alertsData.js).
 */

import { createDistanceStepper } from './distance.js'

export const DEFAULT_USAGE_OPTS = Object.freeze({
  maxGapSec: 30 * 60,
  overSpeedKmh: 80,
  xiMinutes: 10,
  harshMs2: 3.5,
  // Harsh cornering: lateral acceleration (speed × turn rate) between samples
  // 1-10 s apart, at or above the speed. A normal 90° junction turn at 25 km/h
  // is about 1.4 m/s²; 3 m/s² is a hard swerve.
  corneringMs2: 3,
  corneringMinKmh: 20,
  // Night driving window, local time, and the zone it is read in (seconds
  // east of UTC). The server passes UAE (+4 h); the browser its own offset.
  nightFrom: '22:00',
  nightTo: '05:00',
  tzOffsetSec: 4 * 3600,
})

const hhmmMin = v => { const [h, m] = String(v).split(':').map(Number); return h * 60 + m }
/** Whether unix seconds fall inside a daily local window that may wrap midnight. */
export function inWindow(ts, from, to, tzOffsetSec) {
  const min = Math.floor((((ts + tzOffsetSec) % 86400) + 86400) % 86400 / 60)
  const f = hhmmMin(from), t = hhmmMin(to)
  return f <= t ? min >= f && min < t : min >= f || min < t
}

const NOISE_CEILING_MS2 = 10
/** An over-speed episode ends only once the speed is this far under the limit (as the server's alert). */
export const SPEED_HYSTERESIS_KMH = 5
/** A trip shorter than this distance counts as "0 km" for the hide-zero option. */
export const ZERO_KM = 0.05

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const speedOf = m => num(m['position.speed']) ?? 0

/** The iButton tag in a message, upper-case; null for none or the all-zero "no tag" code. */
function tagOf(m) {
  const v = m['ibutton.code']
  if (typeof v !== 'string') return null
  const s = v.replace(/[\s:-]/g, '').toUpperCase()
  return s && !/^0+$/.test(s) ? s : null
}

function posOf(m) {
  const lat = num(m['position.latitude'])
  const lng = num(m['position.longitude'])
  if (lat === null || lng === null || (lat === 0 && lng === 0) || m['position.valid'] === false) return null
  return { lat, lng }
}

// ── tracker glitches (supply voltage) ───────────────────────────────────

/*
 * A running engine charges: the supply reads ~13.8-14.4 V (12 V vehicles) or
 * ~27-28 V (24 V) while driving. An engine off behind an "ignition on" (the
 * iTriangle's wiring) is NOT corrected here: the client will have the device
 * fixed rather than manage it in software (2026-11-12), so a trip stays
 * ignition on to ignition off.
 */
const VOLT = 'external.powersource.voltage'

/** Median supply voltage while driving; null with fewer than 20 readings. */
function drivingVoltage(msgs) {
  const driving = msgs.filter(m => speedOf(m) > 0 && num(m[VOLT]) !== null).map(m => m[VOLT]).sort((a, b) => a - b)
  return driving.length < 20 ? null : driving[Math.floor(driving.length / 2)]
}

/**
 * The voltage at or above which this vehicle's engine is surely still running:
 * within CHARGING_MARGIN_V of its driving median. Right after a real key-off
 * the supply reads 12.7-13.3 V for a minute or two (measured 2026-11-12), so
 * only a reading this close to the driving voltage counts. null when the
 * driving voltage itself is not a charging one (a bench supply, ~12 V).
 */
export const CHARGING_MARGIN_V = 0.5
export function chargingVoltage(msgs) {
  const median = drivingVoltage(msgs)
  return median === null || median < 13.2 ? null : median - CHARGING_MARGIN_V
}

/**
 * A tracker that restarts while driving reports the ignition off for a few
 * seconds (the iTriangle restarts daily around 13:27 UAE, 2026-11-12: "ignition
 * off" at 63 km/h for 8 s, then "Ignition ON"), which cut a drive into two
 * trips and a 4-second one. An ignition-off spell shorter than
 * IGNITION_GLITCH_SEC is not a real one if the vehicle moved during it, or the
 * supply stayed at charging voltage throughout, the "on" reading included (the
 * engine kept running: on 2026-11-11 the restart reported 0 km/h at 86 km/h,
 * but 13.9 V). A real short key-off drops below that within seconds.
 */
export const IGNITION_GLITCH_SEC = 2 * 60

/** The messages (by identity) inside an ignition-off spell that is a tracker glitch. */
export function ignitionGlitches(msgs, charge = chargingVoltage(msgs)) {
  const out = new Set()
  let spell = []
  // The spell and the "on" reading that ends it all at charging voltage.
  const charging = on => {
    const volts = [...spell, on].map(m => num(m[VOLT])).filter(v => v !== null)
    return charge !== null && volts.length > 1 && volts.every(v => v >= charge)
  }
  const settle = on => {
    if (spell.length && on.timestamp - spell[0].timestamp < IGNITION_GLITCH_SEC && (spell.some(m => speedOf(m) > 0) || charging(on))) {
      for (const m of spell) out.add(m)
    }
    spell = []
  }
  let ign = null
  for (const m of msgs) {
    const v = m['engine.ignition.status']
    if (typeof v !== 'boolean') { if (spell.length) spell.push(m); continue }
    // Only a spell between two "on" readings: one that ends the data is left alone.
    if (v === false && ign === true && !spell.length) spell.push(m)
    else if (v === false && spell.length) spell.push(m)
    else if (v === true && spell.length) settle(m)
    ign = v
  }
  return out.size ? out : null
}

// ── trips ────────────────────────────────────────────────────────────────

/**
 * One vehicle's trips from its messages (ascending by timestamp).
 * @returns {object[]} trips, each with start/end, times, distance and exceptions
 */
export function deriveTrips(messages, opts = {}) {
  const o = { ...DEFAULT_USAGE_OPTS, ...opts }
  const timed = (messages ?? []).filter(m => num(m.timestamp) !== null)
  const hasIgnition = timed.some(m => typeof m['engine.ignition.status'] === 'boolean')
  // Some trackers (the iTriangle, 2026-11-12) send status packets between their
  // position reports with neither ignition nor speed. Read as "ignition off"
  // they cut one drive into hundreds of 5-second trips, so with ignition known
  // they are skipped, and a message without the field keeps the last state.
  const msgs = hasIgnition
    ? timed.filter(m => typeof m['engine.ignition.status'] === 'boolean' || num(m['position.speed']) !== null)
    : timed
  const glitches = hasIgnition ? ignitionGlitches(msgs) : null
  let ignNow = false
  const isOn = m => {
    if (!hasIgnition) return speedOf(m) > 0
    const v = m['engine.ignition.status']
    if (typeof v === 'boolean') ignNow = v
    if (glitches?.has(m)) return true
    return ignNow
  }

  const trips = []
  const step = createDistanceStepper()
  let trip = null
  let lastPos = null
  let prev = null

  const closeIdle = (t, endTs) => {
    if (t.idleStart === null) return
    const run = endTs - t.idleStart
    if (run >= o.xiMinutes * 60) { t.xiCount += 1; t.xiSec += run }
    t.idleStart = null
  }
  const open = m => {
    const p = posOf(m) ?? lastPos
    return {
      startTs: m.timestamp, endTs: m.timestamp,
      startLat: p?.lat ?? null, startLng: p?.lng ?? null, endLat: p?.lat ?? null, endLng: p?.lng ?? null,
      startOdo: num(m['vehicle.mileage']), endOdo: num(m['vehicle.mileage']),
      driveSec: 0, idleSec: 0, distanceKm: 0, maxSpeed: speedOf(m),
      overSpeedCount: 0, overSpeedSec: 0, xiCount: 0, xiSec: 0, hbCount: 0, haCount: 0, hcCount: 0, nightSec: 0,
      over: speedOf(m) > o.overSpeedKmh, idleStart: speedOf(m) > 0 ? null : m.timestamp, open: false,
      ibutton: tagOf(m),
    }
  }
  const close = (t, m, { open: stillOpen = false } = {}) => {
    t.endTs = m.timestamp
    const p = posOf(m) ?? lastPos
    if (p) { t.endLat = p.lat; t.endLng = p.lng }
    const odo = num(m['vehicle.mileage'])
    if (odo !== null) t.endOdo = odo
    closeIdle(t, m.timestamp)
    t.open = stillOpen
    delete t.over
    delete t.idleStart
    trips.push(t)
  }

  for (const m of msgs) {
    const { km } = step(m)
    const gap = prev ? m.timestamp - prev.timestamp : 0

    if (trip && prev && gap > o.maxGapSec) {
      close(trip, prev)
      trip = null
    }

    if (trip && prev) {
      // The interval prev → m belongs to the trip; prev's state classifies it.
      const dt = gap
      const moving = speedOf(prev) > 0
      if (moving) {
        trip.driveSec += dt
        if (inWindow(prev.timestamp, o.nightFrom, o.nightTo, o.tzOffsetSec)) trip.nightSec += dt
      } else trip.idleSec += dt
      trip.distanceKm += km
      if (speedOf(prev) > o.overSpeedKmh) trip.overSpeedSec += dt

      if (dt >= 1 && dt <= 10) {
        const a = ((speedOf(m) - speedOf(prev)) / 3.6) / dt
        if (a <= -o.harshMs2 && -a <= NOISE_CEILING_MS2) trip.hbCount += 1
        else if (a >= o.harshMs2 && a <= NOISE_CEILING_MS2) trip.haCount += 1
        const h0 = num(prev['position.direction']), h1 = num(m['position.direction'])
        if (h0 !== null && h1 !== null && speedOf(m) >= o.corneringMinKmh && speedOf(prev) >= o.corneringMinKmh) {
          const turnRad = (Math.abs(((h1 - h0 + 540) % 360) - 180) * Math.PI) / 180
          const lateral = ((speedOf(prev) + speedOf(m)) / 2 / 3.6) * (turnRad / dt)
          if (lateral >= o.corneringMs2 && lateral <= NOISE_CEILING_MS2) trip.hcCount += 1
        }
      }
    }

    if (!trip && isOn(m)) {
      trip = open(m)
    } else if (trip) {
      const s = speedOf(m)
      if (s > trip.maxSpeed) trip.maxSpeed = s
      if (s > o.overSpeedKmh) {
        if (!trip.over) trip.overSpeedCount += 1
        trip.over = true
      } else if (s < o.overSpeedKmh - SPEED_HYSTERESIS_KMH) {
        trip.over = false
      }
      if (s > 0) closeIdle(trip, m.timestamp)
      else if (trip.idleStart === null) trip.idleStart = m.timestamp
      if (!isOn(m)) {
        close(trip, m)
        trip = null
      }
    }

    // The first tag read during a trip is its driver.
    if (trip && !trip.ibutton) trip.ibutton = tagOf(m)

    const p = posOf(m)
    if (p) {
      lastPos = p
      // A trip that began before its first fix takes that fix as its start.
      if (trip && trip.startLat === null) { trip.startLat = p.lat; trip.startLng = p.lng }
    }
    prev = m
  }

  if (trip && prev) close(trip, prev, { open: true })

  // A trip's Stop Time is how long the vehicle then stood before the next one.
  for (let i = 0; i < trips.length; i++) {
    const next = trips[i + 1]
    trips[i].stopSec = next ? Math.max(0, next.startTs - trips[i].endTs) : null
    trips[i].durationSec = trips[i].endTs - trips[i].startTs
  }
  return trips
}

// ── shared shaping ───────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')
/** Local calendar day of unix seconds: "2026-11-06". Overnight trips count on the day they started. */
export const dayKey = ts => {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const SUM_KEYS = ['driveSec', 'idleSec', 'distanceKm', 'overSpeedCount', 'overSpeedSec', 'xiCount', 'xiSec', 'hbCount', 'haCount', 'hcCount', 'nightSec']

/** Totals over a list of trips. */
export function sumTrips(trips) {
  const t = { trips: trips.length, maxSpeed: 0, stopSec: 0, firstStart: null, lastStop: null }
  for (const k of SUM_KEYS) t[k] = 0
  for (const x of trips) {
    for (const k of SUM_KEYS) t[k] += x[k] ?? 0
    t.stopSec += x.stopSec ?? 0
    if (x.maxSpeed > t.maxSpeed) t.maxSpeed = x.maxSpeed
    if (t.firstStart === null || x.startTs < t.firstStart) t.firstStart = x.startTs
    if (t.lastStop === null || x.endTs > t.lastStop) t.lastStop = x.endTs
  }
  return t
}

/**
 * Every selected vehicle's trips, in vehicle-name order.
 * @param {Map<number,{messages:object[]}>} byDevice  fetchMovementMessages' result
 * @param {object[]} vehicles  from useFlespiData (id, name, master)
 */
export function tripsByVehicle(byDevice, vehicles, opts = {}) {
  const nameOf = v => v.master?.plateNo || v.name || String(v.id)
  const out = []
  for (const [deviceId, entry] of byDevice ?? []) {
    const vehicle = vehicles.find(v => v.id === deviceId) ?? { id: deviceId, name: String(deviceId) }
    out.push({ deviceId, vehicle, vehicleId: nameOf(vehicle), truncated: !!entry?.truncated, trips: deriveTrips(entry?.messages ?? [], opts) })
  }
  return out.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId))
}

/** Trips grouped by the day they started, in order. */
export function byDay(trips) {
  const map = new Map()
  for (const t of trips) {
    const k = dayKey(t.startTs)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(t)
  }
  return [...map.entries()].map(([key, list]) => ({ key, date: new Date(list[0].startTs * 1000), trips: list }))
}

const isZero = t => t.distanceKm < ZERO_KM

/** Trips with the 0 km ones optionally taken out; how many were hidden. */
export function visibleTrips(trips, hideZero) {
  if (!hideZero) return { trips, hidden: 0 }
  const kept = trips.filter(t => !isZero(t))
  return { trips: kept, hidden: trips.length - kept.length }
}

// ── Private Usage ────────────────────────────────────────────────────────

/**
 * Business or Private, by the client's working-hours rule: a trip that starts
 * on a working day inside the working window is Business, anything else
 * Private. There is no business/private switch on these trackers, so the
 * rule is the only source.
 *
 * @param {object} rule  { days: number[] (0 = Sunday), from: 'HH:MM', to: 'HH:MM' }
 */
export function tripUsage(trip, rule) {
  const d = new Date(trip.startTs * 1000)
  const min = d.getHours() * 60 + d.getMinutes()
  const [fh, fm] = String(rule.from).split(':').map(Number)
  const [th, tm] = String(rule.to).split(':').map(Number)
  const from = fh * 60 + fm
  const to = th * 60 + tm
  const inWindow = from <= to ? min >= from && min < to : min >= from || min < to
  return rule.days.includes(d.getDay()) && inWindow ? 'Business' : 'Private'
}

// ── GYR ──────────────────────────────────────────────────────────────────

/**
 * Green / Yellow / Red score per vehicle. Each exception counts per 100 km
 * driven (at least 50 km, so a short day is not punished as if it were 100 km
 * of the same), weighted, and taken off 100:
 *   score = 100 − (5 × over speed + 4 × harsh brake + 3 × harsh accel + 2 × excess idle) per 100 km
 */
export const GYR_WEIGHTS = Object.freeze({ overSpeed: 5, harshBrake: 4, harshAccel: 3, excessIdle: 2 })
export const GYR_MIN_KM = 1
const GYR_BASE_KM = 50

export function gyrScore(totals, bands = { green: 80, red: 60 }) {
  if (totals.distanceKm < GYR_MIN_KM) return { score: null, rating: 'No driving', rates: null }
  const per100 = n => (n * 100) / Math.max(totals.distanceKm, GYR_BASE_KM)
  const rates = {
    overSpeed: per100(totals.overSpeedCount),
    harshBrake: per100(totals.hbCount),
    harshAccel: per100(totals.haCount),
    excessIdle: per100(totals.xiCount),
  }
  const penalty = Object.entries(GYR_WEIGHTS).reduce((s, [k, w]) => s + w * rates[k], 0)
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)))
  const rating = score >= bands.green ? 'Green' : score < bands.red ? 'Red' : 'Yellow'
  return { score, rating, rates }
}

// ── formatting ───────────────────────────────────────────────────────────

export function hms(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—'
  const s = Math.max(0, Math.round(sec))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export const km = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
