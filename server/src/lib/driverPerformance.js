/**
 * Driver performance and rule-based risk (Driver Management phases 3-4).
 *
 * Every vehicle's trips in the period come from the same engine the reports
 * use (src/utils/usageReports.js deriveTrips), on our own telemetry history
 * when it covers the period and Flespi's otherwise. Each trip is credited to
 * a driver:
 *   1. the driver whose iButton tag was read during it;
 *   2. else the Temporary assignment covering its start, else the Primary one;
 *   3. else nobody — "driving without identification", listed per vehicle.
 *
 * The scores are rules on those numbers, not a trained model: there is no
 * accident history to learn from. Every threshold is here, in one place.
 */

import prisma from '../prisma.js'
import * as flespi from './flespi.js'
import { coverageStart, messagesBetween } from './telemetry.js'
import { scopedWhere } from './scope.js'
import { deriveTrips, sumTrips } from '../../../src/utils/usageReports.js'

const UAE_OFFSET_SEC = 4 * 3600
const DAY = 86_400
const FIELDS = 'timestamp,position.latitude,position.longitude,position.speed,position.direction,position.valid,engine.ignition.status,vehicle.mileage,ibutton.code,external.powersource.voltage'

// ── settings ─────────────────────────────────────────────────────────────

/**
 * The fatigue rule (client, 2026-11-06; UAE rules expected from January).
 * Minutes. The first stint of the day may run firstDriveMin, later stints
 * driveMin; a stop of at least breakMin ends a stint; no more than dailyMaxMin
 * of driving a day.
 */
export const FATIGUE_DEFAULTS = Object.freeze({ firstDriveMin: 150, breakMin: 15, driveMin: 120, dailyMaxMin: 600 })

export async function getFatigueSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: 'fatigue' } })
  return { ...FATIGUE_DEFAULTS, ...(row?.value ?? {}) }
}

export async function setFatigueSettings(value) {
  const v = { ...FATIGUE_DEFAULTS, ...value }
  await prisma.appSetting.upsert({ where: { key: 'fatigue' }, create: { key: 'fatigue', value: v }, update: { value: v } })
  return v
}

// ── data ─────────────────────────────────────────────────────────────────

async function loadMessages(deviceIds, fromTs, toTs) {
  const byDevice = new Map(deviceIds.map(id => [id, []]))
  if (!deviceIds.length) return byDevice
  const start = await coverageStart()
  if (start !== null && start <= fromTs) {
    for (const id of deviceIds) byDevice.set(id, await messagesBetween([id], fromTs, toTs, { limit: 400_000 }))
    return byDevice
  }
  if (!flespi.isConfigured()) return byDevice
  const data = encodeURIComponent(JSON.stringify({ from: fromTs, to: toTs, fields: FIELDS }))
  for (const id of deviceIds) {
    const res = await flespi.forward(`/gw/devices/${id}/messages?data=${data}`, { timeoutMs: 120_000 })
    if (res.status === 200) byDevice.set(id, JSON.parse(res.text).result ?? [])
  }
  return byDevice
}

const uaeDay = ts => new Date((ts + UAE_OFFSET_SEC) * 1000).toISOString().slice(0, 10)

/** Which driver a trip belongs to, and how we know. */
export function creditTrip(trip, vehicleId, ctx) {
  if (trip.ibutton) {
    const d = ctx.byTag.get(trip.ibutton)
    return d ? { driverId: d.id, via: 'tag' } : { driverId: null, via: 'unknown tag', tag: trip.ibutton }
  }
  const at = trip.startTs * 1000
  const covering = (ctx.assignByVehicle.get(vehicleId) ?? [])
    .filter(a => a.startDate.getTime() <= at && (!a.endDate || a.endDate.getTime() + DAY * 1000 > at))
  const pick = covering.find(a => a.role === 'Temporary') ?? covering.find(a => a.role === 'Primary')
  return pick ? { driverId: pick.driverId, via: 'assignment' } : { driverId: null, via: 'none' }
}

