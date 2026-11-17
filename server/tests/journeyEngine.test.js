/**
 * The journey engine (lib/journeyEngine.js): status transitions, stop arrival
 * and departure, the six arrival/departure events, not departed, off route,
 * unplanned stop, no signal, running late (ETA), HSE break due — driven with
 * synthetic tracker messages — and one DB pass with its bell entries, notices
 * and the stage-2 escalation.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { stepJourney, runJourneyPass, escalate } from '../src/lib/journeyEngine.js'
import { JOURNEY_DEFAULTS, mergeSettings, __clearJourneySettingsCache } from '../src/lib/journeySettings.js'
import { FATIGUE_DEFAULTS } from '../src/lib/driverPerformance.js'
import { computeSchedule } from '../../src/utils/journeySchedule.js'
import { signToken } from '../src/lib/jwt.js'
import { auth, resetDb, seedFixture } from './factories.js'

const settings = mergeSettings(JOURNEY_DEFAULTS)
const T0 = Math.floor(Date.parse('2026-11-18T06:00:00Z') / 1000) // 10:00 UAE
const LAT = 24.35
// 0.2° of longitude here ≈ 20.3 km.
const A = 54.5, B = 54.7, C = 54.9

/** A journey A → B (stay 30) → C, 20 min legs, straight line. */
function makeJourney({ stayB = 30, routeSource = 'STRAIGHT', path = null, start = T0 } = {}) {
  const sched = computeSchedule({
    plannedStart: start * 1000,
    stops: [
      { name: 'Depot', lat: LAT, lng: A, radiusM: 300, stayMin: 0 },
      { name: 'Fuel stop', lat: LAT, lng: B, radiusM: 300, stayMin: stayB, legDriveMin: 20, legSource: 'MANUAL' },
      { name: 'Site C', lat: LAT, lng: C, radiusM: 300, stayMin: 0, legDriveMin: 20, legSource: 'MANUAL' },
    ],
  })
  const stops = sched.stops.map((s, seq) => ({
    ...s, seq, arrivalType: 'RADIUS', status: 'PENDING', alongKm: seq * 20.3,
    kind: seq === 0 ? 'ORIGIN' : seq === 2 ? 'DESTINATION' : 'STOP',
  }))
  return {
    journey: {
      id: 'j1', status: 'Scheduled', plannedStart: new Date(start * 1000), expectedArrival: sched.expectedArrival,
      routeSource, plannedPath: path, plannedDistanceKm: 40.6, plannedDriveMin: 40, engineState: null,
      offRouteCount: 0, offRouteSec: 0, unplannedStops: 0, unplannedStopSec: 0,
    },
    stops,
  }
}

const msg = (ts, lng, speed, lat = LAT, ign = true) => ({
  timestamp: ts, 'position.latitude': lat, 'position.longitude': lng, 'position.speed': speed, 'engine.ignition.status': ign,
})
/** Parked at `lng` from t for `min` minutes, a fix a minute. */
const park = (t, min, lng, lat = LAT) => Array.from({ length: min }, (_, i) => msg(t + i * 60, lng, 0, lat))
/** Driving from lng0 to lng1 over `min` minutes, a fix every `step` seconds. */
function drive(t, min, lng0, lng1, { step = 60, lat0 = LAT, lat1 = LAT } = {}) {
  const n = Math.round((min * 60) / step)
  const kmh = (Math.abs(lng1 - lng0) * 101.4) / (min / 60)
  return Array.from({ length: n }, (_, i) => {
    const f = (i + 1) / n
    return msg(t + (i + 1) * step, lng0 + f * (lng1 - lng0), kmh, lat0 + f * (lat1 - lat0))
  })
}

