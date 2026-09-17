// Usage tab (and Vehicle Info's odometer/speed fields) data source: fetch a
// device's raw messages for "today" from Flespi and derive distance, running/
// idle/stop time, trip count and odometer from them. Same BASE_URL/HEADERS +
// 429 backoff schedule as replay.js, since it's the same endpoint and the same
// per-account rate limit.
import { BASE_URL, HEADERS } from '../hooks/flespiConfig'

const MAX_MESSAGES = 3000
const RETRY_DELAYS_SEC = [30, 60, 120]

// How long a fetched day's messages stay valid before Usage/Vehicle Info will
// re-fetch. Both tabs read through this cache, so switching between them
// within the window never issues a second request.
const CACHE_TTL_MS = 5 * 60 * 1000

// Gap above which we assume the device was off/out of coverage rather than
// idling or moving, so it doesn't get counted into running/idle/stop time.
const MAX_GAP_SEC = 30 * 60

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, onStatus) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS })
    if (res.status !== 429) {
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Flespi /messages ${res.status}: ${body}`)
      }
      return res.json()
    }

    if (attempt >= RETRY_DELAYS_SEC.length) {
      throw new Error('Flespi is still rate-limiting requests after several retries. Try again in a minute.')
    }
    const waitSec = RETRY_DELAYS_SEC[attempt]
    for (let remaining = waitSec; remaining > 0; remaining--) {
      onStatus?.(`Rate limit reached, retrying in ${remaining}s...`)
      await sleep(1000)
    }
  }
}

const cache = new Map() // deviceId -> { expiresAt, promise }

// Only the fields the calculations below actually read. Without this Flespi
// returns every parameter the device reports (~29-34 per message), which is
// ~5x the payload for data we immediately discard.
// movement.status and trip.status are deliberately absent: trip.status is not
// reported by these devices at all, and movement.status carries no usable
// signal (see computeUsage). Asking for them only inflates the payload.
// The fuel/temperature fields feed sensorsData.js's Sensors tab (Phase 3);
// position.direction and external.powersource.status feed alertsData.js's
// Alerts tab (Phase 4) — all added here rather than a second fetch so
// switching tabs never issues its own request.
const FIELDS = [
  'timestamp',
  'vehicle.mileage',
  'engine.ignition.status',
  'position.speed',
  'position.latitude',
  'position.longitude',
  'position.direction',
  'external.powersource.status',
  'fuel.sensor.value',
  'can.fuel.consumed',
  'can.fuel.consumed.high.resolution',
  'ble.sensor.temperature.1',
  'ble.sensor.temperature.2',
  'ble.sensor.temperature.3',
  'ble.sensor.temperature.4',
].join(',')

// Returns today's raw messages (00:00 local to now) for a device, sorted
// ascending by timestamp. Cached per device for CACHE_TTL_MS — the promise
// itself is cached (not just the resolved value) so Usage and Vehicle Info
// switching tabs before the first fetch lands share the one in-flight request
// instead of firing two.
export function fetchTodayMessages(deviceId, onStatus) {
  const cached = cache.get(deviceId)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const fromTs = Math.floor(midnight.getTime() / 1000)
  const toTs = Math.floor(now.getTime() / 1000)

  // Flespi takes these inside a JSON `data` object. Passed as top-level query
  // params they are silently ignored (HTTP 200 + the device's entire stored
  // history), and a bare comma-separated `data` value is a hard 400.
  const data = JSON.stringify({ from: fromTs, to: toTs, count: MAX_MESSAGES, fields: FIELDS })
  const url = `${BASE_URL}/gw/devices/${deviceId}/messages?data=${encodeURIComponent(data)}`
  const promise = fetchWithRetry(url, onStatus)
    .then(json => (json.result || []).slice().sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)))
    .catch(err => {
      cache.delete(deviceId) // don't cache a failure — next attempt should retry
      throw err
    })

  cache.set(deviceId, { expiresAt: Date.now() + CACHE_TTL_MS, promise })
  return promise
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Seconds elapsed since local midnight — the denominator for stop time.
function elapsedToday(nowMs) {
  const now = new Date(nowMs)
  const midnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.max(0, (nowMs - midnightMs) / 1000)
}

/**
 * Derive Usage-tab stats from a device's today-messages.
 *
 * All time totals are in seconds.
 *
 * Classification deliberately uses ignition + speed rather than the device's
 * own `movement.status`. On this account's hardware (Teltonika, codec 142)
 * `movement.status` is a boolean that reads `true` for every message of a
 * driving day including the ones at a standstill, so it cannot separate
 * running from idle. ignition+speed is also what replay.js's pointStatus() and
 * useFlespiMQTT's vehicleStatus() already use, so all three agree.
 *
 * `trip.status` is not reported by these devices at all, so trips are inferred
 * from reporting gaps instead — see below.
 *
 * Stop time is a whole-day residual, not a measured total: these devices only
 * transmit with the ignition on, so engine-off time produces no messages to
 * measure. Everything today that was not running or idling was stopped.
 *
 * @param {object[]} messages  today's messages, sorted ascending by timestamp
 * @param {number} [nowMs]     injectable clock; the residual is measured from
 *                             local midnight up to this instant
 */
export function computeUsage(messages, nowMs = Date.now()) {
  const result = {
    distanceKm: null,
    runningSec: 0,
    idleSec: 0,
    stopSec: 0,
    tripCount: 0,
    odometerKm: null,
    maxSpeed: 0,
    avgSpeed: null,
  }
  // No messages at all means the device never woke today, which is a full day
  // stopped — not an absence of data. Returning zero here would under-report it.
  if (!messages || messages.length === 0) {
    result.stopSec = elapsedToday(nowMs)
    return result
  }

  let firstMileage = null
  let lastMileage = null
  // Averaged over moving samples only. Including the stationary ones would
  // report the average of "driving and sitting at lights", which reads as
  // implausibly slow for a vehicle that spent the day on the highway.
  let movingSpeedSum = 0
  let movingSpeedCount = 0
  // These devices sleep when the ignition is off, so a driving session is a run
  // of messages with no long gap in it. A trip is counted the first time the
  // vehicle actually moves within such a session.
  let inTrip = false

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const mileage = num(m['vehicle.mileage'])
    if (mileage != null) {
      if (firstMileage == null) firstMileage = mileage
      lastMileage = mileage
    }

    const speed = num(m['position.speed']) ?? 0
    const ignition = m['engine.ignition.status'] ?? null
    if (speed > result.maxSpeed) result.maxSpeed = speed
    if (speed > 0) {
      movingSpeedSum += speed
      movingSpeedCount += 1
    }

    if (i > 0) {
      const prev = messages[i - 1]
      const dt = (m.timestamp ?? 0) - (prev.timestamp ?? 0)
      const prevSpeed = num(prev['position.speed']) ?? 0
      const prevIgnition = prev['engine.ignition.status'] ?? null

      if (dt > MAX_GAP_SEC) {
        // The device stopped reporting, which on this hardware means the
        // ignition was off. Attributed to neither running nor idling, so the
        // residual below absorbs it, and it ends the current trip.
        inTrip = false
      } else if (dt > 0 && prevIgnition !== false) {
        if (prevSpeed > 0) result.runningSec += dt
        else result.idleSec += dt
      }
    }

    if (ignition === false) inTrip = false
    if (speed > 0 && !inTrip) {
      result.tripCount += 1
      inTrip = true
    }
  }

  if (firstMileage != null && lastMileage != null) {
    result.distanceKm = lastMileage - firstMileage
  }
  result.odometerKm = lastMileage
  result.avgSpeed = movingSpeedCount > 0 ? movingSpeedSum / movingSpeedCount : null

  // Whole-day residual. Clamped because running+idle can marginally exceed the
  // elapsed day if a message timestamp runs slightly ahead of the local clock.
  result.stopSec = Math.max(0, elapsedToday(nowMs) - result.runningSec - result.idleSec)

  return result
}
