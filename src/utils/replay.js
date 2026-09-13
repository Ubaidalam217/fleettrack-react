// Replay/History: fetch a device's raw message history from Flespi and turn it
// into a plottable, playable track. Same BASE_URL/HEADERS + defensive field
// reads as VehicleActivity.jsx's /messages call, scoped to one device.
import { BASE_URL, HEADERS } from '../hooks/flespiConfig'
import { statusColor } from './vehicleStatus'

// Hard cap so one request can't ask Flespi for an unbounded reply. If a range
// hits the cap the track is silently incomplete, so callers should surface
// `truncated` rather than assume they got everything.
const MAX_MESSAGES = 3000

// Flespi's REST rate limit is per-account/per-minute, not per-endpoint, so a
// wide range can trip it purely from the number of chunk requests below. Fixed
// backoff schedule rather than a computed one — predictable wait times are
// easier to show the user than a jittered/computed value.
const RETRY_DELAYS_SEC = [30, 60, 120]

// One request per calendar day of range, sequential. Keeps each request's
// response small and, more importantly, keeps our own request rate low
// enough to avoid re-triggering the 429 that chunking exists to survive.
const CHUNK_SECONDS = 86400

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Mirrors useFlespiMQTT's vehicleStatus() classifier (Running/Idle/Stopped),
// minus the "Inactive" branch — that's a live-staleness concept that doesn't
// apply to a historic point that already has a timestamp in range.
function pointStatus(ignition, speed) {
  if (ignition === true && (speed ?? 0) > 0) return 'Running'
  if (ignition === true && (speed ?? 0) === 0) return 'Idle'
  if (ignition === false) return 'Stopped'
  return 'NoData'
}

// Fetches one page, retrying on 429 with the fixed backoff schedule above.
// onStatus(text) is called with a user-friendly progress line for the UI —
// including a second-by-second retry countdown — never the raw HTTP error.
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
      throw new Error('Flespi is still rate-limiting requests after several retries. Try again in a minute, or narrow the date range.')
    }
    const waitSec = RETRY_DELAYS_SEC[attempt]
    for (let remaining = waitSec; remaining > 0; remaining--) {
      onStatus?.(`Rate limit reached, retrying in ${remaining}s...`)
      await sleep(1000)
    }
  }
}

// fromTs/toTs are unix seconds. Returns { points, truncated }; points are
// sorted ascending by timestamp and filtered to those with a position.
// onStatus(text), if given, receives human-readable progress (chunk position
// and any rate-limit retry countdown) — not raw errors.
export async function fetchDeviceTrack(deviceId, fromTs, toTs, onStatus) {
  const chunks = []
  for (let start = fromTs; start < toTs; start += CHUNK_SECONDS) {
    chunks.push([start, Math.min(start + CHUNK_SECONDS - 1, toTs)])
  }
  if (chunks.length === 0) chunks.push([fromTs, toTs])

  const allMsgs = []
  let truncated = false

  for (let i = 0; i < chunks.length; i++) {
    const [chunkFrom, chunkTo] = chunks[i]
    if (chunks.length > 1) onStatus?.(`Loading ${i + 1}/${chunks.length}...`)

    const url = `${BASE_URL}/gw/devices/${deviceId}/messages?from=${chunkFrom}&to=${chunkTo}&count=${MAX_MESSAGES}`
    const json = await fetchWithRetry(url, onStatus)
    const msgs = json.result || []
    if (msgs.length >= MAX_MESSAGES) truncated = true
    allMsgs.push(...msgs)
  }

  const points = allMsgs
    .map(m => {
      const lat = m['position.latitude'] ?? m.lat ?? null
      const lng = m['position.longitude'] ?? m.lng ?? null
      if (lat == null || lng == null) return null

      const speed    = m['position.speed'] ?? m['gps.speed'] ?? m.speed ?? 0
      const ignition = m['engine.ignition.status'] ?? m.ignition ?? null
      const ts       = m.timestamp ?? null

      return { lat, lng, speed, ignition, ts, status: pointStatus(ignition, speed) }
    })
    .filter(Boolean)
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))

  return { points, truncated }
}

// One Polyline segment per consecutive pair, colored by the status at the
// start of that segment — react-leaflet has no multi-color single Polyline,
// so a colored trail means one <Polyline> per run.
export function buildSegments(points) {
  const segments = []
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      key: i,
      positions: [[points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]],
      color: statusColor(points[i].status),
    })
  }
  return segments
}
