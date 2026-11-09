import { useSyncExternalStore } from 'react'
import { BASE_URL, HEADERS, hasFlespiToken } from './flespiConfig'
import { IS_REAL, API_URL } from '../data/mode'
import { normalizeMaster, cacheRawMetadata } from '../services/vehicleMaster'
import { useScopedSnapshot } from '../data/fleetScope'
import { liveFuelLevel, liveTemperature, probeTemperature, flatTelemetry } from '../utils/sensorReadings'

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
    `${BASE_URL}/gw/devices/all/telemetry/position.latitude,position.longitude,position.speed,position.direction,engine.ignition.status,timestamp,fuel.sensor.value,ble.sensor.temperature.1,ble.sensor.humidity.1,ble.sensor.battery.voltage.1,ibutton.code`,
    { headers: HEADERS }
  )
  if (!res.ok) {
    const err = new Error(`Telemetry API ${res.status}: ${res.statusText}`)
    err.status = res.status
    throw err
  }
  return parseTelemetry((await res.json()).result)
}

/** Flespi-shaped telemetry items → id → our reading. Polling and the live stream both feed this. */
function parseTelemetry(items) {
  const snap = new Map()
  ;(items || []).forEach(item => {
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
      // Only when that field itself was reported lately, and not a no-probe 0
      // (utils/sensorReadings.js): a stale or placeholder value is no reading.
      fuelLevel:    liveFuelLevel(t),
      temperature:  liveTemperature(t),
      // The last real reading however old, for "Last Temperature · 7 h ago".
      temperatureLast:   probeTemperature(flatTelemetry(t), 1),
      temperatureLastTs: t['ble.sensor.temperature.1']?.ts ?? null,
      // Driver-ID tag (iButton) and when it was last read; Settings > Driver maps it to a name.
      ibutton:      typeof t['ibutton.code']?.value === 'string' ? t['ibutton.code'].value : null,
      ibuttonTs:    t['ibutton.code']?.ts ?? null,
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
      temperatureLast:   prev.temperatureLast   ?? null,
      temperatureLastTs: prev.temperatureLastTs ?? null,
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
      // Not carried from the previous poll: a reading that went stale or
      // turned out to be a placeholder is no longer current.
      fuelLevel:   tel.fuelLevel   ?? null,
      temperature: tel.temperature ?? null,
      temperatureLast:   tel.temperatureLast   ?? prev.temperatureLast   ?? null,
      temperatureLastTs: tel.temperatureLastTs ?? prev.temperatureLastTs ?? null,
      ibutton:     tel.ibutton     ?? prev.ibutton     ?? null,
      ibuttonTs:   tel.ibuttonTs   ?? prev.ibuttonTs   ?? null,
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
    schedule(streamLive ? STREAM_POLL_MS : POLL_MS)
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

// ── Live push ───────────────────────────────────────────────────────────────
// GET /api/live/stream pushes each vehicle's update as the Flespi webhook
// delivers it (server routes/live.js), so the map moves within a second or two
// instead of on the next 10-second poll. Read with fetch rather than
// EventSource so the login token rides in the Authorization header. While it
// is live, polling drops to once a minute (device names, and a safety net);
// when it ends or fails — webhook off (204), network, server restart — polling
// goes straight back to every 10 s and the stream is retried a little later.

const STREAM_POLL_MS = 60_000
const STREAM_RETRY_MS = 30_000
let streamLive = false
let streamAbort = null
let streamRetry = null

function handleStreamEvent(event, data) {
  if (event === 'snapshot' || event === 'update') {
    applyTelemetrySnapshot(parseTelemetry(JSON.parse(data).result))
    publish({ isConnected: true, lastUpdated: new Date(), error: null, mqttFatalError: null, mqttRetryNotice: null })
  }
}

async function runStream() {
  streamRetry = null
  if (!running || !IS_REAL || !hasFlespiToken() || streamAbort) return
  const ctrl = new AbortController()
  streamAbort = ctrl
  try {
    const res = await fetch(`${API_URL}/api/live/stream`, { headers: { Authorization: HEADERS.Authorization }, signal: ctrl.signal })
    if (res.status !== 200 || !res.body) throw new Error(`live stream ${res.status}`)
    streamLive = true
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        let event = 'message'
        const data = []
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trim())
        }
        if (data.length) {
          try { handleStreamEvent(event, data.join('\n')) } catch (e) { warn('bad live event —', e.message) }
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') warn('live stream unavailable —', e.message)
  } finally {
    const wasLive = streamLive
    streamLive = false
    if (streamAbort === ctrl) streamAbort = null
    if (running) {
      if (wasLive) schedule(0) // back to 10-second polling at once
      streamRetry = setTimeout(runStream, STREAM_RETRY_MS)
    }
  }
}

function stopStream() {
  if (streamRetry) { clearTimeout(streamRetry); streamRetry = null }
  streamAbort?.abort()
  streamAbort = null
  streamLive = false
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
  if (IS_REAL) streamRetry = setTimeout(runStream, 1500) // after the first poll has the device list
}

function stop() {
  running = false
  stopStream()
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
