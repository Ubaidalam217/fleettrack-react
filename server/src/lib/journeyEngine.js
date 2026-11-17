/**
 * The journey engine: measures each journey's vehicle against its plan, one
 * pass per alert-engine tick (lib/alertEngine.js tick() calls runJourneyPass
 * with the telemetry and the IMEI map that tick already read, so a pass makes
 * at most one extra messages read — from our own telemetry copy when it holds
 * the stretch, else one Flespi GET).
 *
 * ── What one pass does, per journey ────────────────────────────────────────
 *   Scheduled → Started     the vehicle left the origin (seen inside, then
 *                           `departAfterSec` outside), or — never seen inside —
 *                           it is moving along the planned line ≥ 1 km in;
 *   Started → In Progress   ≥ 2 km along the line, or the first stop reached;
 *   In Progress ⇄ Delayed   ETA later than planned + lateArrivalMin (back
 *                           under it less 5 min: hysteresis, no flapping);
 *   → Completed             arrived at the destination;
 *   → Interrupted           no message for noSignalMin; back when data returns.
 *
 * Stops: arrival after `arriveAfterMin` inside (or the ignition off inside);
 * a stop with no stay may be driven through, caught by the segment test
 * between two fixes (src/utils/journeyGeo.js passThrough). Departure after
 * `departAfterSec` outside. Each arrival and departure is judged EARLY /
 * ON_TIME / LATE against its planned time ± onTimeMin — the six events of the
 * client's voice note (2026-11-17) — for the start, every stop and the
 * destination.
 *
 * Also: not departed, off route (corridor, for a recorded or drawn line),
 * unplanned stop, missed stop, HSE break due / daily limit (the fatigue
 * setting, over the journey's own driving), and the ETA:
 *   remaining km along the line ÷ (0.6 · recent moving speed + 0.4 · planned
 *   speed) + the stays still ahead.
 *
 * stepJourney() is pure (tests drive it with recorded messages);
 * runJourneyPass() reads and writes.
 */

import prisma from '../prisma.js'
import * as flespi from './flespi.js'
import { fetchRecent } from './alertEngine.js'
import { getJourneySettings } from './journeySettings.js'
import { getFatigueSettings } from './driverPerformance.js'
import { recordEvent, sendNotices, bgAdminsOf, lineOf, ACTIVE } from './journeys.js'
import { cumulativeKm, inStop, passThrough, project } from '../../../src/utils/journeyGeo.js'
import { timingOf, diffText } from '../../../src/utils/journeySchedule.js'
import { haversineMeters } from '../../../src/utils/distance.js'

export const JOURNEY_FIELDS = 'device.id,timestamp,position.latitude,position.longitude,position.speed,engine.ignition.status'

const MOVING_KMH = 5
const STILL_KMH = 3
/** Before its planned start a journey only watches the origin from this early. */
const START_WINDOW_SEC = 60 * 60
/** A scheduled journey that never left stops being watched this long after its start. */
const GIVE_UP_SEC = 24 * 3600
/** The longest gap between two fixes counted as driving or resting. */
const MAX_DT_SEC = 300
const UAE_MS = 4 * 3600 * 1000

const hhmm = ts => new Date(ts * 1000 + UAE_MS).toISOString().slice(11, 16)
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const toSec = d => (d ? Math.floor(new Date(d).getTime() / 1000) : null)

function fix(m) {
  const lat = num(m['position.latitude']), lng = num(m['position.longitude'])
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null
  const ign = m['engine.ignition.status']
  return { lat, lng, ts: m.timestamp, speed: num(m['position.speed']) ?? 0, ign: typeof ign === 'boolean' ? ign : null }
}

const TIMING_TYPE = { arrive: { EARLY: 'ARRIVE_EARLY', ON_TIME: 'ARRIVE_ON_TIME', LATE: 'ARRIVE_LATE' }, depart: { EARLY: 'DEPART_EARLY', ON_TIME: 'DEPART_ON_TIME', LATE: 'DEPART_LATE' } }

function timingText(kind, stopName, ts, planned, t) {
  const verb = kind === 'arrive' ? `Arrived at ${stopName}` : `Left ${stopName}`
  if (!t) return `${verb} at ${hhmm(ts)}`
  const how = t.timing === 'ON_TIME' ? 'on time' : `${diffText(Math.abs(t.diffMin)).replace(/^[+−]/, '')} ${t.timing === 'LATE' ? 'late' : 'early'}`
  return `${verb} at ${hhmm(ts)}, ${how} (planned ${hhmm(planned)})`
}

