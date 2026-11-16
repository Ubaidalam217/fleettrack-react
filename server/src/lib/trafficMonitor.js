/**
 * The counters behind the Device Data Monitor (client, 2026-11-16: "if any
 * device sends a lot of data it should report to the app and take some
 * action", and "see which device or source makes a lot of requests").
 *
 * Two things are counted, both in memory, cheaply, as they happen:
 *
 *   1. What every tracker sends us — each message the Flespi webhook delivers
 *      (lib/telemetry.js ingest() calls noteMessage). Per device and per
 *      arrival minute: messages, approximate bytes, repeats of a timestamp
 *      already received, gaps between messages, backlog, parked, reconnects.
 *
 *   2. What WE ask of Flespi — every REST call lib/flespi.js makes, plus the
 *      browser reads the proxy answered itself or held back. Per caller (user or
 *      server job, lib/requestSource.js), per endpoint and per device, with
 *      bytes, against the plan's per-minute limits (Free: 200 calls, 50 MiB).
 *
 * Each keeps the last hour minute by minute for the detection rules
 * (lib/dataMonitor.js) and adds hourly counts to DeviceTrafficStat /
 * FlespiRequestStat every few minutes (flushCounters), as increments, so a
 * restart loses at most the few minutes not yet written and never overwrites
 * what was. Nothing here reads TelemetryMessage.
 *
 * The one "action" taken on its own: an exact copy of a message already
 * received (same device, same timestamp, same content — a Flespi retry, or a
 * tracker resending) is dropped at the webhook (dropDuplicates), and browser
 * reads are held back with a "busy, retry" 429 when our Flespi usage nears the
 * plan's limit (flespiGate, protectFlespi). Nothing is ever sent to a device.
 */

import prisma from '../prisma.js'
import { Prisma } from '@prisma/client'
import { currentSource } from './requestSource.js'

export const MIN_MS = 60_000
export const HOUR_MS = 3_600_000
/** DeviceTrafficStat / FlespiRequestStat rows older than this are deleted. */
export const RETENTION_DAYS = 30
/**
 * How long a message is remembered, by when it ARRIVED, to recognise a repeat:
 * a stream retry comes within seconds to minutes of the first delivery, however
 * old the messages in it are. A device reporting every 30 s keeps ~30 entries.
 */
const SEEN_WINDOW_MS = 15 * 60_000
/** And at most this many per device (a long backlog upload); past it a message is not remembered. */
const SEEN_MAX = 5000
/** Different messages remembered for one timestamp. */
const SEEN_PER_TS = 8
/** A message this much older than its arrival is a backlog upload. */
const LATE_SEC = 600
const PARKED_KMH = 3
/** One gap counts at most this much toward the average interval. */
const MAX_GAP_SEC = 3600
/** Minute buckets kept: the last hour plus the one filling now. */
const MINUTES_KEPT = 61

// ── settings ─────────────────────────────────────────────────────────────────
//
// One AppSetting row, edited on the monitor's Thresholds tab. The defaults and
// why they are what they are (see also lib/dataMonitor.js):
//   - normal trackers here send ~5.7k-23k messages a month (2026-10-19), i.e.
//     about 10-120 an hour; a 30 s interval while moving is 120/h. So "over 5x
//     the device's own median hour AND over 600/h" (one message per 6 s for an
//     hour) only catches something genuinely wrong.
//   - Wialon's documented ceiling is one message per second per unit; an
//     average gap under 5 s held for 10 minutes is a misconfigured interval.
//   - more than 20% repeated timestamps (with at least 60 messages) is a
//     tracker or stream resending, not chance.

export const SETTINGS_KEY = 'dataMonitor'

