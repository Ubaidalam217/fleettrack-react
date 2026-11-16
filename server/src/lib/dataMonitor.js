/**
 * Device Data Monitor (client, 2026-11-16): "If any device sends a lot of data
 * it should report to the app and take some action", and see which device or
 * source makes a lot of requests.
 *
 * Reads the counters of lib/trafficMonitor.js once a minute and:
 *
 *   - flags a tracker in DATA OVERLOAD when, over the last hour, it
 *       (rate)       sent more than rateMultiplier x its own median hour of the
 *                    last 7 days AND more than rateFloorPerHour messages, or
 *       (interval)   averaged a gap under minIntervalSec in each of the last
 *                    fastMinutes minutes, or
 *       (duplicates) repeated a timestamp in more than duplicatePct of at least
 *                    duplicateMinMsgs messages;
 *   - flags OUR Flespi usage in REQUEST OVERLOAD when the last 60 s reached
 *     requestWarnPct of the plan's per-minute limit, or Flespi answered 429.
 *
 * Each overload is ONE AlertEvent from start to end, like the alert engine's
 * episodes (occurredAt / endedAt / durationSec / peakValue): raised once,
 * its peak raised while it lasts, and closed once it has been back to normal
 * for clearMinutes — a new one can only start after that. The events have no BG
 * (bgId null), so only a Super Admin's bell and Notifications show them; with
 * "notifyBgAdmins" on, a device overload is raised in its vehicle's own BG too.
 *
 * What it never does: send anything to a device or to Flespi. The fix for a
 * device (its reporting interval) is written out as a recommendation, for the
 * client to approve.
 */

import prisma from '../prisma.js'
import env from '../env.js'
import { pushEvents } from './push.js'
import {
  MIN_MS, HOUR_MS, DEVICE_FIELDS, zeroDevice, getSettings, loadSettings, flushCounters, pruneOld,
  deviceSnapshot, unflushedDeviceHours, requestSnapshot, unflushedRequestHours, flespiLoad, takeLoadPeak, sqlTs,
  pruneIdleDevices,
} from './trafficMonitor.js'
import { vehicleLabel } from './vehicleLabel.js'

export const DATA_OVERLOAD = 'data_overload'
export const REQUEST_OVERLOAD = 'request_overload'
export const SYSTEM_EVENT_TYPES = Object.freeze([DATA_OVERLOAD, REQUEST_OVERLOAD])

/** The median needs this many hours of history; before that only the floor applies. */
const BASELINE_MIN_HOURS = 24
const BASELINE_DAYS = 7
/** The monitor holds an open episode this long after a restart (its counts start empty). */
const WARM_UP_MS = 60 * MIN_MS
/** A peak is written to the event when it has grown this much since the last write. */
const PEAK_WRITE_GROWTH = 1.1

