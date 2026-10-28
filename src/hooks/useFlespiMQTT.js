import { useSyncExternalStore } from 'react'
import { BASE_URL, HEADERS, hasFlespiToken } from './flespiConfig'
import { normalizeMaster, cacheRawMetadata } from '../services/vehicleMaster'
import { useScopedSnapshot } from '../data/fleetScope'

// Live fleet state, kept fresh by polling the Flespi proxy.
//
// This used to be an MQTT connection from the browser straight to Flespi, which
// needed a Flespi token IN the browser — one shared demo token, or one minted
// per user in real mode. The client asked for a single Flespi key, kept on the
// server, so the browser now asks the proxy (hooks/flespiConfig.js) for the
// latest telemetry every POLL_MS instead. The hook keeps its name and its
// snapshot shape, so the Live Map, Dashboard, alerts and every other consumer
// are unchanged.
//
// One request per POLL_MS for the whole fleet (the telemetry endpoint answers
// for every device at once), paused while the tab is hidden, and slowed down on
// a 429 so a Flespi rate limit is never made worse.
const POLL_MS          = 10_000
const RATE_LIMIT_MS    = 60_000
const META_REFRESH_MS  = 5 * 60_000
const TEARDOWN_GRACE_MS = 300
const RATE_NOTICE      = 'Rate limited by Flespi, retrying...'

const warn = (...a) => { if (import.meta.env.DEV) console.warn('[FlespiLive]', ...a) }

function vehicleStatus(v) {
  if (!v || v.lastTs == null) return 'NoData'
  if (Date.now() / 1000 - v.lastTs > 86400) return 'Inactive'
  const { ignition, speed } = v
  if (ignition === true  && (speed ?? 0) > 0) return 'Running'
  if (ignition === true  && (speed ?? 0) === 0) return 'Idle'
  if (ignition === false) return 'Stopped'
  return 'NoData'
}

// Device list: names, IMEIs and vehicle master data. Re-read every
// META_REFRESH_MS so a renamed or newly added device shows up.
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

// Latest telemetry for every device in one request — what each poll fetches.
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

// ── Shared state ────────────────────────────────────────────────────────────
// Every useFlespiMQTT() caller shares one poll loop.
const vehiclesById = new Map()
let metaById       = new Map()
let refCount       = 0
let teardownTimer  = null
let pollTimer      = null
let running        = false
let lastMetaAt     = 0

let snapshot = {
  vehicles: [], isConnected: false, lastUpdated: null,
  error: null, mqttFatalError: null, mqttRetryNotice: null,
  /** This account reaches no device: a settled empty state, not a pending one. */
  noVehicles: false,
  tokenError: null,
}
const listeners = new Set()

function publish(patch) {
  // A patch that changes nothing is dropped. useSyncExternalStore compares the
  // snapshot by identity, so re-publishing the same values would re-render every
  // consumer for no reason — and the no-token path below is re-evaluated on every
  // token-store change, which makes that a real cost rather than a theoretical one.
  if (Object.keys(patch).every(k => snapshot[k] === patch[k])) return
  snapshot = { ...snapshot, ...patch }
  listeners.forEach(l => l())
}

function rebuildVehicles() {
  return Array.from(vehiclesById.values())
}

// Applies device names/idents. Also creates entries for devices with no
// telemetry yet, so the list populates as soon as names land.
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
// an earlier poll already applied. This snapshot is a point-in-time read taken when
// the request was issued; a newer reading must never be rewound by an older one.
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


// ── Poll loop ───────────────────────────────────────────────────────────────

function schedule(ms) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = running ? setTimeout(pollOnce, ms) : null
}

async function pollOnce() {
  pollTimer = null
  if (!running) return
  // Hidden tab: nobody is looking, so spend no requests. The visibility listener
  // below polls again the moment the tab comes back.
  if (typeof document !== 'undefined' && document.hidden) return schedule(POLL_MS)
  if (!hasFlespiToken()) {
    publish({ isConnected: false })
    return schedule(POLL_MS)
  }

  try {
    if (Date.now() - lastMetaAt > META_REFRESH_MS) {
      const meta = await fetchDeviceMeta()
      applyDeviceMeta(meta)
      lastMetaAt = Date.now()
      publish({ noVehicles: meta.size === 0 })
    }
    applyTelemetrySnapshot(await fetchTelemetrySnapshot())
    publish({
      isConnected: true, lastUpdated: new Date(),
      error: null, mqttFatalError: null, mqttRetryNotice: null,
    })
    schedule(POLL_MS)
  } catch (e) {
    if (e.status === 429) {
      warn('rate limited — slowing down')
      publish({ mqttRetryNotice: RATE_NOTICE })
      schedule(RATE_LIMIT_MS)
    } else {
      warn('poll failed —', e.message)
      publish({ isConnected: false, error: e.message })
      schedule(POLL_MS * 3)
    }
  }
}

function onVisible() {
  if (running && !document.hidden) schedule(0)
}

function start() {
  if (running) return
  running = true
  lastMetaAt = 0
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  schedule(0)
}

function stop() {
  running = false
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  publish({ isConnected: false })
}

function subscribe(callback) {
  listeners.add(callback)
  refCount += 1
  if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null }
  start()
  return () => {
    listeners.delete(callback)
    refCount -= 1
    // Grace period so React StrictMode's mount→cleanup→mount does not restart
    // the loop.
    if (refCount === 0) {
      teardownTimer = setTimeout(() => { if (refCount === 0) stop() }, TEARDOWN_GRACE_MS)
    }
  }
}

function getSnapshot() {
  return snapshot
}

/**
 * The live fleet, scoped to what the signed-in account may see.
 *
 * In real mode the proxy already answers with this account's devices only — that
 * is the boundary. useScopedSnapshot still filters by IMEI on top (and covers the
 * Super Admin case, whose proxy scope is the whole account). In mock mode it
 * returns the snapshot unchanged.
 */
export function useFlespiMQTT() {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  return useScopedSnapshot(snap)
}
