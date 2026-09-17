// Alerts tab data source (Phase 4). Flespi gives this fleet no native field
// for braking, cornering, acceleration, power-loss, fuel, or geofence events
// — every type below except Ignition ON/OFF and Document Expiry is derived
// client-side from position.speed, position.direction and
// engine.ignition.status (plus fuel.sensor.value / external.powersource.status
// if a device ever starts reporting them; none does today — see the Phase 4
// probe notes). Document Expiry reads the existing Documents module directly,
// independent of telemetry, so it still shows up for a device with zero
// messages today.
//
// Speed/heading derivatives are only computed across consecutive samples
// 1-10s apart, and discarded above NOISE_CEILING_MS2: these devices report at
// irregular intervals, so a naive delta across a multi-minute gap produces
// physically impossible values (tens of m/s²) that are reporting artifacts,
// not real events.

import { listDocuments, expiryState, daysUntilExpiry } from '../services/documentStore'

export const DEFAULT_THRESHOLDS = {
  overSpeedKmh: 80,
  harshBrakingMs2: 3.5,
  suddenAccelMs2: 3.5,
  corneringDeg: 45,
  corneringMinSpeedKmh: 20,
  excessiveIdleMin: 10,
  fuelFillPct: 10,
  fuelTheftPct: 10,
}

export const SEVERITY = {
  Critical: { label: 'Critical', color: '#ef4444' },
  High:     { label: 'High',     color: '#f97316' },
  Medium:   { label: 'Medium',   color: '#eab308' },
  Low:      { label: 'Low',      color: '#3b82f6' },
}
export const SEVERITY_KEYS = ['Critical', 'High', 'Medium', 'Low']
export const SEVERITY_FILTERS = ['All', ...SEVERITY_KEYS]

export const ALERT_TYPES = [
  { key: 'overSpeed',       label: 'Over Speed' },
  { key: 'harshBraking',    label: 'Harsh Braking' },
  { key: 'harshCornering',  label: 'Harsh Cornering' },
  { key: 'excessiveIdle',   label: 'Excessive Idle' },
  { key: 'suddenAccel',     label: 'Sudden Acceleration' },
  { key: 'geofenceEntry',   label: 'Geofence Entry' },
  { key: 'geofenceExit',    label: 'Geofence Exit' },
  { key: 'ignitionOn',      label: 'Ignition ON' },
  { key: 'ignitionOff',     label: 'Ignition OFF' },
  { key: 'powerDisconnect', label: 'Power Disconnect' },
  { key: 'fuelTheft',       label: 'Fuel Theft' },
  { key: 'fuelFilling',     label: 'Fuel Filling' },
  { key: 'documentExpiry',  label: 'Document Expiry' },
]

// Types with no possible data source at all right now — surfaced so the UI
// can say why the list is empty instead of implying a clean day.
export const UNAVAILABLE_NOTES = {
  geofenceEntry: 'Requires geofence setup — no geofences are configured for this account.',
  geofenceExit:  'Requires geofence setup — no geofences are configured for this account.',
}

// ── threshold persistence — global defaults with a per-vehicle override ────

const THRESHOLDS_KEY = 'ft_alert_thresholds'

function readOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(THRESHOLDS_KEY))
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
  } catch {
    return {}
  }
}

function writeOverrides(overrides) {
  try { localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(overrides)) } catch {}
}

export function getThresholds(vehicleId) {
  const overrides = readOverrides()[String(vehicleId)] ?? {}
  return { ...DEFAULT_THRESHOLDS, ...overrides }
}

export function saveThresholds(vehicleId, patch) {
  const overrides = readOverrides()
  const key = String(vehicleId)
  overrides[key] = { ...(overrides[key] ?? {}), ...patch }
  writeOverrides(overrides)
  return getThresholds(vehicleId)
}

export function resetThresholds(vehicleId) {
  const overrides = readOverrides()
  delete overrides[String(vehicleId)]
  writeOverrides(overrides)
  return getThresholds(vehicleId)
}

// ── detection ────────────────────────────────────────────────────────────

// Gap above which two messages are treated as unrelated (device went quiet),
// same convention as usageData.js's MAX_GAP_SEC — no episode spans it.
const MAX_GAP_SEC = 30 * 60
// A derived value beyond this is a reporting artifact, not a real event.
const NOISE_CEILING_MS2 = 10

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function loc(m) {
  return { lat: num(m['position.latitude']), lng: num(m['position.longitude']) }
}

