/**
 * Our own copy of the fleet's telemetry (client, 2026-11-02: "no calling Flespi
 * again and again — the data should already be with us, and hold 5,000+
 * vehicles").
 *
 * Flespi pushes every device message to POST /api/ingest/flespi (an HTTP
 * Stream, routes/ingest.js). This module:
 *
 *   - normalises each message to the fields the app reads (FIELD_MAP, plus a
 *     small `extra` bag for the rarer ones);
 *   - keeps the newest state of every device in memory (`latest`), so the live
 *     map and the alert engine never touch the database or Flespi to read it;
 *   - writes messages and states to Postgres in batches (one multi-row INSERT
 *     per FLUSH_MS, not one per message), idempotent on (deviceId, ts) so a
 *     batch Flespi re-sends after a timeout is not stored twice;
 *   - keeps TelemetryMessage partitioned by UTC day: partitions are made a few
 *     days ahead and dropped once older than TELEMETRY_RETENTION_DAYS, so
 *     expiring history is a DROP TABLE instead of a slow DELETE.
 *
 * Sizing: 5,000 vehicles at one message per 10 s is 500 messages a second —
 * a single batched INSERT per second, far inside what one Postgres takes.
 * The queue is bounded (MAX_QUEUE): past it the webhook answers 503 and Flespi
 * keeps the messages and retries, so a slow database never loses data or
 * exhausts memory.
 */

import prisma from '../prisma.js'
import env from '../env.js'
import { Prisma } from '@prisma/client'
import * as flespi from './flespi.js'

/** Flespi field → our column. */
export const FIELD_MAP = Object.freeze({
  'position.latitude': 'lat',
  'position.longitude': 'lng',
  'position.speed': 'speed',
  'position.direction': 'heading',
  'engine.ignition.status': 'ignition',
  'vehicle.mileage': 'odometerKm',
  'position.satellites': 'satellites',
  'position.valid': 'valid',
  'fuel.sensor.value': 'fuel',
  'ble.sensor.temperature.1': 'temperature',
})

/** Rarer fields the code reads, kept in `extra` only when a device sends them. */
export const EXTRA_FIELDS = Object.freeze([
  'external.powersource.status',
  'ble.sensor.temperature.2',
  'ble.sensor.temperature.3',
  'ble.sensor.temperature.4',
  'can.fuel.consumed',
  'can.fuel.consumed.high.resolution',
  'position.altitude',
])

const COLUMNS = ['deviceId', 'ts', ...new Set(Object.values(FIELD_MAP)), 'extra']
const MAX_QUEUE = 200_000
const MAX_ROWS_PER_INSERT = 2_000 // 13 columns → well under Postgres's 65,535 bind limit
const DAY = 86_400

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = v => (typeof v === 'boolean' ? v : null)
const COLUMN_TYPE = { ignition: bool, valid: bool, satellites: v => (num(v) === null ? null : Math.round(v)) }

/**
 * One Flespi message → a row, or null when it names no device or time.
 * Flespi messages are flat objects keyed by parameter name.
 */
export function normalize(msg) {
  if (!msg || typeof msg !== 'object') return null
  const deviceId = num(msg['device.id'])
  const ts = num(msg.timestamp)
  if (deviceId === null || ts === null) return null
  const row = { deviceId: Math.trunc(deviceId), ts: Math.trunc(ts), ident: typeof msg.ident === 'string' ? msg.ident : null }
  for (const [field, col] of Object.entries(FIELD_MAP)) {
    row[col] = (COLUMN_TYPE[col] ?? num)(msg[field])
  }
  let extra = null
  for (const f of EXTRA_FIELDS) {
    const v = msg[f]
    if (typeof v === 'number' || typeof v === 'boolean') (extra ??= {})[f] = v
  }
  row.extra = extra
  return row
}

/** A stored row back to the Flespi message shape the frontends already parse. */
export function toFlespiMessage(row) {
  const m = { 'device.id': row.deviceId, timestamp: row.ts }
  for (const [field, col] of Object.entries(FIELD_MAP)) {
    if (row[col] !== null && row[col] !== undefined) m[field] = row[col]
  }
  if (row.extra && typeof row.extra === 'object') Object.assign(m, row.extra)
  return m
}

// ── state ────────────────────────────────────────────────────────────────────

/** deviceId → newest row. Loaded from DeviceState at start, kept by ingest. */
const latest = new Map()
let queue = []
const dirty = new Set()
const listeners = new Set()
let loaded = false
let flushing = null
let flushTimer = null
let partitionTimer = null
let stats = { received: 0, stored: 0, lastIngestAt: null, lastError: null }

export const getLatest = deviceId => latest.get(deviceId) ?? null
export const allLatest = () => latest
export const telemetryStats = () => ({ ...stats, queued: queue.length, devices: latest.size })

