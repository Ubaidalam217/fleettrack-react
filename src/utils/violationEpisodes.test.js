import { describe, expect, it } from 'vitest'
import { violationEpisode, eventSpan, messageAt, maxSpeedBetween } from './violationEpisodes'

const T0 = Math.floor(Date.parse('2026-11-13T04:00:00Z') / 1000)
const iso = s => new Date((T0 + s) * 1000).toISOString()
const m = (s, speed, o = {}) => ({ timestamp: T0 + s, 'position.speed': speed, 'engine.ignition.status': true, 'position.latitude': 24.4, 'position.longitude': 54.5, ...o })

describe('violationEpisode', () => {
  it('takes the end, duration and peak the engine stored', () => {
    const e = { type: 'overspeed', occurredAt: iso(10), endedAt: iso(40), durationSec: 30, peakValue: 131.4, value: 125, lat: 24.1, lng: 54.1 }
    expect(violationEpisode(e, [])).toEqual({ fromTs: T0 + 10, toTs: T0 + 40, durationSec: 30, speed: 131.4, lat: 24.1, lng: 54.1, source: 'stored' })
  })

  it('reads an older over speed back from the messages, with the 5 km/h hysteresis', () => {
    // over 120 from 30 s; 118 is inside the band, so the episode goes on; 110 ends it.
    const msgs = [m(0, 100), m(30, 125), m(60, 140), m(90, 118), m(120, 122), m(150, 110), m(180, 130)]
    const e = { type: 'overspeed', occurredAt: iso(62), value: 140, message: 'Over speed: 140 km/h (limit 120 km/h)' }
    const ep = violationEpisode(e, msgs)
    expect(ep).toMatchObject({ fromTs: T0 + 30, toTs: T0 + 150, durationSec: 120, speed: 140, source: 'track' })
    // The rule's own limit wins over the message.
    expect(violationEpisode(e, msgs, { limitKmh: 135 })).toMatchObject({ fromTs: T0 + 60, toTs: T0 + 90, speed: 140 })
  })

  it('keeps a zone speed inside its zone', () => {
    const msgs = [m(0, 70), m(30, 70, { inside: false }), m(60, 75)]
    const e = { type: 'geofence_speed', occurredAt: iso(0), value: 70, message: 'in Yard: 70 km/h (limit 60 km/h)' }
    expect(violationEpisode(e, msgs, { inZone: x => x.inside !== false })).toMatchObject({ fromTs: T0, toTs: T0 + 30, durationSec: 30 })
  })

  it('reads an idle back to when the vehicle stopped and on until it moved', () => {
    const msgs = [m(0, 40), m(60, 0), m(600, 1), m(1200, 0), m(1260, 30)]
    const ep = violationEpisode({ type: 'idle', occurredAt: iso(1200), value: 19 }, msgs)
    expect(ep).toMatchObject({ fromTs: T0 + 60, toTs: T0 + 1260, durationSec: 1200, speed: 0 })
  })

  it('ends an idle when the engine is switched off', () => {
    const msgs = [m(0, 0), m(300, 0), m(600, 0, { 'engine.ignition.status': false })]
    expect(violationEpisode({ type: 'idle', occurredAt: iso(300) }, msgs)).toMatchObject({ fromTs: T0, toTs: T0 + 600 })
  })

  it('does not run across a gap in the data', () => {
    const msgs = [m(0, 130), m(3600, 130), m(3630, 100)]
    const e = { type: 'overspeed', occurredAt: iso(3600), message: '(limit 120 km/h)' }
    expect(violationEpisode(e, msgs)).toMatchObject({ fromTs: T0 + 3600, toTs: T0 + 3630 })
  })

  it('gives an instant event its moment and the speed then', () => {
    const msgs = [m(0, 50), m(100, 64)]
    const ep = violationEpisode({ type: 'custom', occurredAt: iso(110) }, msgs)
    expect(ep).toEqual({ fromTs: T0 + 110, toTs: T0 + 110, durationSec: 0, speed: 64, lat: 24.4, lng: 54.5, source: 'moment' })
    // No tracking at all: the moment, and no speed.
    expect(violationEpisode({ type: 'temperature', occurredAt: iso(5) }, [])).toMatchObject({ durationSec: 0, speed: null, source: 'moment' })
    // An over speed with no matching reading keeps its own value.
    expect(violationEpisode({ type: 'overspeed', occurredAt: iso(5), value: 133, message: '(limit 120 km/h)' }, msgs)).toMatchObject({ speed: 133, source: 'moment' })
  })

  it('finds the hard stop itself', () => {
    const msgs = [m(0, 60), m(1, 45), m(2, 30), m(40, 30)]
    expect(violationEpisode({ type: 'harsh_braking', occurredAt: iso(0) }, msgs)).toMatchObject({ fromTs: T0, toTs: T0 + 2, durationSec: 2, speed: 60 })
  })
})

describe('eventSpan (the map dialog)', () => {
  const ts = T0 + 62
  it('takes the span the report passes, as is', () => {
    expect(eventSpan({ type: 'overspeed', ts, span: { startTs: T0 + 30, endTs: T0 + 150, speed: 140 } }))
      .toEqual({ startTs: T0 + 30, endTs: T0 + 150, speed: 140, known: true })
  })

  it('else the end the engine stored, without the track', () => {
    const e = { type: 'overspeed', ts: T0 + 10, endedAt: iso(40), durationSec: 30, peakValue: 131.4 }
    expect(eventSpan(e)).toEqual({ startTs: T0 + 10, endTs: T0 + 40, speed: 131.4, known: true })
  })

  it('else reads it from the track by the same rule as the report, so the two agree', () => {
    const msgs = [m(0, 100), m(30, 125), m(60, 140), m(90, 118), m(120, 122), m(150, 110), m(180, 130)]
    const e = { type: 'overspeed', ts, value: 140, message: 'Over speed: 140 km/h (limit 120 km/h)' }
    const report = violationEpisode({ ...e, occurredAt: iso(62) }, msgs)
    expect(eventSpan(e, msgs)).toEqual({ startTs: report.fromTs, endTs: report.toTs, speed: report.speed, known: false })
    expect(eventSpan(e, msgs)).toMatchObject({ startTs: T0 + 30, endTs: T0 + 150 })
    // Not found yet (no track): the moment itself.
    expect(eventSpan(e)).toMatchObject({ startTs: ts, endTs: ts, known: false })
  })

  it('never ends before it starts, and needs a time', () => {
    expect(eventSpan({ type: 'tamper', ts: T0 + 100, endedAt: iso(50) })).toMatchObject({ startTs: T0 + 100, endTs: T0 + 100 })
    expect(eventSpan({ type: 'overspeed', span: { startTs: 5, endTs: 1 } })).toBe(null)
  })
})

describe('message helpers', () => {
  it('reads the message at a moment within 15 min, and the worst speed in a span', () => {
    const msgs = [m(0, 10), m(100, 20), m(5000, 30)]
    expect(messageAt(msgs, T0 + 150)['position.speed']).toBe(20)
    expect(messageAt(msgs, T0 + 4500)['position.speed']).toBe(30)
    expect(messageAt(msgs, T0 + 2500)).toBe(null)
    expect(maxSpeedBetween(msgs, T0, T0 + 100)).toBe(20)
    expect(maxSpeedBetween(msgs, T0 + 1, T0 + 99)).toBe(null)
  })
})