export function initialState() {
  return {
    lastTs: null, seg: 0, progressKm: 0, next: 1,
    originSeen: false, outOrigin: null,
    inside: null, // { seq, since, arrived }
    out: null, // { seq, since } — outside a stop it arrived at
    still: null, off: null, speeds: [],
    drive: { lastTs: null, stintSec: 0, stintNo: 0, stillSec: 0, daySec: 0, breakRaised: false, dailyRaised: false },
    raised: {}, episodes: {}, before: null, nextBreakAt: null,
  }
}

/**
 * One journey against the messages since the last pass.
 *
 * @param {object} p
 * @param {object} p.journey   the row (status, plannedStart, expectedArrival, routeSource, plannedPath, plannedDistanceKm, plannedDriveMin, engineState, lastFixAt, actualStart, etaAt…)
 * @param {object[]} p.stops   its stops in seq order
 * @param {object[]} p.messages Flespi-shaped messages, oldest first
 * @param {number} p.now       unix seconds
 * @param {object} p.settings  Journey settings (lib/journeySettings.js)
 * @param {object} p.fatigue   the HSE driving rules
 * @returns {{ patch: object, stopPatches: Map<number, object>, events: object[], closes: object[], state: object }}
 */
export function stepJourney({ journey, stops, messages, now, settings, fatigue }) {
  const st = { ...initialState(), ...(journey.engineState ?? {}) }
  st.drive = { ...initialState().drive, ...(st.drive ?? {}) }
  st.raised = { ...(st.raised ?? {}) }
  st.episodes = { ...(st.episodes ?? {}) }
  const j = { status: journey.status }
  const patch = {}
  const stopPatches = new Map()
  const events = []
  const closes = []
  const S = stops.map(s => ({ ...s }))
  const last = S.length - 1
  const line = lineOf(journey, S)
  const cum = cumulativeKm(line)
  const totalKm = cum[cum.length - 1] ?? 0
  // Progress is measured on the line. Straight legs count as road (× ROAD_FACTOR
  // in the plan), so what is stored and shown is scaled to the planned km.
  const scale = totalKm > 0 && S[last]?.alongKm > 0 ? S[last].alongKm / totalKm : 1
  const hasLine = journey.routeSource !== 'STRAIGHT' && Array.isArray(journey.plannedPath) && journey.plannedPath.length >= 2
  const corridorM = Math.max(500, settings.offRouteKm * 1000)
  const plannedStart = toSec(journey.plannedStart)
  const tol = settings.onTimeMin

  const setStop = (seq, data) => {
    Object.assign(S[seq], data)
    stopPatches.set(seq, { ...(stopPatches.get(seq) ?? {}), ...data })
  }
  const status = (to, ts, message) => {
    if (j.status === to) return
    events.push({ type: 'STATUS', fromStatus: j.status, toStatus: to, message, occurredAt: ts })
    j.status = to
    patch.status = to
  }
  const timingEvent = (kind, seq, ts, f) => {
    const s = S[seq]
    const planned = toSec(kind === 'arrive' ? s.plannedArrive : s.plannedDepart)
    const t = planned ? timingOf(ts * 1000, planned * 1000, tol) : null
    if (t) setStop(seq, kind === 'arrive' ? { arriveTiming: t.timing, arriveDiffMin: t.diffMin } : { departTiming: t.timing, departDiffMin: t.diffMin })
    if (!t) return
    events.push({
      type: TIMING_TYPE[kind][t.timing], stopSeq: seq, value: t.diffMin, occurredAt: ts,
      message: timingText(kind, s.name, ts, planned, t), lat: f?.lat, lng: f?.lng,
      atEndpoint: seq === 0 || seq === last,
    })
  }
  const closeEpisode = (key, ts, extra = {}) => {
    if (st.episodes[key]) closes.push({ eventId: st.episodes[key], endedAt: ts, ...extra })
    delete st.episodes[key]
  }

  // ── departure from the origin ──
  const depart = (ts, f) => {
    setStop(0, { status: 'DEPARTED', actualDepart: new Date(ts * 1000), checkInSource: S[0].checkInSource ?? 'AUTO' })
    timingEvent('depart', 0, ts, f)
    patch.actualStart = new Date(ts * 1000)
    status('Started', ts, `Left ${S[0].name} at ${hhmm(ts)}`)
    st.next = 1
  }

  const arrive = (seq, since, ts, f, how) => {
    const s = S[seq]
    setStop(seq, { status: 'ARRIVED', actualArrive: new Date(since * 1000), detectedBy: how, checkInSource: 'AUTO', checkedInAt: new Date(ts * 1000) })
    timingEvent('arrive', seq, since, f)
    // Stops skipped on the way to this one.
    for (let k = st.next; k < seq; k++) {
      if (S[k].status === 'PENDING') {
        setStop(k, { status: 'SKIPPED' })
        events.push({ type: 'SKIPPED_STOP', stopSeq: k, occurredAt: since, message: `Did not stop at ${S[k].name}` })
      }
    }
    st.next = seq + 1
    if (seq === last) {
      patch.actualArrival = new Date(since * 1000)
      patch.completedAt = new Date(ts * 1000)
      patch.etaAt = null
      patch.remainingKm = 0
      patch.progressKm = Math.round(totalKm * scale * 100) / 100
      const planned = toSec(s.plannedArrive)
      if (planned) patch.delayMin = Math.round((since - planned) / 60)
      closeEpisode('off', ts)
      closeEpisode('stop', ts)
      status('Completed', ts, `Reached ${s.name} at ${hhmm(since)}`)
    } else if (j.status === 'Started') {
      status('InProgress', ts, `Reached ${s.name}`)
    }
  }
  const departStop = (seq, ts, f) => {
    const s = S[seq]
    const arrivedAt = toSec(s.actualArrive) ?? ts
    setStop(seq, { status: 'DEPARTED', actualDepart: new Date(ts * 1000), dwellSec: Math.max(0, ts - arrivedAt) })
    timingEvent('depart', seq, ts, f)
  }
  const passStop = (seq, ts, f) => {
    arrive(seq, ts, ts, f, 'PASS_BY')
    if (seq !== last) {
      setStop(seq, { status: 'PASSED', actualDepart: new Date(ts * 1000), dwellSec: 0 })
      timingEvent('depart', seq, ts, f)
    }
  }

  const active = () => ACTIVE.includes(j.status)
  let prev = st.lastFix ?? null
  const fixes = messages.map(fix).filter(Boolean).filter(f => st.lastTs == null || f.ts > st.lastTs)

  for (const f of fixes) {
    if (j.status === 'Completed' || j.status === 'Cancelled') break
    const p = project(line, cum, [f.lat, f.lng], st.seg, { corridorM })

    if (j.status === 'Scheduled') {
      if (f.ts >= plannedStart - START_WINDOW_SEC) {
        const inOrigin = inStop(f.lat, f.lng, S[0])
        if (inOrigin) {
          st.originSeen = true
          st.outOrigin = null
          if (!S[0].actualArrive) setStop(0, { status: 'ARRIVED', actualArrive: new Date(f.ts * 1000), detectedBy: 'INSIDE', checkInSource: 'AUTO' })
        } else if (st.originSeen) {
          st.outOrigin ??= f.ts
          if (f.ts - st.outOrigin >= settings.departAfterSec || haversineMeters(f.lat, f.lng, S[0].lat, S[0].lng) > (S[0].radiusM || 300) + 200) depart(st.outOrigin, f)
        } else if (f.speed > MOVING_KMH && p.crossM <= corridorM && p.alongKm >= 1 && p.alongKm < totalKm - 1) {
          depart(f.ts, f)
        }
      }
      if (j.status === 'Scheduled') { prev = f; continue }
    }

    // ── on the road ──
    if (p.crossM <= corridorM) {
      st.seg = p.segIdx
      st.progressKm = Math.max(st.progressKm, p.alongKm)
    }
    if (j.status === 'Started' && st.progressKm >= 2) status('InProgress', f.ts, `${Math.round(st.progressKm)} km along the route`)

    // Stops: the one in progress, else the next ones (up to two ahead, for a missed stop).
    const cur = st.inside && S[st.inside.seq]
    if (cur && st.inside.arrived) {
      // Arrived: waiting to leave.
      if (inStop(f.lat, f.lng, cur)) st.out = null
      else {
        st.out ??= f.ts
        if (f.ts - st.out >= settings.departAfterSec || haversineMeters(f.lat, f.lng, cur.lat, cur.lng) > (cur.radiusM || 300) + 300) {
          departStop(cur.seq, st.out, f)
          st.inside = null
          st.out = null
        }
      }
    } else {
      for (let k = st.next; k <= Math.min(last, st.next + 2); k++) {
        const s = S[k]
        if (s.status !== 'PENDING') continue
        const isIn = inStop(f.lat, f.lng, s)
        const needStay = s.stayMin > 0 || k === last
        if (isIn) {
          if (!st.inside || st.inside.seq !== k) {
            const entry = prev && !inStop(prev.lat, prev.lng, s) ? passThrough(prev, f, s) ?? f.ts : prev?.ts ?? f.ts
            st.inside = { seq: k, since: Math.round(entry), arrived: false }
          }
          if (!needStay || f.ts - st.inside.since >= settings.arriveAfterMin * 60 || f.ign === false) {
            st.inside.arrived = true
            arrive(k, st.inside.since, f.ts, f, 'INSIDE')
            if (k === last) st.inside = null
          }
          break
        }
        if (st.inside?.seq === k && !st.inside.arrived) {
          // In and out again before it counted: drove through.
          passStop(k, st.inside.since, f)
          st.inside = null
          break
        }
        const through = prev ? passThrough(prev, f, s) : null
        if (through !== null) {
          passStop(k, Math.round(through), f)
          break
        }
      }
    }

    if (!active()) { prev = f; continue }

    // ── unplanned stop ──
    if (f.speed < STILL_KMH) {
      st.still ??= { since: prev && prev.speed < STILL_KMH ? prev.ts : f.ts, lat: f.lat, lng: f.lng, raised: false }
      const nearStop = S.some(s => haversineMeters(f.lat, f.lng, s.lat, s.lng) <= (s.radiusM || 300) + 200 || inStop(f.lat, f.lng, s))
      if (!nearStop && !st.still.raised && f.ts - st.still.since >= settings.unplannedStopMin * 60) {
        st.still.raised = true
        patch.unplannedStops = (journey.unplannedStops ?? 0) + 1
        journey = { ...journey, unplannedStops: patch.unplannedStops }
        events.push({ type: 'UNPLANNED_STOP', occurredAt: st.still.since, lat: f.lat, lng: f.lng, episode: 'stop', value: Math.round((f.ts - st.still.since) / 60), message: `Stopped away from the planned stops since ${hhmm(st.still.since)}` })
      }
    } else if (f.speed > MOVING_KMH && st.still) {
      if (st.still.raised) {
        const dur = f.ts - st.still.since
        patch.unplannedStopSec = (journey.unplannedStopSec ?? 0) + dur
        journey = { ...journey, unplannedStopSec: patch.unplannedStopSec }
        closeEpisode('stop', f.ts, { durationSec: dur, value: Math.round(dur / 60) })
      }
      st.still = null
    }

    // ── off route (only against a real line) ──
    if (hasLine) {
      if (p.crossM > settings.offRouteKm * 1000) {
        st.off ??= { since: f.ts, maxM: 0, raised: false }
        st.off.maxM = Math.max(st.off.maxM, Math.round(p.crossM))
        if (!st.off.raised && f.ts - st.off.since >= settings.offRouteMin * 60) {
          st.off.raised = true
          patch.offRouteCount = (journey.offRouteCount ?? 0) + 1
          journey = { ...journey, offRouteCount: patch.offRouteCount }
          events.push({ type: 'OFF_ROUTE', occurredAt: st.off.since, lat: f.lat, lng: f.lng, episode: 'off', value: st.off.maxM, message: `${(st.off.maxM / 1000).toFixed(1)} km off the planned route since ${hhmm(st.off.since)}` })
        }
      } else if (st.off && p.crossM < 0.8 * settings.offRouteKm * 1000) {
        if (st.off.raised) {
          const dur = f.ts - st.off.since
          patch.offRouteSec = (journey.offRouteSec ?? 0) + dur
          patch.maxOffRouteM = Math.max(journey.maxOffRouteM ?? 0, st.off.maxM)
          journey = { ...journey, offRouteSec: patch.offRouteSec, maxOffRouteM: patch.maxOffRouteM }
          closeEpisode('off', f.ts, { durationSec: dur, value: st.off.maxM })
        }
        st.off = null
      }
    }

    // ── HSE driving rules, over this journey's driving ──
    const d = st.drive
    const dt = d.lastTs ? Math.min(MAX_DT_SEC, Math.max(0, f.ts - d.lastTs)) : 0
    d.lastTs = f.ts
    if (f.speed > MOVING_KMH) {
      d.stintSec += dt
      d.daySec += dt
      d.stillSec = 0
    } else {
      d.stillSec += dt
      if (d.stillSec >= fatigue.breakMin * 60 && d.stintSec > 0) {
        d.stintNo += 1
        d.stintSec = 0
        d.breakRaised = false
      }
    }
    const limitMin = d.stintNo === 0 ? fatigue.firstDriveMin : fatigue.driveMin
    if (settings.hseBreaks && !d.breakRaised && d.stintSec > limitMin * 60) {
      d.breakRaised = true
      events.push({ type: 'BREAK_DUE', occurredAt: f.ts, lat: f.lat, lng: f.lng, value: Math.round(d.stintSec / 60), message: `Driven ${Math.round(d.stintSec / 60)} min without a ${fatigue.breakMin} min break (HSE limit ${limitMin} min)` })
    }
    if (settings.hseBreaks && !d.dailyRaised && d.daySec > fatigue.dailyMaxMin * 60) {
      d.dailyRaised = true
      events.push({ type: 'DAILY_LIMIT', occurredAt: f.ts, lat: f.lat, lng: f.lng, value: Math.round(d.daySec / 60), message: `Driven ${Math.round(d.daySec / 60)} min today on this journey (HSE limit ${fatigue.dailyMaxMin} min)` })
    }
    st.nextBreakAt = f.speed > MOVING_KMH ? new Date((f.ts + Math.max(0, limitMin * 60 - d.stintSec)) * 1000).toISOString() : st.nextBreakAt

    // Recent moving speeds for the ETA (30 min).
    if (f.speed > MOVING_KMH) st.speeds.push([f.ts, f.speed])
    st.speeds = st.speeds.filter(([t]) => t >= f.ts - 1800).slice(-60)
    prev = f
  }

  if (fixes.length) {
    const lf = fixes[fixes.length - 1]
    st.lastTs = lf.ts
    st.lastFix = { lat: lf.lat, lng: lf.lng, ts: lf.ts, speed: lf.speed }
    Object.assign(patch, { lastLat: lf.lat, lastLng: lf.lng, lastSpeed: lf.speed, lastFixAt: new Date(lf.ts * 1000) })
  }

  // ── not departed ──
  if (j.status === 'Scheduled' && now >= plannedStart + settings.lateDepartureMin * 60 && !st.raised.notDeparted) {
    st.raised.notDeparted = true
    const late = Math.round((now - plannedStart) / 60)
    events.push({ type: 'NOT_DEPARTED', occurredAt: now, value: late, stopSeq: 0, message: `Has not left ${S[0].name}: planned ${hhmm(plannedStart)}, ${late} min ago` })
  }

  // ── signal ──
  const lastFixTs = st.lastFix?.ts ?? toSec(journey.lastFixAt) ?? toSec(patch.actualStart ?? journey.actualStart)
  if (['Started', 'InProgress', 'Delayed'].includes(j.status) && lastFixTs && now - lastFixTs >= settings.noSignalMin * 60) {
    st.before = j.status
    events.push({ type: 'NO_SIGNAL', occurredAt: now, value: Math.round((now - lastFixTs) / 60), message: `No signal from the tracker since ${hhmm(lastFixTs)}` })
    status('Interrupted', now, 'No signal')
  } else if (j.status === 'Interrupted' && fixes.length && now - fixes[fixes.length - 1].ts < settings.noSignalMin * 60) {
    events.push({ type: 'SIGNAL_BACK', occurredAt: fixes[0].ts, message: `Signal back at ${hhmm(fixes[0].ts)}` })
    status(st.before && st.before !== 'Interrupted' ? st.before : 'InProgress', fixes[0].ts, 'Signal back')
    st.before = null
  }

  // ── progress and ETA ──
  if (['Started', 'InProgress', 'Delayed', 'Interrupted'].includes(j.status)) {
    const remainingKm = Math.max(0, totalKm - st.progressKm) * scale
    const vPlan = journey.plannedDriveMin > 0 && journey.plannedDistanceKm > 0
      ? (journey.plannedDistanceKm / journey.plannedDriveMin) * 60
      : settings.plannedSpeedKmh
    const recent = st.speeds.map(([, v]) => v)
    const vRecent = recent.length >= 5 ? Math.min(110, Math.max(30, recent.reduce((a, b) => a + b, 0) / recent.length)) : null
    const v = Math.max(5, vRecent ? 0.6 * vRecent + 0.4 * vPlan : vPlan)
    let stays = 0
    for (let k = Math.max(1, st.next); k < last; k++) if (S[k].status === 'PENDING') stays += (S[k].stayMin || 0) * 60
    if (st.inside?.arrived && st.inside.seq < last) {
      const at = toSec(S[st.inside.seq].actualArrive) ?? now
      stays += Math.max(0, (S[st.inside.seq].stayMin || 0) * 60 - (now - at))
    }
    const eta = Math.round(now + (remainingKm / v) * 3600 + stays)
    const oldEta = toSec(journey.etaAt)
    if (oldEta == null || Math.abs(eta - oldEta) >= 120) patch.etaAt = new Date(eta * 1000)
    const etaUse = toSec(patch.etaAt ?? journey.etaAt) ?? eta
    const expected = toSec(journey.expectedArrival)
    patch.delayMin = Math.round((etaUse - expected) / 60)
    patch.progressKm = Math.round(st.progressKm * scale * 100) / 100
    patch.remainingKm = Math.round(remainingKm * 100) / 100
    if (j.status === 'InProgress' && etaUse > expected + settings.lateArrivalMin * 60) {
      events.push({ type: 'DELAYED', occurredAt: now, value: patch.delayMin, message: `Running ${patch.delayMin} min late: arrives about ${hhmm(etaUse)} (planned ${hhmm(expected)})` })
      status('Delayed', now, `ETA ${hhmm(etaUse)}`)
    } else if (j.status === 'Delayed' && etaUse < expected + (settings.lateArrivalMin - 5) * 60) {
      status('InProgress', now, `Back on time: ETA ${hhmm(etaUse)}`)
    }
  }

  patch.engineState = st
  return { patch, stopPatches, events, closes, state: st }
}

