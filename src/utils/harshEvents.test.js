import { describe, expect, it } from 'vitest'
import { harshEpisodes, describeHarsh } from './harshEvents'

const m = (t, speed, o = {}) => ({ timestamp: 1000 + t, 'position.speed': speed, 'position.latitude': 24.4, 'position.longitude': 54.4 + t / 1e4, ...o })

describe('harshEpisodes', () => {
  it('joins back-to-back hard readings into one stop, with its start, end and peak', () => {
    // 60 → 45 → 30 km/h a second apart (4.2 m/s² each), then a gentle stretch.
    const msgs = [m(0, 60), m(1, 45), m(2, 30), m(4, 28), m(6, 26)]
    const [e, ...rest] = harshEpisodes(msgs)
    expect(rest).toHaveLength(0)
    expect(e).toMatchObject({ startTs: 1000, endTs: 1002, fromKmh: 60, toKmh: 30, lat: 24.4 })
    expect(e.peakMs2).toBeCloseTo(15 / 3.6, 5)
    expect(describeHarsh('braking', e)).toBe('Harsh braking: 60 → 30 km/h in 2 s (4.2 m/s²)')
  })

  it('reads acceleration the other way, and ignores gaps and impossible jumps', () => {
    const msgs = [m(0, 0), m(2, 30), m(30, 100), m(31, 140), m(32, 10)]
    // 0 → 30 in 2 s is 4.2 m/s²; 30 → 100 is 28 s apart; 100 → 140 in 1 s is 11 m/s² (noise).
    expect(harshEpisodes(msgs, { kind: 'acceleration' }).map(e => [e.fromKmh, e.toKmh])).toEqual([[0, 30]])
    // 140 → 10 in 1 s is 36 m/s²: noise, not a stop.
    expect(harshEpisodes(msgs, { kind: 'braking' })).toHaveLength(0)
  })

  it('follows the rule’s threshold', () => {
    const msgs = [m(0, 50), m(2, 30)] // 2.8 m/s²
    expect(harshEpisodes(msgs)).toHaveLength(0)
    expect(harshEpisodes(msgs, { thresholdMs2: 2.5 })).toHaveLength(1)
  })
})
