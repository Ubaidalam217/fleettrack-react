/**
 * The events a Live Map replay puts on the map, the timeline and the trip
 * list (client-approved replay "Option C", 2026-11-13: "event will show as dot
 * on map and clicking on them show the details and we can filter the events /
 * violations during replay").
 *
 * Two sources:
 *   - the server's alert events for the vehicle and range. Their From, To,
 *     Duration and peak speed come from the episode the engine stored
 *     (endedAt / durationSec / peakValue), else from the track, by the
 *     violation reports' own rule (violationEpisodes.js);
 *   - read off the track itself: harsh braking / acceleration (the reports'
 *     rule, harshEvents.js) and ignition on / off — each only where no alert
 *     event already says the same thing, so nothing is counted twice.
 *
 * Pure: no React, no network, no Date.now().
 */

import { violationEpisode } from './violationEpisodes'
import { limitIn } from './violationSpan'
import { harshEpisodes, HARSH_MS2 } from './harshEvents'

/**
 * The filter chips, in the panel's order. `core` chips are always shown (a
 * count of 0 says "none in this range"); the rest only when present.
 * `short` is the trip badge's word: "2 overspeed".
 */
export const EVENT_GROUPS = [
  { key: 'overspeed', label: 'Overspeed',      short: 'overspeed',  color: '#e53935', core: true,  types: ['overspeed'] },
  { key: 'harsh',     label: 'Harsh',          short: 'harsh',      color: '#fb8c00', core: true,  types: ['harsh_braking', 'harsh_acceleration', 'harsh_cornering'] },
  { key: 'idle',      label: 'Idle',           short: 'idle',       color: '#f2b705', core: true,  types: ['idle'] },
  { key: 'geofence',  label: 'Geofence',       short: 'geofence',   color: '#1e88e5', core: true,  types: ['geofence', 'geofence_enter', 'geofence_exit'] },
  { key: 'ignition',  label: 'Ignition',       short: 'ignition',   color: '#90a4ae', core: true,  types: ['ignition_on', 'ignition_off'] },
  { key: 'zoneSpeed', label: 'Geo Zone Speed', short: 'zone speed', color: '#d81b60', core: false, types: ['geofence_speed'] },
  { key: 'tamper',    label: 'Tamper',         short: 'tamper',     color: '#7e57c2', core: false, types: ['tamper'] },
  { key: 'battery',   label: 'Battery Tamper', short: 'battery',    color: '#00897b', core: false, types: ['battery_tamper'] },
  { key: 'sos',       label: 'SOS',            short: 'SOS',        color: '#b71c1c', core: false, types: ['panic'] },
  { key: 'other',     label: 'Other',          short: 'other',      color: '#607d8b', core: false, types: ['night_driving', 'suspended_driver', 'temperature', 'offline', 'custom'] },
]

/** Hidden until switched on: a day has many of them and they are rarely the point. */
export const DEFAULT_HIDDEN_GROUPS = ['ignition']

const GROUP_BY_KEY = new Map(EVENT_GROUPS.map(g => [g.key, g]))
const GROUP_BY_TYPE = new Map(EVENT_GROUPS.flatMap(g => g.types.map(t => [t, g])))

/** The chip an alert type belongs to; null for one that is not about a place on a drive (licence expiry, reminders). */
export const groupOfType = type => GROUP_BY_TYPE.get(type) ?? null
export const groupByKey = key => GROUP_BY_KEY.get(key) ?? null

const TYPE_LABEL = {
  overspeed: 'Overspeed',
  geofence_speed: 'Geo Zone Speed',
  harsh_braking: 'Harsh braking',
  harsh_acceleration: 'Harsh acceleration',
  harsh_cornering: 'Harsh cornering',
  idle: 'Idle',
  geofence: 'Geofence',
  geofence_enter: 'Geofence enter',
  geofence_exit: 'Geofence exit',
  ignition_on: 'Ignition on',
  ignition_off: 'Ignition off',
  tamper: 'Tamper',
  battery_tamper: 'Battery Tamper',
  panic: 'SOS',
  night_driving: 'Night driving',
  suspended_driver: 'Suspended driver',
  temperature: 'Temperature',
  offline: 'Offline',
  custom: 'Custom',
}
export const eventTypeLabel = type => TYPE_LABEL[type] ?? 'Event'

