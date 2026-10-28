import { describe, it, expect } from 'vitest'
import {
  pointInPolygon, pointInCircle, whichGeofence,
  buildContainmentSegments, deriveTrips, deriveVisits, deriveHistoryRows,
  analyzeVehicle, classifyInterval, usageOverWindow,
} from './geoZoneEngine'

// A 1km-ish square around (25.0, 55.0) and a circle near (25.1, 55.1).
const SQUARE = {
  id: 'sq', name: 'Square', shape: 'POLYGON',
  points: [
    { lat: 24.995, lng: 54.995 },
    { lat: 24.995, lng: 55.005 },
    { lat: 25.005, lng: 55.005 },
    { lat: 25.005, lng: 54.995 },
  ],
}
const CIRCLE = {
  id: 'ci', name: 'Circle', shape: 'CIRCLE',
  centerLat: 25.1, centerLng: 55.1, radius: 500,
}
const GEOFENCES = [SQUARE, CIRCLE]

const INSIDE_SQUARE = { lat: 25.0, lng: 55.0 }
const INSIDE_CIRCLE = { lat: 25.1, lng: 55.1 }
const OUTSIDE = { lat: 24.5, lng: 54.5 }

let T0 = 1_000_000_000 // arbitrary epoch seconds base

function msg(ts, { lat, lng, speed = 0, ignition = true, mileage = null } = {}) {
  const m = { timestamp: T0 + ts, 'engine.ignition.status': ignition, 'position.speed': speed }
  if (lat != null) m['position.latitude'] = lat
  if (lng != null) m['position.longitude'] = lng
  if (mileage != null) m['vehicle.mileage'] = mileage
  return m
}

describe('geometry', () => {
  it('pointInPolygon: inside and outside the square', () => {
    expect(pointInPolygon(INSIDE_SQUARE.lat, INSIDE_SQUARE.lng, SQUARE.points)).toBe(true)
    expect(pointInPolygon(OUTSIDE.lat, OUTSIDE.lng, SQUARE.points)).toBe(false)
  })

  it('pointInCircle: inside and outside the circle', () => {
    expect(pointInCircle(INSIDE_CIRCLE.lat, INSIDE_CIRCLE.lng, CIRCLE.centerLat, CIRCLE.centerLng, CIRCLE.radius)).toBe(true)
    expect(pointInCircle(OUTSIDE.lat, OUTSIDE.lng, CIRCLE.centerLat, CIRCLE.centerLng, CIRCLE.radius)).toBe(false)
  })

  it('whichGeofence picks the containing fence, null when outside all', () => {
    expect(whichGeofence(INSIDE_SQUARE.lat, INSIDE_SQUARE.lng, GEOFENCES)?.id).toBe('sq')
    expect(whichGeofence(INSIDE_CIRCLE.lat, INSIDE_CIRCLE.lng, GEOFENCES)?.id).toBe('ci')
    expect(whichGeofence(OUTSIDE.lat, OUTSIDE.lng, GEOFENCES)).toBe(null)
  })
})

describe('usage classification', () => {
  it('buckets running/idle/stop/inactive by ignition+speed+gap, matching computeUsage rules', () => {
    const a = msg(0, { speed: 10, ignition: true })
    const b = msg(60, { speed: 10, ignition: true })
    expect(classifyInterval(a, b).bucket).toBe('running')

    const c = msg(0, { speed: 0, ignition: true })
    const d = msg(60, { speed: 0, ignition: true })
    expect(classifyInterval(c, d).bucket).toBe('idle')

    const e = msg(0, { speed: 0, ignition: false })
    const f = msg(60, { speed: 0, ignition: false })
    expect(classifyInterval(e, f).bucket).toBe('stop')

    const g = msg(0, { speed: 0, ignition: true })
    const h = msg(3000, { speed: 0, ignition: true }) // 50 min gap > 30 min cap
    expect(classifyInterval(g, h).bucket).toBe('inactive')
  })

  it('usageOverWindow sums buckets to the window span and derives distance from mileage delta', () => {
    // Each interval is classified by the state at its START sample, matching
    // classifyInterval's "prev speed/ignition" convention.
    // Positions move ~3.3 km with the odometer's 5 km — an odometer rise with
    // no movement behind it is treated as a glitch (see distance.js).
    const messages = [
      msg(0, { lat: 24.40, lng: 54.4, speed: 10, ignition: true, mileage: 100 }),  // [0,600) running
      msg(600, { lat: 24.43, lng: 54.4, speed: 0, ignition: true, mileage: 105 }), // [600,900) idle
      msg(900, { lat: 24.43, lng: 54.4, speed: 0, ignition: true, mileage: 105 }), // window end marker
    ]
    const u = usageOverWindow(messages, T0 + 0, T0 + 900)
    expect(u.runningSec).toBe(600)
    expect(u.idleSec).toBe(300)
    expect(u.runningSec + u.idleSec + u.stopSec + u.inactiveSec).toBe(900)
    expect(u.distanceKm).toBe(5)
  })
})

