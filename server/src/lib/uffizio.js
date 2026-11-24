/**
 * Uffizio / Trakzee — fuel vehicles that report only to the client's own
 * tracking platform (client, 2026-11-24: "Fuel vehicles through API will be
 * added to the business group 'Al Jaber Leasing - Fuel'. Fuel data comes only
 * through the API").
 *
 * ── The API (Uffizio's customised web service) ─────────────────────────────
 *
 *   POST {BASE}/webservice?token=generateAccessToken        {username, password}
 *        → {result:1, data:{token}}  |  {result:0, message:"Incorrect username or password"}
 *   POST {BASE}/webservice?token=getTokenBaseLiveData&ProjectId={P}
 *        header auth-code: <token>, body {company_names}
 *        → {root:{VehicleData:[…]}}  |  {result:0, message:"<company> Does Not Belongs To Given User"}
 *
 * Both answer HTTP 200 for their own errors. Uffizio allows ONE live-data call
 * per 120 s per company: the gap here is measured from the END of the last
 * call to the start of the next, so a slow answer can never make two calls
 * arrive closer than that. The time is kept in AppSetting, so a restart does
 * not break the spacing either. 429 / 5xx / network errors back off (2, 4, 8 …
 * up to 30 min). A rejected token is dropped and the next poll signs in again
 * (no immediate retry: that would be a second call inside the 120 s).
 *
 * ── Times ──────────────────────────────────────────────────────────────────
 *
 * Datetime and GPSActualTime come as "DD-MM-YYYY HH:MM:SS" with no zone. They
 * are read as UAE time (UTC+4, no daylight saving) — the account is a UAE one
 * and the live sample matched the UAE clock. A value with its own offset
 * ("…+05:30" or "Z") would be honoured instead.
 *
 * ── What it writes ─────────────────────────────────────────────────────────
 *
 *   - vehicles: upserted by IMEI into the Business Group UFFIZIO_BG_ID with
 *     dataSource 'UFFIZIO' (plateNo = Vehicle_Name, fleetNo = Vehicle_No,
 *     deviceType = DeviceModel). Never a Flespi device. An IMEI that belongs
 *     to a FLESPI vehicle is left alone and reported as a conflict.
 *   - FuelReading rows, one per fuel port, only when the vehicle's Datetime
 *     moved on; rows older than 90 days are deleted by the same job.
 *
 * Configuration is the server's environment only (names in .env.example):
 * UFFIZIO_BASE, UFFIZIO_USER, UFFIZIO_PASS, UFFIZIO_COMPANY,
 * UFFIZIO_PROJECT_ID (49), UFFIZIO_BG_ID. Nothing here ever logs or returns
 * the password or the access token.
 */

import prisma from '../prisma.js'
import env from '../env.js'
import { deviceRow, renameRow } from './vehicleMoves.js'
import { activeCalibrations, readingLitres } from './fuel.js'
import { runFuelAlertPass } from './fuelAlerts.js'

export const SOURCE = 'UFFIZIO'
/** Uffizio's own limit: one live-data call per 120 s per company. */
export const MIN_GAP_MS = 120_000
export const TIMEOUT_MS = 15_000
export const RETENTION_DAYS = 90
const MAX_BACKOFF_MS = 30 * 60_000
/** A token older than this is renewed before use, even if never refused. */
const TOKEN_MAX_AGE_MS = 12 * 3600_000
const UAE_OFFSET_MIN = 240
const STATE_KEY = 'uffizio.state'
const SYNC_ACTOR = { id: null, name: 'Uffizio sync' }

// ── configuration ───────────────────────────────────────────────────────────

const clean = v => String(v ?? '').trim()
const digits = v => String(v ?? '').replace(/\D/g, '')

/** The settings from the environment, read on every use (tests set them). */
export function config() {
  const e = process.env
  const pollMs = Number(e.UFFIZIO_POLL_MS)
  return {
    base: clean(e.UFFIZIO_BASE).replace(/\/+$/, ''),
    user: clean(e.UFFIZIO_USER),
    pass: String(e.UFFIZIO_PASS ?? ''),
    company: clean(e.UFFIZIO_COMPANY),
    projectId: clean(e.UFFIZIO_PROJECT_ID) || '49',
    bgId: clean(e.UFFIZIO_BG_ID),
    // Never below Uffizio's 120 s (a little over it by default).
    pollMs: Math.max(MIN_GAP_MS, Number.isFinite(pollMs) && pollMs > 0 ? pollMs : MIN_GAP_MS + 5_000),
  }
}

