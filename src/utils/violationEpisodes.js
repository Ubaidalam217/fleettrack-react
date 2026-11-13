// Each violation's From, To, Duration and speed for the violation reports
// (client, 2026-11-13: Ctrack's Violation Details / Locations / Summary /
// Statistics show "From, To, Duration, Speed (Kph)").
//
// The alert engine now stores a lasting violation's end with its event —
// endedAt / durationSec / peakValue (server/src/lib/alertEngine.js, "episodes").
// Older events, and one still going on, carry only the moment they were raised;
// for those the span is read back from the vehicle's messages by the rule the
// engine itself applies:
//
//   over speed / zone speed   from the first reading over the limit until one
//                             back under limit − 5 km/h (the engine's hysteresis)
//   idle                      ignition on and under 3 km/h, until it moves or
//                             the engine is switched off
//   night driving             the run of driving
//   suspended driver          the run with the engine on
//   harsh braking / accel     the hard stop or launch itself
//   anything else             the moment itself: From = To, 0 s, the speed then

import { harshEpisodes } from './harshEvents'
import { limitIn } from './violationSpan'

/** Mirrors SPEED_HYSTERESIS_KMH and STILL_KMH in server/src/lib/alertEngine.js. */
export const SPEED_HYSTERESIS_KMH = 5
export const STILL_KMH = 3
/** A gap longer than this between two messages ends a run: nothing is known inside it. */
export const MAX_GAP_SEC = 10 * 60
/** How far the reading that describes a moment may be from it (eventOccurrence.js TRACK_WINDOW_SEC). */
export const NEAR_SEC = 15 * 60
/** The engine reads telemetry up to this old (FRESH_SEC), so a run may begin this long before its alert. */
const LOOK_BACK_SEC = 15 * 60
const LOOK_AHEAD_SEC = 120

/** Types whose Speed column is the worst speed of the episode. */
export const PEAK_SPEED_TYPES = new Set(['overspeed', 'geofence_speed', 'night_driving', 'suspended_driver'])

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const speedOf = m => num(m['position.speed']) ?? 0
const tsOf = iso => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

/** Index of the last message at or before t, or -1. Messages are oldest first. */
function lastAtOrBefore(messages, t) {
  let lo = 0, hi = messages.length - 1, hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (messages[mid].timestamp <= t) { hit = mid; lo = mid + 1 } else hi = mid - 1
  }
  return hit
}

/** The message that describes moment t: the last one before it, else the first after, within NEAR_SEC. */
export function messageAt(messages, t) {
  if (!messages?.length || t == null) return null
  const i = lastAtOrBefore(messages, t)
  const before = i >= 0 ? messages[i] : null
  const after = i + 1 < messages.length ? messages[i + 1] : null
  if (before && t - before.timestamp <= NEAR_SEC) return before
  if (after && after.timestamp - t <= NEAR_SEC) return after
  return null
}

/** Worst speed between two moments, or null when no message falls inside. */
export function maxSpeedBetween(messages, fromTs, toTs) {
  let max = null
  for (const m of messages ?? []) {
    if (m.timestamp < fromTs || m.timestamp > toTs) continue
    const s = num(m['position.speed'])
    if (s !== null && (max === null || s > max)) max = s
  }
  return max
}

/**
 * The run of messages around `ts` while `holds` stays true: the matching
 * message nearest the alert (from LOOK_BACK_SEC before it to LOOK_AHEAD_SEC
 * after), grown back while `holdsBack` and forward while `holdsOn`.
 * Returns indexes [a, b], or null when nothing near the alert matches.
 */
function run(messages, ts, { start, holdsBack = start, holdsOn = start }) {
  let anchor = -1, gap = Infinity
  for (let i = 0; i < messages.length; i++) {
    const t = messages[i].timestamp
    if (t < ts - LOOK_BACK_SEC) continue
    if (t > ts + LOOK_AHEAD_SEC) break
    if (start(messages[i]) && Math.abs(t - ts) < gap) { gap = Math.abs(t - ts); anchor = i }
  }
  if (anchor < 0) return null
  let a = anchor, b = anchor
  while (a > 0 && holdsBack(messages[a - 1]) && messages[a].timestamp - messages[a - 1].timestamp <= MAX_GAP_SEC) a--
  while (b < messages.length - 1 && holdsOn(messages[b + 1]) && messages[b + 1].timestamp - messages[b].timestamp <= MAX_GAP_SEC) b++
  return [a, b]
}

/**
 * The end of a run is the first message that broke it (when it is close), as
 * the engine closes an episode on that reading; else the last one inside it.
 */
function endOf(messages, b) {
  const next = messages[b + 1]
  return next && next.timestamp - messages[b].timestamp <= MAX_GAP_SEC ? next.timestamp : messages[b].timestamp
}

/**
 * @param {object} event  an alert event (API shape): type, occurredAt, endedAt?,
 *   durationSec?, peakValue?, value?, message?, lat?, lng?
 * @param {object[]} messages  the vehicle's Flespi messages, oldest first
 * @param {object} [opts]
 * @param {number|null} [opts.limitKmh]  the over-speed rule's limit; else the one its message names
 * @param {(msg) => boolean} [opts.inZone]  zone speed: whether a reading is inside the zone
 * @param {number} [opts.harshMs2]  the harsh rule's threshold
 * @returns {{ fromTs: number, toTs: number, durationSec: number, speed: number|null,
 *   lat: number|null, lng: number|null, source: 'stored'|'track'|'moment' }}
 */
