import { describe, expect, it } from 'vitest'
import { violationSpan, limitIn } from './violationSpan'

const m = (t, speed, o = {}) => ({ timestamp: t, 'position.speed': speed, 'engine.ignition.status': true, ...o })

describe('violationSpan', () => {
  it('runs an over-speed event from the first to the last reading over the limit', () => {
    const msgs = [m(0, 100), m(30, 125), m(60, 140), m(90, 130), m(120, 110), m(150, 128)]
    const e = { type: 'overspeed', ts: 60, value: 140, message: 'PLATE-1: Over speed: 140 km/h (limit 120 km/h)' }
    expect(limitIn(e.message)).toBe(120)
    expect(violationSpan(e, msgs)).toEqual({ startTs: 30, endTs: 90 })
  })

  it('reads an idle event back to when the vehicle stopped', () => {
    const msgs = [m(0, 40), m(60, 0), m(600, 0), m(1200, 1), m(1260, 30)]
    expect(violationSpan({ type: 'idle', ts: 1200 }, msgs)).toEqual({ startTs: 60, endTs: 1200 })
  })

  it('finds the hard stop itself, and keeps a plain event to its moment', () => {
    const msgs = [m(0, 60), m(1, 45), m(2, 30), m(40, 30)]
    expect(violationSpan({ type: 'harsh_braking', ts: 0 }, msgs)).toEqual({ startTs: 0, endTs: 2 })
    expect(violationSpan({ type: 'geofence', ts: 40 }, msgs)).toEqual({ startTs: 40, endTs: 40 })
    expect(violationSpan({ type: 'overspeed', ts: 40, message: '(limit 120 km/h)' }, msgs)).toEqual({ startTs: 40, endTs: 40 })
  })
})