const digits = v => String(v ?? '').replace(/\D/g, '')
const round1 = v => Math.round(v * 10) / 10
/** 8192 → "8 KB", 9_123_456 → "8.7 MiB". */
const size = b => (b < 102_400 ? `${Math.round(b / 1024)} KB` : `${round1(b / 1048576)} MiB`)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "45 s", "5 min", "1 h 20 min". */
export function fmtSec(sec) {
  const s = Math.max(0, Math.round(sec))
  if (s < 90) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

// ── rules (pure) ─────────────────────────────────────────────────────────────

const sumInto = (acc, b) => { for (const f of DEVICE_FIELDS) acc[f] += b[f] ?? 0; return acc }

/** Was this minute's traffic a fast interval: enough messages, and a short average gap? */
export const isFastMinute = (b, s) =>
  !!b && (b.msgs - (b.exactDuplicates ?? 0)) >= Math.ceil(60 / s.minIntervalSec) &&
  b.intervalCount > 0 && b.intervalSum / b.intervalCount < s.minIntervalSec

/**
 * One device's last hour from its minute buckets (arrival time): the summed
 * counts and how many complete minutes in a row, up to the last one, were fast.
 * The minute filling now counts toward the hour but not toward the run.
 *
 * Exact copies are not the tracker's doing: a byte-identical message — Flespi's
 * own server.timestamp included — is the HTTP stream re-sending a batch we were
 * slow to answer. So `msgs` here is what the TRACKER sent (received less exact
 * copies) and `duplicatePct` its own repeats: the same timestamp again with
 * different content, which is what a tracker resending a record looks like
 * (Flespi stamps each delivery with a new server.timestamp).
 */
export function deviceMetrics(minutes, nowMs, s) {
  const cur = Math.floor(nowMs / MIN_MS) * MIN_MS
  const hour = zeroDevice()
  const byStart = new Map()
  for (const b of minutes ?? []) {
    if (b.start > cur - 60 * MIN_MS && b.start <= cur) {
      sumInto(hour, b)
      byStart.set(b.start, b)
    }
  }
  let fastRun = 0
  for (let k = 1; k <= 60 && isFastMinute(byStart.get(cur - k * MIN_MS), s); k++) fastRun++
  const lastMinute = byStart.get(cur - MIN_MS)
  const sent = hour.msgs - hour.exactDuplicates
  const repeats = hour.duplicates - hour.exactDuplicates
  return {
    ...hour,
    received: hour.msgs,
    msgs: sent,
    repeats,
    fastRun,
    perMinuteNow: lastMinute ? lastMinute.msgs - lastMinute.exactDuplicates : 0,
    avgIntervalSec: hour.intervalCount ? hour.intervalSum / hour.intervalCount : null,
    duplicatePct: sent ? (repeats / sent) * 100 : 0,
  }
}

/** Messages per hour above which the rate rule fires, for a device's baseline. */
export function rateThreshold(baseline, s) {
  const median = baseline && baseline.hours >= BASELINE_MIN_HOURS ? baseline.median : null
  return Math.max(s.rateFloorPerHour, median === null ? 0 : s.rateMultiplier * median)
}

/**
 * Which rules a device's last hour breaks, and its status:
 * overload (a rule fires), high (half way to one) or normal.
 */
export function classify(m, baseline, s) {
  const threshold = rateThreshold(baseline, s)
  const causes = []
  if (m.msgs > threshold) causes.push('rate')
  if (m.fastRun >= s.fastMinutes) causes.push('interval')
  const dupsCount = m.msgs >= s.duplicateMinMsgs
  if (dupsCount && m.duplicatePct > s.duplicatePct) causes.push('duplicates')
  const high = !causes.length && (
    m.msgs > threshold * 0.5 ||
    m.fastRun >= Math.ceil(s.fastMinutes / 2) ||
    (dupsCount && m.duplicatePct > s.duplicatePct / 2)
  )
  return { status: causes.length ? 'overload' : high ? 'high' : 'normal', causes, threshold }
}

const ASK_FIRST = 'Ask the client before changing any device setting — FleetmaxX has not sent anything to the device.'

/**
 * The likely cause of a device's traffic and the fix to recommend, in words.
 * Read off the same hour: backlog uploads, reconnects, repeats, the interval,
 * and how much of it was sent parked.
 */
export function diagnose(m, s, { normalPerHour = null } = {}) {
  const msgs = m.msgs || 0
  const share = n => (msgs ? n / msgs : 0)
  const iv = m.avgIntervalSec
  const plan = `recommended: ${fmtSec(s.recommendMovingSec)} while moving, ${fmtSec(s.recommendParkedSec)} parked`
  if (m.reconnects >= 12) {
    return { cause: 'reconnects', text: `The tracker reconnected ${m.reconnects} times in the last hour; each new connection can resend data. Check the SIM signal, the APN/server settings and the power wiring. ${ASK_FIRST}` }
  }
  if (msgs >= s.duplicateMinMsgs && m.duplicatePct > s.duplicatePct) {
    return { cause: 'duplicates', text: `${Math.round(m.duplicatePct)}% of the tracker's messages repeat a timestamp it already sent — it is resending records. Check the device's acknowledgement (ACK) setting and firmware. ${ASK_FIRST}` }
  }
  if (msgs && share(m.late) > 0.5) {
    return { cause: 'backlog', text: `Most messages arrived more than 10 min after they were recorded: the tracker is uploading data it stored while offline. This usually settles by itself; if it keeps happening, check the SIM and coverage. ${ASK_FIRST}` }
  }
  if (iv !== null && iv < s.minIntervalSec) {
    const parked = share(m.parked) > 0.6
    return {
      cause: parked ? 'interval-parked' : 'interval',
      text: `Reporting interval looks like ~${fmtSec(iv)}${parked ? ' even while parked' : ''} (${plan}). ${ASK_FIRST}`,
    }
  }
  if (share(m.parked) > 0.6) {
    return { cause: 'drift', text: `Most messages were sent standing still with the ignition off — GPS drift can trigger distance/angle reports. A parked (stop) mode reporting every ${fmtSec(s.recommendParkedSec)}, or higher distance/angle thresholds, is recommended. ${ASK_FIRST}` }
  }
  const usual = normalPerHour ? ` (its usual is ~${Math.round(normalPerHour)}/h)` : ''
  return { cause: 'volume', text: `Sending ${msgs} messages an hour${usual}${iv !== null ? `, about every ${fmtSec(iv)}` : ''}. Check the reporting interval (${plan}) and event triggers such as inputs toggling or the accelerometer. ${ASK_FIRST}` }
}

/**
 * One minute of an episode: open it when the condition starts, raise its peak
 * while it lasts, close it once the condition has been gone for clearMinutes.
 * While it is open nothing new is raised — one event per episode.
 * `warm` false (just restarted, counts still filling) never closes one.
 *
 * @returns {{ ep: object|null, action: 'open'|'peak'|'close'|null, closed?: object }}
 */
export function stepEpisode(ep, over, value, nowMs, s, { warm = true } = {}) {
  if (over) {
    if (!ep) return { ep: { startMs: nowMs, peak: value, clearSince: null }, action: 'open' }
    const next = { ...ep, clearSince: null }
    if (value > (ep.peak ?? -Infinity)) {
      next.peak = value
      return { ep: next, action: 'peak' }
    }
    return { ep: next, action: null }
  }
  if (!ep) return { ep: null, action: null }
  const clearSince = ep.clearSince ?? nowMs
  if (warm && nowMs - clearSince >= s.clearMinutes * MIN_MS) {
    return { ep: null, action: 'close', closed: { ...ep, endMs: clearSince } }
  }
  return { ep: { ...ep, clearSince }, action: null }
}

/** Calls and bytes of the last hour per source / endpoint / device, busiest first. */
export function requestBreakdown(minutes, nowMs) {
  const cur = Math.floor(nowMs / MIN_MS) * MIN_MS
  const totals = { calls: 0, bytes: 0, throttled: 0, shed: 0, local: 0 }
  const by = { source: new Map(), endpoint: new Map(), device: new Map() }
  const perMinute = []
  for (const b of minutes ?? []) {
    if (b.start <= cur - 60 * MIN_MS || b.start > cur) continue
    for (const f of Object.keys(totals)) totals[f] += b[f]
    perMinute.push({ at: new Date(b.start).toISOString(), calls: b.calls, bytes: b.bytes, throttled: b.throttled, shed: b.shed, local: b.local })
    for (const kind of Object.keys(by)) {
      for (const [key, c] of b.by[kind]) {
        let t = by[kind].get(key)
        if (!t) by[kind].set(key, (t = { calls: 0, bytes: 0, throttled: 0, shed: 0, local: 0 }))
        for (const f of Object.keys(t)) t[f] += c[f]
      }
    }
  }
  const sorted = map => [...map].map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => b.calls - a.calls || b.bytes - a.bytes || b.local + b.shed - a.local - a.shed)
  return { totals, perMinute, source: sorted(by.source), endpoint: sorted(by.endpoint), device: sorted(by.device) }
}

