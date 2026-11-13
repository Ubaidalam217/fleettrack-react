// Violation Details, Violation Locations, Violations Summary and Violation
// Statistics — the client's Ctrack samples (2026-11-13), from the events the
// server's alert engine raised (GET /api/alert-events).
//
// One violation per alert event: its rule's name is the Event, its span comes
// from utils/violationEpisodes.js, its driver is the one the engine recorded,
// else the driver at that moment from the tracks (utils/driverAtTime.js), else
// the vehicle's driver, else "No driver". Site is the vehicle's branch and
// Asset the vehicle.
//
// Ctrack's "Group By Entity: Driver" is our Report By: Driver; Report By:
// Vehicle groups by the asset instead. Everything is grouped by day (the day
// the violation began), as the samples are.

import { violationEpisode } from './violationEpisodes'
import { driverIdentity, driverPasses, NO_DRIVER } from './driverAtTime.js'

/** Alert types that report a state, not a violation: left out unless picked. */
export const NOT_VIOLATIONS = new Set(['ignition_on', 'ignition_off', 'geofence', 'geofence_enter', 'geofence_exit'])
export const isViolationType = type => !!type && !NOT_VIOLATIONS.has(type)

export const UNCATEGORIZED = 'UnCategorized'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = n => String(n).padStart(2, '0')

/** "13 Nov, 2026" */
export const ctrackDate = d => `${two(d.getDate())} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`
/** "04:07:27" */
export function ctrackTime(ts) {
  const d = new Date(ts * 1000)
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
/** "13 Nov, 2026 04:07:27" */
export const ctrackDateTime = ts => `${ctrackDate(new Date(ts * 1000))} ${ctrackTime(ts)}`
/** "00:05:37" — the hours keep counting past a day, as Ctrack's totals do. */
export function hhmmss(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
}

const dayKeyOf = ts => {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
const byText = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })

/** The Event column: the rule's name; the event's own title for a rule since deleted; the type last. */
export function eventName(e, ruleById, typeLabel = t => t) {
  const rule = e.alertId ? ruleById?.get(e.alertId) : null
  return rule?.name || String(e.title ?? '').replace(/\s*·\s*recorded$/, '').trim() || typeLabel(e.type)
}

/**
 * The Violations filter: every rule name the account has or the events carry,
 * with whether it counts as a violation by default (all but ignition and geo
 * zone enter / exit).
 *
 * @returns {{ name: string, type: string, byDefault: boolean }[]} by name
 */
export function violationNames(events, rules, typeLabel) {
  const ruleById = new Map((rules ?? []).map(r => [r.id, r]))
  const out = new Map()
  const add = (name, type) => {
    if (!name || out.has(name)) return
    out.set(name, { name, type, byDefault: isViolationType(type) })
  }
  for (const r of rules ?? []) {
    // Licence expiry watches paperwork, not how a vehicle is driven or kept.
    if (r.type !== 'license_expiry') add(r.name, r.type)
  }
  for (const e of events ?? []) add(eventName(e, ruleById, typeLabel), e.type)
  return [...out.values()].sort((a, b) => byText(a.name, b.name))
}

/**
 * Alert events + the vehicles' messages → one violation each, oldest first.
 *
 * @param {object[]} events     alert events (API shape)
 * @param {Map|null} byDevice   fetchMovementMessages' result, or null
 * @param {object}   opts
 * @param {object[]} opts.vehicles       the live vehicles (id = Flespi device id)
 * @param {object[]} [opts.rules]        alert rules ({ id, name, type, settings })
 * @param {(type) => string} [opts.typeLabel]
 * @param {Set<string>|null} [opts.names]  Event names to keep; null = every violation type
 * @param {(vehicle, messages) => (ts) => {key,label}} [opts.driverAt]
 * @param {(vehicle) => {key,label}|null} [opts.assignedFor]
 * @param {Set|null} [opts.driverFilter]  driver keys to keep (null = all)
 * @param {(vehicle) => string} [opts.siteOf]
 * @param {(who) => string} [opts.departmentOf]  a driver's category ('' = none)
 * @param {(event) => ((msg) => boolean)|null} [opts.zoneFor]  zone speed: inside its zone
 */
