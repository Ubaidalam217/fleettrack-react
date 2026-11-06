import { describe, expect, it } from 'vitest'
import { deriveTrips, sumTrips, byDay, visibleTrips, tripUsage, gyrScore, hms } from './usageReports'

// 2026-11-06 08:00 local
const T0 = Math.floor(new Date(2026, 10, 6, 8, 0, 0).getTime() / 1000)
const msg = (dt, o = {}) => ({
  timestamp: T0 + dt,
  'position.latitude': 25.2 + dt * 0.00008, // ~9 m/s: odometer jumps stay plausible
  'position.longitude': 55.3,
  'position.speed': 0,
  'engine.ignition.status': true,
  ...o,
})

describe('deriveTrips', () => {
  it('cuts a trip from ignition on to ignition off, with drive and idle time and distance', () => {
    const trips = deriveTrips([
      msg(0, { 'engine.ignition.status': false }),
      msg(60, { 'vehicle.mileage': 100 }),            // on, idle
      msg(120, { 'position.speed': 40, 'vehicle.mileage': 100 }),
      msg(720, { 'position.speed': 30, 'vehicle.mileage': 105 }),
      msg(780, { 'vehicle.mileage': 105.5 }),          // stopped, still on
      msg(840, { 'engine.ignition.status': false, 'vehicle.mileage': 105.5 }),
      msg(3600, { 'engine.ignition.status': false }),
    ])
    expect(trips).toHaveLength(1)
    const t = trips[0]
    expect(t.startTs).toBe(T0 + 60)
    expect(t.endTs).toBe(T0 + 840)
    expect(t.idleSec).toBe(60 + 60)          // 60→120 and 780→840
    expect(t.driveSec).toBe(600 + 60)        // 120→720 and 720→780
    expect(t.distanceKm).toBeCloseTo(5.5, 1)
    expect(t.maxSpeed).toBe(40)
    expect(t.open).toBe(false)
  })

  it('counts over speed episodes, excess idle and harsh braking', () => {
    const trips = deriveTrips([
      msg(0),                                   // idle from 0
      msg(700, { 'position.speed': 0 }),        // 11:40 idle → XI at 10 min
      msg(701, { 'position.speed': 90 }),       // over (and a +25 m/s² jump, discarded as noise)
      msg(760, { 'position.speed': 70 }),
      msg(820, { 'position.speed': 95 }),       // over again
      msg(825, { 'position.speed': 60 }),       // -1.9 m/s²: not harsh
      msg(826, { 'position.speed': 45 }),       // -4.2 m/s²: harsh brake
      msg(900, { 'engine.ignition.status': false }),
    ], { overSpeedKmh: 80, xiMinutes: 10 })
    const t = trips[0]
    expect(t.overSpeedCount).toBe(2)
    expect(t.overSpeedSec).toBe(59 + 5)
    expect(t.xiCount).toBe(1)
    expect(t.xiSec).toBe(701)
    expect(t.hbCount).toBe(1)
    expect(t.haCount).toBe(0)
  })

  it('counts speed hovering at the limit as one over-speed episode', () => {
    const speeds = [85, 79, 83, 78, 84, 70, 90]
    const trips = deriveTrips([msg(0), ...speeds.map((v, i) => msg(60 * (i + 1), { 'position.speed': v })), msg(600, { 'engine.ignition.status': false })], { overSpeedKmh: 80 })
    expect(trips[0].overSpeedCount).toBe(2) // 85…84 is one; it re-arms at 70; 90 is the second
  })

  it('ends a trip at a long data gap, and keeps the last one open at the end of the data', () => {
    const trips = deriveTrips([
      msg(0, { 'position.speed': 20 }),
      msg(60, { 'position.speed': 20 }),
      msg(60 + 3 * 3600, { 'position.speed': 20 }), // 3 h later, ignition still on
      msg(60 + 3 * 3600 + 60, { 'position.speed': 20 }),
    ])
    expect(trips).toHaveLength(2)
    expect(trips[0].endTs).toBe(T0 + 60)
    expect(trips[0].stopSec).toBe(3 * 3600)
    expect(trips[1].open).toBe(true)
    expect(trips[1].stopSec).toBeNull()
  })

  it('takes the first fix as the start place when the trip began without one', () => {
    const nofix = o => { const m = msg(o.dt, o); delete m['position.latitude']; delete m['position.longitude']; return m }
    const trips = deriveTrips([nofix({ dt: 0 }), msg(60, { 'position.speed': 20 }), msg(120, { 'engine.ignition.status': false })])
    expect(trips[0].startLat).toBeCloseTo(25.2 + 60 * 0.00008, 6)
  })

  it('names the trip by the first iButton tag read during it, ignoring the all-zero code', () => {
    const trips = deriveTrips([
      msg(0, { 'ibutton.code': '0000000000000000' }),
      msg(60, { 'position.speed': 20, 'ibutton.code': '94000001d9df0801' }),
      msg(120, { 'position.speed': 20, 'ibutton.code': 'AAAA' }),
      msg(180, { 'engine.ignition.status': false }),
    ])
    expect(trips[0].ibutton).toBe('94000001D9DF0801')
  })

  it('falls back to movement when a tracker never reports ignition', () => {
    const noIgn = o => { const m = msg(o.dt, o); delete m['engine.ignition.status']; return m }
    const trips = deriveTrips([noIgn({ dt: 0 }), noIgn({ dt: 60, 'position.speed': 30 }), noIgn({ dt: 120, 'position.speed': 30 }), noIgn({ dt: 180 })])
    expect(trips).toHaveLength(1)
    expect(trips[0].startTs).toBe(T0 + 60)
  })
})