/**
 * Fatigue: one driver's trips (sorted) cut into stints by stops of breakMin,
 * day by day (UAE). A stint over its limit, or a day over dailyMaxMin, is a
 * violation.
 */
export function fatigueOf(trips, rule = FATIGUE_DEFAULTS) {
  const byDay = new Map()
  for (const t of trips) {
    const k = uaeDay(t.startTs)
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(t)
  }
  let violations = 0, daysOverLimit = 0, longestStintSec = 0
  const details = []
  for (const [dayKey, list] of byDay) {
    list.sort((a, b) => a.startTs - b.startTs)
    const stints = []
    let cur = null
    for (const t of list) {
      if (cur && t.startTs - cur.endTs < rule.breakMin * 60) {
        cur.driveSec += t.driveSec
        cur.endTs = t.endTs
      } else {
        cur = { startTs: t.startTs, endTs: t.endTs, driveSec: t.driveSec }
        stints.push(cur)
      }
    }
    stints.forEach((s, i) => {
      longestStintSec = Math.max(longestStintSec, s.driveSec)
      const limit = (i === 0 ? rule.firstDriveMin : rule.driveMin) * 60
      if (s.driveSec > limit) {
        violations += 1
        details.push({ day: dayKey, kind: i === 0 ? 'First stint too long' : 'No break in time', startTs: s.startTs, driveSec: s.driveSec, limitSec: limit })
      }
    })
    const total = list.reduce((n, t) => n + t.driveSec, 0)
    if (total > rule.dailyMaxMin * 60) {
      violations += 1
      daysOverLimit += 1
      details.push({ day: dayKey, kind: 'Daily limit exceeded', driveSec: total, limitSec: rule.dailyMaxMin * 60 })
    }
  }
  return { violations, daysOverLimit, longestStintSec, details }
}

// ── scores ───────────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = Object.freeze({ overSpeed: 5, harshBrake: 4, harshAccel: 3, harshCorner: 3, excessIdle: 2 })
const BASE_KM = 50
export const SCORE_BANDS = Object.freeze({ green: 80, red: 60 })

/**
 * Safety score 0-100: the exceptions per 100 km (at least 50 km counted),
 * weighted, taken off 100, then 2 points per fatigue violation and 10 per
 * accident or incident in the period.
 */
export function safetyScore(t, fatigue, incidents) {
  if (t.distanceKm < 1) return null
  const per100 = n => (n * 100) / Math.max(t.distanceKm, BASE_KM)
  const penalty = SCORE_WEIGHTS.overSpeed * per100(t.overSpeedCount) + SCORE_WEIGHTS.harshBrake * per100(t.hbCount)
    + SCORE_WEIGHTS.harshAccel * per100(t.haCount) + SCORE_WEIGHTS.harshCorner * per100(t.hcCount)
    + SCORE_WEIGHTS.excessIdle * per100(t.xiCount) + 2 * (fatigue?.violations ?? 0) + 10 * incidents
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
}

const level = (points, high, medium) => (points >= high ? 'High' : points >= medium ? 'Medium' : 'Low')

