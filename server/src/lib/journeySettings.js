/**
 * Journey settings per Business Group (client 2026-11-16: "all limits
 * configurable"; 2026-11-17: on-time tolerance, planned speed, which of the six
 * arrival/departure events alert). Stored in JourneySetting.value; a missing
 * key reads as its default here, so adding a setting never migrates rows.
 */

import prisma from '../prisma.js'
import { getFatigueSettings } from './driverPerformance.js'
import * as whatsapp from './whatsapp.js'

export const JOURNEY_DEFAULTS = Object.freeze({
  /** NOT_DEPARTED: still not left this long after the planned start. */
  lateDepartureMin: 10,
  /** Delayed: the ETA is this much later than the planned arrival. */
  lateArrivalMin: 15,
  /** A departure or arrival within ± this of its planned time is on time. */
  onTimeMin: 10,
  unplannedStopMin: 10,
  offRouteKm: 1,
  offRouteMin: 3,
  noSignalMin: 30,
  /** Time inside a stop (with a stay) before it counts as arrived. */
  arriveAfterMin: 2,
  /** Time outside a stop before it counts as left. */
  departAfterSec: 30,
  defaultRadiusM: 300,
  /** Planned speed: leg drive time = leg km ÷ this, unless the leg came from a past trip. */
  plannedSpeedKmh: 70,
  /** Which of the six events raise an alert (they are always recorded on the journey). */
  eventAlerts: Object.freeze({
    departEarly: true, departOnTime: false, departLate: true,
    arriveEarly: true, arriveOnTime: false, arriveLate: true,
    /** Also for the stops in between, not only the start and the destination. */
    atStops: true,
  }),
  /** Break due / daily driving limit from the HSE driving rules (the fatigue setting). */
  hseBreaks: true,
  recipients: Object.freeze({ creatorAndApprover: true, bgAdmins: true, bgAdminsAfterMin: 15 }),
  channels: Object.freeze({ push: true, web: true, whatsapp: false }),

  // ── The rest of the Uffizio Job module (client 2026-11-21) ──
  /** Force close: an unfinished journey closes itself this long after its planned arrival (0 = never). */
  forceCloseHours: 12,
  /**
   * When the destination counts as reached: DWELL_OR_IGNITION (inside for
   * arriveAfterMin, or the ignition off inside), DWELL, or IGNITION_OFF.
   * Driving through it never completes the journey.
   */
  destinationRule: 'DWELL_OR_IGNITION',
  /** A start up to this long before the planned start counts (each journey may change it). */
  startBufferMin: 60,
  /** Convoy: a vehicle further than its tolerance from the lead for this long is separated. */
  convoyAfterMin: 2,
  /** Temperature: outside the journey's limits for this long raises an alert. */
  tempAfterMin: 5,
  /** The load states a journey and its stops pick from. */
  loadStates: Object.freeze(['Empty', 'Loaded', 'Partially loaded']),
  /** How long a new tracking / driver link stays open. */
  trackLinkHours: 48,
  driverLinkHours: 48,
  /**
   * Route optimization's distances (Journey › Route Optimization).
   * ESTIMATE = great-circle × roadFactor at the planned speed, no service.
   * OSRM (a self-hosted URL), ORS (OPENROUTESERVICE_API_KEY on the server) and
   * GOOGLE (GOOGLE_MAPS_API_KEY) are only used when set up (lib/distanceProvider.js).
   */
  routing: Object.freeze({ provider: 'ESTIMATE', roadFactor: 1.3, osrmUrl: '' }),
})

export const DESTINATION_RULES = Object.freeze(['DWELL_OR_IGNITION', 'DWELL', 'IGNITION_OFF'])
export const ROUTING_PROVIDERS = Object.freeze(['ESTIMATE', 'OSRM', 'ORS', 'GOOGLE'])