export function buildViolations(events, byDevice, opts = {}) {
  const {
    vehicles = [], rules = [], typeLabel = t => t, names = null, driverAt = null, assignedFor = null,
    driverFilter = null, siteOf = () => '', departmentOf = () => '', zoneFor = null,
  } = opts
  const ruleById = new Map(rules.map(r => [r.id, r]))
  const metaById = new Map(vehicles.map(v => [v.id, v]))
  const timelines = new Map()
  const messagesOf = id => byDevice?.get(id)?.messages ?? []
  const timelineOf = (id, meta) => {
    if (!driverAt) return null
    if (!timelines.has(id)) timelines.set(id, driverAt(meta, messagesOf(id)))
    return timelines.get(id)
  }

  const out = []
  for (const e of events ?? []) {
    if (e.deviceId == null) continue
    const deviceId = Number(e.deviceId)
    const name = eventName(e, ruleById, typeLabel)
    if (names ? !names.has(name) : !isViolationType(e.type)) continue
    const rule = e.alertId ? ruleById.get(e.alertId) : null
    const ep = violationEpisode(e, messagesOf(deviceId), {
      limitKmh: e.type === 'overspeed' ? Number(rule?.settings?.speedKmh) || null : null,
      inZone: e.type === 'geofence_speed' ? zoneFor?.(e) ?? null : null,
      harshMs2: Number(rule?.settings?.thresholdMs2) || null,
    })
    if (ep.fromTs == null) continue

    const meta = metaById.get(deviceId)
    const asset = meta?.master?.plateNo || e.vehicle?.plateNo || e.vehicle?.fleetNo || meta?.name || `Device ${deviceId}`
    const who = driverIdentity(e.driver) ?? timelineOf(deviceId, meta)?.(ep.fromTs) ?? assignedFor?.(meta) ?? NO_DRIVER
    if (!driverPasses(who, driverFilter)) continue
    const site = siteOf(meta) || ''

    out.push({
      key: e.id,
      deviceId,
      alertId: e.alertId ?? null,
      type: e.type,
      severity: e.severity,
      message: e.message || '',
      value: e.value,
      event: name,
      fromTs: ep.fromTs,
      toTs: ep.toTs,
      durationSec: ep.durationSec,
      speed: ep.speed,
      lat: ep.lat,
      lng: ep.lng,
      source: ep.source,
      asset,
      site,
      driver: who.label,
      driverKey: who.key,
      department: (who === NO_DRIVER ? '' : departmentOf(who)) || UNCATEGORIZED,
      siteCategory: site || UNCATEGORIZED,
    })
  }
  return out.sort((a, b) => a.fromTs - b.fromTs || byText(a.event, b.event))
}

/** Days in order, each with its violations: [{ dayKey, date, label, rows }]. */
export function groupByDay(violations) {
  const days = new Map()
  for (const v of violations) {
    const k = dayKeyOf(v.fromTs)
    if (!days.has(k)) {
      const d = new Date(v.fromTs * 1000)
      days.set(k, { dayKey: k, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), label: ctrackDate(d), rows: [] })
    }
    days.get(k).rows.push(v)
  }
  return [...days.values()].sort((a, b) => a.date - b.date)
}

const entityOf = (v, by) => (by === 'driver' ? v.driver : v.asset)

/** Totals of a set of violations: count, summed duration, worst speed, distinct events. */
export function violationTotals(violations) {
  let durationSec = 0
  let maxSpeed = null
  const events = new Set()
  for (const v of violations) {
    durationSec += v.durationSec || 0
    if (v.speed != null && (maxSpeed === null || v.speed > maxSpeed)) maxSpeed = v.speed
    events.add(v.event)
  }
  return { count: violations.length, durationSec, maxSpeed, events: events.size }
}

/**
 * Violation Details / Locations: per day, every violation, by driver (or asset)
 * and then time — the order of the samples.
 */
export function detailDays(violations, { by = 'driver' } = {}) {
  return groupByDay(violations).map(d => ({
    ...d,
    rows: [...d.rows].sort((a, b) => byText(entityOf(a, by), entityOf(b, by)) || a.fromTs - b.fromTs),
    totals: violationTotals(d.rows),
  }))
}

/**
 * Violations Summary: per day, one line per driver, asset and event, with the
 * summed duration, how many and the worst speed. The sample orders the lines
 * by asset and then event, whatever the entity.
 */
export function summaryDays(violations) {
  return groupByDay(violations).map(d => {
    const lines = new Map()
    for (const v of d.rows) {
      const k = `${v.driverKey}\u0000${v.deviceId}\u0000${v.event}`
      let l = lines.get(k)
      if (!l) {
        l = { key: `${d.dayKey}-${k}`, driver: v.driver, driverKey: v.driverKey, site: v.site, asset: v.asset, event: v.event, durationSec: 0, count: 0, maxSpeed: null }
        lines.set(k, l)
      }
      l.durationSec += v.durationSec || 0
      l.count += 1
      if (v.speed != null && (l.maxSpeed === null || v.speed > l.maxSpeed)) l.maxSpeed = v.speed
    }
    const rows = [...lines.values()].sort((a, b) =>
      byText(a.asset, b.asset) || byText(a.event, b.event) || byText(a.driver, b.driver))
    return {
      ...d,
      lines: rows,
      totals: { lines: rows.length, durationSec: rows.reduce((s, l) => s + l.durationSec, 0), count: d.rows.length },
    }
  })
}

/**
 * Violation Statistics: per day, per category — the driver's department
 * (Report By: Driver) or the vehicle's site (Report By: Vehicle) — how many
 * violations and how long. Alphabetical, "UnCategorized" last.
 */
export function statisticsDays(violations, { by = 'driver' } = {}) {
  return groupByDay(violations).map(d => {
    const cats = new Map()
    for (const v of d.rows) {
      const c = by === 'driver' ? v.department : v.siteCategory
      const row = cats.get(c) ?? { key: `${d.dayKey}-${c}`, category: c, count: 0, durationSec: 0 }
      row.count += 1
      row.durationSec += v.durationSec || 0
      cats.set(c, row)
    }
    const rows = [...cats.values()].sort((a, b) =>
      (a.category === UNCATEGORIZED) - (b.category === UNCATEGORIZED) || byText(a.category, b.category))
    return { ...d, categories: rows }
  })
}