/** The predictive block: rules over this period's numbers and the previous period's score. */
export function riskProfile(t, fatigue, incidents, score, prevScore) {
  const per100 = n => (t.distanceKm >= 1 ? (n * 100) / Math.max(t.distanceKm, BASE_KM) : 0)
  const harsh = per100(t.hbCount + t.haCount + t.hcCount)
  const trend = score === null || prevScore === null || prevScore === undefined
    ? (score === null ? 'No driving' : 'New')
    : score - prevScore >= 5 ? 'Improving' : prevScore - score >= 5 ? 'Deteriorating' : 'Stable'

  let accident = 0
  if (score !== null && score < SCORE_BANDS.red) accident += 2
  else if (score !== null && score < SCORE_BANDS.green) accident += 1
  if (trend === 'Deteriorating') accident += 1
  if (incidents > 0) accident += 2
  if ((fatigue?.violations ?? 0) >= 3) accident += 1
  if (harsh > 2) accident += 1

  const fatigueLevel = (fatigue?.daysOverLimit ?? 0) > 0 || (fatigue?.violations ?? 0) >= 3 ? 'High' : (fatigue?.violations ?? 0) > 0 ? 'Medium' : 'Low'

  const engineOn = t.driveSec + t.idleSec
  const idleShare = engineOn > 0 ? t.idleSec / engineOn : 0
  let fuel = 0
  if (idleShare > 0.25) fuel += 2
  else if (idleShare > 0.15) fuel += 1
  if (per100(t.haCount) > 1) fuel += 1
  if (per100(t.overSpeedCount) > 2) fuel += 1

  let wear = harsh > 3 ? 2 : harsh > 1.5 ? 1 : 0
  if (t.distanceKm > 5000) wear += 1

  return {
    trend,
    accidentRisk: t.distanceKm < 1 && incidents === 0 ? 'Low' : level(accident, 4, 2),
    fatigueRisk: fatigueLevel,
    fuelWaste: level(fuel, 3, 2),
    maintenanceRisk: level(wear, 2, 1),
    idleShare: Math.round(idleShare * 100),
  }
}

const EXPIRY_FIELDS = [['licenseExpiry', 'Licence'], ['visaExpiry', 'Visa'], ['emiratesIdExpiry', 'Emirates ID'], ['medicalExpiry', 'Medical']]

/** The paper that runs out first, with the days left (negative once expired). */
export function nextExpiry(driver, nowMs = Date.now()) {
  const dated = EXPIRY_FIELDS.filter(([f]) => driver[f]).map(([f, label]) => ({ label, date: driver[f] }))
  if (!dated.length) return null
  dated.sort((a, b) => a.date - b.date)
  const first = dated[0]
  return { label: first.label, date: first.date.toISOString().slice(0, 10), daysLeft: Math.floor((first.date.getTime() - nowMs) / (DAY * 1000)) }
}

// ── the computation ──────────────────────────────────────────────────────