describe('entry/exit and dwell filter', () => {
  it('a containment run at or above dwellSec is kept as a real entry', () => {
    const messages = [
      msg(0, OUTSIDE),
      msg(30, INSIDE_SQUARE),
      msg(90, INSIDE_SQUARE), // 90s inside >= default 60s dwell
      msg(120, OUTSIDE),
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const fenceSegs = segs.filter(s => s.fenceId != null)
    expect(fenceSegs).toHaveLength(1)
    expect(fenceSegs[0].fenceId).toBe('sq')
  })

  it('a containment run shorter than dwellSec is dropped as GPS jitter', () => {
    const messages = [
      msg(0, OUTSIDE),
      msg(30, INSIDE_SQUARE),
      msg(45, INSIDE_SQUARE), // only 15s inside, below default 60s dwell
      msg(60, OUTSIDE),
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    expect(segs.every(s => s.fenceId == null)).toBe(true)
  })
})

describe('short-exit merge', () => {
  it('merges a brief exit-and-return to the SAME fence within mergeGapSec', () => {
    const messages = [
      msg(0, INSIDE_SQUARE),
      msg(120, INSIDE_SQUARE),  // 120s inside: real entry
      msg(130, OUTSIDE),
      msg(150, OUTSIDE),        // 20s outside, well under 120s merge gap
      msg(160, INSIDE_SQUARE),
      msg(400, INSIDE_SQUARE),  // back inside the SAME fence
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const fenceSegs = segs.filter(s => s.fenceId != null)
    expect(fenceSegs).toHaveLength(1)
    expect(fenceSegs[0].startMsg.timestamp).toBe(T0 + 0)
    expect(fenceSegs[0].endMsg.timestamp).toBe(T0 + 400)
  })

  it('does NOT merge when the exit returns to a DIFFERENT fence', () => {
    const messages = [
      msg(0, INSIDE_SQUARE),
      msg(120, INSIDE_SQUARE),
      msg(130, OUTSIDE),
      msg(150, OUTSIDE),
      msg(160, INSIDE_CIRCLE),
      msg(400, INSIDE_CIRCLE),
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const fenceSegs = segs.filter(s => s.fenceId != null)
    expect(fenceSegs.map(s => s.fenceId)).toEqual(['sq', 'ci'])
  })

  it('does NOT merge an exit longer than mergeGapSec even back to the same fence', () => {
    const messages = [
      msg(0, INSIDE_SQUARE),
      msg(120, INSIDE_SQUARE),
      msg(130, OUTSIDE),
      msg(400, OUTSIDE), // 270s outside > default 120s merge gap
      msg(410, INSIDE_SQUARE),
      msg(600, INSIDE_SQUARE),
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES, { mergeGapSec: 120 })
    const fenceSegs = segs.filter(s => s.fenceId != null)
    expect(fenceSegs).toHaveLength(2) // two genuinely separate visits
  })
})

describe('trips', () => {
  it('chains trips zero-gap from one fence-exit to the next fence-entry', () => {
    const messages = [
      msg(0, INSIDE_SQUARE, ),
      msg(120, INSIDE_SQUARE),   // exit sq at t=120
      msg(130, OUTSIDE),
      msg(1000, OUTSIDE),
      msg(1010, INSIDE_CIRCLE),  // enter ci at t=1010
      msg(1200, INSIDE_CIRCLE),
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const trips = deriveTrips(segs, messages)
    expect(trips).toHaveLength(1)
    expect(trips[0].startFence.id).toBe('sq')
    expect(trips[0].endFence.id).toBe('ci')
    expect(trips[0].start.ts).toBe(T0 + 120)
    expect(trips[0].end.ts).toBe(T0 + 1010)
  })

  it('allows a self-to-self trip when the exit survives the merge window', () => {
    const messages = [
      msg(0, INSIDE_SQUARE),
      msg(120, INSIDE_SQUARE),   // exit
      msg(130, OUTSIDE),
      msg(400, OUTSIDE),         // outside long enough to NOT merge (> default 120s)
      msg(410, INSIDE_SQUARE),   // re-enter the SAME fence: a real self-to-self trip
      msg(600, INSIDE_SQUARE),
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const trips = deriveTrips(segs, messages)
    expect(trips).toHaveLength(1)
    expect(trips[0].startFence.id).toBe('sq')
    expect(trips[0].endFence.id).toBe('sq')
  })

  it('emits no trip before the first exit, and no dangling trip at the data cutoff', () => {
    const messages = [
      msg(0, OUTSIDE), // starts outside with no prior known fence
      msg(100, OUTSIDE),
      msg(200, INSIDE_SQUARE),
      msg(500, INSIDE_SQUARE), // window ends still inside sq — no "open trip" row
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const trips = deriveTrips(segs, messages)
    expect(trips).toHaveLength(0)
  })
})

describe('visits', () => {
  it('reach/depart a fence, with outside duration until the next reach of the SAME fence', () => {
    const messages = [
      msg(0, INSIDE_SQUARE),
      msg(120, INSIDE_SQUARE),  // depart sq at 120
      msg(130, OUTSIDE),
      msg(1000, OUTSIDE),
      msg(1010, INSIDE_SQUARE), // reach sq again at 1010
      msg(1200, INSIDE_SQUARE),
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const visits = deriveVisits(segs, messages)
    expect(visits).toHaveLength(2)
    expect(visits[0].reach.ts).toBe(T0 + 0)
    expect(visits[0].depart.ts).toBe(T0 + 120)
    expect(visits[0].outsideDurationSec).toBe(890) // 1010 - 120
    expect(visits[1].inProgress).toBe(true)
    expect(visits[1].depart).toBe(null)
  })

  it('an in-progress visit at the data cutoff has null depart, not an invented value', () => {
    const messages = [
      msg(0, INSIDE_SQUARE),
      msg(500, INSIDE_SQUARE), // still inside when messages run out
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const visits = deriveVisits(segs, messages)
    expect(visits).toHaveLength(1)
    expect(visits[0].depart).toBe(null)
    expect(visits[0].inProgress).toBe(true)
  })
})

describe('history rows', () => {
  it('one entry/exit row per containment segment, with distance from mileage delta', () => {
    const messages = [
      msg(0, { ...INSIDE_SQUARE, mileage: 10 }),
      msg(120, { ...INSIDE_SQUARE, mileage: 12 }),
      msg(130, OUTSIDE),
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const rows = deriveHistoryRows(segs, messages)
    expect(rows).toHaveLength(1)
    expect(rows[0].fence.id).toBe('sq')
    expect(rows[0].distanceKm).toBe(2)
  })
})

describe('midnight crossing', () => {
  // The engine itself is timezone-agnostic — it only ever compares raw epoch
  // seconds, so a trip/visit that happens to straddle UAE local midnight
  // needs no special handling here. (UAE-day CHUNKING of the Flespi fetch
  // itself is geoZoneFetch.js's concern, reusing daywise.js's logic.)
  it('derives a trip correctly across a UTC-midnight-straddling span', () => {
    T0 = Math.floor(Date.UTC(2026, 0, 1, 23, 50, 0) / 1000) // 23:50 UTC
    const messages = [
      msg(0, INSIDE_SQUARE),
      msg(300, INSIDE_SQUARE),   // exit at 23:55
      msg(310, OUTSIDE),
      msg(1200, OUTSIDE),
      msg(1210, INSIDE_CIRCLE),  // enter ci at 00:10 next day
      msg(1500, INSIDE_CIRCLE),
    ]
    const segs = buildContainmentSegments(messages, GEOFENCES)
    const trips = deriveTrips(segs, messages)
    expect(trips).toHaveLength(1)
    expect(trips[0].end.ts - trips[0].start.ts).toBe(910)
  })
})

describe('analyzeVehicle orchestration', () => {
  it('returns segments, trips, visits and historyRows together', () => {
    const messages = [
      msg(0, INSIDE_SQUARE),
      msg(120, INSIDE_SQUARE),
      msg(130, OUTSIDE),
      msg(1000, OUTSIDE),
      msg(1010, INSIDE_CIRCLE),
      msg(1200, INSIDE_CIRCLE),
    ]
    const result = analyzeVehicle(messages, GEOFENCES)
    expect(result.trips).toHaveLength(1)
    expect(result.visits.length).toBeGreaterThanOrEqual(2)
    expect(result.historyRows.length).toBeGreaterThanOrEqual(2)
  })
})
