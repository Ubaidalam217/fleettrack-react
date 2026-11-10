/**
 * Where a violation began and ended (client, 2026-11-10: "upon clicking on
 * any event it will plot the event / violation on the map from start to
 * end"). An alert event carries only the moment it was raised; the span is
 * read back from the vehicle's messages around it, by what the rule watches:
 *
 *   over speed / zone speed  the run of readings over the limit
 *   idle                     the engine on with the vehicle standing
 *   night driving            the run of driving
 *   harsh braking / accel    the hard stop or launch itself
 *   anything else            the moment itself
 */

import { harshEpisodes } from './harshEvents'

/** How much track to read around each kind of event: [before, after] seconds. */
export function spanWindow(type) {
  switch (type) {
    case 'harsh_braking':
    case 'harsh_acceleration': return [120, 120]
    case 'idle': return [3 * 3600, 3600]
    case 'overspeed':
    case 'geofence_speed':
    case 'night_driving': return [1800, 3600]
    default: return [900, 900]
  }
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const speedOf = m => num(m['position.speed']) ?? 0

/** The speed limit an over-speed message names: "… (limit 120 km/h …". */
export function limitIn(message) {
  const m = /limit (\d+(?:\.\d+)?) ?km\/h/i.exec(message ?? '')
  return m ? Number(m[1]) : null
}

/** Index of the message nearest a time. */
function nearest(messages, ts) {
  let best = -1, gap = Infinity
  messages.forEach((m, i) => {
    const d = Math.abs(m.timestamp - ts)
    if (d < gap) { gap = d; best = i }
  })
  return best
}

/** Grow from the message nearest `ts` while `holds` stays true either side. */
function grow(messages, ts, holds) {
  const i = nearest(messages, ts)
  if (i < 0 || !holds(messages[i])) return null
  let a = i, b = i
  while (a > 0 && holds(messages[a - 1])) a--
  while (b < messages.length - 1 && holds(messages[b + 1])) b++
  return { startTs: messages[a].timestamp, endTs: messages[b].timestamp }
}

/**
 * @param {object} event    { type, ts, value?, message? }
 * @param {object[]} messages  the vehicle's messages around it, oldest first
 * @returns {{ startTs: number, endTs: number }}  the moment itself when nothing longer is found
 */
export function violationSpan(event, messages) {
  const point = { startTs: event.ts, endTs: event.ts }
  if (!messages?.length) return point
  let span = null
  switch (event.type) {
    case 'overspeed':
    case 'geofence_speed': {
      // The limit in the message; just under the speed recorded otherwise.
      const limit = limitIn(event.message) ?? (num(event.value) !== null ? event.value * 0.9 : null)
      if (limit !== null) span = grow(messages, event.ts, m => speedOf(m) > limit)
      break
    }
    case 'idle':
      span = grow(messages, event.ts, m => m['engine.ignition.status'] !== false && speedOf(m) < 3)
      break
    case 'night_driving':
      span = grow(messages, event.ts, m => speedOf(m) > 0)
      break
    case 'harsh_braking':
    case 'harsh_acceleration': {
      const kind = event.type === 'harsh_acceleration' ? 'acceleration' : 'braking'
      // The rule may have a lower threshold than the default; find the closest stop at any.
      const found = harshEpisodes(messages, { kind, thresholdMs2: 1.5 })
      const hit = found.sort((x, y) => Math.abs(x.startTs - event.ts) - Math.abs(y.startTs - event.ts))[0]
      if (hit && Math.abs(hit.startTs - event.ts) <= 30) span = { startTs: hit.startTs, endTs: hit.endTs }
      break
    }
    default:
      break
  }
  return span ?? point
}
