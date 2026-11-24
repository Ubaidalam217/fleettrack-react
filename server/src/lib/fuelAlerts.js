/**
 * Fuel alerts (client, 2026-11-24: "We need … alerts"): the alert rules of
 * the fuel types, run over the stored fuel readings (FuelReading) with each
 * vehicle's calibration in use.
 *
 *   fuel_theft  a drain: the level falls by at least `litres` (default 15)
 *               while the vehicle stands (src/utils/fuelEvents.js)
 *   fuel_fill   a fill: the level rises by at least `litres`
 *   low_fuel    the level is under `litres`, or under `percent` of the tank
 *
 * Like the engine's other episodes (lib/alertEngine.js) each is ONE
 * AlertEvent from start to end: a drain that goes on after it was raised
 * moves that event's end and litres rather than raising another; low fuel
 * is raised once and closed (endedAt, duration, lowest level) when the level
 * is back above the limit. What a rule last saw lives in AlertState
 * (subject "v:<vehicleId>"), so a restart raises nothing twice.
 *
 * The same rules as everywhere else apply: the vehicles of the rule's BG (or
 * its list), a vehicle that muted the type is skipped (Vehicle.mutedAlerts),
 * events go to the bell / Notifications, the phones (lib/push.js) and, when
 * the rule asks, by email. Vehicles without a calibration raise nothing (no
 * litres to judge). Run after each Uffizio poll that stored readings.
 */

import prisma from '../prisma.js'
import { pushEvents } from './push.js'
import { emailEvents, FUEL_ALERT_TYPES, TYPES } from './alertEngine.js'
import { bgFleetWhere } from './scope.js'
import { SHARED_BG_RULES_APPLY } from './sharePolicy.js'
import { vehicleLabel } from './vehicleLabel.js'
import { activeCalibrations, readingLitres, calibrationPort } from './fuel.js'
import { cleanSeries, detectFuelEvents } from '../../../src/utils/fuelEvents.js'

/** How far back the first pass of a rule reads, and at most after a pause. */
const FIRST_LOOKBACK_MS = 2 * 3600_000
const MAX_LOOKBACK_MS = 12 * 3600_000
/** A run is read with this much before the last point seen, so it is whole. */
const OVERLAP_MS = 2 * 3600_000
/** Low fuel reads the level of the last readings within this window. */
const LEVEL_WINDOW_MS = 6 * 3600_000

const round1 = v => Math.round(v * 10) / 10
const paramsOf = alert => ({ ...(TYPES[alert.type]?.defaults ?? {}), ...(alert.params ?? {}) })
const isMuted = (v, alert) => Array.isArray(v.mutedAlerts) && v.mutedAlerts.includes(alert.type)

/** The litres limit of a low-fuel rule for a vehicle, or null when it cannot be set. */
export function lowFuelLimit(params, cal) {
  const l = Number(params.litres)
  if (params.litres !== null && params.litres !== undefined && params.litres !== '' && Number.isFinite(l) && l > 0) return l
  const pct = Number(params.percent)
  const tank = Number(cal?.tankCapacityL)
  if (Number.isFinite(pct) && pct > 0 && Number.isFinite(tank) && tank > 0) return (pct / 100) * tank
  return null
}

/**
 * One fill / drain rule against one vehicle's cleaned series (pure).
 * @returns {{ state, create: object[], update: object[] }}  create/update: the episodes to write
 */
export function evaluateFuelRun(kind, series, state, { threshold, now }) {
  const s = { ...(state ?? {}) }
  const create = []
  const update = []
  if (!series.length) return { state: s, create, update }
  const lastTs = series[series.length - 1].ts
  // Only runs that have ended: a reading after their furthest point.
  const events = detectFuelEvents(series, { threshold }).filter(e => e.kind === kind && e.endTs < lastTs)
  for (const e of events) {
    const ep = s.ep
    if (ep && e.startTs <= ep.endTs) {
      // The same run as the one raised, seen further: its end and litres move.
      if (e.endTs > ep.endTs) {
        update.push({ at: ep.at, startTs: ep.startTs, ...e })
        s.ep = { ...ep, endTs: e.endTs, litres: e.litres }
      }
      continue
    }
    if (ep && e.endTs <= ep.endTs) continue // already reported
    create.push(e)
    s.ep = { at: e.startTs, startTs: e.startTs, endTs: e.endTs, litres: e.litres }
  }
  s.lastTs = Math.max(s.lastTs ?? 0, lastTs)
  s.checkedAt = now
  return { state: s, create, update }
}

/**
 * One low-fuel rule against one vehicle's level (pure).
 * @returns {{ state, fire: null|{level, limit, ts}, end: null|{at, endTs, lowest} }}
 */
export function evaluateLowFuel(series, state, { limit }) {
  const s = { ...(state ?? {}) }
  if (!series.length || limit === null) return { state: s, fire: null, end: null }
  const last = series[series.length - 1]
  const level = last.litres
  const back = limit + Math.max(2, limit * 0.05)
  if (!s.low) {
    if (level < limit) {
      s.low = { at: last.ts, lowest: level }
      return { state: s, fire: { level, limit, ts: last.ts }, end: null }
    }
    return { state: s, fire: null, end: null }
  }
  if (level >= back) {
    const end = { at: s.low.at, endTs: last.ts, lowest: s.low.lowest }
    delete s.low
    return { state: s, fire: null, end }
  }
  if (level < s.low.lowest) s.low = { ...s.low, lowest: level }
  return { state: s, fire: null, end: null }
}

