import { useSyncExternalStore } from 'react'
import mqtt from 'mqtt'
import { BASE_URL, HEADERS } from './flespiConfig'
import { normalizeMaster, cacheRawMetadata } from '../services/vehicleMaster'

// Flespi MQTT gateway — real-time push, replaces REST polling for live telemetry.
const MQTT_URL      = 'wss://mqtt.flespi.io:443'
const MQTT_USERNAME = import.meta.env.VITE_FLESPI_TOKEN
// Unique per browser tab/session, and always paired with `clean: true` below.
// Those two settings are only safe together in that combination:
//   - a fixed clientId makes the broker kick whichever tab connected first the
//     moment a second tab (or a stale reload) connects with the same id, which
//     reads to the user as endless "Reconnecting...";
//   - a random clientId with `clean: false` is worse — a persistent session is
//     keyed by clientId, so every page load asks the broker to retain a brand
//     new session forever, each holding a QoS-1 wildcard subscription queueing
//     messages for a client that will never come back. Those orphans count
//     against the account's mqtt_sessions cap, and once it is exceeded Flespi
//     refuses new CONNECTs with "Not authorized" — which looks exactly like a
//     token/ACL problem but is not.
// Random id + clean session: nothing is retained, nothing accumulates.
const CLIENT_ID      = 'fleettrack-dashboard-' + Math.random().toString(36).slice(2, 10)
const TOPIC          = 'flespi/message/gw/devices/+'
const RECONNECT_MS       = 5000
const REST_RETRY_MS      = 30000
const CONNECT_TIMEOUT_MS = 5000
// Flespi temporarily bans a token after too many failed / too-frequent CONNECTs
// and then refuses every attempt until the ban lifts. That is not permanent, so
// we close the socket (mqtt.js's own 5s retry loop only feeds the ban) and come
// back on a widening schedule that settles at one attempt every two minutes.
const BAN_RETRY_MS       = [30000, 60000, 120000]
const BAN_NOTICE         = 'Rate limited by Flespi, retrying...'
// Grace period before tearing down the shared connection once the last
// subscriber unmounts. Lets React StrictMode's synchronous mount→cleanup→mount
// dev-only double-invoke re-subscribe before we actually close the socket.
const TEARDOWN_GRACE_MS = 300

const log  = (...a) => { if (import.meta.env.DEV) console.log('[FlespiMQTT]', ...a) }
const warn = (...a) => { if (import.meta.env.DEV) console.warn('[FlespiMQTT]', ...a) }

// MQTT 5 CONNACK reason codes, surfaced by mqtt.js as `err.code`. Under MQTT
// 3.1.1 the broker only had "Not authorized" (5) to describe every refusal —
// bad token, missing ACL, session cap, active ban all looked identical — which
// is why the connection below negotiates protocol version 5.
const RC_FATAL       = new Set([132, 133, 134, 140]) // unsupported version, bad client id, bad credentials, bad auth method
const RC_RATE_LIMIT  = new Set([135, 136, 137, 138, 151, 159]) // not authorized, unavailable, busy, banned, quota, connect rate

// 'fatal' — retrying can never work without a code/token change.
// 'rate-limit' — temporary; back off and try again.
// 'transient' — socket-level noise; mqtt.js's own reconnect handles it.
function classifyError(e) {
  if (RC_FATAL.has(e.code))      return 'fatal'
  if (RC_RATE_LIMIT.has(e.code)) return 'rate-limit'
  // No reason code (pre-CONNACK failure, or a 3.1.1 fallback) — fall back to
  // the message text.
  if (/bad user ?name or password|malformed|unsupported protocol|client identifier/i.test(e.message)) return 'fatal'
  if (/banned|quota|rate exceeded|too many|not authoriz|server (unavailable|busy)/i.test(e.message))  return 'rate-limit'
  return 'transient'
}

function vehicleStatus(v) {
  if (!v || v.lastTs == null) return 'NoData'
  if (Date.now() / 1000 - v.lastTs > 86400) return 'Inactive'
  const { ignition, speed } = v
  if (ignition === true  && (speed ?? 0) > 0) return 'Running'
  if (ignition === true  && (speed ?? 0) === 0) return 'Idle'
  if (ignition === false) return 'Stopped'
  return 'NoData'
}

