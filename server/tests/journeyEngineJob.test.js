/**
 * The journey engine's Job-module parts (client 2026-11-21): the destination
 * is reached only by staying or switching off there (never by driving
 * through), start logic + start buffer, the HSE limits counting the day's
 * earlier driving, the convoy, temperature limits, QR stops and check-ins
 * made between passes — with synthetic tracker messages, plus one DB pass
 * that makes a schedule's days and force-closes.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import prisma from '../src/prisma.js'
import { stepJourney, priorDriving, runJourneyPass } from '../src/lib/journeyEngine.js'
import { JOURNEY_DEFAULTS, mergeSettings, __clearJourneySettingsCache } from '../src/lib/journeySettings.js'
import { FATIGUE_DEFAULTS } from '../src/lib/driverPerformance.js'
import { computeSchedule } from '../../src/utils/journeySchedule.js'
import { resetDb, seedFixture } from './factories.js'

const settings = mergeSettings(JOURNEY_DEFAULTS)
const T0 = Math.floor(Date.parse('2026-11-18T06:00:00Z') / 1000) // 10:00 UAE
const LAT = 24.35
const A = 54.5, B = 54.7, C = 54.9

function makeJourney({ stayB = 30, extra = {}, stopExtra = {} } = {}) {
  const sched = computeSchedule({
    plannedStart: T0 * 1000,
    stops: [
      { name: 'Depot', lat: LAT, lng: A, radiusM: 300, stayMin: 0 },
      { name: 'Fuel stop', lat: LAT, lng: B, radiusM: 300, stayMin: stayB, legDriveMin: 20, legSource: 'MANUAL', ...stopExtra },
      { name: 'Site C', lat: LAT, lng: C, radiusM: 300, stayMin: 0, legDriveMin: 20, legSource: 'MANUAL' },
    ],
  })
  return {
    journey: {
      id: 'j1', status: 'Scheduled', plannedStart: new Date(T0 * 1000), expectedArrival: sched.expectedArrival,
      routeSource: 'STRAIGHT', plannedPath: null, plannedDistanceKm: 40.6, plannedDriveMin: 40, engineState: null,
      offRouteCount: 0, offRouteSec: 0, unplannedStops: 0, unplannedStopSec: 0, startBufferMin: 60, ...extra,
    },
    stops: sched.stops.map((s, seq) => ({ ...s, seq, arrivalType: 'RADIUS', status: 'PENDING', alongKm: seq * 20.3, visitVia: s.visitVia ?? 'MAP' })),
  }
}

const msg = (ts, lng, speed, { lat = LAT, ign = true, temp } = {}) => ({
  timestamp: ts, 'position.latitude': lat, 'position.longitude': lng, 'position.speed': speed, 'engine.ignition.status': ign,
  ...(temp != null ? { 'ble.sensor.temperature.1': temp } : {}),
})
const park = (t, min, lng, o = {}) => Array.from({ length: min }, (_, i) => msg(t + i * 60, lng, 0, o))
function drive(t, min, lng0, lng1, o = {}) {
  const n = min
  const kmh = (Math.abs(lng1 - lng0) * 101.4) / (min / 60)
  return Array.from({ length: n }, (_, i) => msg(t + (i + 1) * 60, lng0 + ((i + 1) / n) * (lng1 - lng0), kmh, typeof o === 'function' ? o(i) : o))
}

function run(fx, msgs, { s = settings, fatigue = FATIGUE_DEFAULTS, prior = null, convoyMessages = {}, chunk = 5, beforePass } = {}) {
  let journey = { ...fx.journey }
  const stops = fx.stops.map(x => ({ ...x }))
  const events = []
  for (let i = 0; i < msgs.length; i += chunk) {
    const messages = msgs.slice(i, i + chunk)
    if (beforePass) beforePass(i, stops, journey)
    const now = messages[messages.length - 1].timestamp
    const r = stepJourney({ journey, stops, messages, now, settings: s, fatigue, prior, convoyMessages })
    for (const [seq, p] of r.stopPatches) Object.assign(stops[seq], p)
    journey = { ...journey, ...r.patch }
    events.push(...r.events)
  }
  return { journey, stops, events, types: events.map(e => e.type) }
}

const toB = () => [...park(T0 - 300, 5, A), ...drive(T0, 20, A, B), ...park(T0 + 1260, 35, B), ...drive(T0 + 3360, 20, B, C)]

describe('the destination', () => {
  it('driving through it does not complete the journey; staying does', () => {
    const fx = makeJourney()
    const through = [...toB(), ...drive(T0 + 4560, 10, C, C + 0.1)]
    const r = run(fx, through)
    expect(r.journey.status).not.toBe('Completed')
    expect(r.stops[2].status).toBe('PENDING')
    expect(r.types).toContain('DESTINATION_PASSED')

    const stay = run(fx, [...toB(), ...park(T0 + 4560, 4, C)])
    expect(stay.journey.status).toBe('Completed')
  })

  it('IGNITION_OFF: only the ignition off there completes it', () => {
    const fx = makeJourney()
    const s = { ...settings, destinationRule: 'IGNITION_OFF' }
    const engineOn = run(fx, [...toB(), ...park(T0 + 4560, 6, C)], { s })
    expect(engineOn.journey.status).not.toBe('Completed')
    const off = run(fx, [...toB(), ...park(T0 + 4560, 2, C), ...park(T0 + 4680, 2, C, { ign: false })], { s })
    expect(off.journey.status).toBe('Completed')
  })
})

describe('start logic and start buffer', () => {
  it('IGNITION_ON starts at the first stop when the ignition comes on, and departs on leaving', () => {
    const fx = makeJourney({ extra: { startLogic: 'IGNITION_ON' } })
    const msgs = [...park(T0 - 600, 4, A, { ign: false }), ...park(T0 - 360, 6, A, { ign: true }), ...drive(T0, 20, A, B)]
    const r = run(fx, msgs)
    const started = r.events.find(e => e.type === 'STATUS' && e.toStatus === 'Started')
    expect(started.occurredAt).toBe(T0 - 360)
    expect(r.journey.actualStart.getTime() / 1000).toBe(T0 - 360)
    expect(r.stops[0].status).toBe('DEPARTED')
    expect(r.types).toContain('DEPART_ON_TIME')
  })

  it('a departure before the start buffer does not start the journey', () => {
    const fx = makeJourney({ extra: { startBufferMin: 10 } })
    // At the depot and away 40 min early: outside the 10 min buffer.
    const early = [...park(T0 - 3000, 5, A), ...drive(T0 - 2700, 20, A, B)]
    expect(run(fx, early).journey.status).toBe('Scheduled')
    const fx60 = makeJourney({ extra: { startBufferMin: 60 } })
    expect(run(fx60, early).journey.status).not.toBe('Scheduled')
  })
})

describe('HSE driving rules count the day before the journey', () => {
  it('priorDriving: driving seconds and the stint still running', () => {
    const f = { breakMin: 30 }
    const m = [
      ...Array.from({ length: 61 }, (_, i) => ({ timestamp: i * 60, 'position.speed': 60 })), // 60 min driving
      ...Array.from({ length: 40 }, (_, i) => ({ timestamp: 3660 + i * 60, 'position.speed': 0 })), // 40 min break
      ...Array.from({ length: 30 }, (_, i) => ({ timestamp: 6060 + i * 60, 'position.speed': 50 })), // 30 min driving
    ]
    const p = priorDriving(m, f)
    expect(Math.round(p.daySec / 60)).toBe(90)
    expect(Math.round(p.stintSec / 60)).toBe(30)
    expect(p.stintNo).toBe(1)
  })

  it('the daily limit is reached sooner with earlier driving', () => {
    const fx = makeJourney({ extra: { status: 'InProgress', actualStart: new Date(T0 * 1000), engineState: { lastTs: T0, next: 1, seg: 0, progressKm: 0, originSeen: true } } })
    fx.stops[0].status = 'DEPARTED'
    const fatigue = { ...FATIGUE_DEFAULTS, dailyMaxMin: 600, firstDriveMin: 10_000, driveMin: 10_000 }
    const msgs = drive(T0, 20, A, B)
    expect(run(fx, msgs, { fatigue }).types).not.toContain('DAILY_LIMIT')
    const r = run(fx, msgs, { fatigue, prior: { daySec: 590 * 60, stintSec: 0, stintNo: 0 } })
    expect(r.types).toContain('DAILY_LIMIT')
    expect(r.events.find(e => e.type === 'DAILY_LIMIT').message).toMatch(/590 min of it before this journey/)
    expect(r.journey.engineState.drive.seeded).toBe(true)
  })
})

describe('convoy and temperature', () => {
  const onRoad = extra => {
    const fx = makeJourney({ extra: { status: 'InProgress', actualStart: new Date(T0 * 1000), engineState: { lastTs: T0, next: 1, seg: 0, progressKm: 0, originSeen: true }, ...extra } })
    fx.stops[0].status = 'DEPARTED'
    return fx
  }

  it('raises Convoy separated when a member falls behind, and Back together when it catches up', () => {
    const fx = onRoad({ convoy: [{ vehicleId: 'v2', vehicleLabel: 'AD 2' }], convoyToleranceM: 200 })
    const lead = drive(T0, 20, A, B)
    // The member keeps up for 5 min, falls 2+ km behind, then catches up.
    const member = lead.map((m, i) => ({ ...m, 'position.longitude': m['position.longitude'] - (i >= 5 && i < 14 ? 0.03 : 0.0005) }))
    const r = run(fx, lead, { convoyMessages: { v2: member } })
    expect(r.types).toContain('CONVOY_SEPARATED')
    expect(r.types).toContain('CONVOY_REJOINED')
    expect(r.journey.convoyState[0]).toMatchObject({ vehicleId: 'v2', separated: false })
  })

  it('raises Temperature out of range after the delay, and back in range', () => {
    const fx = onRoad({ tempMin: 2, tempMax: 8 })
    const msgs = drive(T0, 20, A, B, i => ({ temp: i >= 3 && i < 12 ? 11.5 : 5 }))
    const r = run(fx, msgs)
    expect(r.types.filter(t => t === 'TEMP_OUT_OF_RANGE')).toHaveLength(1)
    expect(r.types).toContain('TEMP_BACK')
    expect(r.journey.lastTemp).toBe(5)
    // No limits: just the reading.
    expect(run(onRoad({}), msgs).types).not.toContain('TEMP_OUT_OF_RANGE')
  })
})

describe('QR stops and check-ins between passes', () => {
  it('a QR stop is not reached by position; a later stop marks it missed', () => {
    const fx = makeJourney({ stayB: 0, stopExtra: { visitVia: 'QR' } })
    const r = run(fx, [...toB(), ...park(T0 + 4560, 4, C)])
    expect(r.stops[1].status).toBe('SKIPPED')
    expect(r.journey.status).toBe('Completed')
  })

  it('the driver scanned it between passes: the engine carries on and sees it leave', () => {
    const fx = makeJourney({ stopExtra: { visitVia: 'QR' } })
    const msgs = toB()
    const r = run(fx, msgs, {
      beforePass: (i, stops) => {
        // Scanned at 10:25, while parked there.
        if (msgs[i].timestamp >= T0 + 1500 && stops[1].status === 'PENDING') Object.assign(stops[1], { status: 'ARRIVED', actualArrive: new Date((T0 + 1500) * 1000), checkInSource: 'DRIVER' })
      },
    })
    expect(r.stops[1].status).toBe('DEPARTED')
    expect(r.types).not.toContain('SKIPPED_STOP')
  })
})

describe('one pass against the database', () => {
  let fx
  beforeEach(async () => {
    await resetDb()
    __clearJourneySettingsCache()
    fx = await seedFixture()
  })

  it('makes the schedules\' days and force-closes a stale journey in the same pass', async () => {
    const stops = [
      { name: 'Depot', lat: LAT, lng: A, stayMin: 0 },
      { name: 'Site C', lat: LAT, lng: C, stayMin: 0, legDriveMin: 40, legSource: 'MANUAL' },
    ]
    await prisma.journeyTemplate.create({
      data: {
        bgId: fx.bgA1a.id, name: 'Daily', vehicleId: fx.vehicles.v1.id, scheduleKind: 'RELATIVE', repeat: 'DAILY', startTime: '06:00',
        validFrom: new Date(Date.now() - 86_400_000), horizonDays: 2, body: { title: 'Daily run', routeSource: 'STRAIGHT', stops },
      },
    })
    const stale = await prisma.journey.create({
      data: {
        bgId: fx.bgA1a.id, title: 'Old', vehicleId: fx.vehicles.v2.id, vehicleLabel: 'V2', status: 'Scheduled', approvalStatus: 'APPROVED',
        plannedStart: new Date(Date.now() - 30 * 3600_000), expectedArrival: new Date(Date.now() - 29 * 3600_000),
        stops: { create: [{ seq: 0, kind: 'ORIGIN', name: 'A', lat: LAT, lng: A }, { seq: 1, kind: 'DESTINATION', name: 'C', lat: LAT, lng: C }] },
      },
    })
    await runJourneyPass(Math.floor(Date.now() / 1000), { deviceByImei: new Map(), fetchMessages: async ids => new Map(ids.map(id => [id, []])) })
    const made = await prisma.journey.count({ where: { scheduleKind: 'RELATIVE' } })
    expect(made).toBeGreaterThanOrEqual(2)
    const s = await prisma.journey.findUnique({ where: { id: stale.id } })
    expect(s.status).toBe('Cancelled')
    expect(s.forceClosedAt).toBeInstanceOf(Date)
  })
})