/**
 * One-time events: a moment, not a stretch. They show their time and speed
 * only — no To, no Duration (client, 2026-11-13: "SOS, harsh braking, harsh
 * acceleration = single point").
 */
export const INSTANT_TYPES = new Set([
  'harsh_braking', 'harsh_acceleration', 'harsh_cornering', 'panic',
  'ignition_on', 'ignition_off', 'geofence', 'geofence_enter', 'geofence_exit',
])

/** Types whose speed limit is worth a row of its own. */
export const SPEED_TYPES = new Set(['overspeed', 'geofence_speed'])

/** Types whose speed says something about the event (idle's is always ~0). */
const SHOWS_SPEED = new Set([
  'overspeed', 'geofence_speed', 'harsh_braking', 'harsh_acceleration', 'harsh_cornering',
  'panic', 'night_driving', 'suspended_driver',
])
export const showsSpeed = type => SHOWS_SPEED.has(type)

/** How close (s) a track-read event may be to an alert of the same type to be the same event. */
const SAME_EVENT_SEC = 60

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function base(type) {
  const g = groupOfType(type)
  return g ? { type, group: g.key, color: g.color, label: eventTypeLabel(type) } : null
}

/**
 * The server's alert events, each as the replay shows it.
 *
 * @param {object[]} alertEvents  API shape: id, type, title, message, value,
 *   occurredAt, endedAt?, durationSec?, peakValue?, lat?, lng?, driverId?
 * @param {object[]} messages     the replay's points as Flespi messages, oldest first
 */
export function fromAlertEvents(alertEvents, messages) {
  const out = []
  for (const e of alertEvents ?? []) {
    const b = base(e?.type)
    if (!b) continue
    const ep = violationEpisode(e, messages)
    if (ep.fromTs == null) continue
    const instant = INSTANT_TYPES.has(e.type)
    out.push({
      ...b,
      id: `a:${e.id}`,
      source: 'alert',
      title: e.title ?? null,
      fromTs: ep.fromTs,
      toTs: instant ? ep.fromTs : ep.toTs,
      // Neither stored nor found on the track (still going, or no readings
      // around it): a Duration of 0 would be a guess, so there is none.
      durationSec: instant || ep.source === 'moment' ? null : ep.durationSec,
      speed: ep.speed,
      limit: SPEED_TYPES.has(e.type) ? limitIn(e.message) : null,
      lat: ep.lat,
      lng: ep.lng,
      driverId: e.driverId ?? null,
    })
  }
  return out
}

/** True when an alert event of `type` is within SAME_EVENT_SEC of `ts`. */
function alreadyAlerted(alerts, type, ts) {
  return alerts.some(a => a.type === type && Math.abs(a.fromTs - ts) <= SAME_EVENT_SEC)
}

/** Harsh braking and acceleration read off the speed (the reports' rule), where no alert says so. */
export function harshFromTrack(messages, alerts = []) {
  const out = []
  for (const kind of ['braking', 'acceleration']) {
    const type = `harsh_${kind}`
    for (const h of harshEpisodes(messages, { kind, thresholdMs2: HARSH_MS2 })) {
      if (alreadyAlerted(alerts, type, h.startTs)) continue
      out.push({
        ...base(type),
        id: `h:${kind}:${h.startTs}`,
        source: 'track',
        title: null,
        fromTs: h.startTs,
        toTs: h.startTs,
        durationSec: null,
        speed: num(h.fromKmh),
        limit: null,
        lat: h.lat,
        lng: h.lng,
        driverId: null,
        detail: `${Math.round(h.fromKmh)} → ${Math.round(h.toKmh)} km/h · ${h.peakMs2.toFixed(1)} m/s²`,
      })
    }
  }
  return out
}