// One alert per contiguous over-speed episode (not one per message), using
// the episode's peak speed for severity and location.
function detectOverSpeed(messages, thresholds) {
  const alerts = []
  let episode = null
  let prevTs = null

  const close = () => {
    if (!episode) return
    const severity = episode.peak.speed > thresholds.overSpeedKmh + 30 ? 'High' : 'Medium'
    alerts.push({
      type: 'overSpeed', severity,
      ts: episode.peak.ts, lat: episode.peak.lat, lng: episode.peak.lng,
      detail: `${episode.peak.speed} km/h (limit ${thresholds.overSpeedKmh})`,
    })
    episode = null
  }

  for (const m of messages) {
    const speed = num(m['position.speed']) ?? 0
    const ts = m.timestamp
    if (prevTs != null && ts - prevTs > MAX_GAP_SEC) close()

    if (speed > thresholds.overSpeedKmh) {
      const { lat, lng } = loc(m)
      if (!episode || speed > episode.peak.speed) episode = { peak: { speed, ts, lat, lng } }
    } else {
      close()
    }
    prevTs = ts
  }
  close()
  return alerts
}

// Harsh Braking and Sudden Acceleration both come from the same guarded
// speed-derivative — see file header for why the dt/ceiling guards exist.
function detectPseudoAcceleration(messages, thresholds) {
  const alerts = []
  let prev = null

  for (const m of messages) {
    if (prev != null) {
      const dt = m.timestamp - prev.timestamp
      if (dt >= 1 && dt <= 10) {
        const dv = ((num(m['position.speed']) ?? 0) - (num(prev['position.speed']) ?? 0)) / 3.6
        const a = dv / dt
        const { lat, lng } = loc(m)

        if (a <= -thresholds.harshBrakingMs2 && Math.abs(a) <= NOISE_CEILING_MS2) {
          const severity = Math.abs(a) > thresholds.harshBrakingMs2 + 5 ? 'Critical' : 'High'
          alerts.push({ type: 'harshBraking', severity, ts: m.timestamp, lat, lng, detail: `${a.toFixed(1)} m/s²` })
        } else if (a >= thresholds.suddenAccelMs2 && a <= NOISE_CEILING_MS2) {
          alerts.push({ type: 'suddenAccel', severity: 'High', ts: m.timestamp, lat, lng, detail: `+${a.toFixed(1)} m/s²` })
        }
      }
    }
    prev = m
  }
  return alerts
}

function detectHarshCornering(messages, thresholds) {
  const alerts = []
  let prev = null

  for (const m of messages) {
    const speed = num(m['position.speed']) ?? 0
    if (prev != null && speed > thresholds.corneringMinSpeedKmh) {
      const dt = m.timestamp - prev.timestamp
      const h1 = num(m['position.direction'])
      const h0 = num(prev['position.direction'])
      if (dt >= 1 && dt <= 10 && h1 != null && h0 != null) {
        const raw = Math.abs(h1 - h0)
        const diff = Math.min(raw, 360 - raw)
        if (diff >= thresholds.corneringDeg) {
          const { lat, lng } = loc(m)
          alerts.push({ type: 'harshCornering', severity: 'High', ts: m.timestamp, lat, lng, detail: `${Math.round(diff)}° turn at ${speed} km/h` })
        }
      }
    }
    prev = m
  }
  return alerts
}

// One alert per idle episode that crosses the threshold, emitted once (at the
// point it crosses, not repeated for every message the episode continues).
function detectExcessiveIdle(messages, thresholds) {
  const alerts = []
  const idleSec = thresholds.excessiveIdleMin * 60
  let episode = null
  let prevTs = null

  for (const m of messages) {
    const speed = num(m['position.speed']) ?? 0
    const ignition = m['engine.ignition.status'] ?? null
    const ts = m.timestamp
    const isIdle = ignition === true && speed === 0

    if (isIdle && episode && prevTs != null && ts - prevTs <= MAX_GAP_SEC) {
      episode.accSec += ts - prevTs
      if (!episode.flagged && episode.accSec >= idleSec) {
        alerts.push({
          type: 'excessiveIdle', severity: 'Medium', ts: episode.startTs,
          lat: episode.startLoc.lat, lng: episode.startLoc.lng,
          detail: `Idle ${Math.round(episode.accSec / 60)}m+`,
        })
        episode.flagged = true
      }
    } else if (isIdle) {
      episode = { startTs: ts, startLoc: loc(m), accSec: 0, flagged: false }
    } else {
      episode = null
    }
    prevTs = ts
  }
  return alerts
}