/** Per-driver numbers for [fromTs, toTs] within a user's scope. */
export async function computePerformance(scope, fromTs, toTs, { fatigue = FATIGUE_DEFAULTS } = {}) {
  const [vehicles, drivers] = await Promise.all([
    prisma.vehicle.findMany({ where: scopedWhere('vehicle', scope), select: { id: true, bgId: true, imei: true, plateNo: true, fleetNo: true } }),
    prisma.driver.findMany({ where: scopedWhere('driver', scope) }),
  ])
  const vehicleIds = vehicles.map(v => v.id)
  const driverIds = drivers.map(d => d.id)
  const [assignments, incidents] = await Promise.all([
    prisma.driverAssignment.findMany({ where: { vehicleId: { in: vehicleIds }, startDate: { lte: new Date(toTs * 1000) }, OR: [{ endDate: null }, { endDate: { gte: new Date((fromTs - DAY) * 1000) } }] } }),
    prisma.driverIncident.findMany({ where: { driverId: { in: driverIds }, date: { gte: new Date(fromTs * 1000), lte: new Date(toTs * 1000) } } }),
  ])

  const byImei = flespi.isConfigured() ? await flespi.deviceMap() : new Map()
  const digits = v => String(v ?? '').replace(/\D/g, '')
  const tracked = vehicles.map(v => ({ ...v, deviceId: byImei.get(digits(v.imei)) })).filter(v => v.deviceId !== undefined)
  const messages = await loadMessages(tracked.map(v => v.deviceId), fromTs, toTs)

  const ctx = {
    byTag: new Map(drivers.filter(d => d.ibuttonCode).map(d => [d.ibuttonCode, d])),
    assignByVehicle: new Map(),
  }
  for (const a of assignments) {
    if (!ctx.assignByVehicle.has(a.vehicleId)) ctx.assignByVehicle.set(a.vehicleId, [])
    ctx.assignByVehicle.get(a.vehicleId).push(a)
  }

  const tripsByDriver = new Map(driverIds.map(id => [id, []]))
  const vehiclesByDriver = new Map(driverIds.map(id => [id, new Set()]))
  const viaCount = new Map(driverIds.map(id => [id, { tag: 0, assignment: 0 }]))
  const unidentified = []
  for (const v of tracked) {
    const trips = deriveTrips(messages.get(v.deviceId) ?? [], { tzOffsetSec: UAE_OFFSET_SEC })
      .filter(t => t.startTs >= fromTs && t.startTs <= toTs)
    const loose = []
    for (const t of trips) {
      const c = creditTrip(t, v.id, ctx)
      if (c.driverId && tripsByDriver.has(c.driverId)) {
        tripsByDriver.get(c.driverId).push(t)
        vehiclesByDriver.get(c.driverId).add(v.plateNo || v.fleetNo || v.imei)
        viaCount.get(c.driverId)[c.via] += 1
      } else {
        loose.push({ ...t, tag: c.tag ?? null })
      }
    }
    if (loose.length) {
      const s = sumTrips(loose)
      unidentified.push({
        vehicleId: v.id, vehicle: v.plateNo || v.fleetNo || v.imei, trips: s.trips, distanceKm: s.distanceKm, driveSec: s.driveSec,
        unknownTags: [...new Set(loose.map(t => t.tag).filter(Boolean))],
      })
    }
  }

  const incidentsByDriver = new Map()
  for (const i of incidents) incidentsByDriver.set(i.driverId, (incidentsByDriver.get(i.driverId) ?? 0) + 1)

  const rows = drivers.map(d => {
    const trips = tripsByDriver.get(d.id)
    const t = sumTrips(trips)
    const fat = fatigueOf(trips, fatigue)
    return {
      driverId: d.id, driverNo: d.driverNo, name: d.name, status: d.status, bgId: d.bgId, photoKey: d.photoKey,
      department: d.department,
      trips: t.trips, distanceKm: t.distanceKm, driveSec: t.driveSec, idleSec: t.idleSec, nightSec: t.nightSec,
      avgSpeed: t.driveSec > 0 ? (t.distanceKm / t.driveSec) * 3600 : 0, maxSpeed: t.maxSpeed,
      overSpeedCount: t.overSpeedCount, hbCount: t.hbCount, haCount: t.haCount, hcCount: t.hcCount,
      xiCount: t.xiCount, xiSec: t.xiSec,
      vehicles: [...vehiclesByDriver.get(d.id)],
      identifiedBy: viaCount.get(d.id),
      fatigue: fat,
      incidents: incidentsByDriver.get(d.id) ?? 0,
      // A suspended driver whose tag was read was driving while off duty.
      suspendedDriving: d.status === 'Suspended' ? viaCount.get(d.id).tag : 0,
      nextExpiry: nextExpiry(d),
    }
  })
  return { drivers: rows, unidentified }
}

/** Current period with scores, risk and the trend against the period before it. */
export async function performanceReport(scope, fromTs, toTs) {
  const fatigue = await getFatigueSettings()
  const span = toTs - fromTs
  const [cur, prev] = await Promise.all([
    computePerformance(scope, fromTs, toTs, { fatigue }),
    computePerformance(scope, fromTs - span - 1, fromTs - 1, { fatigue }),
  ])
  const prevScore = new Map(prev.drivers.map(r => [r.driverId, safetyScore(r, r.fatigue, r.incidents)]))
  const drivers = cur.drivers.map(r => {
    const score = safetyScore(r, r.fatigue, r.incidents)
    const rating = score === null ? 'No driving' : score >= SCORE_BANDS.green ? 'Green' : score < SCORE_BANDS.red ? 'Red' : 'Yellow'
    return { ...r, safetyScore: score, previousScore: prevScore.get(r.driverId) ?? null, rating, ...riskProfile(r, r.fatigue, r.incidents, score, prevScore.get(r.driverId) ?? null) }
  })
  return { drivers, unidentified: cur.unidentified, fatigueRule: fatigue }
}
