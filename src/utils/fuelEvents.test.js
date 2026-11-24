import { describe, expect, it } from 'vitest'
import { cleanSeries, detectFuelEvents, fuelSummary, downsample, medianOf3, isStanding, rawSummary } from './fuelEvents'

const T0 = Date.UTC(2026, 10, 20, 4, 0, 0)
const MIN = 60_000
/** Readings every 2 min from `levels`; `state(i)` gives ign/speed. */
const series = (levels, state = () => ({ ign: true, speed: 50 })) =>
  levels.map((litres, i) => ({ ts: T0 + i * 2 * MIN, litres, lat: 24 + i / 1000, lng: 54, ...state(i) }))
const parked = () => ({ ign: false, speed: 0 })

describe('cleanSeries', () => {
  it('drops readings without litres and smooths single spikes', () => {
    const s = cleanSeries([
      { ts: 3, litres: 100 }, { ts: 1, litres: 100 }, { ts: 2, litres: null }, { ts: 4, litres: 160 }, { ts: 5, litres: 100 }, { ts: 6, litres: 99 },
    ])
    expect(s.map(r => r.ts)).toEqual([1, 3, 4, 5, 6])
    expect(s.map(r => r.litres)).toEqual([100, 100, 100, 100, 99])
  })
  it('median of 3 keeps the ends', () => {
    expect(medianOf3([{ litres: 5 }, { litres: 1 }, { litres: 9 }, { litres: 2 }]).map(r => r.litres)).toEqual([5, 5, 2, 2])
  })
})

describe('detectFuelEvents', () => {
  it('finds a refill, from the low before it to the high after it', () => {
    const levels = [80, 79.6, 79.2, 79, 95, 130, 160, 180, 180, 179.7]
    const ev = detectFuelEvents(cleanSeries(series(levels, parked)))
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ kind: 'fill', before: 79.2, after: 180, litres: 100.8 })
    expect(ev[0].startTs).toBe(T0 + 3 * 2 * MIN)
  })

  it('finds a drain while parked', () => {
    const levels = [150, 150, 149.8, 140, 125, 110, 100, 100, 99.9]
    const ev = detectFuelEvents(cleanSeries(series(levels, parked)))
    expect(ev).toEqual([expect.objectContaining({ kind: 'drain', before: 150, after: 99.9, litres: 50.1 })])
  })

  it('a drain with the engine running but standing still counts too', () => {
    const levels = [150, 150, 130, 110, 100, 100]
    const ev = detectFuelEvents(cleanSeries(series(levels, () => ({ ign: true, speed: 0 }))))
    expect(ev.map(e => e.kind)).toEqual(['drain'])
  })

  it('consumption while driving is not a drain', () => {
    const levels = Array.from({ length: 120 }, (_, i) => 200 - i * 0.5) // 60 L over 4 h of driving
    expect(detectFuelEvents(cleanSeries(series(levels)))).toEqual([])
  })

  it('a fall that starts while driving counts only from where it stood', () => {
    const levels = [150, 145, 140, 135, 130, 129, 129, 129]
    const ev = detectFuelEvents(cleanSeries(series(levels, i => (i < 5 ? { ign: true, speed: 60 } : parked()))))
    expect(ev).toEqual([])
  })

  it('ignores sensor dropouts to 0 and noise', () => {
    const raw = [120, 121, 119.5, null, 120.5, 0, 120, 118.9, 121.2, 120, null, 119.8]
    // 0 here is a reading outside the calibration that still converted: a lone dip the median removes.
    const s = cleanSeries(series(raw.map(v => v), parked))
    expect(detectFuelEvents(s)).toEqual([])
  })

  it('a refill and a later drain on one day, with the threshold respected', () => {
    const levels = [60, 60, 100, 140, 140, 139, 138, 120, 105, 104, 104]
    const ev = detectFuelEvents(cleanSeries(series(levels, parked)))
    expect(ev.map(e => [e.kind, e.litres])).toEqual([['fill', 80], ['drain', 36]])
    expect(detectFuelEvents(cleanSeries(series(levels, parked)), { threshold: 40 }).map(e => e.kind)).toEqual(['fill'])
    const sum = fuelSummary(cleanSeries(series(levels, parked)), ev)
    expect(sum).toMatchObject({ start: 60, end: 104, min: 60, max: 140, filled: 80, drained: 36, fills: 1, drains: 1, used: 0 })
  })

  it('unknown ignition and speed is not standing', () => {
    expect(isStanding({ ign: null, speed: null })).toBe(false)
    expect(isStanding({ ign: false })).toBe(true)
    expect(isStanding({ ign: true, speed: 0 })).toBe(true)
  })
})

describe('summaries and the graph', () => {
  it('empty series', () => {
    expect(fuelSummary([], [])).toMatchObject({ readings: 0, start: null, used: null })
    expect(rawSummary([{ ts: 2, raw: 3000 }, { ts: 1, raw: 3100 }])).toEqual({ readings: 2, start: 3100, end: 3000, min: 3000, max: 3100 })
  })

  it('downsample keeps the highs and lows of each bucket', () => {
    const pts = Array.from({ length: 10_000 }, (_, i) => ({ ts: i, v: i === 5000 ? 500 : 100 }))
    const d = downsample(pts, 200)
    expect(d.length).toBeLessThanOrEqual(200)
    expect(d.some(p => p.v === 500)).toBe(true)
    expect(d.every((p, i) => i === 0 || p.ts >= d[i - 1].ts)).toBe(true)
  })
})