/** Runs the engine pass by pass (one per `chunk` of messages), carrying the state like the DB would. */
function run(fx, chunks, { s = settings, fatigue = FATIGUE_DEFAULTS, nowOf } = {}) {
  let journey = { ...fx.journey }
  const stops = fx.stops.map(x => ({ ...x }))
  const events = []
  for (const [i, messages] of chunks.entries()) {
    const now = nowOf ? nowOf(i, messages) : messages.length ? messages[messages.length - 1].timestamp : T0
    const r = stepJourney({ journey, stops, messages, now, settings: s, fatigue })
    for (const [seq, p] of r.stopPatches) Object.assign(stops[seq], p)
    journey = { ...journey, ...r.patch }
    events.push(...r.events)
  }
  return { journey, stops, events, types: events.map(e => e.type) }
}

describe('a journey from start to finish', () => {
  it('starts, reaches the stop, leaves, completes — with the six timing events', () => {
    const fx = makeJourney({ stayB: 30 })
    const msgs = [
      ...park(T0 - 600, 22, A), // waiting at the depot until 10:12
      ...drive(T0 + 720, 20, A, B), // leaves 12 min late, at the stop 10:32 (planned 10:20)
      ...park(T0 + 1980, 6, B), // 5 min there
      ...drive(T0 + 2280, 20, B, C), // leaves 10:39 (planned 10:50): 11 min early
      ...park(T0 + 3540, 4, C), // arrives ~10:58 (planned 11:10)
    ]
    // Passes of ~5 minutes, like the engine.
    const chunks = []
    for (let i = 0; i < msgs.length; i += 5) chunks.push(msgs.slice(i, i + 5))
    const r = run(fx, chunks)

    expect(r.journey.status).toBe('Completed')
    const timing = r.events.filter(e => /^(ARRIVE|DEPART)_/.test(e.type)).map(e => [e.type, e.stopSeq])
    expect(timing).toEqual([
      ['DEPART_LATE', 0],
      ['ARRIVE_LATE', 1],
      ['DEPART_EARLY', 1],
      ['ARRIVE_EARLY', 2],
    ])
    const statuses = r.events.filter(e => e.type === 'STATUS').map(e => e.toStatus)
    expect(statuses).toEqual(['Started', 'InProgress', 'Completed'])
    expect(r.stops.map(s => s.status)).toEqual(['DEPARTED', 'DEPARTED', 'ARRIVED'])
    // The first fix outside the depot (10:13) is when it left.
    expect(r.stops[0].departDiffMin).toBe(13)
    expect(r.stops[1]).toMatchObject({ arriveTiming: 'LATE', departTiming: 'EARLY', checkInSource: 'AUTO' })
    expect(r.stops[1].dwellSec).toBeGreaterThanOrEqual(300)
    expect(r.journey.actualArrival).toBeInstanceOf(Date)
    expect(r.journey.delayMin).toBeLessThan(0)
    expect(r.journey.remainingKm).toBe(0)
    // Nothing alarming happened on the way.
    expect(r.types).not.toContain('OFF_ROUTE')
    expect(r.types).not.toContain('UNPLANNED_STOP')
    expect(r.types).not.toContain('NO_SIGNAL')
  })

  it('on time within ± onTimeMin', () => {
    const fx = makeJourney({ stayB: 0 })
    const msgs = [...park(T0 - 300, 7, A), ...drive(T0 + 120, 20, A, B), ...drive(T0 + 1320, 20, B, C), ...park(T0 + 2520, 4, C)]
    const r = run(fx, [msgs.slice(0, 10), msgs.slice(10, 30), msgs.slice(30)])
    const timing = r.events.filter(e => /^(ARRIVE|DEPART)_/.test(e.type)).map(e => e.type)
    expect(timing).toEqual(['DEPART_ON_TIME', 'ARRIVE_ON_TIME', 'DEPART_ON_TIME', 'ARRIVE_ON_TIME'])
    expect(r.stops[1].status).toBe('DEPARTED')
  })

  it('catches a stop driven through between two fixes 1.7 km apart', () => {
    const fx = makeJourney({ stayB: 0 })
    // 60 s fixes at ~100 km/h; shift the fixes so none lands inside the 300 m stop circle.
    const fast = drive(T0 + 30, 12, A + 0.0083, C, { step: 60 })
    expect(fast.some(m => Math.abs(m['position.longitude'] - B) * 101400 < 300)).toBe(false)
    const r = run(fx, [park(T0 - 300, 6, A), fast, park(T0 + 30 + 720, 4, C)])
    expect(r.stops[1]).toMatchObject({ status: 'PASSED', detectedBy: 'PASS_BY', dwellSec: 0 })
    expect(r.types).toContain('ARRIVE_EARLY')
    expect(r.journey.status).toBe('Completed')
  })
})