// ── state ────────────────────────────────────────────────────────────────────

/** deviceId → { eventId, startMs, peak, writtenPeak, clearSince } of the open overloads. */
const deviceEpisodes = new Map()
let requestEpisode = null
/** deviceId → { median, hours } from DeviceTrafficStat, refreshed hourly. */
let baselines = new Map()
let baselineAt = 0
let monitorStartMs = Date.now()
let ticks = 0

export const getBaselines = () => baselines

/** Each device's median hour over the last 7 days (of the hours it sent anything). */
export async function refreshBaselines(nowMs = Date.now()) {
  const to = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const from = to - BASELINE_DAYS * 24 * HOUR_MS
  const rows = await prisma.$queryRaw`
    SELECT "deviceId", percentile_cont(0.5) WITHIN GROUP (ORDER BY "msgs") AS median, count(*)::int AS hours
    FROM "DeviceTrafficStat" WHERE "hour" >= ${sqlTs(from)} AND "hour" < ${sqlTs(to)}
    GROUP BY "deviceId"`
  baselines = new Map(rows.map(r => [Number(r.deviceId), { median: Number(r.median), hours: Number(r.hours) }]))
  baselineAt = nowMs
  return baselines
}

/** Pick the open episodes back up after a restart (their events are still open). */
export async function loadOpenEpisodes() {
  const open = await prisma.alertEvent.findMany({
    where: { type: { in: SYSTEM_EVENT_TYPES }, endedAt: null },
    orderBy: { occurredAt: 'asc' },
  })
  for (const e of open) {
    const ep = { eventId: e.id, startMs: e.occurredAt.getTime(), peak: e.peakValue ?? e.value ?? 0, writtenPeak: e.peakValue ?? e.value ?? 0, clearSince: null }
    if (e.type === REQUEST_OVERLOAD) requestEpisode = ep
    else if (e.deviceId != null) deviceEpisodes.set(e.deviceId, ep)
  }
  return open.length
}