// ── the pass ────────────────────────────────────────────────────────────────

const digits = v => String(v ?? '').replace(/\D/g, '')

async function deviceMapOrOwn(pre) {
  if (pre?.deviceByImei) return pre.deviceByImei
  if (flespi.isConfigured()) {
    try { return await flespi.deviceMap() } catch { /* our own copy */ }
  }
  const rows = await prisma.deviceState.findMany({ select: { deviceId: true, ident: true } })
  return new Map(rows.filter(r => r.ident).map(r => [digits(r.ident), r.deviceId]))
}

/**
 * One pass over every journey that needs watching. `pre` may carry
 * deviceByImei (the tick's) and `fetchMessages(deviceIds, from, to)` (tests and
 * the replay check pass recorded messages). Returns { journeys, events }.
 */
export async function runJourneyPass(now = Math.floor(Date.now() / 1000), pre = {}) {
  const journeys = await prisma.journey.findMany({
    where: {
      OR: [
        { status: { in: ACTIVE } },
        { status: 'Scheduled', plannedStart: { lte: new Date((now + START_WINDOW_SEC) * 1000), gte: new Date((now - GIVE_UP_SEC) * 1000) } },
      ],
    },
    include: { stops: { orderBy: { seq: 'asc' } }, vehicle: { select: { imei: true } } },
  })
  if (!journeys.length) {
    await escalate(now)
    return { journeys: 0, events: 0 }
  }
  const byImei = await deviceMapOrOwn(pre)
  const deviceOf = new Map()
  let from = now
  for (const j of journeys) {
    const id = byImei.get(digits(j.vehicle?.imei))
    if (id === undefined) continue
    deviceOf.set(j.id, id)
    const last = j.engineState?.lastTs ?? toSec(j.plannedStart) - START_WINDOW_SEC
    from = Math.min(from, last - 60)
  }
  from = Math.max(from, now - 6 * 3600)
  let msgs = new Map()
  const ids = [...new Set(deviceOf.values())]
  if (ids.length) {
    try {
      msgs = pre.fetchMessages ? await pre.fetchMessages(ids, from, now) : await fetchRecent(ids, from, now, JOURNEY_FIELDS)
    } catch (err) {
      console.error(`[fleetmax] journey messages read failed: ${err.message}`)
      return { journeys: journeys.length, events: 0, error: err.message }
    }
  }
  const fatigue = await getFatigueSettings()
  let count = 0
  for (const j of journeys) {
    const settings = await getJourneySettings(j.bgId)
    const deviceId = deviceOf.get(j.id)
    const messages = deviceId === undefined ? [] : (msgs.get(deviceId) ?? []).filter(m => m.timestamp <= now)
    try {
      count += await applyStep(j, stepJourney({ journey: j, stops: j.stops, messages, now, settings, fatigue }), settings)
    } catch (err) {
      console.error(`[fleetmax] journey ${j.id}: ${err.message}`)
    }
  }
  await escalate(now)
  return { journeys: journeys.length, events: count }
}

