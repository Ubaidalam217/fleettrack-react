/**
 * The Uffizio vehicles in the standard reports (client, 2026-11-26: "We can
 * get the same standard reports"). Pure: no React, no fetch, no Date.now(),
 * and `.js` imports so the server can load it (lib/uffizioReports.js).
 *
 * ── What an Uffizio vehicle gives a report ──────────────────────────────────
 *
 * One position sample about every 2 minutes (the server polls Uffizio every
 * ~125 s, server/src/lib/uffizio.js), already in Flespi's message shape
 * (GET /api/live/uffizio/:id/messages): timestamp, position, sampled speed,
 * heading, ignition, odometer (km), driver tag, external volts. The message
 * readers (utils/replay.js) route the ids "uffizio:<vehicleId>" there, so the
 * report engines (trips: usageReports.js deriveTrips; days: daywiseCore.js,
 * utilization.js; the Movement Report) run on them UNCHANGED:
 *   - a trip is an ignition-on run; a sample gap over 30 min ends it;
 *   - between two samples with the ignition on, speed 0 is idle, else driving;
 *     ignition off is stopped;
 *   - DISTANCE is the odometer: createDistanceStepper (utils/distance.js)
 *     recognises the Uffizio ids and sums the odometer's signed deltas, which
 *     over any period is the last reading minus the first. Where the odometer
 *     is missing, falls back (a reset) or jumps (a rise no drive explains), that
 *     stretch is measured from the GPS fixes and marked ESTIMATED.
 *   - days are UAE days (UTC+4); an interval across midnight is split between
 *     the two days in proportion, as for every other vehicle.
 *
 * What 2-minute samples cannot give: harsh braking / acceleration / cornering
 * (they need speeds 1-10 s apart), an exact over-speed duration or maximum
 * speed (both are sampled), and a geofence crossed between two samples.
 *
 * This file holds what the engines do not: the per-vehicle distance with its
 * source (odometer or estimated), the Daywise month with the estimated share,
 * per-day records (distance, driving / idle / stop time, speeds, first start,
 * last stop, trips, fuel), and the report footnote.
 */

import { createDistanceStepper } from './distance.js'
import { deriveDeviceMonth, daysInMonth, uaeDayStart, uaeDayOf, MAX_GAP_SEC, UAE_OFFSET_SEC } from './daywiseCore.js'
import { deriveTrips } from './usageReports.js'
import { isUffizioId } from './uffizioLive.js'

export { isUffizioId }

/** Said once on every report that has an Uffizio vehicle in it. */
export const UFFIZIO_FOOTNOTE = 'Uffizio vehicles: positions every ~2 minutes; distance is taken from the vehicle odometer.'

/** Below this many km an estimated share is rounding, not worth a label. */
export const ESTIMATED_MIN_KM = 0.05

/** Litres a reading must rise by to count as a fill when working out fuel used. */
export const FUEL_FILL_MIN_L = 5

const DAY = 86400
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Sort order for mixed device ids: Flespi numbers first (ascending), then the Uffizio strings. */
export function compareIds(a, b) {
  const na = typeof a === 'number', nb = typeof b === 'number'
  if (na && nb) return a - b
  if (na !== nb) return na ? -1 : 1
  return String(a).localeCompare(String(b))
}

/** Whether a list of ids (or a Map keyed by them) holds an Uffizio vehicle. */
export function hasUffizio(ids) {
  for (const id of ids instanceof Map ? ids.keys() : ids ?? []) if (isUffizioId(id)) return true
  return false
}

/** Messages with a timestamp, ascending (copies the array, not the messages). */
function timed(messages) {
  return (messages ?? []).filter(m => num(m?.timestamp) !== null).sort((a, b) => a.timestamp - b.timestamp)
}

/** UAE midnight (unix s) of the day `ts` falls in. */
export const uaeMidnight = ts => Math.floor((ts + UAE_OFFSET_SEC) / DAY) * DAY - UAE_OFFSET_SEC
/** "YYYY-MM-DD" of a UAE day. */
export const uaeDate = ts => new Date((ts + UAE_OFFSET_SEC) * 1000).toISOString().slice(0, 10)

/**
 * Hand `value` (spread evenly over [t0, t1)) to `add(dayStart, part)` for each
 * UAE day it covers, clipped to [from, to).
 */
function splitByDay(t0, t1, value, from, to, add) {
  if (!(t1 > t0) || !value) return
  const span = t1 - t0
  let cursor = Math.max(t0, from)
  const end = Math.min(t1, to)
  while (cursor < end) {
    const day = uaeMidnight(cursor)
    const sliceEnd = Math.min(day + DAY, end)
    add(day, value * ((sliceEnd - cursor) / span))
    cursor = sliceEnd
  }
}

/**
 * The distance of one vehicle over [fromTs, toTs): the stepper's km, split
 * across the window edges in proportion like the Daywise days.
 *
 * Pass every sample you have (also before / after the window): the odometer
 * anchor needs them.
 *
 * @returns {{ km: number, odometerKm: number, estimatedKm: number,
 *             source: 'odometer'|'estimated'|'mixed'|null, samples: number }}
 *          source null = no sample in the window
 */
