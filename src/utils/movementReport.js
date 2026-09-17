// Movement Report (Phase 5) data source. Turns a device's raw Flespi messages
// into the row-per-event table the client's Ctrack "Movement Report" produces:
// grouped Vehicle -> Date -> rows, with a derived Status, a cumulative odometer
// that restarts at 0 for the reported range, and a reverse-geocoded Location.
//
// What the statuses are derived from, and why some cannot exist:
//
// Flespi gives this fleet no native "movement status" for a report like this —
// everything below comes from `engine.ignition.status`, `position.speed`,
// `vehicle.mileage` and `position.valid`/`position.satellites`. A probe of all
// 10 devices (2026-09-17) found:
//   - ignition, speed, lat/lng, mileage and satellites on 100% of messages;
//   - `position.valid` on only 3 of 10 devices, so the "; (GPS Unlock)" suffix
//     is satellite-count-derived on the rest and will rarely fire;
//   - NO iButton/RFID/driver-tag field and NO immobilizer field anywhere on the
//     account. "Driver Tag Presented" and "Immob Auto" therefore cannot be
//     derived at all. They stay in STATUS_DEFS, flagged `unavailable`, so the
//     UI can show them disabled rather than imply a clean day — same convention
//     as alertsData.js's UNAVAILABLE_NOTES.
//
// The reference PDF reads "Cumulative Odo (km)" as distance since the start of
// the reported range (its first row is 0.000 and its last equals the vehicle
// group row's total), NOT the absolute odometer — so that is what is computed.

import { fetchDeviceMessages, isAbortError } from './replay'
import { reverseGeocodeMany, geocodeKey, shortenAddress, countUncached } from './geocode'

export { isAbortError }

// Only the fields the derivation below reads. Unfiltered, Flespi returns every
// parameter a device reports (~33-81 here), which is several times the payload
// for data immediately discarded.
export const MOVEMENT_FIELDS = [
  'timestamp',
  'position.latitude',
  'position.longitude',
  'position.speed',
  'position.valid',
  'position.satellites',
  'engine.ignition.status',
  'vehicle.mileage',
].join(',')

// Status values, in the order the filter list shows them. `unavailable` marks
// the two the client's sample contains that no field on this account can back.
export const STATUS_DEFS = [
  { key: 'startUp',         label: 'Start up' },
  { key: 'driverTag',       label: 'Driver Tag Presented', unavailable: 'requires additional hardware config' },
  { key: 'driving',         label: 'Driving' },
  { key: 'excessiveIdling', label: 'Excessive Idling' },
  { key: 'ignitionOff',     label: 'Ignition off' },
  { key: 'immobAuto',       label: 'Immob Auto', unavailable: 'requires additional hardware config' },
]

export const STATUS_LABELS = Object.fromEntries(STATUS_DEFS.map(s => [s.key, s.label]))
export const AVAILABLE_STATUS_KEYS = STATUS_DEFS.filter(s => !s.unavailable).map(s => s.key)

// Continuous ignition-on-at-a-standstill beyond this is Excessive Idling. The
// sample PDF then repeats the row on every clock-aligned boundary (4:15:00PM,
// 4:20:00PM, ...), which is what emitIdleRows reproduces.
const IDLE_SEC = 5 * 60

// Gap above which two messages are unrelated — the device slept or lost
// coverage. Same convention as usageData.js / alertsData.js. No idle episode
// spans one.
const MAX_GAP_SEC = 30 * 60

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// ── formatting — matches the reference PDF's en-US forms exactly ───────────

/** "2:14:58PM" — no space before the meridiem, as the sample's data rows use. */
export function formatTime(ts) {
  const d = new Date(ts * 1000)
  const h24 = d.getHours()
  return `${h24 % 12 || 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${h24 >= 12 ? 'PM' : 'AM'}`
}