function detectIgnitionTransitions(messages) {
  const alerts = []
  let prev = null
  for (const m of messages) {
    const ignition = m['engine.ignition.status'] ?? null
    if (prev != null && ignition != null && ignition !== prev['engine.ignition.status']) {
      const { lat, lng } = loc(m)
      alerts.push({
        type: ignition ? 'ignitionOn' : 'ignitionOff', severity: 'Low',
        ts: m.timestamp, lat, lng,
        detail: ignition ? 'Ignition turned on' : 'Ignition turned off',
      })
    }
    prev = m
  }
  return alerts
}

// Never fires on this fleet today — external.powersource.status is not
// reported by any device — but is wired against the real field name so it
// starts working the moment one is.
function detectPowerDisconnect(messages) {
  const alerts = []
  let prev = null
  for (const m of messages) {
    const status = m['external.powersource.status']
    if (prev != null && status === false && prev['external.powersource.status'] === true) {
      const { lat, lng } = loc(m)
      alerts.push({ type: 'powerDisconnect', severity: 'Critical', ts: m.timestamp, lat, lng, detail: 'External power lost' })
    }
    prev = m
  }
  return alerts
}

// Fuel Theft/Filling — same never-fires-today caveat as Power Disconnect;
// fuel.sensor.value is not reported by any device in this fleet right now.
function detectFuel(messages, thresholds) {
  const alerts = []
  let prev = null
  for (const m of messages) {
    const level = num(m['fuel.sensor.value'])
    const prevLevel = prev ? num(prev['fuel.sensor.value']) : null
    if (level != null && prevLevel != null) {
      const delta = level - prevLevel
      const { lat, lng } = loc(m)
      if (delta >= thresholds.fuelFillPct) {
        alerts.push({ type: 'fuelFilling', severity: 'Medium', ts: m.timestamp, lat, lng, detail: `+${delta.toFixed(0)}%` })
      } else if (delta <= -thresholds.fuelTheftPct && prev['engine.ignition.status'] === false) {
        alerts.push({ type: 'fuelTheft', severity: 'Critical', ts: m.timestamp, lat, lng, detail: `${delta.toFixed(0)}% while off` })
      }
    }
    prev = m
  }
  return alerts
}

// Independent of telemetry — reads the Documents module directly, so a
// device with zero messages today can still surface a due/expired document.
function detectDocumentExpiry(vehicleId) {
  const now = Date.now()
  return listDocuments(vehicleId)
    .map(doc => ({ doc, state: expiryState(doc, now), days: daysUntilExpiry(doc, now) }))
    .filter(x => x.state === 'expired' || x.state === 'due')
    .map(({ doc, state, days }) => ({
      type: 'documentExpiry',
      severity: state === 'expired' ? 'High' : 'Medium',
      ts: Math.floor(now / 1000),
      lat: null, lng: null,
      detail: state === 'expired' ? `${doc.name} expired ${-days}d ago` : `${doc.name} expires in ${days}d`,
    }))
}

let seq = 0
function withId(a) {
  seq += 1
  return { id: `${a.type}-${a.ts}-${seq}`, ...a }
}

/**
 * @param {object[]} messages   today's messages, sorted ascending (from fetchTodayMessages)
 * @param {object} vehicle      the vehicle object — only `.id` is read (for documents)
 * @param {object} [thresholds] see DEFAULT_THRESHOLDS / getThresholds()
 * @returns alerts sorted newest first
 */
export function computeAlerts(messages, vehicle, thresholds = DEFAULT_THRESHOLDS) {
  const msgs = messages || []
  const raw = [
    ...detectOverSpeed(msgs, thresholds),
    ...detectPseudoAcceleration(msgs, thresholds),
    ...detectHarshCornering(msgs, thresholds),
    ...detectExcessiveIdle(msgs, thresholds),
    ...detectIgnitionTransitions(msgs),
    ...detectPowerDisconnect(msgs),
    ...detectFuel(msgs, thresholds),
    ...detectDocumentExpiry(vehicle.id),
  ]
  return raw.map(withId).sort((a, b) => b.ts - a.ts)
}