export const SETTINGS_SPEC = Object.freeze({
  rateMultiplier:     { def: 5,   min: 1,  max: 100 },
  rateFloorPerHour:   { def: 600, min: 10, max: 1_000_000 },
  minIntervalSec:     { def: 5,   min: 1,  max: 600 },
  fastMinutes:        { def: 10,  min: 1,  max: 60 },
  duplicatePct:       { def: 20,  min: 1,  max: 100 },
  duplicateMinMsgs:   { def: 60,  min: 1,  max: 100_000 },
  clearMinutes:       { def: 15,  min: 1,  max: 240 },
  flespiCallsPerMin:  { def: 200, min: 1,  max: 10_000_000 },
  flespiMiBPerMin:    { def: 50,  min: 1,  max: 1_000_000 },
  requestWarnPct:     { def: 80,  min: 10, max: 100 },
  requestShedPct:     { def: 95,  min: 10, max: 100 },
  recommendMovingSec: { def: 30,  min: 1,  max: 3600 },
  recommendParkedSec: { def: 300, min: 1,  max: 86_400 },
  protectFlespi:      { def: true },
  dropDuplicates:     { def: true },
  notifyBgAdmins:     { def: false },
})

export const DEFAULT_SETTINGS = Object.freeze(
  Object.fromEntries(Object.entries(SETTINGS_SPEC).map(([k, s]) => [k, s.def]))
)

/** Any stored or posted object → a complete settings object, clamped to the spec. */
export function normalizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return out
  for (const [k, spec] of Object.entries(SETTINGS_SPEC)) {
    const v = raw[k]
    if (typeof spec.def === 'boolean') {
      if (typeof v === 'boolean') out[k] = v
      continue
    }
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) out[k] = Math.min(spec.max, Math.max(spec.min, n))
  }
  return out
}

let settings = DEFAULT_SETTINGS
export const getSettings = () => settings

export async function loadSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } })
  settings = normalizeSettings(row?.value)
  return settings
}

export async function saveSettings(patch) {
  const next = normalizeSettings({ ...settings, ...patch })
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: next },
    update: { value: next },
  })
  settings = next
  return next
}

// ── devices ──────────────────────────────────────────────────────────────────

export const DEVICE_FIELDS = Object.freeze([
  'msgs', 'bytes', 'duplicates', 'exactDuplicates', 'fast',
  'intervalSum', 'intervalCount', 'late', 'parked', 'reconnects',
])
const BIGINT_DEVICE = new Set(['bytes', 'intervalSum'])
export const zeroDevice = () => Object.fromEntries(DEVICE_FIELDS.map(f => [f, 0]))

/**
 * deviceId → {
 *   ident, lastTs, lastPeer, lastAt,
 *   seen     Map<ts, { at, h: hash[] }>  timestamps that arrived in the last SEEN_WINDOW_MS
 *   minutes  [{ start, ...counts }]  by arrival minute, oldest first
 *   hours    Map<hourStartMs, counts>  not yet written to DeviceTrafficStat
 * }
 */
const devices = new Map()

function deviceOf(id) {
  let d = devices.get(id)
  if (!d) {
    d = { ident: null, lastTs: null, lastPeer: null, lastAt: 0, seen: new Map(), minutes: [], hours: new Map() }
    devices.set(id, d)
  }
  return d
}

/** The bucket for `start` at the end of `list`, made when it is a new minute. */
function minuteBucket(list, start, make) {
  let b = list[list.length - 1]
  if (!b || b.start !== start) {
    b = { start, ...make() }
    list.push(b)
    if (list.length > MINUTES_KEPT) list.splice(0, list.length - MINUTES_KEPT)
  }
  return b
}