/** Writes one step's result: the journey, its stops, its events (bell + push), closed episodes. */
async function applyStep(j, result, settings) {
  const { patch, stopPatches, events, closes, state } = result
  for (const c of closes) {
    await prisma.journeyEvent.update({
      where: { id: c.eventId },
      data: { endedAt: new Date(c.endedAt * 1000), durationSec: c.durationSec ?? null, ...(c.value != null ? { value: c.value } : {}) },
    }).catch(() => null)
  }
  for (const [seq, data] of stopPatches) {
    await prisma.journeyStop.update({ where: { journeyId_seq: { journeyId: j.id, seq } }, data })
  }
  const after = { ...j, ...patch }
  for (const e of events) {
    const { episode, atEndpoint, occurredAt, ...rest } = e
    const row = await recordEvent(after, { ...rest, occurredAt: new Date(occurredAt * 1000) }, { settings, atEndpoint: atEndpoint ?? true })
    if (episode) state.episodes[episode] = row.id
  }
  await prisma.journey.update({ where: { id: j.id }, data: { ...patch, engineState: state } })
  return events.length
}

/**
 * Stage 2 of the journey alerts (design §A.5): an alert still unread
 * `bgAdminsAfterMin` after it went out goes to the BG's admin accounts too.
 */
export async function escalate(now = Math.floor(Date.now() / 1000)) {
  const rows = await prisma.journeyEvent.findMany({
    // The engine's alerts; the approval notices go to their own people only.
    where: { alertEventId: { not: null }, type: { notIn: ['SUBMITTED', 'APPROVED', 'REJECTED'] }, occurredAt: { gte: new Date((now - 24 * 3600) * 1000) } },
    select: { id: true, bgId: true, journeyId: true, alertEventId: true, occurredAt: true, message: true, type: true },
    take: 500,
  })
  if (!rows.length) return 0
  const alerts = await prisma.alertEvent.findMany({ where: { id: { in: rows.map(r => r.alertEventId) } }, select: { id: true, readAt: true, title: true, message: true } })
  const alertById = new Map(alerts.map(a => [a.id, a]))
  const notices = await prisma.journeyNotice.findMany({ where: { journeyEventId: { in: rows.map(r => r.id) } }, select: { journeyEventId: true, userId: true, stage: true } })
  let sent = 0
  for (const r of rows) {
    const a = alertById.get(r.alertEventId)
    if (!a || a.readAt) continue
    const mine = notices.filter(n => n.journeyEventId === r.id)
    if (mine.some(n => n.stage === 2)) continue
    const settings = await getJourneySettings(r.bgId)
    if (!settings.recipients.bgAdmins) continue
    if (now - Math.floor(r.occurredAt.getTime() / 1000) < settings.recipients.bgAdminsAfterMin * 60) continue
    const told = new Set(mine.map(n => n.userId))
    const admins = (await bgAdminsOf(r.bgId)).map(u => u.id).filter(id => !told.has(id))
    if (!admins.length) continue
    await sendNotices(r, admins, { title: a.title, body: a.message, stage: 2, settings, journeyId: r.journeyId })
    sent += admins.length
  }
  return sent
}