/** The readings of a vehicle's calibrated port since `fromMs`, converted, cleaned. */
async function seriesOf(vehicleId, cal, fromMs, toMs) {
  const rows = await prisma.fuelReading.findMany({
    where: { vehicleId, port: calibrationPort(cal), ts: { gte: new Date(fromMs), lte: new Date(toMs) } },
    orderBy: { ts: 'asc' },
    select: { ts: true, port: true, raw: true, ign: true, speed: true, lat: true, lng: true },
  })
  return cleanSeries(rows.map(r => ({ ts: r.ts.getTime(), litres: readingLitres(r, cal).litres, ign: r.ign, speed: r.speed, lat: r.lat, lng: r.lng })))
}

const VEHICLE_SELECT = { id: true, bgId: true, mutedAlerts: true, imei: true, plateNo: true, fleetNo: true, driver: { select: { id: true, name: true } } }

/**
 * One pass over every active fuel rule. Returns the events it created.
 * @param {number} nowMs
 */
export async function runFuelAlertPass(nowMs = Date.now()) {
  const alerts = await prisma.alert.findMany({
    where: { status: 'Active', type: { in: [...FUEL_ALERT_TYPES] } },
    include: { vehicles: { select: { vehicleId: true } } },
  })
  if (!alerts.length) return []

  const fleets = new Map()
  for (const bgId of new Set(alerts.map(a => a.bgId))) {
    fleets.set(bgId, await prisma.vehicle.findMany({ where: SHARED_BG_RULES_APPLY ? bgFleetWhere(bgId) : { bgId }, select: VEHICLE_SELECT }))
  }
  const allIds = [...new Set([...fleets.values()].flat().map(v => v.id))]
  const cals = await activeCalibrations(allIds)
  const states = await prisma.alertState.findMany({ where: { alertId: { in: alerts.map(a => a.id) } } })
  const stateOf = new Map(states.map(r => [`${r.alertId}|${r.subject}`, r.state]))
  const seriesCache = new Map()
  const series = async (v, cal, fromMs) => {
    const key = `${v.id}|${fromMs}`
    if (!seriesCache.has(key)) seriesCache.set(key, await seriesOf(v.id, cal, fromMs, nowMs))
    return seriesCache.get(key)
  }

  const changed = []
  const events = []
  const updates = []
  for (const alert of alerts) {
    const listed = new Set(alert.vehicles.map(x => x.vehicleId))
    const p = paramsOf(alert)
    for (const v of fleets.get(alert.bgId) ?? []) {
      if (!(alert.allVehicles || listed.has(v.id)) || isMuted(v, alert)) continue
      const cal = cals.get(v.id)
      if (!cal) continue
      const subject = `v:${v.id}`
      const prev = stateOf.get(`${alert.id}|${subject}`)
      const label = vehicleLabel(v)
      const driver = v.driver ? ` · Driver: ${v.driver.name}` : ''
      const base = { alertId: alert.id, bgId: alert.bgId, type: alert.type, severity: alert.severity, title: alert.name, vehicleId: v.id, driverId: v.driver?.id ?? null }
      let next

      if (alert.type === 'low_fuel') {
        const s = await series(v, cal, nowMs - LEVEL_WINDOW_MS)
        const limit = lowFuelLimit(p, cal)
        const r = evaluateLowFuel(s, prev, { limit })
        next = r.state
        if (r.fire) {
          const why = p.litres ? `under ${round1(r.fire.limit)} L` : `under ${p.percent}% of the ${cal.tankCapacityL} L tank`
          const at = s[s.length - 1]
          events.push({ ...base, message: `${label}: Low fuel, ${round1(r.fire.level)} L (${why})${driver}`, value: round1(r.fire.level), peakValue: round1(r.fire.level), occurredAt: new Date(r.fire.ts), lat: at.lat ?? null, lng: at.lng ?? null })
        }
        if (r.end) updates.push({ alertId: alert.id, vehicleId: v.id, at: r.end.at, data: { endedAt: new Date(r.end.endTs), durationSec: Math.round((r.end.endTs - r.end.at) / 1000), peakValue: round1(r.end.lowest) } })
      } else {
        const kind = alert.type === 'fuel_theft' ? 'drain' : 'fill'
        const from = Math.max(nowMs - MAX_LOOKBACK_MS, prev?.lastTs ? prev.lastTs - OVERLAP_MS : nowMs - FIRST_LOOKBACK_MS)
        const s = await series(v, cal, from)
        const r = evaluateFuelRun(kind, s, prev, { threshold: Number(p.litres) || 15, now: nowMs })
        next = r.state
        const text = e => (kind === 'drain'
          ? `${label}: Fuel drained while stopped, ${round1(e.litres)} L (${e.before} → ${e.after} L)${driver}`
          : `${label}: Fuel filled, ${round1(e.litres)} L (${e.before} → ${e.after} L)${driver}`)
        for (const e of r.create) {
          events.push({
            ...base, message: text(e), value: e.litres, peakValue: e.litres, lat: e.lat, lng: e.lng,
            occurredAt: new Date(e.startTs), endedAt: new Date(e.endTs), durationSec: Math.round((e.endTs - e.startTs) / 1000),
          })
        }
        for (const u of r.update) {
          updates.push({
            alertId: alert.id, vehicleId: v.id, at: u.at,
            data: { endedAt: new Date(u.endTs), durationSec: Math.round((u.endTs - u.startTs) / 1000), value: u.litres, peakValue: u.litres, message: text({ ...u, before: u.before }) },
          })
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(prev ?? {})) changed.push({ alertId: alert.id, subject, state: next })
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
  for (const u of updates) {
    await prisma.alertEvent.updateMany({ where: { alertId: u.alertId, vehicleId: u.vehicleId, occurredAt: new Date(u.at) }, data: u.data })
  }
  if (created.length) {
    emailEvents(created, alerts).catch(err => console.error(`[fleetmax] fuel alert email failed: ${err.message}`))
    pushEvents(created)
  }
  return created
}