/** The vehicle a tracker is fitted to, by its IMEI (Vehicle.imei is digits only). */
async function vehicleForIdent(ident) {
  const imei = digits(ident)
  if (!imei) return null
  return prisma.vehicle.findUnique({ where: { imei }, select: { id: true, bgId: true, plateNo: true, fleetNo: true } })
}

const CAUSE_TEXT = {
  rate: (m, c) => `${m.msgs} messages in the last hour (limit ${Math.round(c.threshold)}/h)`,
  interval: (m, c, s) => `an average gap under ${s.minIntervalSec} s for ${m.fastRun} min`,
  duplicates: m => `${Math.round(m.duplicatePct)}% repeated timestamps`,
}

async function openDeviceEpisode(deviceId, ident, m, c, s, startMs) {
  const v = await vehicleForIdent(ident)
  const name = v ? (vehicleLabel(v) || ident) : `Device ${deviceId}${ident ? ` (${ident})` : ''}`
  const why = c.causes.map(k => CAUSE_TEXT[k](m, c, s)).join('; ')
  const fix = diagnose(m, s, { normalPerHour: baselines.get(deviceId)?.median ?? null })
  return prisma.alertEvent.create({
    data: {
      alertId: null,
      bgId: s.notifyBgAdmins ? v?.bgId ?? null : null,
      vehicleId: v?.id ?? null,
      deviceId,
      type: DATA_OVERLOAD,
      severity: 'High',
      title: 'Device data overload',
      message: `${name}: ${why}. ${fix.text}`,
      value: m.msgs,
      occurredAt: new Date(startMs),
    },
  })
}

function topSources(breakdown, labels, n = 3) {
  return breakdown.source.slice(0, n).filter(r => r.calls)
    .map(r => `${labels.get(r.key) ?? r.key} (${plural(r.calls, 'call')}, ${size(r.bytes)})`).join(', ')
}

async function openRequestEpisode(load, s, nowMs) {
  const { minutes, labels } = requestSnapshot()
  const b = requestBreakdown(minutes, nowMs)
  const busiest = topSources(b, labels)
  const throttled = b.perMinute.slice(-1)[0]?.throttled ?? 0
  return prisma.alertEvent.create({
    data: {
      alertId: null,
      bgId: null,
      type: REQUEST_OVERLOAD,
      severity: load.coolingMs > 0 || load.throttled ? 'Critical' : 'High',
      title: 'Flespi request overload',
      message: `FleetmaxX's Flespi usage reached ${Math.round(load.pct)}% of the plan's per-minute limit ` +
        `(${load.calls} of ${s.flespiCallsPerMin} calls, ${size(load.bytes)} of ${s.flespiMiBPerMin} MiB in the last 60 s)` +
        `${load.coolingMs > 0 || load.throttled ? `; Flespi refused requests (429)${throttled ? ` ${throttled} time${throttled === 1 ? '' : 's'} this minute` : ''}` : ''}.` +
        `${busiest ? ` Busiest in the last hour: ${busiest}.` : ''}` +
        `${s.protectFlespi ? ' Browser live-data requests are being held back with "busy, retry" until it drops.' : ''}`,
      value: Math.round(load.pct),
      occurredAt: new Date(nowMs),
    },
  })
}