/** The variable NAMES that are missing (never their values). */
export function missingSettings(c = config()) {
  return [
    ['UFFIZIO_BASE', c.base], ['UFFIZIO_USER', c.user], ['UFFIZIO_PASS', c.pass],
    ['UFFIZIO_COMPANY', c.company], ['UFFIZIO_BG_ID', c.bgId],
  ].filter(([, v]) => !v).map(([k]) => k)
}

export const isConfigured = (c = config()) => missingSettings(c).length === 0

// ── state ───────────────────────────────────────────────────────────────────

let token = null
let tokenAt = 0
const fresh = () => ({
  lastCallAt: 0, // end of the last live-data call (ms)
  lastAttemptAt: 0, // start of the last poll, sign-in failures included (ms)
  backoffUntil: 0,
  backoffStep: 0,
  lastPollAt: null, // ISO
  lastOkAt: null,
  lastError: null,
  lastErrorAt: null,
  lastResult: null,
})
let state = fresh()
let stateLoaded = false

async function loadState() {
  if (stateLoaded) return
  stateLoaded = true
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: STATE_KEY } })
    // The call times carry over a restart (Uffizio's 120 s gap); a backoff
    // does not — a restart is how a fixed setting is picked up.
    if (row?.value && typeof row.value === 'object') state = { ...fresh(), ...row.value, backoffUntil: 0, backoffStep: 0 }
  } catch { /* first run */ }
}

async function saveState() {
  const value = JSON.parse(JSON.stringify(state))
  await prisma.appSetting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value }, update: { value } }).catch(() => {})
}

/**
 * Text that may be shown or logged: the password, the user name and the token
 * blanked out wherever they appear, and cut short.
 */
export function scrub(text, c = config()) {
  let s = String(text ?? '')
  for (const secret of [c.pass, c.user, token]) {
    if (secret && secret.length >= 3) s = s.split(secret).join('***')
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, 300)
}

export class UffizioError extends Error {
  /** kind: 'login' | 'token' | 'company' | 'rate' | 'http' | 'network' | 'config' | 'shape' */
  constructor(kind, message, { retryAt = null, status = null } = {}) {
    super(message)
    this.kind = kind
    this.retryAt = retryAt
    this.status = status
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

async function postJson(url, { headers = {}, body }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    })
    let json = null
    try { json = await res.json() } catch { json = null }
    return { status: res.status, json }
  } catch (err) {
    const why = err?.name === 'AbortError' ? `no answer within ${TIMEOUT_MS / 1000} s` : (err?.message || 'network error')
    throw new UffizioError('network', `Could not reach Uffizio: ${why}`)
  } finally {
    clearTimeout(timer)
  }
}

const TOKEN_REFUSED = /token|auth|expired|session|unauthori[sz]ed|login again/i

/** Sign in and keep the token. Throws UffizioError('login') on a wrong login. */
export async function login(c = config()) {
  if (!c.base || !c.user || !c.pass) throw new UffizioError('config', `Uffizio is not set up: ${missingSettings(c).join(', ')} missing`)
  const { status, json } = await postJson(`${c.base}/webservice?token=generateAccessToken`, {
    body: { username: c.user, password: c.pass },
  })
  if (status === 429 || status >= 500) throw new UffizioError('http', `Uffizio sign-in answered HTTP ${status}`, { status })
  const t = json?.data?.token
  if (status === 200 && Number(json?.result) === 1 && t) {
    token = String(t)
    tokenAt = Date.now()
    return true
  }
  token = null
  const why = json?.message ? scrub(json.message, c) : `HTTP ${status}`
  throw new UffizioError('login', `Uffizio sign-in failed: ${why}`, { status })
}

/** When the next live-data call may start (ms). */
export function nextAllowedAt() {
  return Math.max(state.lastCallAt ? state.lastCallAt + MIN_GAP_MS : 0, state.backoffUntil || 0)
}

function backoff(nowMs) {
  state.backoffStep = Math.min(state.backoffStep + 1, 10)
  state.backoffUntil = nowMs + Math.min(MAX_BACKOFF_MS, MIN_GAP_MS * 2 ** state.backoffStep)
}

/**
 * The live data of one company: Uffizio's VehicleData rows as they come.
 * Refuses (UffizioError 'rate', with retryAt) inside the 120 s gap or a backoff.
 */