/** Called with the rows of every accepted batch (alert engine, live push). */
export function onTelemetry(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** True while the queue has room; the webhook answers 503 otherwise. */
export const canAccept = () => queue.length < MAX_QUEUE

/**
 * Accept a batch from the webhook. Synchronous and cheap: it only normalises,
 * updates memory and queues; the database write happens in flush().
 *
 * @returns {{ accepted: number, skipped: number }}
 */
export function ingest(messages) {
  const rows = []
  let skipped = 0
  for (const m of Array.isArray(messages) ? messages : []) {
    const row = normalize(m)
    if (!row) { skipped++; continue }
    rows.push(row)
    const prev = latest.get(row.deviceId)
    if (!prev || row.ts >= prev.ts) {
      // Keep the last known value of a field a message did not carry.
      const merged = { ...row }
      if (prev) {
        for (const col of Object.values(FIELD_MAP)) if (merged[col] === null) merged[col] = prev[col]
        if (!merged.ident) merged.ident = prev.ident
        if (!merged.extra && prev.extra) merged.extra = prev.extra
      }
      latest.set(row.deviceId, merged)
      dirty.add(row.deviceId)
    }
  }
  queue.push(...rows)
  stats.received += rows.length
  stats.lastIngestAt = new Date().toISOString()
  if (queue.length >= MAX_ROWS_PER_INSERT * 5) flush().catch(() => {})
  for (const fn of listeners) {
    try { fn(rows) } catch { /* a listener must not break ingest */ }
  }
  return { accepted: rows.length, skipped }
}

// ── database ─────────────────────────────────────────────────────────────────

// `extra` goes in as text and is cast, since a bound parameter is not jsonb.
const cell = (r, c, now) =>
  c === 'extra' ? Prisma.sql`${r.extra ? JSON.stringify(r.extra) : null}::jsonb`
    : c === 'updatedAt' ? now
      : r[c]
const tuple = (r, cols, now) => Prisma.sql`(${Prisma.join(cols.map(c => cell(r, c, now)))})`

async function insertMessages(rows) {
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_INSERT) {
    const chunk = rows.slice(i, i + MAX_ROWS_PER_INSERT)
    const tuples = chunk.map(r => tuple(r, COLUMNS))
    await prisma.$executeRaw`
      INSERT INTO "TelemetryMessage" (${Prisma.raw(COLUMNS.map(c => `"${c}"`).join(', '))})
      VALUES ${Prisma.join(tuples)}
      ON CONFLICT ("deviceId", "ts") DO NOTHING`
  }
}

async function upsertStates(ids) {
  const rows = ids.map(id => latest.get(id)).filter(Boolean)
  const cols = ['deviceId', 'ident', 'ts', ...new Set(Object.values(FIELD_MAP)), 'extra', 'updatedAt']
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_INSERT) {
    const chunk = rows.slice(i, i + MAX_ROWS_PER_INSERT)
    const now = new Date()
    const tuples = chunk.map(r => tuple(r, cols, now))
    const set = cols.filter(c => c !== 'deviceId').map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')
    await prisma.$executeRaw`
      INSERT INTO "DeviceState" (${Prisma.raw(cols.map(c => `"${c}"`).join(', '))})
      VALUES ${Prisma.join(tuples)}
      ON CONFLICT ("deviceId") DO UPDATE SET ${Prisma.raw(set)}
      WHERE EXCLUDED."ts" >= "DeviceState"."ts"`
  }
}

/** Write what is queued. One run at a time; a failed batch goes back on the queue. */
export function flush() {
  if (flushing) return flushing
  if (!queue.length && !dirty.size) return Promise.resolve()
  const rows = queue
  const ids = [...dirty]
  queue = []
  dirty.clear()
  flushing = (async () => {
    try {
      if (rows.length) await insertMessages(rows)
      if (ids.length) await upsertStates(ids)
      stats.stored += rows.length
      stats.lastError = null
    } catch (err) {
      // Put the batch back in front; the next tick retries it.
      queue = rows.concat(queue).slice(0, MAX_QUEUE)
      for (const id of ids) dirty.add(id)
      stats.lastError = String(err?.message ?? err).slice(0, 300)
      console.error('[telemetry] flush failed:', stats.lastError)
    } finally {
      flushing = null
    }
  })()
  return flushing
}

/** Load the stored states into memory (once, at start). */
export async function loadStates() {
  const rows = await prisma.deviceState.findMany()
  for (const r of rows) if (!latest.has(r.deviceId)) latest.set(r.deviceId, r)
  loaded = true
  return rows.length
}

// ── partitions ───────────────────────────────────────────────────────────────

