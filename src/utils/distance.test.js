import { describe, it, expect } from 'vitest'
import { createDistanceStepper, gpsDistanceKm, haversineMeters } from './distance'

// ~1.11 km per 0.01 degree of latitude.
const msg = (timestamp, { lat = 24.4, lng = 54.4, speed = 0, mileage, valid, noPosition } = {}) => {
  const m = { timestamp, 'position.speed': speed }
  if (!noPosition) { m['position.latitude'] = lat; m['position.longitude'] = lng }
  if (mileage !== undefined) m['vehicle.mileage'] = mileage
  if (valid !== undefined) m['position.valid'] = valid
  return m
}

const run = messages => {
  const step = createDistanceStepper()
  const steps = messages.map(m => step(m))
  return { steps, total: steps.reduce((a, s) => a + s.km, 0) }
}

describe('createDistanceStepper', () => {
  it('returns 0 for the first message', () => {
    expect(run([msg(0, { mileage: 5 })]).steps[0]).toEqual({ km: 0, source: null })
  })

  it('uses the odometer when both messages carry it, even if GPS disagrees', () => {
    const { steps } = run([msg(0, { mileage: 100, speed: 50 }), msg(60, { lat: 24.41, mileage: 100.9, speed: 50 })])
    expect(steps[1].source).toBe('odometer')
    expect(steps[1].km).toBeCloseTo(0.9, 6)
  })

  it('keeps small odometer decreases signed (jitter), so the total equals last - first', () => {
    const { total } = run([msg(0, { mileage: 100 }), msg(60, { mileage: 99.998 }), msg(120, { mileage: 101 })])
    expect(total).toBeCloseTo(1, 6)
  })

  it('measures a device with no odometer from GPS', () => {
    const { steps, total } = run([msg(0, { speed: 60 }), msg(60, { lat: 24.41, speed: 60 })])
    expect(steps[1].source).toBe('gps')
    expect(total).toBeCloseTo(haversineMeters(24.4, 54.4, 24.41, 54.4) / 1000, 6)
  })

  it('bridges messages without an odometer, so the total still equals the odometer (VL149)', () => {
    // The middle message has neither odometer nor position, so GPS measures 0
    // for both intervals touching it — the odometer's advance must not be lost.
    const { steps, total } = run([
      msg(0, { mileage: 100, speed: 60 }),
      msg(60, { noPosition: true, speed: 60 }),
      msg(120, { lat: 24.42, mileage: 102.5, speed: 60 }),
    ])
    expect(total).toBeCloseTo(2.5, 6)
    expect(steps[2].source).toBe('odometer')
  })

  it('does not double count when GPS measured the gap the odometer later closes', () => {
    const { total } = run([
      msg(0, { mileage: 100, speed: 60 }),
      msg(60, { lat: 24.41, speed: 60 }),             // GPS credits ~1.11 km
      msg(120, { lat: 24.42, mileage: 102.3, speed: 60 }),
    ])
    expect(total).toBeCloseTo(2.3, 6)
  })

  it('ignores an odometer that flips between two values while parked (VL149)', () => {
    const { total } = run([
      msg(0, { mileage: 172.0 }),
      msg(60, { mileage: 291.6 }),   // +119.6 km in a minute, not moving
      msg(62, { mileage: 172.0 }),
      msg(120, { mileage: 291.6 }),
      msg(180, { mileage: 291.8, speed: 20 }), // real driving resumes from the new value
    ])
    expect(total).toBeCloseTo(0.2, 6)
  })

  it('still trusts an odometer rise across a silence when the fixes moved apart', () => {
    // Device silent for 20 min; both ends read speed 0 but the vehicle is ~5.6 km away.
    const { total } = run([
      msg(0, { mileage: 100 }),
      msg(1200, { lat: 24.45, mileage: 108 }),
    ])
    expect(total).toBeCloseTo(8, 6)
  })

  it('treats an odometer drop of a kilometre or more as a reset and uses GPS', () => {
    const { steps, total } = run([
      msg(0, { mileage: 10789, speed: 60 }),
      msg(60, { lat: 24.41, mileage: 0, speed: 60 }),
      msg(120, { lat: 24.41, mileage: 0.5, speed: 60 }),
    ])
    expect(steps[1].source).toBe('gps')
    expect(steps[2]).toEqual({ km: 0.5, source: 'odometer' }) // new baseline after the reset
    expect(total).toBeGreaterThan(1.1)
  })
})

describe('gpsDistanceKm', () => {
  it('ignores GPS drift while parked', () => {
    expect(gpsDistanceKm(msg(0), msg(3600, { lat: 24.4003 }))).toEqual({ km: 0, source: 'gps' })
  })

  it('ignores impossible jumps', () => {
    // 1.1 km in 10 s = ~400 km/h
    expect(gpsDistanceKm(msg(0, { speed: 40 }), msg(10, { lat: 24.41, speed: 40 })).km).toBe(0)
  })

  it('ignores invalid fixes and missing positions', () => {
    expect(gpsDistanceKm(msg(0, { speed: 40, valid: false }), msg(60, { lat: 24.41, speed: 40 })).km).toBe(0)
    expect(gpsDistanceKm({ timestamp: 0 }, { timestamp: 60 })).toEqual({ km: 0, source: null })
  })
})