export async function getLiveData(company, { c = config(), now = Date.now } = {}) {
  await loadState()
  const allowed = nextAllowedAt()
  if (now() < allowed) throw new UffizioError('rate', 'Uffizio allows one call every 2 minutes', { retryAt: allowed })
  if (!token || now() - tokenAt > TOKEN_MAX_AGE_MS) await login(c)

  const url = `${c.base}/webservice?token=getTokenBaseLiveData&ProjectId=${encodeURIComponent(c.projectId)}`
  let res
  try {
    res = await postJson(url, { headers: { 'auth-code': token }, body: { company_names: company } })
  } catch (err) {
    state.lastCallAt = now()
    backoff(now())
    await saveState()
    throw err
  }
  state.lastCallAt = now()
  const { status, json } = res

  if (status === 429 || status >= 500) {
    backoff(now())
    await saveState()
    throw new UffizioError('http', `Uffizio answered HTTP ${status}${status === 429 ? ' (too many requests)' : ''}`, { status, retryAt: state.backoffUntil })
  }
  if (status === 401 || status === 403) {
    token = null
    await saveState()
    throw new UffizioError('token', 'Uffizio refused the access token; it signs in again on the next poll', { status })
  }
  const rows = json?.root?.VehicleData
  if (Array.isArray(rows)) {
    state.backoffStep = 0
    state.backoffUntil = 0
    await saveState()
    return rows
  }
  await saveState()
  const message = scrub(json?.message ?? '', c)
  if (json && Number(json.result) === 0) {
    if (/does not belongs? to/i.test(message)) throw new UffizioError('company', `Uffizio: ${message}`)
    if (TOKEN_REFUSED.test(message)) {
      token = null
      throw new UffizioError('token', `Uffizio refused the access token (${message}); it signs in again on the next poll`)
    }
    throw new UffizioError('http', `Uffizio: ${message || 'the request was refused'}`)
  }
  throw new UffizioError('shape', `Uffizio answered HTTP ${status} without vehicle data`, { status })
}

// ── parsing ─────────────────────────────────────────────────────────────────

/**
 * "24-11-2026 13:05:09" (UAE time) → epoch ms. Also takes "2026-11-24 13:05:09"
 * and an ISO time with its own offset. Null when it is not a time.
 */