describe('grouping and rules', () => {
  const trip = (startH, km = 10, extra = {}) => ({
    startTs: T0 + startH * 3600, endTs: T0 + startH * 3600 + 1800, distanceKm: km, driveSec: 1500, idleSec: 300,
    maxSpeed: 60, overSpeedCount: 0, overSpeedSec: 0, xiCount: 0, xiSec: 0, hbCount: 0, haCount: 0, stopSec: 600, ...extra,
  })

  it('sums trips and groups them by the day they started', () => {
    const list = [trip(0), trip(2, 5, { maxSpeed: 90 }), trip(20)] // 08:00, 10:00, next day 04:00
    const s = sumTrips(list)
    expect(s).toMatchObject({ trips: 3, distanceKm: 25, maxSpeed: 90, driveSec: 4500, firstStart: T0, lastStop: T0 + 20 * 3600 + 1800 })
    expect(byDay(list).map(d => d.trips.length)).toEqual([2, 1])
  })

  it('hides 0 km trips when asked, and says how many', () => {
    const { trips, hidden } = visibleTrips([trip(0), trip(1, 0), trip(2, 0.01)], true)
    expect(trips).toHaveLength(1)
    expect(hidden).toBe(2)
    expect(visibleTrips([trip(0), trip(1, 0)], false).hidden).toBe(0)
  })

  it('splits Business and Private by the working-hours rule', () => {
    const rule = { days: [1, 2, 3, 4, 5], from: '08:00', to: '18:00' } // 2026-11-06 is a Friday
    expect(tripUsage(trip(0), rule)).toBe('Business')      // Fri 08:00
    expect(tripUsage(trip(11), rule)).toBe('Private')      // Fri 19:00
    expect(tripUsage(trip(24 + 2), rule)).toBe('Private')  // Sat 10:00
  })

  it('scores GYR per 100 km and bands it', () => {
    expect(gyrScore({ distanceKm: 200, overSpeedCount: 0, hbCount: 0, haCount: 0, xiCount: 0 })).toMatchObject({ score: 100, rating: 'Green' })
    // 4 over speeds per 100 km × 5 = 20 points off → 80 → Green
    expect(gyrScore({ distanceKm: 100, overSpeedCount: 4, hbCount: 0, haCount: 0, xiCount: 0 }).score).toBe(80)
    expect(gyrScore({ distanceKm: 100, overSpeedCount: 5, hbCount: 2, haCount: 0, xiCount: 0 })).toMatchObject({ score: 67, rating: 'Yellow' })
    expect(gyrScore({ distanceKm: 100, overSpeedCount: 10, hbCount: 0, haCount: 0, xiCount: 0 }).rating).toBe('Red')
    // A short day is scored as if 50 km, not stretched to 100.
    expect(gyrScore({ distanceKm: 10, overSpeedCount: 1, hbCount: 0, haCount: 0, xiCount: 0 }).score).toBe(90)
    expect(gyrScore({ distanceKm: 0.2, overSpeedCount: 0, hbCount: 0, haCount: 0, xiCount: 0 }).rating).toBe('No driving')
  })

  it('formats durations', () => {
    expect(hms(3725)).toBe('01:02:05')
    expect(hms(null)).toBe('—')
  })
})