/** "12/2/2017" — M/D/YYYY, unpadded, as the sample uses throughout. */
export function formatDateNum(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

/** "12/2/2017 1:00:00 PM" — the filter-summary form, which does use a space. */
export function formatDateTime(ts) {
  const d = new Date(ts * 1000)
  const h24 = d.getHours()
  return `${formatDateNum(d)} ${h24 % 12 || 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${h24 >= 12 ? 'PM' : 'AM'}`
}

/** "Sat, 12/2/2017" — the date sub-header row. */
export function formatDateLabel(d) {
  return `${WEEKDAYS[d.getDay()]}, ${formatDateNum(d)}`
}

/** "2/12/2018   1:30:51PM" — the page footer's print stamp. */
export function formatPrintDate(ts = Math.floor(Date.now() / 1000)) {
  return `${formatDateNum(new Date(ts * 1000))}   ${formatTime(ts)}`
}

function dateKeyOf(ts) {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── geometry ──────────────────────────────────────────────────────────────

const EARTH_M = 6371000

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

// ── status derivation ─────────────────────────────────────────────────────

// "; (GPS Unlock)" in the sample persists across several consecutive rows and
// then stops, with the location frozen while it shows — so it reads as "this
// fix is not locked", not "the fix just changed". Modelled that way: true
// whenever the point has no valid fix.
function gpsUnlocked(m) {
  const valid = m['position.valid']
  if (typeof valid === 'boolean') return !valid
  const sats = num(m['position.satellites'])
  if (sats != null) return sats === 0
  return false
}

function makeRow({ ts, statusKey, speed, odoKm, lat, lng, unlocked }) {
  return {
    ts,
    time:   formatTime(ts),
    statusKey,
    status: STATUS_LABELS[statusKey] + (unlocked ? '; (GPS Unlock)' : ''),
    speed:  Math.round(speed ?? 0),
    odoKm:  odoKm ?? 0,
    lat,
    lng,
    // Filled in later by resolveReportLocations; until then the row renders its
    // coordinates, so the table is usable before geocoding finishes.
    location: null,
  }
}

/**
 * Derive one device's rows from its raw messages.
 *
 * One row per message, except:
 *   - inside an Excessive Idling episode the per-message rows are suppressed
 *     and replaced by one row per clock-aligned 5-minute boundary (the sample
 *     does exactly this — 4:15:00PM, 4:20:00PM, ... with nothing in between);
 *   - with tolerance on, an ordinary Driving row within N metres of the last
 *     kept row is dropped. Transitions (Start up / Ignition off) and idling
 *     rows are never dropped: they are the events the report exists to show,
 *     and they happen precisely when the vehicle is not moving.
 */
function deriveRows(messages, { applyTolerance, toleranceMeters }) {
  const rows = []

  let firstMileage = null
  let lastMileage  = null
  let prevIgnition = null   // last non-null ignition seen
  let prevTs       = null
  let idleStart    = null   // ts the current continuous idle began
  let lastBoundary = null   // last synthesized Excessive Idling ts
  let lastKept     = null   // last emitted position, for the tolerance test
  let lastLat = null, lastLng = null

  for (const m of messages) {
    const ts = m.timestamp
    if (ts == null) continue

    const speed = num(m['position.speed']) ?? 0
    const lat   = num(m['position.latitude'])
    const lng   = num(m['position.longitude'])
    if (lat != null && lng != null) { lastLat = lat; lastLng = lng }

    const mileage = num(m['vehicle.mileage'])
    if (mileage != null) {
      if (firstMileage == null) firstMileage = mileage
      lastMileage = mileage
    }
    const odoKm = (firstMileage != null && lastMileage != null) ? lastMileage - firstMileage : 0

    const rawIgn = m['engine.ignition.status']
    const ign = typeof rawIgn === 'boolean' ? rawIgn : prevIgnition
    const gapped = prevTs != null && ts - prevTs > MAX_GAP_SEC

    let statusKey
    if (ign === true && prevIgnition === false)  statusKey = 'startUp'
    else if (ign === false)                      statusKey = 'ignitionOff'
    else if (ign === true)                       statusKey = 'driving'
    // Ignition never reported by this device — fall back to motion so the row
    // still says something true. Defensive; all 10 devices report ignition.
    else statusKey = speed > 0 ? 'driving' : 'ignitionOff'

    const unlocked = gpsUnlocked(m)

    // Idle-episode bookkeeping. A Start up is excluded: the vehicle has just
    // been switched on, it is not yet idling.
    const idling = ign === true && speed === 0 && statusKey !== 'startUp'
    if (!idling || gapped) {
      idleStart = idling ? ts : null
      lastBoundary = null
    } else if (idleStart == null) {
      idleStart = ts
    }

    if (idleStart != null && ts - idleStart >= IDLE_SEC) {
      // First boundary at or after idleStart + 5min, then every 5min. Epoch
      // seconds divide evenly into 5-minute marks for every real UTC offset,
      // so this lands on wall-clock :00/:05/:10 like the sample.
      let b = Math.ceil((idleStart + IDLE_SEC) / IDLE_SEC) * IDLE_SEC
      if (lastBoundary != null) b = Math.max(b, lastBoundary + IDLE_SEC)
      for (; b <= ts; b += IDLE_SEC) {
        rows.push(makeRow({ ts: b, statusKey: 'excessiveIdling', speed: 0, odoKm, lat: lastLat, lng: lastLng, unlocked }))
        lastBoundary = b
      }
      prevIgnition = ign
      prevTs = ts
      continue
    }

    if (
      applyTolerance && toleranceMeters > 0 && statusKey === 'driving'
      && lastKept && lat != null && lng != null
      && haversineMeters(lastKept.lat, lastKept.lng, lat, lng) < toleranceMeters
    ) {
      prevIgnition = ign
      prevTs = ts
      continue
    }

    rows.push(makeRow({ ts, statusKey, speed, odoKm, lat, lng, unlocked }))
    if (lat != null && lng != null) lastKept = { lat, lng }
    prevIgnition = ign
    prevTs = ts
  }

  return rows
}

// ── fetch ─────────────────────────────────────────────────────────────────

/**
 * Fetch raw messages for every selected device, sequentially.
 *
 * Sequential on purpose: Flespi's REST rate limit is per-account, so firing ten
 * devices' chunks in parallel is the fastest way to earn a 429 on all of them.
 * fetchDeviceMessages already chunks per calendar day and survives 429 with a
 * visible countdown, and that countdown is forwarded through onProgress.
 *
 * @returns {Promise<Map<number, {messages: object[], truncated: boolean}>>}
 */
export async function fetchMovementMessages(deviceIds, fromTs, toTs, opts = {}) {
  const { onProgress, signal } = opts
  const byDevice = new Map()

  for (let i = 0; i < deviceIds.length; i++) {
    if (signal?.aborted) throw abortError()
    const id = deviceIds[i]
    const prefix = deviceIds.length > 1 ? `Vehicle ${i + 1}/${deviceIds.length} — ` : ''
    onProgress?.({ phase: 'fetch', done: i, total: deviceIds.length, text: `${prefix}fetching messages...` })

    const result = await fetchDeviceMessages(id, fromTs, toTs, {
      fields:   MOVEMENT_FIELDS,
      signal,
      onStatus: text => onProgress?.({ phase: 'fetch', done: i, total: deviceIds.length, text: `${prefix}${text}` }),
    })
    byDevice.set(id, result)
  }

  onProgress?.({ phase: 'fetch', done: deviceIds.length, total: deviceIds.length, text: 'Messages loaded' })
  return byDevice
}

function abortError() {
  const err = new Error('Cancelled')
  err.name = 'AbortError'
  return err
}

// ── grouping ──────────────────────────────────────────────────────────────

/**
 * Turn fetched messages into the grouped report structure. Pure and synchronous
 * — the page keeps the fetched messages in state and calls this again when the
 * status filter or tolerance changes, so re-filtering never touches the network.
 *
 * @param {Map<number, {messages, truncated}>} byDevice
 * @param {object} opts
 * @param {object[]} opts.vehicles  from useFlespiData — supplies name + master
 * @param {string[]} opts.statuses  status keys to keep
 * @returns {{vehicles: object[], totalRows: number, truncated: boolean}}
 */
export function deriveMovementReport(byDevice, opts = {}) {
  const {
    vehicles = [],
    statuses = AVAILABLE_STATUS_KEYS,
    applyTolerance = false,
    toleranceMeters = 0,
  } = opts

  const metaById = new Map(vehicles.map(v => [v.id, v]))
  const keep = new Set(statuses)
  const out = []
  let totalRows = 0
  let truncated = false

  for (const [deviceId, { messages, truncated: deviceTruncated }] of byDevice) {
    if (deviceTruncated) truncated = true

    const meta   = metaById.get(deviceId)
    const master = meta?.master
    const vehicleId = master?.plateNo || meta?.name || `Device ${deviceId}`
    const driverId  = master?.driver?.name || ''

    const allRows = deriveRows(messages, { applyTolerance, toleranceMeters })
    if (allRows.length === 0) continue

    // Vehicle and date totals are computed over ALL derived rows, before the
    // status filter. The group row summarises the vehicle over the reported
    // date range; narrowing the status list is a view of that range, not a
    // redefinition of it, so filtering to "Ignition off" must not make the
    // day's distance read 0.000.
    const statsByDate = new Map()
    let maxSpeed = 0
    for (const r of allRows) {
      if (r.speed > maxSpeed) maxSpeed = r.speed
      const k = dateKeyOf(r.ts)
      const s = statsByDate.get(k)
      if (s) { if (r.speed > s.maxSpeed) s.maxSpeed = r.speed }
      else statsByDate.set(k, { maxSpeed: r.speed })
    }
    const totalDistanceKm = allRows[allRows.length - 1].odoKm

    const rows = allRows.filter(r => keep.has(r.statusKey))
    if (rows.length === 0) continue

    const dates = []
    let current = null
    for (const r of rows) {
      const k = dateKeyOf(r.ts)
      if (!current || current.dateKey !== k) {
        current = {
          dateKey:  k,
          label:    formatDateLabel(new Date(r.ts * 1000)),
          maxSpeed: statsByDate.get(k)?.maxSpeed ?? 0,
          rows:     [],
        }
        dates.push(current)
      }
      current.rows.push(r)
    }

    totalRows += rows.length
    out.push({ deviceId, vehicleId, driverId, maxSpeed, totalDistanceKm, rowCount: rows.length, dates })
  }

  out.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId))
  return { vehicles: out, totalRows, truncated }
}