export function uffizioDistance(messages, fromTs = -Infinity, toTs = Infinity) {
  const msgs = timed(messages)
  const step = createDistanceStepper()
  let odometerKm = 0, estimatedKm = 0, samples = 0
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    const { km, source } = step(m)
    if (m.timestamp >= fromTs && m.timestamp < toTs) samples += 1
    if (i === 0 || !km) continue
    const t0 = msgs[i - 1].timestamp, t1 = m.timestamp
    let part
    if (t1 > t0) part = km * (Math.max(0, Math.min(t1, toTs) - Math.max(t0, fromTs)) / (t1 - t0))
    else part = t1 >= fromTs && t1 < toTs ? km : 0
    if (source === 'gps') estimatedKm += part
    else odometerKm += part
  }
  const km = odometerKm + estimatedKm
  return { km, odometerKm, estimatedKm, source: samples ? sourceOf(km, estimatedKm) : null, samples }
}

/** 'odometer' | 'estimated' | 'mixed' for a distance and its GPS share. */
export function sourceOf(km, estimatedKm) {
  if (!(estimatedKm >= ESTIMATED_MIN_KM)) return 'odometer'
  return estimatedKm >= km - ESTIMATED_MIN_KM ? 'estimated' : 'mixed'
}

/**
 * The Uffizio vehicles of a fetched report whose distance in the window is
 * (partly) estimated from GPS — the footnote names them.
 * @param {Map<string|number, {messages: object[]}>} byDevice
 * @returns {Set<string>} their ids
 */
export function estimatedUffizioIds(byDevice, fromTs = -Infinity, toTs = Infinity) {
  const out = new Set()
  for (const [id, entry] of byDevice ?? []) {
    if (!isUffizioId(id)) continue
    const d = uffizioDistance(entry?.messages ?? entry ?? [], fromTs, toTs)
    if (d.source === 'estimated' || d.source === 'mixed') out.add(id)
  }
  return out
}

/**
 * The Daywise month of one Uffizio vehicle: deriveDeviceMonth's numbers
 * (the same rules as every vehicle) plus, per day, how many of the km are
 * estimated and how many samples there were.
 *
 * @returns {ReturnType<typeof deriveDeviceMonth> & { estimatedKm: number[],
 *           totalEstimatedKm: number, samplesPerDay: number[], noData: boolean, source: 'UFFIZIO' }}
 */
export function deriveUffizioMonth(messages, year, month) {
  const msgs = timed(messages)
  const base = deriveDeviceMonth(msgs, year, month)
  const days = daysInMonth(year, month)
  const estimatedKm = new Array(days + 1).fill(0)
  const samplesPerDay = new Array(days + 1).fill(0)
  const from = uaeDayStart(year, month, 1)
  const to = uaeDayStart(year, month, days) + DAY
  const step = createDistanceStepper()
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    const { km, source } = step(m)
    const d = uaeDayOf(m.timestamp, year, month)
    if (d != null) samplesPerDay[d] += 1
    if (i === 0 || source !== 'gps' || !km) continue
    splitByDay(msgs[i - 1].timestamp, m.timestamp, km, from, to, (dayStart, part) => {
      const day = uaeDayOf(dayStart, year, month)
      if (day != null) estimatedKm[day] += part
    })
  }
  const totalEstimatedKm = estimatedKm.reduce((a, b) => a + b, 0)
  return { ...base, estimatedKm, totalEstimatedKm, samplesPerDay, noData: !samplesPerDay.some(n => n > 0), source: 'UFFIZIO' }
}

/**
 * Per UAE day records of one Uffizio vehicle over [fromTs, toTs).
 *
 * @param {object[]} messages  its samples, ascending or not (also before / after the window)
 * @param {number} fromTs
 * @param {number} toTs        exclusive
 * @param {object} [opts]
 * @param {{ts: number, litres: number}[]} [opts.fuel]  calibrated fuel readings, for fuel start / end / used
 * @param {object} [opts.tripOpts]  deriveTrips options (speed limit, XI minutes…)
 * @returns {object[]} one record per day in the window:
 *   { date, dayStart, samples, noData, distanceKm, estimatedKm, distanceSource,
 *     odoStart, odoEnd, drivingSec, idleSec, stopSec, maxSpeed, avgSpeed,
 *     firstStart, lastStop, trips, fuelStartL, fuelEndL, fuelUsedL }
 *   A day without a sample has noData true and nulls where nothing is known.
 */
