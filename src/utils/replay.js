// Replay/History: fetch a device's raw message history from Flespi and turn it
// into a plottable, playable track. Same BASE_URL/HEADERS + defensive field
// reads as VehicleActivity.jsx's /messages call, scoped to one device.
import { BASE_URL, HEADERS } from '../hooks/flespiConfig'
import { statusColor } from './vehicleStatus'

// Hard cap so one request can't ask Flespi for an unbounded reply. If a range
// hits the cap the track is silently incomplete, so callers should surface
// `truncated` rather than assume they got everything.
const MAX_MESSAGES = 3000

// Only the fields the track actually needs. Flespi otherwise returns every
// parameter the device reports (~29-34 per message) — on a 6h range that is
// 247KB of JSON to deliver 51KB of useful data.
const FIELDS = [
  'position.latitude',
  'position.longitude',
  'position.speed',
  // Course over ground — rotates the replay car and feeds the Heading field on
  // the floating info card.
  'position.direction',
  'engine.ignition.status',
  'timestamp',
].join(',')

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

    // Flespi takes from/to/count/fields inside a JSON `data` object. Passed as
    // top-level query params they are silently ignored — HTTP 200 with the
    // device's entire stored history (167 days / 37MB on this account), which
    // is what made every range behave identically and always look truncated.
    const data = JSON.stringify({
      from:   chunkFrom,
      to:     chunkTo,
      count:  MAX_MESSAGES,
      fields: FIELDS,
    })
    const url = `${BASE_URL}/gw/devices/${deviceId}/messages?data=${encodeURIComponent(data)}`
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
      const heading  = m['position.direction'] ?? m.direction ?? null
      const ignition = m['engine.ignition.status'] ?? m.ignition ?? null
      const ts       = m.timestamp ?? null

      return { lat, lng, speed, heading, ignition, ts, status: pointStatus(ignition, speed) }
    })
    .filter(Boolean)
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))

  return { points, truncated }
}

// react-leaflet has no multi-color single Polyline, so a colored trail means
// one <Polyline> per color run. One per *point pair* would also work but costs
// a Leaflet layer and an SVG path per pair — 385 of them on a routine 6h
// track. Merging consecutive same-status points into a single run drops that
// to 65 for identical output, and keeps the per-tick re-render cheap.
//
// Runs overlap by one point (each run ends on the first point of the next) so
// the trail has no visual gaps at the color boundaries.
export function buildSegments(points) {
  if (points.length < 2) return []

  const segments = []
  let start = 0

  for (let i = 1; i < points.length; i++) {
    if (points[i].status !== points[start].status) {
      // Pairs start..i-1 all carry points[start].status, so the run spans
      // points start..i — ending on i (not i-1) is what closes the gap.
      segments.push({
        key: start,
        positions: points.slice(start, i + 1).map(p => [p.lat, p.lng]),
        color: statusColor(points[start].status),
      })
      start = i
    }
  }

  // Trailing run. Skipped when start is already the last point, which happens
  // when the final point's status differs — that pair was emitted above, and a
  // one-point Polyline would be an invisible layer.
  if (start < points.length - 1) {
    segments.push({
      key: start,
      positions: points.slice(start).map(p => [p.lat, p.lng]),
      color: statusColor(points[start].status),
    })
  }

  return segments
}