const dayStart = ts => Math.floor(ts / DAY) * DAY
const partName = start => {
  const d = new Date(start * 1000)
  const p = n => String(n).padStart(2, '0')
  return `TelemetryMessage_${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
}

/**
 * Make tomorrow's partitions before they are needed and drop the expired ones.
 * Rows older than any partition (a backfill) land in the DEFAULT partition,
 * which is trimmed to the same retention.
 */
export async function maintainPartitions(now = Math.floor(Date.now() / 1000)) {
  const today = dayStart(now)
  const made = []
  for (let d = -1; d <= 3; d++) {
    const start = today + d * DAY
    const name = partName(start)
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "TelemetryMessage" FOR VALUES FROM (${start}) TO (${start + DAY})`)
      made.push(name)
    } catch (err) {
      // The DEFAULT partition already holds rows of that day (they arrived before
      // the partition existed); they stay there and are trimmed with it.
      if (!/default partition|would be violated/i.test(String(err?.message))) throw err
    }
  }

  const cutoff = today - env.TELEMETRY_RETENTION_DAYS * DAY
  const parts = await prisma.$queryRaw`
    SELECT c.relname AS name FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'TelemetryMessage'`
  const dropped = []
  for (const { name } of parts) {
    const m = /^TelemetryMessage_(\d{4})(\d{2})(\d{2})$/.exec(name)
    if (!m) continue
    const start = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000
    if (start + DAY <= cutoff) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${name}"`)
      dropped.push(name)
    }
  }
  await prisma.$executeRawUnsafe(`DELETE FROM "TelemetryMessage_default" WHERE "ts" < ${cutoff}`)
  return { made, dropped }
}

// ── reads ────────────────────────────────────────────────────────────────────

/**
 * Messages of some devices in [fromTs, toTs], oldest first, as Flespi-shaped
 * objects — what the reports and replay already consume.
 */
export async function messagesBetween(deviceIds, fromTs, toTs, { limit = 100_000 } = {}) {
  if (!deviceIds.length) return []
  const rows = await prisma.telemetryMessage.findMany({
    where: { deviceId: { in: deviceIds }, ts: { gte: fromTs, lte: toTs } },
    orderBy: [{ deviceId: 'asc' }, { ts: 'asc' }],
    take: limit,
  })
  return rows.map(toFlespiMessage)
}

/** The oldest message we hold — before it, history still comes from Flespi. */
export async function coverageStart() {
  const r = await prisma.telemetryMessage.findFirst({ orderBy: { ts: 'asc' }, select: { ts: true } })
  return r?.ts ?? null
}

// ── fleet seed ───────────────────────────────────────────────────────────────

/**
 * A parked or silent tracker may not send anything for hours, so the webhook
 * alone never tells us it exists. While the webhook is on, one Flespi
 * telemetry read every SEED_EVERY_MS fills in the last state of every device
 * we have nothing newer for. Until the first seed succeeds, "all devices"
 * reads are not answered locally (they would miss those devices).
 */
const SEED_EVERY_MS = 10 * 60 * 1000
let seededAt = 0
let seedTimer = null

export async function seedFromFlespi() {
  if (!env.INGEST_TOKEN || !flespi.isConfigured()) return 0
  const fields = ['timestamp', 'ident', ...Object.keys(FIELD_MAP), ...EXTRA_FIELDS].join(',')
  const res = await flespi.forward(`/gw/devices/all/telemetry/${fields}`, { timeoutMs: 20_000 })
  if (res.status !== 200) throw new Error(`Flespi telemetry answered ${res.status}`)
  let added = 0
  for (const item of JSON.parse(res.text).result ?? []) {
    const t = item.telemetry ?? {}
    const msg = { 'device.id': item.id }
    for (const [k, v] of Object.entries(t)) msg[k] = v?.value
    if (msg.timestamp == null) {
      const stamps = Object.values(t).map(v => v?.ts).filter(Boolean)
      if (stamps.length) msg.timestamp = Math.max(...stamps)
    }
    const row = normalize(msg)
    if (!row) continue
    const prev = latest.get(row.deviceId)
    if (prev && prev.ts >= row.ts) continue
    latest.set(row.deviceId, prev ? { ...prev, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) } : row)
    dirty.add(row.deviceId)
    added++
  }
  seededAt = Date.now()
  return added
}

const seedQuietly = () => seedFromFlespi().catch(err => console.error('[telemetry] seed:', err?.message))

// ── lifecycle ────────────────────────────────────────────────────────────────