export function uffizioDayRecords(messages, fromTs, toTs, opts = {}) {
  const msgs = timed(messages)
  const days = new Map()
  for (let d = uaeMidnight(fromTs); d < toTs; d += DAY) {
    days.set(d, {
      date: uaeDate(d), dayStart: d, samples: 0, noData: true,
      distanceKm: 0, estimatedKm: 0, distanceSource: null, odoStart: null, odoEnd: null,
      drivingSec: 0, idleSec: 0, stopSec: 0, maxSpeed: null, avgSpeed: null,
      firstStart: null, lastStop: null, trips: 0,
      fuelStartL: null, fuelEndL: null, fuelUsedL: null,
      _speedSum: 0, _speedN: 0,
    })
  }
  const recOf = ts => days.get(uaeMidnight(ts))
  const inWin = ts => ts >= fromTs && ts < toTs

  // Samples: counts, speeds, the odometer at the day's first and last sample.
  for (const m of msgs) {
    if (!inWin(m.timestamp)) continue
    const r = recOf(m.timestamp)
    if (!r) continue
    r.samples += 1
    const s = num(m['position.speed'])
    if (s !== null) {
      if (r.maxSpeed === null || s > r.maxSpeed) r.maxSpeed = s
      if (s > 0) { r._speedSum += s; r._speedN += 1 }
    }
    const odo = num(m['vehicle.mileage'])
    if (odo !== null) {
      if (r.odoStart === null) r.odoStart = odo
      r.odoEnd = odo
    }
  }

  // Intervals: distance (with its estimated share) and time by state.
  const step = createDistanceStepper()
  for (let i = 0; i < msgs.length; i++) {
    const b = msgs[i]
    const { km, source } = step(b)
    if (i === 0) continue
    const a = msgs[i - 1]
    const t0 = a.timestamp, t1 = b.timestamp
    if (km) {
      if (t1 > t0) {
        splitByDay(t0, t1, km, fromTs, toTs, (day, part) => {
          const r = days.get(day)
          if (!r) return
          r.distanceKm += part
          if (source === 'gps') r.estimatedKm += part
        })
      } else if (inWin(t1)) {
        const r = recOf(t1)
        if (r) { r.distanceKm += km; if (source === 'gps') r.estimatedKm += km }
      }
    }
    const dt = t1 - t0
    if (!(dt > 0)) continue
    const ign = a['engine.ignition.status']
    const speed = num(a['position.speed']) ?? 0
    const on = ign === true || (typeof ign !== 'boolean' && speed > 0)
    const key = dt > MAX_GAP_SEC || !on ? 'stopSec' : speed > 0 ? 'drivingSec' : 'idleSec'
    splitByDay(t0, t1, dt, fromTs, toTs, (day, part) => {
      const r = days.get(day)
      if (r) r[key] += part
    })
  }

  // Trips: counted on the day they start; first start and last stop of the day.
  for (const t of deriveTrips(msgs, opts.tripOpts)) {
    if (!inWin(t.startTs)) continue
    const r = recOf(t.startTs)
    if (!r) continue
    r.trips += 1
    if (r.firstStart === null || t.startTs < r.firstStart) r.firstStart = t.startTs
    if (r.lastStop === null || t.endTs > r.lastStop) r.lastStop = t.endTs
  }

  // Fuel (calibrated litres): first and last reading of the day, used = the
  // fall plus what was filled in between.
  const fuel = (opts.fuel ?? []).filter(f => num(f?.ts) !== null && num(f?.litres) !== null && inWin(f.ts)).sort((x, y) => x.ts - y.ts)
  const fuelBy = new Map()
  for (const f of fuel) {
    const k = uaeMidnight(f.ts)
    if (!fuelBy.has(k)) fuelBy.set(k, [])
    fuelBy.get(k).push(f.litres)
  }
  for (const [k, list] of fuelBy) {
    const r = days.get(k)
    if (!r) continue
    let fills = 0
    for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] >= FUEL_FILL_MIN_L) fills += list[i] - list[i - 1]
    r.fuelStartL = list[0]
    r.fuelEndL = list[list.length - 1]
    r.fuelUsedL = Math.max(0, list[0] - list[list.length - 1] + fills)
  }

  return [...days.values()].map(r => {
    const { _speedSum, _speedN, ...rest } = r
    const noData = r.samples === 0
    return {
      ...rest,
      noData,
      avgSpeed: _speedN ? _speedSum / _speedN : null,
      distanceSource: noData && !r.distanceKm ? null : sourceOf(r.distanceKm, r.estimatedKm),
    }
  })
}

/** Said where harsh driving would be counted: 2-minute samples cannot show it. */
export const UFFIZIO_HARSH_NOTE = 'Harsh braking, acceleration and cornering need second-by-second data, so they are not counted for Uffizio vehicles; their speeds are samples.'

/**
 * The notes a report prints under its tables, [] when no Uffizio vehicle is in it.
 * @param {{ present: boolean, estimated?: string[], extra?: string[] }} o
 *        estimated: names of the vehicles whose distance is (partly) estimated
 */
export function uffizioNotes({ present, estimated = [], extra = [] }) {
  if (!present) return []
  const out = [UFFIZIO_FOOTNOTE]
  if (estimated.length) out.push(`Distance estimated from GPS positions (no usable odometer reading) for: ${estimated.join(', ')}.`)
  return [...out, ...extra.filter(Boolean)]
}