/** Ignition switched on / off — every change the tracker reported, where no alert says so. */
export function ignitionFromTrack(messages, alerts = []) {
  const out = []
  let prev = null
  for (const m of messages ?? []) {
    const ign = m['engine.ignition.status']
    if (typeof ign !== 'boolean') continue
    if (prev !== null && ign !== prev) {
      const type = ign ? 'ignition_on' : 'ignition_off'
      const ts = m.timestamp
      if (!alreadyAlerted(alerts, type, ts)) {
        out.push({
          ...base(type),
          id: `i:${type}:${ts}`,
          source: 'track',
          title: null,
          fromTs: ts,
          toTs: ts,
          durationSec: null,
          speed: num(m['position.speed']),
          limit: null,
          lat: num(m['position.latitude']),
          lng: num(m['position.longitude']),
          driverId: null,
        })
      }
    }
    prev = ign
  }
  return out
}

/** Everything the replay shows, oldest first. */
export function buildReplayEvents(alertEvents, messages) {
  const alerts = fromAlertEvents(alertEvents, messages)
  return [...alerts, ...harshFromTrack(messages, alerts), ...ignitionFromTrack(messages, alerts)]
    .sort((a, b) => a.fromTs - b.fromTs || a.id.localeCompare(b.id))
}

/**
 * The chips: every core group, plus any other group with events, each with its
 * count — in EVENT_GROUPS order.
 */
export function groupCounts(events) {
  const counts = new Map()
  for (const e of events ?? []) counts.set(e.group, (counts.get(e.group) ?? 0) + 1)
  return EVENT_GROUPS
    .filter(g => g.core || counts.has(g.key))
    .map(g => ({ key: g.key, label: g.label, color: g.color, count: counts.get(g.key) ?? 0 }))
}

/** The events whose groups are not switched off. */
export function visibleEvents(events, hidden) {
  const off = hidden instanceof Set ? hidden : new Set(hidden ?? [])
  return off.size ? (events ?? []).filter(e => !off.has(e.group)) : (events ?? [])
}

/**
 * Each trip's events, keyed by the trip's startTs, plus those outside every
 * trip (a tamper while parked). An event belongs to the trip it began in.
 *
 * @returns {{ byTrip: Map<number, object[]>, outside: object[] }}
 */
export function eventsByTrip(events, trips) {
  const byTrip = new Map((trips ?? []).map(t => [t.startTs, []]))
  const outside = []
  for (const e of events ?? []) {
    const t = (trips ?? []).find(tr => e.fromTs >= tr.startTs && e.fromTs <= tr.endTs)
    if (t) byTrip.get(t.startTs).push(e)
    else outside.push(e)
  }
  return { byTrip, outside }
}

/** A trip's badges: "2 overspeed", "1 idle" — one per group, in chip order. */
export function eventBadges(events) {
  const counts = new Map()
  for (const e of events ?? []) counts.set(e.group, (counts.get(e.group) ?? 0) + 1)
  return EVENT_GROUPS
    .filter(g => counts.has(g.key))
    .map(g => ({ key: g.key, color: g.color, text: `${counts.get(g.key)} ${g.short}` }))
}

const pad = n => String(n).padStart(2, '0')

/** "45s", "1m 05s", "1h 02m" — an event's length in the trip list. */
export function fmtEventDuration(sec) {
  if (!Number.isFinite(sec)) return ''
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`
}

/** "Overspeed · 1m 40s · 98 km/h", "Idle · 6m 12s", "Harsh braking · 62 km/h". */
export function eventSummary(e) {
  const parts = [e.label]
  if (e.durationSec != null) parts.push(fmtEventDuration(e.durationSec))
  if (showsSpeed(e.type) && num(e.speed) !== null) parts.push(`${Math.round(e.speed)} km/h`)
  return parts.join(' · ')
}