export function parseUffizioTime(text) {
  const s = clean(text)
  if (!s) return null
  let m = /^(\d{1,2})-(\d{1,2})-(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s)
  let y, mo, d, h, mi, se
  if (m) [, d, mo, y, h, mi, se] = m
  else {
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
    if (!m) return null
    ;[, y, mo, d, h, mi, se] = m
    if (m[7]) {
      const t = Date.parse(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${se ?? '00'}${m[7]}`)
      return Number.isFinite(t) ? t : null
    }
  }
  const [Y, Mo, D, H, Mi, S] = [y, mo, d, h, mi, se ?? '0'].map(Number)
  if (Mo < 1 || Mo > 12 || D < 1 || D > 31 || H > 23 || Mi > 59 || S > 59) return null
  const utc = Date.UTC(Y, Mo - 1, D, H, Mi, S) - UAE_OFFSET_MIN * 60_000
  // Date.UTC rolls 31-02 over into March: refuse a day the month does not have.
  const back = new Date(utc + UAE_OFFSET_MIN * 60_000)
  return back.getUTCDate() === D ? utc : null
}

const numOrNull = v => {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function ignitionOf(v) {
  const s = clean(v).toUpperCase()
  if (s === 'ON' || s === '1' || s === 'TRUE') return true
  if (s === 'OFF' || s === '0' || s === 'FALSE') return false
  return null
}

/** The driver tag: iButton / RFID when it is not empty or all zeros. */
function driverTagOf(r) {
  const t = clean(r['Ibutton/RFID'] ?? r.Ibutton ?? r.RFID)
  return t && !/^[0\s:-]*$/.test(t) && t !== '--' ? t : null
}

/**
 * One VehicleData row → what FleetmaxX keeps. Fuel: every {port_name, value}
 * with a number, raw. Null for a row with no IMEI.
 */
export function normaliseRow(r) {
  if (!r || typeof r !== 'object') return null
  const imei = digits(r.Imeino ?? r.IMEI ?? r.imei)
  if (!imei) return null
  const lat = numOrNull(r.Latitude)
  const lng = numOrNull(r.Longitude)
  const hasFix = lat !== null && lng !== null && !(lat === 0 && lng === 0)
  const fuel = []
  for (const f of Array.isArray(r.Fuel) ? r.Fuel : []) {
    const raw = numOrNull(f?.value)
    const port = clean(f?.port_name) || 'Fuel'
    if (raw !== null) fuel.push({ port: port.slice(0, 80), raw })
  }
  const driverName = [r.Driver_First_Name, r.Driver_Middle_Name, r.Driver_Last_Name].map(clean).filter(x => x && x !== '--').join(' ')
  return {
    imei,
    plate: clean(r.Vehicle_Name).slice(0, 60) || null,
    fleetNo: clean(r.Vehicle_No).slice(0, 60) || null,
    model: clean(r.DeviceModel).slice(0, 120) || null,
    company: clean(r.Company) || null,
    branch: clean(r.Branch) || null,
    lat: hasFix ? lat : null,
    lng: hasFix ? lng : null,
    speed: numOrNull(r.Speed),
    ign: ignitionOf(r.IGN),
    odometer: numOrNull(r.Odometer),
    externalVolt: numOrNull(r.ExternalVolt),
    location: clean(r.Location) || null,
    ts: parseUffizioTime(r.Datetime) ?? parseUffizioTime(r.GPSActualTime),
    gpsTs: parseUffizioTime(r.GPSActualTime),
    driverTag: driverTagOf(r),
    driverName: driverName || null,
    fuel,
  }
}

// ── storing ─────────────────────────────────────────────────────────────────

/**
 * Upsert the vehicles by IMEI. New ones go into `bgId` as UFFIZIO vehicles;
 * known UFFIZIO ones get Uffizio's current plate / fleet no. / device model
 * (with a rename row in the Reallocation History). A FLESPI vehicle or an
 * archived one with the same IMEI is never touched: it is a conflict.
 *
 * @returns {{ byImei: Map<string, object>, created: number, updated: number, conflicts: object[] }}
 */
export async function syncVehicles(rows, bgId) {
  const list = rows.filter(Boolean)
  const imeis = [...new Set(list.map(r => r.imei))]
  const existing = imeis.length
    ? await prisma.vehicle.findMany({
      where: { imei: { in: imeis } },
      select: { id: true, bgId: true, imei: true, plateNo: true, fleetNo: true, deviceType: true, dataSource: true, deletedAt: true },
    })
    : []
  const known = new Map(existing.map(v => [v.imei, v]))
  const byImei = new Map()
  const conflicts = []
  let created = 0, updated = 0

  for (const r of list) {
    if (byImei.has(r.imei)) continue
    const v = known.get(r.imei)
    if (!v) {
      const made = await prisma.$transaction(async tx => {
        const row = await tx.vehicle.create({
          data: { bgId, imei: r.imei, plateNo: r.plate, fleetNo: r.fleetNo, deviceType: r.model, dataSource: SOURCE },
          select: { id: true, bgId: true, imei: true, plateNo: true, fleetNo: true, deviceType: true, dataSource: true, deletedAt: true },
        })
        await tx.vehicleMove.create({ data: deviceRow(row, row.imei, true, SYNC_ACTOR, 'Added from Uffizio') })
        return row
      })
      created++
      byImei.set(r.imei, made)
      continue
    }
    if (v.deletedAt || v.dataSource !== SOURCE) {
      conflicts.push({
        imei: r.imei,
        plate: r.plate,
        reason: v.deletedAt ? 'archived' : 'flespi',
        message: v.deletedAt
          ? `IMEI ${r.imei} (${r.plate ?? 'no number'}) belongs to an archived vehicle — not changed`
          : `IMEI ${r.imei} (${r.plate ?? 'no number'}) is already a Flespi vehicle — not changed`,
      })
      continue
    }
    const change = {}
    if (r.plate && r.plate !== v.plateNo) change.plateNo = r.plate
    if (r.fleetNo && r.fleetNo !== v.fleetNo) change.fleetNo = r.fleetNo
    if (r.model && r.model !== v.deviceType) change.deviceType = r.model
    if (Object.keys(change).length) {
      const renamed = renameRow(v, { ...v, ...change }, SYNC_ACTOR)
      const ops = [prisma.vehicle.update({ where: { id: v.id }, data: change })]
      if (renamed) ops.push(prisma.vehicleMove.create({ data: renamed }))
      await prisma.$transaction(ops)
      updated++
      byImei.set(r.imei, { ...v, ...change })
    } else {
      byImei.set(r.imei, v)
    }
  }
  return { byImei, created, updated, conflicts }
}

/** The newest stored reading time per vehicle (ms). */
async function lastStored(vehicleIds) {
  if (!vehicleIds.length) return new Map()
  const rows = await prisma.fuelReading.groupBy({ by: ['vehicleId'], where: { vehicleId: { in: vehicleIds } }, _max: { ts: true } })
  return new Map(rows.map(r => [r.vehicleId, r._max.ts?.getTime() ?? 0]))
}

/**
 * Store the fuel readings of the rows whose record time moved on, each with
 * the litres the calibration in use gives (a record: the report and the
 * alerts convert the raw value again with the current one, lib/fuel.js).
 * @returns {Promise<number>} readings inserted
 */
export async function storeReadings(rows, byImei) {
  const withFuel = rows.filter(r => r && r.ts !== null && r.fuel.length && byImei.get(r.imei))
  if (!withFuel.length) return 0
  const ids = [...new Set(withFuel.map(r => byImei.get(r.imei).id))]
  const [last, calibrations] = await Promise.all([lastStored(ids), activeCalibrations(ids)])
  const data = []
  for (const r of withFuel) {
    const v = byImei.get(r.imei)
    if (r.ts <= (last.get(v.id) ?? 0)) continue // the same record as last time
    if (r.ts > Date.now() + 10 * 60_000) continue // a clock far in the future
    for (const f of r.fuel) {
      data.push({
        vehicleId: v.id, ts: new Date(r.ts), port: f.port, raw: f.raw,
        litres: readingLitres(f, calibrations.get(v.id) ?? null).litres,
        ign: r.ign, lat: r.lat, lng: r.lng, speed: r.speed,
      })
    }
  }
  if (!data.length) return 0
  const res = await prisma.fuelReading.createMany({ data, skipDuplicates: true })
  return res.count
}

/** Delete readings older than the retention. */
export async function cleanup(nowMs = Date.now()) {
  const before = new Date(nowMs - RETENTION_DAYS * 86400_000)
  const res = await prisma.fuelReading.deleteMany({ where: { ts: { lt: before } } })
  return res.count
}

// ── one poll ────────────────────────────────────────────────────────────────

let polling = null

/**
 * One poll: live data → vehicles → readings. Never throws; the outcome is in
 * the status (lastError…). `force` is a manual "Poll now" — it still waits
 * for the 120 s gap (answered as a 'rate' error with retryAt).
 */
export async function pollOnce({ now = Date.now } = {}) {
  if (polling) return polling
  polling = (async () => {
    await loadState()
    const c = config()
    const missing = missingSettings(c)
    if (missing.length) return { ok: false, idle: true, error: `Not set up: ${missing.join(', ')} missing on the server` }
    const bg = await prisma.businessGroup.findUnique({ where: { id: c.bgId }, select: { id: true } })
    if (!bg) return { ok: false, idle: true, error: 'UFFIZIO_BG_ID does not match a Business Group' }

    const startedAt = now()
    if (startedAt >= nextAllowedAt()) state.lastAttemptAt = startedAt
    try {
      const raw = await getLiveData(c.company, { c, now })
      const rows = raw.map(normaliseRow).filter(Boolean)
      const sync = await syncVehicles(rows, c.bgId)
      const inserted = await storeReadings(rows, sync.byImei)
      state.lastPollAt = new Date(startedAt).toISOString()
      state.lastOkAt = state.lastPollAt
      state.lastError = null
      state.lastErrorAt = null
      state.lastResult = {
        rows: raw.length, vehicles: sync.byImei.size, created: sync.created, updated: sync.updated, inserted,
        withFuel: rows.filter(r => r.fuel.length).length, conflicts: sync.conflicts.slice(0, 20),
      }
      await saveState()
      return { ok: true, ...state.lastResult }
    } catch (err) {
      const e = err instanceof UffizioError ? err : new UffizioError('error', String(err?.message ?? err))
      if (e.kind === 'rate') return { ok: false, rate: true, retryAt: e.retryAt, error: e.message }
      // A wrong login is not retried every few seconds either.
      if (e.kind === 'login') backoff(now())
      state.lastPollAt = new Date(startedAt).toISOString()
      state.lastError = scrub(e.message, c)
      state.lastErrorAt = state.lastPollAt
      await saveState()
      return { ok: false, kind: e.kind, error: state.lastError, retryAt: e.retryAt ?? null }
    }
  })()
  try {
    return await polling
  } finally {
    polling = null
  }
}

/** Test connection: sign in only (no live-data call, so the 120 s gap is untouched). */
export async function testConnection() {
  const c = config()
  const missing = missingSettings(c).filter(k => k !== 'UFFIZIO_BG_ID')
  if (missing.length) return { ok: false, error: `Not set up: ${missing.join(', ')} missing on the server` }
  try {
    await login(c)
    return { ok: true, message: 'Signed in to Uffizio' }
  } catch (err) {
    return { ok: false, error: scrub(err?.message ?? err, c) }
  }
}

/** What Settings shows: no secrets, no token. */
export async function statusView() {
  await loadState()
  const c = config()
  const missing = missingSettings(c)
  const bg = c.bgId ? await prisma.businessGroup.findUnique({ where: { id: c.bgId }, select: { id: true, name: true } }) : null
  const since = new Date(Date.now() - 86400_000)
  const [vehicles, withReadings, readings24h] = await Promise.all([
    prisma.vehicle.count({ where: { dataSource: SOURCE, deletedAt: null } }),
    prisma.fuelReading.groupBy({ by: ['vehicleId'], where: { ts: { gte: since } } }).then(r => r.length),
    prisma.fuelReading.count({ where: { ts: { gte: since } } }),
  ])
  let host = null
  try { host = c.base ? new URL(c.base).host : null } catch { host = null }
  const next = nextAllowedAt()
  return {
    configured: missing.length === 0 && !!bg,
    missing,
    bgMissing: !!c.bgId && !bg,
    host,
    company: c.company || null,
    projectId: c.projectId,
    bg,
    intervalSec: Math.round(c.pollMs / 1000),
    running: jobRunning,
    lastPollAt: state.lastPollAt,
    lastOkAt: state.lastOkAt,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
    lastResult: state.lastResult,
    nextAllowedAt: next ? new Date(next).toISOString() : null,
    vehicles,
    vehiclesReporting24h: withReadings,
    readings24h,
  }
}

// ── the job ─────────────────────────────────────────────────────────────────

let jobRunning = false
let lastCleanupAt = 0

async function tick() {
  const c = config()
  if (!isConfigured(c)) return
  await loadState()
  const now = Date.now()
  const due = Math.max(nextAllowedAt(), (state.lastAttemptAt || 0) + c.pollMs, state.lastCallAt ? state.lastCallAt + c.pollMs : 0)
  if (now < due) return
  const r = await pollOnce()
  if (!r.ok && !r.rate && !r.idle) console.error(`[uffizio] ${r.error}`)
  if (now - lastCleanupAt > 3600_000) {
    lastCleanupAt = now
    await cleanup(now).catch(err => console.error(`[uffizio] cleanup: ${scrub(err?.message)}`))
  }
  // The fuel alerts read the new readings straight away (lib/fuelAlerts.js).
  if (r.ok && r.inserted) {
    try {
      const events = await runFuelAlertPass()
      if (events.length) console.log(`[uffizio] fuel alerts: ${events.length} raised`)
    } catch (err) {
      console.error(`[uffizio] fuel alerts: ${scrub(err?.message)}`)
    }
  }
}

/** Start the poller (checks every 15 s whether a poll is due). Returns a stop function. */
export function startUffizioJob() {
  if (env.isTest) return () => {}
  jobRunning = true
  if (!isConfigured()) console.log(`[uffizio] idle: ${missingSettings().join(', ')} not set`)
  let busy = false
  const run = async () => {
    if (busy) return
    busy = true
    try { await tick() } catch (err) { console.error(`[uffizio] ${scrub(err?.message)}`) } finally { busy = false }
  }
  const first = setTimeout(run, 15_000)
  const timer = setInterval(run, 15_000)
  timer.unref?.()
  first.unref?.()
  return () => {
    jobRunning = false
    clearTimeout(first)
    clearInterval(timer)
  }
}

/** Test hooks. */
export function __resetUffizio() {
  token = null
  tokenAt = 0
  state = fresh()
  stateLoaded = false
  polling = null
}
export const __hasToken = () => !!token