describe('alerts on the way', () => {
  it('not departed: once, lateDepartureMin after the planned start', () => {
    const fx = makeJourney()
    const r = run(fx, [park(T0 - 300, 10, A), park(T0 + 300, 10, A), park(T0 + 900, 10, A)])
    expect(r.types.filter(t => t === 'NOT_DEPARTED')).toHaveLength(1)
    expect(r.journey.status).toBe('Scheduled')
  })

  it('off route, against a drawn line, for offRouteMin; closed when back', () => {
    const path = [[LAT, A], [LAT, B], [LAT, C]]
    const fx = makeJourney({ routeSource: 'DRAWN', path, stayB: 0 })
    const away = LAT + 0.03 // ≈ 3.3 km north
    const msgs = [
      ...park(T0 - 120, 3, A),
      ...drive(T0 + 60, 5, A, A + 0.05),
      ...drive(T0 + 360, 3, A + 0.05, A + 0.08, { lat0: LAT, lat1: away }),
      ...drive(T0 + 540, 6, A + 0.08, A + 0.14, { lat0: away, lat1: away }),
      ...drive(T0 + 900, 3, A + 0.14, A + 0.17, { lat0: away, lat1: LAT }),
      ...drive(T0 + 1080, 5, A + 0.17, A + 0.19),
    ]
    const r = run(fx, [msgs.slice(0, 12), msgs.slice(12, 22), msgs.slice(22)])
    expect(r.types.filter(t => t === 'OFF_ROUTE')).toHaveLength(1)
    const off = r.events.find(e => e.type === 'OFF_ROUTE')
    expect(off.value).toBeGreaterThan(3000)
    expect(r.journey.offRouteCount).toBe(1)
    expect(r.journey.offRouteSec).toBeGreaterThan(0)
  })

  it('an unplanned stop, away from every planned stop, for unplannedStopMin', () => {
    const fx = makeJourney({ stayB: 0 })
    const mid = A + 0.1
    const msgs = [...park(T0 - 120, 3, A), ...drive(T0 + 60, 10, A, mid), ...park(T0 + 660, 14, mid), ...drive(T0 + 1500, 10, mid, B)]
    const r = run(fx, [msgs.slice(0, 13), msgs.slice(13, 27), msgs.slice(27)])
    expect(r.types.filter(t => t === 'UNPLANNED_STOP')).toHaveLength(1)
    expect(r.journey.unplannedStops).toBe(1)
    expect(r.journey.unplannedStopSec).toBeGreaterThanOrEqual(600)
  })

  it('running late: Delayed when the ETA passes planned + lateArrivalMin, back when it recovers', () => {
    const fx = makeJourney({ stayB: 0 })
    const mid = A + 0.05
    const traffic = park(T0 + 360, 30, mid + 0.0001).map(m => ({ ...m, 'position.speed': 2 }))
    const msgs = [...park(T0 - 120, 3, A), ...drive(T0 + 60, 5, A, mid), ...traffic]
    // The traffic queue sits on the road, within 200 m of nothing planned, so it is
    // also an unplanned stop; what matters here is the ETA.
    const r = run(fx, [msgs.slice(0, 8), msgs.slice(8, 20), msgs.slice(20)])
    expect(r.journey.status).toBe('Delayed')
    expect(r.types).toContain('DELAYED')
    expect(r.journey.delayMin).toBeGreaterThan(15)
  })

  it('no signal → Interrupted; data back → in progress again', () => {
    const fx = makeJourney({ stayB: 0 })
    const first = [...park(T0 - 120, 3, A), ...drive(T0 + 60, 5, A, A + 0.05)]
    const later = drive(T0 + 60 + 300 + 40 * 60, 3, A + 0.05, A + 0.08)
    const r = run(fx, [first, [], later], { nowOf: (i, m) => (i === 1 ? T0 + 360 + 35 * 60 : m[m.length - 1].timestamp) })
    expect(r.types).toContain('NO_SIGNAL')
    expect(r.types).toContain('SIGNAL_BACK')
    const st = r.events.filter(e => e.type === 'STATUS').map(e => e.toStatus)
    expect(st).toContain('Interrupted')
    expect(r.journey.status).not.toBe('Interrupted')
  })

  it('HSE break due after the first stint without a break', () => {
    const fx = makeJourney({ stayB: 0 })
    const msgs = [...park(T0 - 120, 3, A), ...drive(T0 + 60, 15, A, A + 0.15)]
    const r = run(fx, [msgs], { fatigue: { ...FATIGUE_DEFAULTS, firstDriveMin: 10 } })
    expect(r.types.filter(t => t === 'BREAK_DUE')).toHaveLength(1)
    const off = run(fx, [msgs], { fatigue: { ...FATIGUE_DEFAULTS, firstDriveMin: 10 }, s: { ...settings, hseBreaks: false } })
    expect(off.types).not.toContain('BREAK_DUE')
  })

  it('a missed stop is marked when the next one is reached', () => {
    const fx = makeJourney({ stayB: 30 })
    // Swings 5 km north around the fuel stop.
    const msgs = [
      ...park(T0 - 120, 3, A),
      ...drive(T0 + 60, 8, A, B - 0.06, { lat0: LAT, lat1: LAT + 0.045 }),
      ...drive(T0 + 540, 8, B - 0.06, B + 0.06, { lat0: LAT + 0.045, lat1: LAT + 0.045 }),
      ...drive(T0 + 1020, 8, B + 0.06, C, { lat0: LAT + 0.045, lat1: LAT }),
      ...park(T0 + 1500, 4, C),
    ]
    const r = run(fx, [msgs])
    expect(r.stops[1].status).toBe('SKIPPED')
    expect(r.types).toContain('SKIPPED_STOP')
    expect(r.journey.status).toBe('Completed')
  })
})