/** 32-bit FNV-1a of a string — enough to tell a resent message from a different one. */
export function fnv1a(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Count one message from the webhook. `raw` is the message as Flespi sent it,
 * `row` its normalised form (lib/telemetry.js normalize). Returns false when it
 * is an exact copy of one already received and should be dropped.
 */
export function noteMessage(raw, row, nowMs = Date.now()) {
  const d = deviceOf(row.deviceId)
  let text = ''
  try { text = JSON.stringify(raw) ?? '' } catch { /* a cyclic object cannot come from JSON */ }
  const hash = fnv1a(text)
  const m = minuteBucket(d.minutes, Math.floor(nowMs / MIN_MS) * MIN_MS, zeroDevice)
  const hourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  let h = d.hours.get(hourStart)
  if (!h) d.hours.set(hourStart, (h = zeroDevice()))
  const bump = (k, n = 1) => { m[k] += n; h[k] += n }

  bump('msgs')
  bump('bytes', text.length)
  d.lastAt = nowMs
  if (row.ident) d.ident = row.ident

  // Forget what arrived before the window (the Map is in arrival order).
  for (const [k, e] of d.seen) {
    if (e.at >= nowMs - SEEN_WINDOW_MS) break
    d.seen.delete(k)
  }
  const prev = d.seen.get(row.ts)
  if (prev) {
    bump('duplicates')
    if (prev.h.includes(hash)) {
      bump('exactDuplicates')
      return !settings.dropDuplicates
    }
    if (prev.h.length < SEEN_PER_TS) prev.h.push(hash)
  } else if (d.seen.size < SEEN_MAX) {
    d.seen.set(row.ts, { at: nowMs, h: [hash] })
  }

  if (d.lastTs !== null && row.ts > d.lastTs) {
    const gap = Math.min(row.ts - d.lastTs, MAX_GAP_SEC)
    bump('intervalSum', gap)
    bump('intervalCount')
    if (gap < settings.minIntervalSec) bump('fast')
  }
  if (d.lastTs === null || row.ts > d.lastTs) d.lastTs = row.ts
  if (nowMs / 1000 - row.ts > LATE_SEC) bump('late')
  if (row.speed !== null && row.speed !== undefined && row.speed < PARKED_KMH && row.ignition !== true) bump('parked')
  const peer = typeof raw?.peer === 'string' ? raw.peer : null
  if (peer) {
    if (d.lastPeer && d.lastPeer !== peer) bump('reconnects')
    d.lastPeer = peer
  }
  return true
}

/** deviceId → { ident, lastAt, lastTs, minutes } — what the detection rules read. */
export function deviceSnapshot() {
  const out = new Map()
  for (const [id, d] of devices) out.set(id, { ident: d.ident, lastAt: d.lastAt, lastTs: d.lastTs, minutes: d.minutes })
  return out
}

/** deviceId → Map<hourStartMs, counts> not yet in DeviceTrafficStat (added to its rows when read). */
export function unflushedDeviceHours() {
  const out = new Map()
  for (const [id, d] of devices) if (d.hours.size) out.set(id, d.hours)
  return out
}

// ── Flespi requests ──────────────────────────────────────────────────────────

const REQUEST_FIELDS = ['calls', 'bytes', 'throttled', 'shed', 'local']
const zeroRequest = () => Object.fromEntries(REQUEST_FIELDS.map(f => [f, 0]))
const BREAKDOWNS = ['source', 'endpoint', 'device']
const makeRequestMinute = () => ({ ...zeroRequest(), by: { source: new Map(), endpoint: new Map(), device: new Map() } })

/** The last 60 seconds of calls actually sent, one slot per second: { sec, calls, bytes }. */
let seconds = []
/** Minute buckets, oldest first: totals plus the three breakdowns. */
let reqMinutes = []
/** `${hour}|${kind}|${key}` → { hour, kind, key, ...counts } not yet in FlespiRequestStat. */
let reqHours = new Map()
/** Source key → its label, as last seen (a user's email, a job's name). */
const labels = new Map()
let last429At = 0
/** The highest 60-s load seen since the monitor last asked (takeLoadPeak), so a burst between its passes counts. */
let peak = null

/**
 * "GET /gw/devices/{ids}/telemetry" for a path: device lists, ids and the
 * telemetry field list folded, so one endpoint is one row however it is asked.
 */
export function endpointOf(method, path) {
  const segs = String(path ?? '').split('?')[0].split('/').filter(Boolean)
  const out = []
  for (let i = 0; i < segs.length && out.length < 8; i++) {
    const s = segs[i]
    if (segs[i - 1] === 'telemetry') { out.push('{fields}'); break }
    if (s === 'all' || /^\d+(,\d+)*$/.test(s)) out.push('{ids}')
    else out.push(s.slice(0, 40))
  }
  return `${String(method || 'GET').toUpperCase()} /${out.join('/')}`
}

/** Which device a call was about: its id, "all", "several", or "-" for a non-device call. */
export function deviceKeyOf(path) {
  const m = /^\/gw\/devices\/([^/?]+)/.exec(String(path ?? ''))
  if (!m) return '-'
  if (m[1] === 'all') return 'all'
  return /^\d+$/.test(m[1]) ? m[1] : 'several'
}

function addTo(map, key, add) {
  let c = map.get(key)
  if (!c) map.set(key, (c = zeroRequest()))
  for (const f of REQUEST_FIELDS) c[f] += add[f]
}

function tally(outcome, method, path, bytes, nowMs) {
  const src = currentSource()
  labels.set(src.key, src.label)
  const sent = outcome === 'sent' || outcome === 'throttled'
  const add = {
    calls: sent ? 1 : 0,
    bytes: sent ? Math.max(0, bytes || 0) : 0,
    throttled: outcome === 'throttled' ? 1 : 0,
    shed: outcome === 'shed' ? 1 : 0,
    local: outcome === 'local' ? 1 : 0,
  }
  const keys = { source: src.key, endpoint: endpointOf(method, path), device: deviceKeyOf(path) }

  if (sent) {
    const sec = Math.floor(nowMs / 1000)
    let slot = seconds[seconds.length - 1]
    if (!slot || slot.sec !== sec) seconds.push((slot = { sec, calls: 0, bytes: 0 }))
    slot.calls += 1
    slot.bytes += add.bytes
    while (seconds.length && seconds[0].sec <= sec - 60) seconds.shift()
  }
  if (outcome === 'throttled') last429At = nowMs
  if (sent || outcome === 'shed') {
    const load = flespiLoad(nowMs)
    const worse = !peak || load.pct > peak.pct
    peak = {
      ...(worse ? load : peak),
      throttled: (peak?.throttled ?? false) || outcome === 'throttled',
      shed: (peak?.shed ?? false) || outcome === 'shed',
    }
  }

  const m = minuteBucket(reqMinutes, Math.floor(nowMs / MIN_MS) * MIN_MS, makeRequestMinute)
  for (const f of REQUEST_FIELDS) m[f] += add[f]
  const hour = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  for (const kind of BREAKDOWNS) {
    addTo(m.by[kind], keys[kind], add)
    const k = `${hour}|${kind}|${keys[kind]}`
    let r = reqHours.get(k)
    if (!r) reqHours.set(k, (r = { hour, kind, key: keys[kind], ...zeroRequest() }))
    for (const f of REQUEST_FIELDS) r[f] += add[f]
  }
}

/** A REST call lib/flespi.js made: its status and size (response + request body). */
export function recordFlespiCall({ method = 'GET', path, status, bytes = 0 }, nowMs = Date.now()) {
  tally(status === 429 ? 'throttled' : 'sent', method, path, bytes, nowMs)
}
/** A browser read the proxy held back near the limit (flespiGate) — never sent. */
export function recordFlespiShed(method, path, nowMs = Date.now()) {
  tally('shed', method, path, 0, nowMs)
}
/** A browser read the proxy answered from our own telemetry copy — never sent. */
export function recordFlespiLocal(method, path, nowMs = Date.now()) {
  tally('local', method, path, 0, nowMs)
}

/** Calls and bytes sent in the last 60 s, as shares of the plan's per-minute limits. */
export function flespiLoad(nowMs = Date.now()) {
  const sec = Math.floor(nowMs / 1000)
  let calls = 0, bytes = 0
  for (const s of seconds) if (s.sec > sec - 60) { calls += s.calls; bytes += s.bytes }
  const pctCalls = (calls / settings.flespiCallsPerMin) * 100
  const pctBytes = (bytes / (settings.flespiMiBPerMin * 1024 * 1024)) * 100
  const coolingMs = last429At ? Math.max(0, MIN_MS - (nowMs - last429At)) : 0
  return { calls, bytes, pctCalls, pctBytes, pct: Math.max(pctCalls, pctBytes), coolingMs, last429At: last429At || null }
}

/**
 * Should the proxy hold this browser read back instead of sending it to Flespi?
 * Flespi suspends the token for a minute once a limit is passed (every request
 * then fails), so near the limit a quick "busy, retry" from us — which the
 * browser already backs off on, as on Flespi's own 429 — beats pushing it over.
 *   - Flespi answered 429 in the last minute: every browser read waits.
 *   - at requestShedPct of a limit: every browser read waits.
 *   - at requestWarnPct: the history reads (/messages, the heavy ones) wait.
 * Server jobs and writes are never held back. Returns null to let it through.
 */
export function flespiGate(rest, nowMs = Date.now()) {
  const s = settings
  if (!s.protectFlespi) return null
  const load = flespiLoad(nowMs)
  const pct = Math.round(load.pct)
  if (load.coolingMs > 0) {
    const wait = Math.max(1, Math.ceil(load.coolingMs / 1000))
    return { retryAfter: wait, reason: 'throttled', message: `Flespi refused a request in the last minute (plan limit reached). FleetmaxX is holding live-data requests back for ${wait} s so the limit is not hit again — retry shortly.` }
  }
  if (load.pct >= s.requestShedPct) {
    return { retryAfter: 15, reason: 'limit', message: `Flespi usage is at ${pct}% of the plan's per-minute limit. FleetmaxX is holding live-data requests back for a moment — retry in 15 s.` }
  }
  if (load.pct >= s.requestWarnPct && /^\/messages(\/|$)/.test(String(rest ?? ''))) {
    return { retryAfter: 15, reason: 'history', message: `Flespi usage is at ${pct}% of the plan's per-minute limit. History requests are paused for a moment — retry in 15 s.` }
  }
  return null
}

/**
 * The worst 60-s load since the last call (or now, if that is worse), and
 * whether Flespi answered 429 or a read was held back in between. Resets.
 */
export function takeLoadPeak(nowMs = Date.now()) {
  const now = flespiLoad(nowMs)
  const p = peak
  peak = null
  if (!p || now.pct >= p.pct) return { ...now, throttled: p?.throttled ?? false, shed: p?.shed ?? false }
  return { ...p, coolingMs: now.coolingMs }
}

/** The minute buckets (last hour) and the labels, for lib/dataMonitor.js. */
export function requestSnapshot() {
  return { minutes: reqMinutes, labels: new Map(labels) }
}

/** `${hour}|${kind}|${key}` rows not yet in FlespiRequestStat. */
export const unflushedRequestHours = () => reqHours

// ── storage ──────────────────────────────────────────────────────────────────

/** A TIMESTAMP(3) literal for an epoch-ms hour, in UTC like every Prisma DateTime. */
export const sqlTs = ms => Prisma.sql`${new Date(ms).toISOString().replace('Z', '')}::timestamp(3)`
const ts = sqlTs
const CHUNK = 1000

async function upsertDeviceRows(rows) {
  const cols = ['deviceId', 'hour', ...DEVICE_FIELDS]
  const set = DEVICE_FIELDS.map(f => `"${f}" = "DeviceTrafficStat"."${f}" + EXCLUDED."${f}"`).join(', ')
  for (let i = 0; i < rows.length; i += CHUNK) {
    const tuples = rows.slice(i, i + CHUNK).map(r => Prisma.sql`(${Prisma.join([
      r.deviceId, ts(r.hour),
      ...DEVICE_FIELDS.map(f => (BIGINT_DEVICE.has(f) ? Prisma.sql`${Math.round(r[f])}::bigint` : Math.round(r[f]))),
    ])})`)
    await prisma.$executeRaw`
      INSERT INTO "DeviceTrafficStat" (${Prisma.raw(cols.map(c => `"${c}"`).join(', '))})
      VALUES ${Prisma.join(tuples)}
      ON CONFLICT ("deviceId", "hour") DO UPDATE SET ${Prisma.raw(set)}`
  }
}

async function upsertRequestRows(rows) {
  const cols = ['hour', 'kind', 'key', ...REQUEST_FIELDS]
  const set = REQUEST_FIELDS.map(f => `"${f}" = "FlespiRequestStat"."${f}" + EXCLUDED."${f}"`).join(', ')
  for (let i = 0; i < rows.length; i += CHUNK) {
    const tuples = rows.slice(i, i + CHUNK).map(r => Prisma.sql`(${Prisma.join([
      ts(r.hour), r.kind, String(r.key).slice(0, 200),
      ...REQUEST_FIELDS.map(f => (f === 'bytes' ? Prisma.sql`${Math.round(r[f])}::bigint` : Math.round(r[f]))),
    ])})`)
    await prisma.$executeRaw`
      INSERT INTO "FlespiRequestStat" (${Prisma.raw(cols.map(c => `"${c}"`).join(', '))})
      VALUES ${Prisma.join(tuples)}
      ON CONFLICT ("hour", "kind", "key") DO UPDATE SET ${Prisma.raw(set)}`
  }
}

let flushing = null

/**
 * Add the counts gathered since the last flush to the hourly rows. One run at a
 * time; what fails to write goes back into memory and is tried next time.
 */
export function flushCounters() {
  if (flushing) return flushing
  const devRows = []
  for (const [deviceId, d] of devices) {
    for (const [hour, c] of d.hours) devRows.push({ deviceId, hour, ...c })
    d.hours = new Map()
  }
  const reqRows = [...reqHours.values()]
  reqHours = new Map()
  if (!devRows.length && !reqRows.length) return Promise.resolve()
  flushing = (async () => {
    try {
      if (devRows.length) await upsertDeviceRows(devRows)
    } catch (err) {
      for (const r of devRows) {
        const d = deviceOf(r.deviceId)
        let h = d.hours.get(r.hour)
        if (!h) d.hours.set(r.hour, (h = zeroDevice()))
        for (const f of DEVICE_FIELDS) h[f] += r[f]
      }
      console.error('[datamon] device counts not saved:', String(err?.message ?? err).slice(0, 200))
    }
    try {
      if (reqRows.length) await upsertRequestRows(reqRows)
    } catch (err) {
      for (const r of reqRows) {
        const k = `${r.hour}|${r.kind}|${r.key}`
        const cur = reqHours.get(k)
        if (!cur) reqHours.set(k, r)
        else for (const f of REQUEST_FIELDS) cur[f] += r[f]
      }
      console.error('[datamon] request counts not saved:', String(err?.message ?? err).slice(0, 200))
    }
  })().finally(() => { flushing = null })
  return flushing
}

/** Forget a device that has sent nothing for two hours and has nothing left to write. */
export function pruneIdleDevices(nowMs = Date.now()) {
  for (const [id, d] of devices) if (d.lastAt < nowMs - 2 * HOUR_MS && !d.hours.size) devices.delete(id)
}

/** Delete the hourly rows older than RETENTION_DAYS. */
export async function pruneOld(nowMs = Date.now()) {
  const cutoff = new Date(nowMs - RETENTION_DAYS * 24 * HOUR_MS)
  await prisma.deviceTrafficStat.deleteMany({ where: { hour: { lt: cutoff } } })
  await prisma.flespiRequestStat.deleteMany({ where: { hour: { lt: cutoff } } })
}

/** Test hook: forget every count and go back to the default settings. */
export function __resetTraffic({ keepSettings = false } = {}) {
  devices.clear()
  seconds = []
  reqMinutes = []
  reqHours = new Map()
  labels.clear()
  last429At = 0
  peak = null
  if (!keepSettings) settings = DEFAULT_SETTINGS
}

/** Test hook: forget the counted messages only (the telemetry suite resets between tests). */
export function __resetDeviceCounters() {
  devices.clear()
}