// One-time device fetch: names, IMEIs, and vehicle master data. This single
// call already existed for names, so master data costs no extra request.
async function fetchDeviceMeta() {
  const res = await fetch(`${BASE_URL}/gw/devices/all`, { headers: HEADERS })
  if (!res.ok) {
    const err = new Error(`Devices API ${res.status}: ${res.statusText}`)
    err.status = res.status
    throw err
  }
  const json = await res.json()
  const meta = new Map()
  ;(json.result || []).forEach(d => {
    // The IMEI is at configuration.ident — the device object has no top-level
    // `ident` field on this account, so the previous `d.ident` read was always
    // undefined and every vehicle carried an empty IMEI.
    const ident = d.configuration?.ident || ''

    // Stash the raw metadata so a later save can read-modify-write it without
    // a second GET. Tolerates metadata being absent entirely, which it is on
    // some devices.
    cacheRawMetadata(d.id, d.metadata)

    meta.set(d.id, {
      name:   d.name || ident || `Device ${d.id}`,
      ident,
      master: normalizeMaster(d.metadata),
    })
  })
  return meta
}

// One-time last-known-telemetry fetch. Seeds the dashboard with real
// position/speed/ignition data immediately, independent of whether the MQTT
// gateway ever delivers a live push (e.g. devices currently silent, or the
// token lacks MQTT ACL, see fatal-auth handling below).
async function fetchTelemetrySnapshot() {
  const res = await fetch(
    `${BASE_URL}/gw/devices/all/telemetry/position.latitude,position.longitude,position.speed,position.direction,engine.ignition.status,timestamp,fuel.sensor.value,ble.sensor.temperature.1`,
    { headers: HEADERS }
  )
  if (!res.ok) {
    const err = new Error(`Telemetry API ${res.status}: ${res.statusText}`)
    err.status = res.status
    throw err
  }
  const json = await res.json()
  const snap = new Map()
  ;(json.result || []).forEach(item => {
    const t = item.telemetry || {}
    const tsCandidates = Object.values(t).map(v => v?.ts).filter(Boolean)
    snap.set(item.id, {
      speed:    t['position.speed']?.value          ?? null,
      lat:      t['position.latitude']?.value        ?? null,
      lng:      t['position.longitude']?.value       ?? null,
      // Course over ground, 0-360. Drives the map car icon's rotation.
      heading:  t['position.direction']?.value       ?? null,
      ignition: t['engine.ignition.status']?.value    ?? null,
      lastTs:   t['timestamp']?.value ?? (tsCandidates.length ? Math.max(...tsCandidates) : null),
      // Sensors tab (Phase 3) — current fuel level / BLE probe temperature.
      fuelLevel:    t['fuel.sensor.value']?.value        ?? null,
      temperature:  t['ble.sensor.temperature.1']?.value ?? null,
    })
  })
  return snap
}

// Applies device names/idents. Also creates entries for devices that have not
// pushed an MQTT message yet, so the list populates as soon as names land.
function applyDeviceMeta(meta) {
  metaById = meta
  meta.forEach((m, id) => {
    const prev = vehiclesById.get(id) || {}
    const next = {
      ...prev,
      id,
      name:     m.name,
      ident:    m.ident,
      master:   m.master,
      speed:    prev.speed    ?? null,
      lat:      prev.lat      ?? null,
      lng:      prev.lng      ?? null,
      heading:  prev.heading  ?? null,
      ignition: prev.ignition ?? null,
      lastTs:   prev.lastTs   ?? null,
      fuelLevel:   prev.fuelLevel   ?? null,
      temperature: prev.temperature ?? null,
    }
    next.status = vehicleStatus(next)
    vehiclesById.set(id, next)
  })
  publish({ vehicles: rebuildVehicles() })
}

// Applies last-known telemetry, but only where it is actually newer than what
// MQTT has already delivered. This snapshot is a point-in-time read taken when
// the request was issued; live messages that arrive while it is in flight are
// fresher, and merging unconditionally visibly rewinds those vehicles.
function applyTelemetrySnapshot(telemetry) {
  telemetry.forEach((tel, id) => {
    const prev = vehiclesById.get(id) || {}
    const meta = metaById.get(id) || {}

    // Live data already present and at least as recent — leave it untouched.
    // A REST record with no timestamp also loses to any live record that has one.
    if (prev.lastTs != null && (tel.lastTs == null || tel.lastTs <= prev.lastTs)) return

    const next = {
      ...prev,
      id,
      name:     meta.name  || prev.name  || `Device ${id}`,
      ident:    meta.ident || prev.ident || '',
      master:   meta.master ?? prev.master ?? normalizeMaster(null),
      speed:    tel.speed    ?? prev.speed    ?? null,
      lat:      tel.lat      ?? prev.lat      ?? null,
      lng:      tel.lng      ?? prev.lng      ?? null,
      heading:  tel.heading  ?? prev.heading  ?? null,
      ignition: tel.ignition ?? prev.ignition ?? null,
      lastTs:   tel.lastTs   ?? prev.lastTs   ?? null,
      fuelLevel:   tel.fuelLevel   ?? prev.fuelLevel   ?? null,
      temperature: tel.temperature ?? prev.temperature ?? null,
    }
    next.status = vehicleStatus(next)
    vehiclesById.set(id, next)
  })
  publish({ vehicles: rebuildVehicles() })
}