/** Every row in the report, in render order. */
export function flattenRows(report) {
  const rows = []
  for (const v of report.vehicles) {
    for (const d of v.dates) rows.push(...d.rows)
  }
  return rows
}

/** How many network lookups resolving this report's locations would cost. */
export function countPendingGeocodes(report) {
  return countUncached(flattenRows(report).filter(r => r.lat != null && r.lng != null))
}

// ── locations ─────────────────────────────────────────────────────────────

/**
 * Resolve the Location column in place, in render order, up to `limit` network
 * lookups. Rows past the limit (or whose lookup failed) keep `location: null`
 * and render their coordinates instead.
 *
 * Mutates the rows rather than rebuilding the report so the table can re-render
 * progressively while this runs.
 *
 * @returns {Promise<{resolved: number, skipped: number}>}
 */
export async function resolveReportLocations(report, opts = {}) {
  const { limit = Infinity, signal, onProgress } = opts
  const rows = flattenRows(report).filter(r => r.lat != null && r.lng != null)
  if (rows.length === 0) return { resolved: 0, skipped: 0 }

  const { addresses, resolved, skipped } = await reverseGeocodeMany(rows, {
    limit,
    signal,
    onProgress: (done, total) => onProgress?.({ phase: 'geocode', done, total, text: `Resolving addresses ${done}/${total}...` }),
  })

  for (const r of rows) {
    const hit = addresses.get(geocodeKey(r.lat, r.lng))
    // Six parts keeps the street/area/city detail the client's sample shows,
    // without the "...Emirate, United Arab Emirates" tail on every single row.
    if (hit) r.location = `${shortenAddress(hit, 6)};`
  }

  return { resolved, skipped }
}