describe('one pass against the database', () => {
  let fx, approver
  const app = createApp()

  beforeEach(async () => {
    await resetDb()
    __clearJourneySettingsCache()
    fx = await seedFixture()
    approver = await prisma.user.create({ data: { email: 'hse@alhabtoorlog.ae', passwordHash: 'x', role: 'BG_USER', bgId: fx.bgA1a.id, mustChangePassword: false, screenAccess: { 'journey-approval': 'modify' } } })
  })

  it('writes the stops, the events, the bell entries per the settings, and escalates unread ones', async () => {
    const start = Math.floor(Date.now() / 1000) + 3600
    const c = await request(app).post('/api/journeys').set(auth(fx.tokens.bgUserA1a)).send({
      title: 'Engine pass', vehicleId: fx.vehicles.v1.id, plannedStart: new Date(start * 1000).toISOString(), submit: true,
      stops: [
        { name: 'Depot', lat: LAT, lng: A },
        { name: 'Fuel stop', lat: LAT, lng: B, stayMin: 30, legDriveMin: 20, legSource: 'MANUAL' },
        { name: 'Site C', lat: LAT, lng: C, legDriveMin: 20, legSource: 'MANUAL' },
      ],
    })
    expect(c.status).toBe(201)
    const ok = await request(app).post(`/api/journeys/${c.body.data.id}/approve`).set(auth(signToken(approver)))
    expect(ok.status).toBe(200)

    const msgs = [...park(start - 600, 22, A), ...drive(start + 720, 20, A, B), ...park(start + 1980, 6, B)]
    const deviceByImei = new Map([[fx.vehicles.v1.imei, 101]])
    const fetchMessages = async () => new Map([[101, msgs]])
    const now = start + 1980 + 6 * 60
    const r = await runJourneyPass(now, { deviceByImei, fetchMessages })
    expect(r.journeys).toBe(1)

    const j = await prisma.journey.findUnique({ where: { id: c.body.data.id }, include: { stops: { orderBy: { seq: 'asc' } }, events: true } })
    expect(j.status).toBe('InProgress')
    expect(j.stops.map(s => s.status)).toEqual(['DEPARTED', 'ARRIVED', 'PENDING'])
    expect(j.stops[1].arriveTiming).toBe('LATE')
    const types = j.events.map(e => e.type)
    expect(types).toEqual(expect.arrayContaining(['DEPART_LATE', 'ARRIVE_LATE', 'STATUS']))
    // Late events ring the bell; status changes do not.
    const bell = await prisma.alertEvent.findMany({ where: { type: { startsWith: 'journey_' } } })
    expect(bell.map(b => b.type)).toEqual(expect.arrayContaining(['journey_depart_late', 'journey_arrive_late']))
    expect(bell.some(b => b.type === 'journey_status')).toBe(false)
    // Stage 1: the creator and the approver (push not set up here, so logged as skipped).
    const n1 = await prisma.journeyNotice.findMany({ where: { stage: 1, journeyEventId: j.events.find(e => e.type === 'ARRIVE_LATE').id } })
    expect(n1.map(n => n.userId).sort()).toEqual([fx.users.bgUserA1a.id, approver.id].sort())
    expect(n1.every(n => n.status === 'SKIPPED_NOT_CONFIGURED')).toBe(true)

    // A second pass with nothing new raises nothing again.
    const again = await runJourneyPass(now + 60, { deviceByImei, fetchMessages })
    expect(again.events).toBe(0)

    // Stage 2: still unread 15 min later → the BG's admin accounts.
    expect(await escalate(now + 5 * 60)).toBe(0)
    const sent = await escalate(now + 20 * 60)
    expect(sent).toBeGreaterThan(0)
    const n2 = await prisma.journeyNotice.findMany({ where: { stage: 2 } })
    expect(n2.length).toBeGreaterThan(0)
    expect(n2.some(n => n.userId === fx.users.bgUserA1a.id)).toBe(false) // already told in stage 1
    expect(await escalate(now + 30 * 60)).toBe(0) // once
  })

  it('a journey shows in the detail with its timing chips', async () => {
    const start = Math.floor(Date.now() / 1000) + 3600
    const c = await request(app).post('/api/journeys').set(auth(fx.tokens.bgUserA1a)).send({
      title: 'Detail', vehicleId: fx.vehicles.v2.id, plannedStart: new Date(start * 1000).toISOString(), submit: true,
      stops: [{ name: 'Depot', lat: LAT, lng: A }, { name: 'Site C', lat: LAT, lng: C, legDriveMin: 40, legSource: 'MANUAL' }],
    })
    await request(app).post(`/api/journeys/${c.body.data.id}/approve`).set(auth(signToken(approver)))
    const msgs = [...park(start - 300, 6, A), ...drive(start + 60, 30, A, C), ...park(start + 1860, 4, C)]
    await runJourneyPass(start + 2100, { deviceByImei: new Map([[fx.vehicles.v2.imei, 102]]), fetchMessages: async () => new Map([[102, msgs]]) })
    const d = await request(app).get(`/api/journeys/${c.body.data.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(d.body.data.display).toBe('Completed')
    expect(d.body.data.stops[0].departTiming).toBe('ON_TIME')
    expect(d.body.data.stops[1].arriveTiming).toBe('ON_TIME') // ~31 min for 40 planned: −9
    expect(d.body.data.stopsDone).toBe(1)
  })
})