// Fire-and-forget loader. Retries on 429 only; every other failure is swallowed
// after a dev-only warning. Nothing here is allowed to surface an error to the
// UI — MQTT is the source of truth and the app renders without waiting on REST.
function loadWithRetry(fetcher, apply, label) {
  fetcher()
    .then(result => {
      apply(result)
      log(`REST bootstrap: ${label} → ${result.size} device(s)`)
    })
    .catch(e => {
      if (e.status === 429) {
        warn(`REST bootstrap: ${label} rate-limited (429), retrying in ${REST_RETRY_MS / 1000}s`)
        setTimeout(() => loadWithRetry(fetcher, apply, label), REST_RETRY_MS)
      } else {
        warn(`REST bootstrap: ${label} failed (ignored, MQTT still populates) —`, e.message)
      }
    })
}

// One-time REST bootstrap, run entirely in the background. Never polled. The
// two requests are deliberately independent rather than Promise.all'd: device
// names are a small, fast response that can paint the vehicle list immediately
// instead of waiting on the much heavier telemetry call.
function loadInitialSnapshot() {
  loadWithRetry(fetchDeviceMeta,        applyDeviceMeta,        'device names')
  loadWithRetry(fetchTelemetrySnapshot, applyTelemetrySnapshot, 'telemetry snapshot')
}

// ── Singleton MQTT session ──────────────────────────────────────────────────
// Every useFlespiMQTT() caller shares this one connection. A broker boots the
// older session whenever a second client connects with the same client ID, so
// this module must only ever hold a single mqtt.connect() no matter how many
// components (Dashboard, the notification engine, ...) use the hook at once.
const vehiclesById = new Map()
let metaById        = new Map()
let client           = null
let refCount         = 0
let teardownTimer    = null
let banRetryTimer    = null
let banRetryIndex    = 0

let snapshot = {
  vehicles: [], isConnected: false, lastUpdated: null,
  error: null, mqttFatalError: null, mqttRetryNotice: null,
}
const listeners = new Set()

function publish(patch) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach(l => l())
}

function rebuildVehicles() {
  return Array.from(vehiclesById.values())
}

