import { useSyncExternalStore } from 'react'
import mqtt from 'mqtt'
import { BASE_URL, HEADERS } from './flespiConfig'
import { normalizeMaster, cacheRawMetadata } from '../services/vehicleMaster'

// Flespi MQTT gateway — real-time push, replaces REST polling for live telemetry.
const MQTT_URL      = 'wss://mqtt.flespi.io:443'
const MQTT_USERNAME = import.meta.env.VITE_FLESPI_TOKEN
// Unique per browser tab/session. A fixed clientId makes the broker kick
// whichever tab connected first the moment a second tab (or a stale reload)
// connects with the same id, which reads to the user as endless "Reconnecting...".
const CLIENT_ID      = 'fleettrack-dashboard-' + Math.random().toString(36).slice(2, 10)
const TOPIC          = 'flespi/message/gw/devices/+'
const RECONNECT_MS       = 5000
const REST_RETRY_MS      = 30000
const CONNECT_TIMEOUT_MS = 5000
// Grace period before tearing down the shared connection once the last
// subscriber unmounts. Lets React StrictMode's synchronous mount→cleanup→mount
// dev-only double-invoke re-subscribe before we actually close the socket.
const TEARDOWN_GRACE_MS = 300

const log  = (...a) => { if (import.meta.env.DEV) console.log('[FlespiMQTT]', ...a) }
const warn = (...a) => { if (import.meta.env.DEV) console.warn('[FlespiMQTT]', ...a) }

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
    `${BASE_URL}/gw/devices/all/telemetry/position.latitude,position.longitude,position.speed,engine.ignition.status,timestamp`,
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
      ignition: t['engine.ignition.status']?.value    ?? null,
      lastTs:   t['timestamp']?.value ?? (tsCandidates.length ? Math.max(...tsCandidates) : null),
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
      ignition: prev.ignition ?? null,
      lastTs:   prev.lastTs   ?? null,
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
      ignition: tel.ignition ?? prev.ignition ?? null,
      lastTs:   tel.lastTs   ?? prev.lastTs   ?? null,
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

let snapshot = { vehicles: [], isConnected: false, lastUpdated: null, error: null, mqttFatalError: null }
const listeners = new Set()

function publish(patch) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach(l => l())
}

function rebuildVehicles() {
  return Array.from(vehiclesById.values())
}

function ensureClient() {
  if (client) return

  loadInitialSnapshot()

  log('connecting to', MQTT_URL, 'as', CLIENT_ID)

  client = mqtt.connect(MQTT_URL, {
    username:        MQTT_USERNAME,
    password:        '',
    clientId:        CLIENT_ID,
    clean:           false,
    reconnectPeriod: RECONNECT_MS,
    // Fail fast. The previous 30s meant a blocked or unresponsive broker left
    // the UI with no connection signal for half a minute before the first retry.
    connectTimeout:  CONNECT_TIMEOUT_MS,
  })

  client.on('connect', () => {
    log('CONNECTED')
    publish({ isConnected: true, error: null, mqttFatalError: null })
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
    warn('connection error:', e.message)
    const fatal = /not authorized|bad user name or password|not authoriz/i.test(e.message)
    if (fatal) {
      // Credentials/ACL problem: retrying on a timer will never succeed and
      // just spams the broker with failed CONNECTs. Stop and surface it clearly;
      // a fixed token requires an app reload anyway (env vars are build-time).
      publish({
        isConnected: false,
        mqttFatalError: `MQTT ${e.message}. Check that the Flespi token has MQTT gateway access enabled.`,
      })
      teardownClient()
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
          ignition: m['engine.ignition.status'] ?? prev.ignition ?? null,
          lastTs:   m.timestamp ?? prev.lastTs ?? null,
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

function teardownClient() {
  if (!client) return
  client.end(true)
  client = null
}

function subscribe(callback) {
  listeners.add(callback)
  refCount += 1
  if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null }
  ensureClient()
  return () => {
    listeners.delete(callback)
    refCount -= 1
    // Last consumer gone: wait a beat before tearing down the shared session,
    // so a StrictMode remount (or a route change that immediately re-mounts a
    // consumer) can cancel this instead of needlessly closing/reopening the socket.
    if (refCount === 0) {
      teardownTimer = setTimeout(() => {
        if (refCount === 0) teardownClient()
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