export function violationEpisode(event, messages = [], opts = {}) {
  const ts = tsOf(event.occurredAt)
  const list = Array.isArray(messages) ? messages : []
  const peakType = PEAK_SPEED_TYPES.has(event.type)
  const at = t => {
    const m = messageAt(list, t)
    return m ? { speed: num(m['position.speed']), lat: num(m['position.latitude']), lng: num(m['position.longitude']) } : null
  }
  const where = t => {
    if (num(event.lat) !== null && num(event.lng) !== null) return { lat: event.lat, lng: event.lng }
    const m = at(t)
    return { lat: m?.lat ?? null, lng: m?.lng ?? null }
  }

  // Stored by the engine: the end and the worst reading are facts, not estimates.
  const ended = tsOf(event.endedAt)
  if (ts !== null && ended !== null) {
    const durationSec = num(event.durationSec) ?? Math.max(0, ended - ts)
    const speed = peakType
      ? num(event.peakValue) ?? maxSpeedBetween(list, ts, ended) ?? num(event.value)
      : at(ts)?.speed ?? null
    return { fromTs: ts, toTs: ended, durationSec, speed, ...where(ts), source: 'stored' }
  }

  const moment = () => {
    const speed = event.type === 'overspeed' || event.type === 'geofence_speed'
      ? num(event.value) ?? at(ts)?.speed ?? null
      : at(ts)?.speed ?? null
    return { fromTs: ts, toTs: ts, durationSec: 0, speed, ...where(ts), source: 'moment' }
  }
  if (ts === null || !list.length) return moment()

  let span = null
  switch (event.type) {
    case 'overspeed':
    case 'geofence_speed': {
      const limit = num(opts.limitKmh) ?? limitIn(event.message) ?? (num(event.value) !== null ? event.value * 0.9 : null)
      if (limit === null) break
      const zone = event.type === 'geofence_speed' && opts.inZone ? opts.inZone : () => true
      const over = m => speedOf(m) > limit && zone(m)
      const still = m => speedOf(m) >= limit - SPEED_HYSTERESIS_KMH && zone(m)
      const r = run(list, ts, { start: over, holdsBack: still, holdsOn: still })
      if (!r) break
      let [a] = r
      const b = r[1]
      // Back through the hysteresis band only as far as the first reading over the limit.
      while (a < b && !over(list[a])) a++
      span = [a, b]
      break
    }
    case 'idle': {
      const idling = m => m['engine.ignition.status'] === true && speedOf(m) < STILL_KMH
      // The engine raises it once the idle has lasted the rule's minutes; it began earlier.
      const r = run(list, ts, { start: idling })
      if (r) span = r
      break
    }
    case 'night_driving': {
      const r = run(list, ts, { start: m => speedOf(m) > 0, holdsBack: m => speedOf(m) > 0, holdsOn: m => speedOf(m) > 0 })
      if (r) span = r
      break
    }
    case 'suspended_driver': {
      const on = m => m['engine.ignition.status'] === true || speedOf(m) > 0
      const r = run(list, ts, { start: on })
      if (r) span = r
      break
    }
    case 'harsh_braking':
    case 'harsh_acceleration': {
      const kind = event.type === 'harsh_acceleration' ? 'acceleration' : 'braking'
      const found = harshEpisodes(list, { kind, thresholdMs2: num(opts.harshMs2) ?? 1.5 })
      const hit = found.sort((x, y) => Math.abs(x.startTs - ts) - Math.abs(y.startTs - ts))[0]
      if (hit && Math.abs(hit.startTs - ts) <= 30) {
        return {
          fromTs: hit.startTs, toTs: hit.endTs, durationSec: Math.max(0, hit.endTs - hit.startTs),
          speed: at(hit.startTs)?.speed ?? null, ...where(hit.startTs), source: 'track',
        }
      }
      break
    }
    default:
      break
  }
  if (!span) return moment()

  const [a, b] = span
  const fromTs = list[a].timestamp
  const toTs = endOf(list, b)
  const speed = peakType
    ? Math.max(maxSpeedBetween(list, fromTs, list[b].timestamp) ?? 0, num(event.value) ?? 0) || null
    : at(fromTs)?.speed ?? null
  return { fromTs, toTs, durationSec: Math.max(0, toTs - fromTs), speed, ...where(fromTs), source: 'track' }
}

/**
 * The span the event map dialog draws (components/reports/EventTrackModal.jsx),
 * by the same rule as the reports' From / To / Duration, so the two agree:
 * the span the report passes, else the end the engine stored, else
 * violationEpisode's reading of the track.
 *
 * @param {object} event  { type, ts, span?: { startTs, endTs, speed? }, endedAt?, durationSec?,
 *   peakValue?, value?, message?, lat?, lng? }
 * @param {object[]} [messages]  the vehicle's messages around it, oldest first
 * @returns {{ startTs: number, endTs: number, speed: number|null, known: boolean }|null}
 *   known: the span did not need the track (it can be fetched from start to end)
 */
export function eventSpan(event, messages = [], opts = {}) {
  const given = event?.span
  if (given && Number.isFinite(given.startTs) && Number.isFinite(given.endTs) && given.endTs >= given.startTs) {
    return { startTs: given.startTs, endTs: given.endTs, speed: num(given.speed), known: true }
  }
  if (!Number.isFinite(event?.ts)) return null
  const ep = violationEpisode({ ...event, occurredAt: new Date(event.ts * 1000).toISOString() }, messages, opts)
  return { startTs: ep.fromTs, endTs: Math.max(ep.fromTs, ep.toTs), speed: ep.speed, known: ep.source === 'stored' }
}