// `bootstrap: false` on ban retries — the REST snapshot already ran for this
// session, and hammering the same rate-limited token from a second angle only
// makes the ban worse.
function ensureClient({ bootstrap = true } = {}) {
  if (client) return

  if (!MQTT_USERNAME) {
    // No token at build time: every CONNECT would be refused, and the refusal
    // reads as a broker-side auth failure. Say what it actually is.
    publish({
      isConnected: false,
      mqttRetryNotice: null,
      mqttFatalError: 'No Flespi token configured (VITE_FLESPI_TOKEN).',
    })
    return
  }

  if (bootstrap) loadInitialSnapshot()

  log('connecting to', MQTT_URL, 'as', CLIENT_ID)

  client = mqtt.connect(MQTT_URL, {
    username:        MQTT_USERNAME,
    password:        '',
    clientId:        CLIENT_ID,
    // MQTT 5. Flespi then answers a refused CONNECT with a specific reason code
    // (Banned / Quota exceeded / Connection rate exceeded) instead of collapsing
    // every cause into 3.1.1's single "Not authorized", which is what lets the
    // error handler below tell a temporary ban apart from a genuinely bad token.
    protocolVersion: 5,
    // Nothing to resume across loads — the REST bootstrap above rebuilds the
    // full fleet state on every mount — so a clean session is all we need.
    clean:           true,
    reconnectPeriod: RECONNECT_MS,
    // Fail fast. The previous 30s meant a blocked or unresponsive broker left
    // the UI with no connection signal for half a minute before the first retry.
    connectTimeout:  CONNECT_TIMEOUT_MS,
  })

  client.on('connect', () => {
    log('CONNECTED')
    banRetryIndex = 0
    publish({ isConnected: true, error: null, mqttFatalError: null, mqttRetryNotice: null })
    client.subscribe(TOPIC, { qos: 1 }, (err, granted) => {
      if (err) warn('subscribe error:', err.message)
      else log('subscribed:', JSON.stringify(granted))
    })
  })

  // Connection dropped — keep last known vehicle data, client auto-reconnects.
  client.on('reconnect', () => { log('reconnecting…'); publish({ isConnected: false }) })
  client.on('close',     () => { log('connection closed'); publish({ isConnected: false }) })
  client.on('offline',   () => { log('offline'); publish({ isConnected: false }) })

  client.on('error', e => {
    warn('connection error:', e.message, e.code != null ? `(reason code ${e.code})` : '')
    const kind = classifyError(e)

    if (kind === 'fatal') {
      // The token itself is wrong or unusable. Retrying on a timer will never
      // succeed and just spams the broker with failed CONNECTs; a corrected
      // token requires an app reload anyway (env vars are build-time).
      publish({
        isConnected: false,
        mqttRetryNotice: null,
        mqttFatalError: `MQTT ${e.message}. Check that the Flespi token has MQTT gateway access enabled.`,
      })
      teardownClient()
    } else if (kind === 'rate-limit') {
      scheduleBanRetry()
    } else {
      publish({ error: e.message })
    }
  })

  client.on('message', (topic, payload) => {
    try {
      const parsed   = JSON.parse(payload.toString())
      const messages = Array.isArray(parsed) ? parsed : [parsed]

      messages.forEach(m => {
        const id = m.device_id ?? m['device.id'] ?? Number(topic.split('/').pop())
        if (id == null || Number.isNaN(id)) return

        const meta = metaById.get(id) || {}
        const prev = vehiclesById.get(id) || {}

        const next = {
          id,
          name:     meta.name  || prev.name  || `Device ${id}`,
          ident:    meta.ident || prev.ident || '',
          master:   meta.master ?? prev.master ?? normalizeMaster(null),
          speed:    m['position.speed']         ?? prev.speed    ?? null,
          lat:      m['position.latitude']      ?? prev.lat      ?? null,
          lng:      m['position.longitude']     ?? prev.lng      ?? null,
          heading:  m['position.direction']     ?? prev.heading  ?? null,
          ignition: m['engine.ignition.status'] ?? prev.ignition ?? null,
          lastTs:   m.timestamp ?? prev.lastTs ?? null,
          fuelLevel:   m['fuel.sensor.value']         ?? prev.fuelLevel   ?? null,
          temperature: m['ble.sensor.temperature.1']  ?? prev.temperature ?? null,
        }
        next.status = vehicleStatus(next)
        vehiclesById.set(id, next)
      })

      log(`message on ${topic}: ${messages.length} update(s)`)
      publish({ vehicles: rebuildVehicles(), lastUpdated: new Date() })
    } catch (e) {
      warn('message parse error:', e.message)
      publish({ error: e.message })
    }
  })
}

// Temporary refusal (ban / quota / connect-rate). Drop the socket so mqtt.js
// stops retrying every 5s — that traffic is what keeps a ban alive — and come
// back later on a widening delay. The UI keeps rendering the REST-seeded
// positions throughout, and a successful connect resets the backoff.
function scheduleBanRetry() {
  const delay = BAN_RETRY_MS[Math.min(banRetryIndex, BAN_RETRY_MS.length - 1)]
  banRetryIndex += 1

  publish({ isConnected: false, mqttFatalError: null, mqttRetryNotice: BAN_NOTICE })
  teardownClient()

  warn(`rate limited — retrying in ${delay / 1000}s (attempt ${banRetryIndex})`)
  if (banRetryTimer) clearTimeout(banRetryTimer)
  banRetryTimer = setTimeout(() => {
    banRetryTimer = null
    if (refCount > 0) ensureClient({ bootstrap: false })
  }, delay)
}

function teardownClient() {
  if (!client) return
  client.end(true)
  client = null
}

// Full stop: no consumers left, so cancel any pending ban retry too — otherwise
// it would silently reopen a socket for a dashboard nobody is looking at.
function teardownSession() {
  if (banRetryTimer) { clearTimeout(banRetryTimer); banRetryTimer = null }
  banRetryIndex = 0
  teardownClient()
}

function subscribe(callback) {
  listeners.add(callback)
  refCount += 1
  if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null }
  // A pending ban retry owns the next connect; reconnecting here would skip the
  // backoff and hand the broker exactly the burst it just banned us for.
  if (!banRetryTimer) ensureClient()
  return () => {
    listeners.delete(callback)
    refCount -= 1
    // Last consumer gone: wait a beat before tearing down the shared session,
    // so a StrictMode remount (or a route change that immediately re-mounts a
    // consumer) can cancel this instead of needlessly closing/reopening the socket.
    if (refCount === 0) {
      teardownTimer = setTimeout(() => {
        if (refCount === 0) teardownSession()
      }, TEARDOWN_GRACE_MS)
    }
  }
}

function getSnapshot() {
  return snapshot
}

export function useFlespiMQTT() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