async function closeEpisode(ep) {
  const endMs = Math.max(ep.startMs, ep.endMs)
  await prisma.alertEvent.updateMany({
    where: { id: ep.eventId, endedAt: null },
    data: {
      endedAt: new Date(endMs),
      durationSec: Math.round((endMs - ep.startMs) / 1000),
      peakValue: Math.round(ep.peak),
    },
  })
}

async function writePeak(ep) {
  if (ep.peak < (ep.writtenPeak || 0) * PEAK_WRITE_GROWTH) return ep
  await prisma.alertEvent.update({ where: { id: ep.eventId }, data: { peakValue: Math.round(ep.peak) } }).catch(() => {})
  return { ...ep, writtenPeak: ep.peak }
}

/**
 * One pass: every device's last hour against the rules, our Flespi usage
 * against its limits; events opened, peaked and closed. Returns the events
 * created (pushed to the phones that may see them — Super Admins).
 */
export async function monitorTick(nowMs = Date.now()) {
  const s = getSettings()
  const warm = nowMs - monitorStartMs >= WARM_UP_MS
  const created = []

  const snap = deviceSnapshot()
  const ids = new Set([...snap.keys(), ...deviceEpisodes.keys()])
  for (const id of ids) {
    const d = snap.get(id)
    const m = deviceMetrics(d?.minutes, nowMs, s)
    const c = classify(m, baselines.get(id), s)
    const ep = deviceEpisodes.get(id)
    const step = stepEpisode(ep, c.status === 'overload', m.msgs, nowMs, s, { warm })
    try {
      if (step.action === 'open') {
        const e = await openDeviceEpisode(id, d?.ident, m, c, s, nowMs)
        created.push(e)
        deviceEpisodes.set(id, { ...step.ep, eventId: e.id, writtenPeak: m.msgs })
      } else if (step.action === 'close') {
        await closeEpisode({ ...step.closed, eventId: ep.eventId })
        deviceEpisodes.delete(id)
      } else if (step.action === 'peak') {
        deviceEpisodes.set(id, await writePeak({ ...step.ep, eventId: ep.eventId, writtenPeak: ep.writtenPeak }))
      } else if (step.ep) {
        deviceEpisodes.set(id, { ...step.ep, eventId: ep.eventId, writtenPeak: ep.writtenPeak })
      }
    } catch (err) {
      console.error(`[datamon] device ${id}: ${String(err?.message ?? err).slice(0, 200)}`)
    }
  }

  // The worst moment since the last pass, not just this instant: a burst between passes counts.
  const load = takeLoadPeak(nowMs)
  const over = load.pct >= s.requestWarnPct || load.coolingMs > 0 || load.throttled || load.shed
  const step = stepEpisode(requestEpisode, over, Math.round(load.pct), nowMs, s, { warm: true })
  try {
    if (step.action === 'open') {
      const e = await openRequestEpisode(load, s, nowMs)
      created.push(e)
      requestEpisode = { ...step.ep, eventId: e.id, writtenPeak: step.ep.peak }
    } else if (step.action === 'close') {
      await closeEpisode({ ...step.closed, eventId: requestEpisode.eventId })
      requestEpisode = null
    } else if (step.action === 'peak') {
      requestEpisode = await writePeak({ ...step.ep, eventId: requestEpisode.eventId, writtenPeak: requestEpisode.writtenPeak })
    } else if (step.ep) {
      requestEpisode = { ...step.ep, eventId: requestEpisode.eventId, writtenPeak: requestEpisode.writtenPeak }
    }
  } catch (err) {
    console.error(`[datamon] requests: ${String(err?.message ?? err).slice(0, 200)}`)
  }

  if (created.length) pushEvents(created)
  return created
}

// ── the job ──────────────────────────────────────────────────────────────────

let running = false

