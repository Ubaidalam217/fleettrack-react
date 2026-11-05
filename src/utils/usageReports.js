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

import { createDistanceStepper } from './distance'

export const DEFAULT_USAGE_OPTS = Object.freeze({
  maxGapSec: 30 * 60,
  overSpeedKmh: 80,
  xiMinutes: 10,
  harshMs2: 3.5,
})

const NOISE_CEILING_MS2 = 10
/** An over-speed episode ends only once the speed is this far under the limit (as the server's alert). */
export const SPEED_HYSTERESIS_KMH = 5
/** A trip shorter than this distance counts as "0 km" for the hide-zero option. */
export const ZERO_KM = 0.05

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const speedOf = m => num(m['position.speed']) ?? 0

function posOf(m) {
  const lat = num(m['position.latitude'])
  const lng = num(m['position.longitude'])
  if (lat === null || lng === null || (lat === 0 && lng === 0) || m['position.valid'] === false) return null
  return { lat, lng }
}

// ── trips ────────────────────────────────────────────────────────────────

/**
 * One vehicle's trips from its messages (ascending by timestamp).
 * @returns {object[]} trips, each with start/end, times, distance and exceptions
 */
export function deriveTrips(messages, opts = {}) {
  const o = { ...DEFAULT_USAGE_OPTS, ...opts }
  const msgs = (messages ?? []).filter(m => num(m.timestamp) !== null)
  const hasIgnition = msgs.some(m => typeof m['engine.ignition.status'] === 'boolean')
  const isOn = m => (hasIgnition ? m['engine.ignition.status'] === true : speedOf(m) > 0)

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
      overSpeedCount: 0, overSpeedSec: 0, xiCount: 0, xiSec: 0, hbCount: 0, haCount: 0,
      over: speedOf(m) > o.overSpeedKmh, idleStart: speedOf(m) > 0 ? null : m.timestamp, open: false,
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
      if (moving) trip.driveSec += dt
      else trip.idleSec += dt
      trip.distanceKm += km
      if (speedOf(prev) > o.overSpeedKmh) trip.overSpeedSec += dt

      if (dt >= 1 && dt <= 10) {
        const a = ((speedOf(m) - speedOf(prev)) / 3.6) / dt
        if (a <= -o.harshMs2 && -a <= NOISE_CEILING_MS2) trip.hbCount += 1
        else if (a >= o.harshMs2 && a <= NOISE_CEILING_MS2) trip.haCount += 1
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

const SUM_KEYS = ['driveSec', 'idleSec', 'distanceKm', 'overSpeedCount', 'overSpeedSec', 'xiCount', 'xiSec', 'hbCount', 'haCount']

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