/** Start the flush loop and the daily partition upkeep. Returns a stop function. */
export function startTelemetry() {
  if (env.isTest) return () => {}
  loadStates()
    .catch(err => console.error('[telemetry] could not load states:', err?.message))
    .then(() => { if (env.INGEST_TOKEN) seedQuietly() })
  if (env.INGEST_TOKEN) seedTimer = setInterval(seedQuietly, SEED_EVERY_MS)
  seedTimer?.unref?.()
  maintainPartitions().catch(err => console.error('[telemetry] partitions:', err?.message))
  flushTimer = setInterval(() => { flush().catch(() => {}) }, env.TELEMETRY_FLUSH_MS)
  partitionTimer = setInterval(() => {
    maintainPartitions().catch(err => console.error('[telemetry] partitions:', err?.message))
  }, 60 * 60 * 1000)
  flushTimer.unref?.()
  partitionTimer.unref?.()
  return async () => {
    clearInterval(flushTimer)
    clearInterval(partitionTimer)
    clearInterval(seedTimer)
    await flush().catch(() => {})
  }
}

/** Test hook: forget everything held in memory. */
export function __resetTelemetry() {
  latest.clear()
  queue = []
  dirty.clear()
  stats = { received: 0, stored: 0, lastIngestAt: null, lastError: null }
  coverage = { at: 0, ts: null }
  seededAt = 0
  loaded = false
}

export const isLoaded = () => loaded

// ── answering Flespi-shaped reads from our own data ─────────────────────────
// The Flespi proxy (routes/flespiProxy.js), the alert engine and the daily
// usage job ask these first; a null answer means "not ours to answer" and they
// fall back to Flespi. So until the HTTP Stream is set up and delivering,
// nothing changes — and once it is, every read stops costing a Flespi call.

/** No webhook batch for this long → our data is not trusted to be live. */
const LIVE_FRESH_MS = 5 * 60 * 1000
const MESSAGE_KEYS = new Set(['from', 'to', 'count', 'fields', 'reverse'])

/** Is the webhook delivering, so our copy is current? */
export function isServing() {
  if (!env.INGEST_TOKEN || !stats.lastIngestAt) return false
  return Date.now() - Date.parse(stats.lastIngestAt) < LIVE_FRESH_MS
}

// Cached 10 minutes once known — it only moves when a day expires. While we
// hold nothing yet (null) it is asked again every time, so history starts
// being served as soon as the first batch is stored.
let coverage = { at: 0, ts: null }
async function coverageCached() {
  if (coverage.ts === null || Date.now() - coverage.at > 10 * 60 * 1000) coverage = { at: Date.now(), ts: await coverageStart() }
  return coverage.ts
}

/**
 * `/gw/devices/<ids>/telemetry/<fields>` from memory, in Flespi's shape:
 * { result: [{ id, telemetry: { field: { value, ts } } }] }. `ids` null = every
 * device we know. Null when a requested device has no state yet.
 */
export function telemetryResponse(ids) {
  if (!isServing()) return null
  if (!ids && !seededAt) return null // the whole fleet is not known yet
  const list = ids ?? [...latest.keys()]
  const result = []
  for (const id of list) {
    const row = latest.get(id)
    if (!row) return null
    const telemetry = { timestamp: { value: row.ts, ts: row.ts } }
    for (const [k, v] of Object.entries(toFlespiMessage(row))) {
      if (k !== 'device.id' && k !== 'timestamp') telemetry[k] = { value: v, ts: row.ts }
    }
    if (row.ident) telemetry.ident = { value: row.ident, ts: row.ts }
    result.push({ id, telemetry })
  }
  return { result }
}

/**
 * `/gw/devices/<ids>/messages?data={from,to,count,fields,reverse}` from our
 * history, in Flespi's shape ({ result: [message…] }). Null when the query uses
 * anything else, or reaches back before the history we hold.
 */
export async function messagesResponse(ids, dataParam) {
  if (!isServing()) return null
  let q
  try { q = JSON.parse(dataParam ?? '{}') } catch { return null }
  if (!q || typeof q !== 'object' || Object.keys(q).some(k => !MESSAGE_KEYS.has(k))) return null
  const from = num(q.from), to = num(q.to)
  if (from === null || to === null) return null
  const start = await coverageCached()
  if (start === null || from < start) return null

  const limit = Math.min(num(q.count) ?? 100_000, 100_000)
  const rows = await prisma.telemetryMessage.findMany({
    where: { ...(ids ? { deviceId: { in: ids } } : {}), ts: { gte: Math.floor(from), lte: Math.ceil(to) } },
    orderBy: q.reverse ? [{ ts: 'desc' }] : [{ ts: 'asc' }],
    take: limit,
  })
  const want = typeof q.fields === 'string' && q.fields ? new Set(q.fields.split(',')) : null
  return {
    result: rows.map(r => {
      const m = toFlespiMessage(r)
      if (!want) return m
      const out = {}
      for (const [k, v] of Object.entries(m)) if (want.has(k) || k === 'device.id' || k === 'timestamp') out[k] = v
      return out
    }),
  }
}