async function tick() {
  if (running) return
  running = true
  const now = Date.now()
  try {
    if (now - baselineAt >= HOUR_MS) {
      await refreshBaselines(now).catch(err => console.error('[datamon] baselines:', err?.message))
      await pruneOld(now).catch(err => console.error('[datamon] prune:', err?.message))
    }
    const created = await monitorTick(now)
    if (created.length) console.log(`[datamon] ${created.length} overload event(s) raised`)
    if (++ticks % 5 === 0) {
      await flushCounters()
      pruneIdleDevices(now)
    }
  } catch (err) {
    console.error(`[datamon] pass failed: ${err?.message}`)
  } finally {
    running = false
  }
}

/** Start the monitor (every minute). Returns a stop function that writes what is counted. */
export function startDataMonitor() {
  if (env.isTest) return async () => {}
  monitorStartMs = Date.now()
  loadSettings()
    .then(loadOpenEpisodes)
    .catch(err => console.error('[datamon] start:', err?.message))
  const timer = setInterval(tick, MIN_MS)
  timer.unref?.()
  return async () => {
    clearInterval(timer)
    await flushCounters().catch(() => {})
  }
}

/** Test hooks. */
export function __resetDataMonitor({ startMs = Date.now() - WARM_UP_MS } = {}) {
  deviceEpisodes.clear()
  requestEpisode = null
  baselines = new Map()
  baselineAt = 0
  monitorStartMs = startMs
  ticks = 0
}
export const __episodes = () => ({ devices: deviceEpisodes, request: requestEpisode })

// ── views (Settings › Device Data Monitor) ──────────────────────────────────

const num = v => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0))

/**
 * Every tracker we know — from the webhook's counts, the hourly rows and the
 * device states — with its last hour, last 24 h, status and the fix to
 * recommend, busiest and worst first.
 */