const NUMBER_LIMITS = Object.freeze({
  lateDepartureMin: [0, 600], lateArrivalMin: [0, 600], onTimeMin: [0, 240], unplannedStopMin: [1, 600],
  offRouteKm: [0.05, 50], offRouteMin: [0, 120], noSignalMin: [5, 1440], arriveAfterMin: [0, 60],
  departAfterSec: [0, 600], defaultRadiusM: [50, 20000], plannedSpeedKmh: [5, 150],
  forceCloseHours: [0, 720], startBufferMin: [0, 720], convoyAfterMin: [0, 120], tempAfterMin: [0, 240],
  trackLinkHours: [1, 24 * 31], driverLinkHours: [1, 24 * 31],
})

/** Defaults under whatever is stored, numbers clamped, unknown keys dropped. */
export function mergeSettings(stored) {
  const v = stored && typeof stored === 'object' ? stored : {}
  const out = {}
  for (const [k, [lo, hi]] of Object.entries(NUMBER_LIMITS)) {
    const n = Number(v[k])
    out[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : JOURNEY_DEFAULTS[k]
  }
  const bools = (def, given) => Object.fromEntries(Object.entries(def).map(([k, d]) => [k, typeof given?.[k] === 'boolean' ? given[k] : d]))
  out.eventAlerts = bools(JOURNEY_DEFAULTS.eventAlerts, v.eventAlerts)
  out.hseBreaks = typeof v.hseBreaks === 'boolean' ? v.hseBreaks : JOURNEY_DEFAULTS.hseBreaks
  const r = v.recipients ?? {}
  out.recipients = {
    creatorAndApprover: typeof r.creatorAndApprover === 'boolean' ? r.creatorAndApprover : true,
    bgAdmins: typeof r.bgAdmins === 'boolean' ? r.bgAdmins : true,
    bgAdminsAfterMin: Number.isFinite(Number(r.bgAdminsAfterMin)) ? Math.min(1440, Math.max(1, Number(r.bgAdminsAfterMin))) : 15,
  }
  out.channels = bools(JOURNEY_DEFAULTS.channels, v.channels)
  out.destinationRule = DESTINATION_RULES.includes(v.destinationRule) ? v.destinationRule : JOURNEY_DEFAULTS.destinationRule
  const states = Array.isArray(v.loadStates)
    ? [...new Set(v.loadStates.map(x => String(x ?? '').trim().slice(0, 40)).filter(Boolean))].slice(0, 30)
    : null
  out.loadStates = states?.length ? states : [...JOURNEY_DEFAULTS.loadStates]
  const rt = v.routing ?? {}
  const factor = Number(rt.roadFactor)
  const url = typeof rt.osrmUrl === 'string' ? rt.osrmUrl.trim() : ''
  out.routing = {
    provider: ROUTING_PROVIDERS.includes(rt.provider) ? rt.provider : 'ESTIMATE',
    roadFactor: Number.isFinite(factor) && rt.roadFactor !== '' ? Math.min(3, Math.max(1, factor)) : JOURNEY_DEFAULTS.routing.roadFactor,
    osrmUrl: /^https?:\/\/\S+$/.test(url) ? url.replace(/\/+$/, '') : '',
  }
  // WhatsApp stays off until the client's account exists (lib/whatsapp.js).
  if (!whatsapp.isConfigured()) out.channels.whatsapp = false
  return out
}

const cache = new Map() // bgId -> { at, value }
const TTL_MS = 60_000

export async function getJourneySettings(bgId, { fresh = false } = {}) {
  const hit = cache.get(bgId)
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value
  const row = bgId ? await prisma.journeySetting.findUnique({ where: { bgId } }) : null
  const value = mergeSettings(row?.value)
  cache.set(bgId, { at: Date.now(), value })
  return value
}

export async function setJourneySettings(bgId, value, byName = null) {
  const v = mergeSettings(value)
  await prisma.journeySetting.upsert({
    where: { bgId },
    create: { bgId, value: v, updatedByName: byName },
    update: { value: v, updatedByName: byName },
  })
  cache.delete(bgId)
  return v
}

export function __clearJourneySettingsCache() {
  cache.clear()
}

/** The HSE driving rules, as the Journey settings panel shows them (read-only there). */
export const hseRules = () => getFatigueSettings()