/** What a row shows in the Location column right now. */
export function rowLocation(row) {
  if (row.location) return row.location
  if (row.lat != null && row.lng != null) return `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}`
  return ''
}

// ── orchestration ─────────────────────────────────────────────────────────

/**
 * Fetch, derive and geocode in one call.
 *
 * @param {number[]} deviceIds
 * @param {number} fromTs           unix seconds
 * @param {number} toTs             unix seconds
 * @param {string[]} statuses       status keys to keep
 * @param {number} toleranceMeters  0 disables the tolerance filter
 * @param {object} [options]        vehicles, applyTolerance, resolveAddresses,
 *                                  geocodeLimit, onProgress, signal
 */
export async function buildMovementReport(deviceIds, fromTs, toTs, statuses, toleranceMeters, options = {}) {
  const {
    vehicles = [],
    applyTolerance = toleranceMeters > 0,
    resolveAddresses = true,
    geocodeLimit = 600,
    onProgress,
    signal,
  } = options

  const byDevice = await fetchMovementMessages(deviceIds, fromTs, toTs, { onProgress, signal })

  onProgress?.({ phase: 'derive', done: 0, total: 1, text: 'Deriving movement rows...' })
  const report = deriveMovementReport(byDevice, { vehicles, statuses, applyTolerance, toleranceMeters })
  report.byDevice = byDevice
  report.geocoded = { resolved: 0, skipped: 0 }

  if (resolveAddresses && report.totalRows > 0) {
    report.geocoded = await resolveReportLocations(report, { limit: geocodeLimit, signal, onProgress })
  }

  onProgress?.({ phase: 'done', done: 1, total: 1, text: 'Report ready' })
  return report
}