export async function devicesView(nowMs = Date.now()) {
  const s = getSettings()
  const hourNow = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const since24 = hourNow - 23 * HOUR_MS
  const [rows, states, spikes] = await Promise.all([
    prisma.deviceTrafficStat.findMany({ where: { hour: { gte: new Date(since24) } } }),
    prisma.deviceState.findMany({ select: { deviceId: true, ident: true, ts: true } }),
    prisma.alertEvent.groupBy({ by: ['deviceId'], where: { type: DATA_OVERLOAD, deviceId: { not: null } }, _max: { occurredAt: true }, _count: { _all: true } }),
  ])

  // deviceId → hourStart → counts (stored + not yet stored)
  const hours = new Map()
  const addHour = (id, hour, c) => {
    if (hour < since24) return
    let byHour = hours.get(id)
    if (!byHour) hours.set(id, (byHour = new Map()))
    const cur = byHour.get(hour) ?? zeroDevice()
    for (const f of DEVICE_FIELDS) cur[f] += num(c[f])
    byHour.set(hour, cur)
  }
  for (const r of rows) addHour(r.deviceId, r.hour.getTime(), r)
  for (const [id, byHour] of unflushedDeviceHours()) for (const [hour, c] of byHour) addHour(id, hour, c)

  const snap = deviceSnapshot()
  const stateOf = new Map(states.map(st => [st.deviceId, st]))
  const spikeOf = new Map(spikes.map(r => [r.deviceId, { at: r._max.occurredAt, count: r._count._all }]))
  const ids = new Set([...snap.keys(), ...hours.keys(), ...stateOf.keys(), ...deviceEpisodes.keys()])

  const identOf = id => snap.get(id)?.ident ?? stateOf.get(id)?.ident ?? null
  const imeis = [...ids].map(id => digits(identOf(id))).filter(Boolean)
  const vehicles = imeis.length
    ? await prisma.vehicle.findMany({
      where: { imei: { in: imeis } },
      select: { id: true, imei: true, plateNo: true, fleetNo: true, bg: { select: { name: true } } },
    })
    : []
  const vehicleOf = new Map(vehicles.map(v => [v.imei, v]))

  const list = []
  for (const id of ids) {
    const d = snap.get(id)
    const m = deviceMetrics(d?.minutes, nowMs, s)
    const base = baselines.get(id) ?? null
    const c = classify(m, base, s)
    const ep = deviceEpisodes.get(id)
    const status = ep ? 'overload' : c.status
    const byHour = hours.get(id) ?? new Map()
    const day = zeroDevice()
    for (const h of byHour.values()) sumInto(day, h)
    const spark = []
    for (let h = since24; h <= hourNow; h += HOUR_MS) {
      const c = byHour.get(h)
      spark.push(c ? c.msgs - c.exactDuplicates : 0)
    }
    const ident = identOf(id)
    const v = vehicleOf.get(digits(ident))
    const lastTs = d?.lastTs ?? stateOf.get(id)?.ts ?? null
    list.push({
      deviceId: id,
      ident,
      vehicle: v ? { id: v.id, plateNo: v.plateNo, fleetNo: v.fleetNo, bgName: v.bg?.name ?? null } : null,
      lastMessageAt: lastTs ? new Date(lastTs * 1000).toISOString() : null,
      status,
      causes: c.causes,
      lastHour: {
        msgs: m.msgs, received: m.received, bytes: m.bytes, perMinuteNow: m.perMinuteNow,
        avgIntervalSec: m.avgIntervalSec === null ? null : round1(m.avgIntervalSec),
        duplicatePct: round1(m.duplicatePct), duplicates: m.duplicates, exactDuplicates: m.exactDuplicates,
        late: m.late, parked: m.parked, reconnects: m.reconnects, fastRun: m.fastRun,
      },
      day: {
        msgs: day.msgs - day.exactDuplicates, received: day.msgs, bytes: day.bytes,
        avgIntervalSec: day.intervalCount ? round1(day.intervalSum / day.intervalCount) : null,
        duplicatePct: day.msgs - day.exactDuplicates ? round1(((day.duplicates - day.exactDuplicates) / (day.msgs - day.exactDuplicates)) * 100) : 0,
        exactDuplicates: day.exactDuplicates,
      },
      spark,
      baselinePerHour: base && base.hours >= BASELINE_MIN_HOURS ? round1(base.median) : null,
      thresholdPerHour: Math.round(c.threshold),
      recommendation: status !== 'normal' ? diagnose(m, s, { normalPerHour: base?.median ?? null }) : null,
      episode: ep ? { since: new Date(ep.startMs).toISOString(), peakPerHour: Math.round(ep.peak), eventId: ep.eventId } : null,
      lastSpikeAt: spikeOf.get(id)?.at?.toISOString?.() ?? null,
      spikes: spikeOf.get(id)?.count ?? 0,
    })
  }
  const rank = { overload: 0, high: 1, normal: 2 }
  list.sort((a, b) => rank[a.status] - rank[b.status] || b.lastHour.msgs - a.lastHour.msgs || b.day.msgs - a.day.msgs || a.deviceId - b.deviceId)

  const totals = list.reduce((t, r) => {
    t.msgsLastHour += r.lastHour.msgs
    t.bytesLastHour += r.lastHour.bytes
    t.droppedLastHour += r.lastHour.exactDuplicates
    t.msgsDay += r.day.msgs
    t[r.status]++
    return t
  }, { msgsLastHour: 0, bytesLastHour: 0, droppedLastHour: 0, msgsDay: 0, overload: 0, high: 0, normal: 0 })

  return { generatedAt: new Date(nowMs).toISOString(), monitoringSince: new Date(monitorStartMs).toISOString(), settings: s, totals, devices: list }
}

const JOB_LABELS = {
  server: 'Server (other)',
  public: 'Public share links',
}

/** Readable names for source keys: a user's email and role, a job's name. */
async function sourceLabels(keys, known) {
  const userIds = keys.filter(k => k.startsWith('user:')).map(k => k.slice(5))
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, role: true, shortName: true } })
    : []
  const byId = new Map(users.map(u => [u.id, u]))
  const out = new Map()
  for (const k of keys) {
    if (k.startsWith('user:')) {
      const u = byId.get(k.slice(5))
      out.set(k, { label: u?.email ?? known.get(k) ?? 'Deleted user', kind: 'user', role: u?.role ?? null, name: u?.shortName ?? null })
    } else {
      out.set(k, { label: known.get(k) ?? JOB_LABELS[k] ?? k.replace(/^job:/, ''), kind: k.startsWith('job:') ? 'job' : 'other', role: null, name: null })
    }
  }
  return out
}

/**
 * Our Flespi usage: the last 60 s against the limits, the last hour by
 * source / endpoint / device (memory), and the last 24 h by hour (stored).
 */
export async function requestsView(nowMs = Date.now()) {
  const s = getSettings()
  const load = flespiLoad(nowMs)
  const { minutes, labels } = requestSnapshot()
  const b = requestBreakdown(minutes, nowMs)

  const hourNow = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const since24 = hourNow - 23 * HOUR_MS
  const stored = await prisma.flespiRequestStat.findMany({ where: { hour: { gte: new Date(since24) }, kind: 'source' } })
  const hourly = new Map()
  const day = new Map() // source → counts over 24 h
  const add = (hour, key, c) => {
    const h = hourly.get(hour) ?? { calls: 0, bytes: 0, throttled: 0, shed: 0, local: 0 }
    const t = day.get(key) ?? { calls: 0, bytes: 0, throttled: 0, shed: 0, local: 0 }
    for (const f of Object.keys(h)) { h[f] += num(c[f]); t[f] += num(c[f]) }
    hourly.set(hour, h)
    day.set(key, t)
  }
  for (const r of stored) add(r.hour.getTime(), r.key, r)
  for (const r of unflushedRequestHours().values()) if (r.kind === 'source' && r.hour >= since24) add(r.hour, r.key, r)
  const hours = []
  for (let h = since24; h <= hourNow; h += HOUR_MS) hours.push({ at: new Date(h).toISOString(), ...(hourly.get(h) ?? { calls: 0, bytes: 0, throttled: 0, shed: 0, local: 0 }) })

  const sourceKeys = [...new Set([...b.source.map(r => r.key), ...day.keys()])]
  const names = await sourceLabels(sourceKeys, labels)
  const named = r => ({ ...r, ...(names.get(r.key) ?? { label: r.key }) })

  // Device keys that are ids get their vehicle's name.
  const ids = b.device.map(r => r.key).filter(k => /^\d+$/.test(k)).map(Number)
  const states = ids.length ? await prisma.deviceState.findMany({ where: { deviceId: { in: ids } }, select: { deviceId: true, ident: true } }) : []
  const imeiOf = new Map(states.map(st => [String(st.deviceId), digits(st.ident)]))
  const vehicles = states.length
    ? await prisma.vehicle.findMany({ where: { imei: { in: [...imeiOf.values()].filter(Boolean) } }, select: { imei: true, plateNo: true, fleetNo: true } })
    : []
  const vByImei = new Map(vehicles.map(v => [v.imei, v]))
  const deviceLabel = key => {
    if (key === 'all') return 'All devices (fleet-wide)'
    if (key === 'several') return 'Several devices'
    if (key === '-') return 'Not a device call'
    const v = vByImei.get(imeiOf.get(key))
    return v ? `${vehicleLabel(v)} (${key})` : `Device ${key}`
  }

  const peak = b.perMinute.reduce((p, x) => (x.calls > (p?.calls ?? -1) ? x : p), null)
  return {
    generatedAt: new Date(nowMs).toISOString(),
    monitoringSince: new Date(monitorStartMs).toISOString(),
    limits: { callsPerMin: s.flespiCallsPerMin, mibPerMin: s.flespiMiBPerMin, warnPct: s.requestWarnPct, shedPct: s.requestShedPct, protect: s.protectFlespi },
    now: {
      calls: load.calls, bytes: load.bytes,
      pctCalls: round1(load.pctCalls), pctBytes: round1(load.pctBytes),
      holdingBack: load.coolingMs > 0 || load.pct >= s.requestShedPct,
      coolingSec: Math.ceil(load.coolingMs / 1000),
      last429At: load.last429At ? new Date(load.last429At).toISOString() : null,
    },
    lastHour: { ...b.totals, peakMinute: peak },
    perMinute: b.perMinute,
    bySource: b.source.map(named),
    byEndpoint: b.endpoint,
    byDevice: b.device.map(r => ({ ...r, label: deviceLabel(r.key) })),
    day: {
      hours,
      bySource: [...day].map(([key, c]) => named({ key, ...c })).sort((x, y) => y.calls - x.calls),
    },
    episode: requestEpisode ? { since: new Date(requestEpisode.startMs).toISOString(), peakPct: Math.round(requestEpisode.peak), eventId: requestEpisode.eventId } : null,
  }
}

