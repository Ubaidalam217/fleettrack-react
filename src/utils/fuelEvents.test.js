import { describe, expect, it } from 'vitest'
import {
  cleanSeries, detectFuelEvents, fuelSummary, downsample, medianOf3, rawSummary, removeDropouts,
  readingState, contextText, isSettled, eventContext,
} from './fuelEvents'

// Invented series: a reading every 2 min unless a test says otherwise.
const T0 = Date.UTC(2026, 10, 20, 4, 0, 0)
const MIN = 60_000
const driving = () => ({ ign: true, speed: 55 })
const idling = () => ({ ign: true, speed: 0 })
const parked = () => ({ ign: false, speed: 0 })
/** Readings every 2 min from `levels`; `state(i)` gives ign/speed; `at(i)` may move the time. */
const series = (levels, state = driving, at = i => T0 + i * 2 * MIN) =>
  levels.map((litres, i) => ({ ts: at(i), litres, lat: 24 + i / 1000, lng: 54, ...state(i) }))
const run = (levels, state, opts) => detectFuelEvents(cleanSeries(series(levels, state)), opts)

describe('cleanSeries', () => {
  it('drops readings without litres and smooths single spikes', () => {
    const s = cleanSeries([
      { ts: 3, litres: 100 }, { ts: 1, litres: 100 }, { ts: 2, litres: null }, { ts: 4, litres: 160 }, { ts: 5, litres: 100 }, { ts: 6, litres: 99 },
    ])
    expect(s.map(r => r.ts)).toEqual([1, 3, 5, 6])
    expect(s.map(r => r.litres)).toEqual([100, 100, 100, 99])
  })
  it('median of 3 keeps the ends', () => {
    expect(medianOf3([{ litres: 5 }, { litres: 1 }, { litres: 9 }, { litres: 2 }]).map(r => r.litres)).toEqual([5, 5, 2, 2])
  })
  it('takes out a dropout of up to 3 readings that comes back, keeps a real change', () => {
    const lv = l => l.map((litres, ts) => ({ ts, litres }))
    expect(removeDropouts(lv([120, 0, 0, 119])).map(r => r.litres)).toEqual([120, 119])
    expect(removeDropouts(lv([120, 0, 0, 0, 121])).map(r => r.litres)).toEqual([120, 121])
    expect(removeDropouts(lv([120, 0, 0, 0, 0, 121])).map(r => r.litres)).toEqual([120, 0, 0, 0, 0, 121])
    expect(removeDropouts(lv([150, 100, 100, 100])).map(r => r.litres)).toEqual([150, 100, 100, 100])
    expect(removeDropouts(lv([120, 250, 121])).map(r => r.litres)).toEqual([120, 121])
    // Still out at the end: may be real, kept.
    expect(removeDropouts(lv([120, 120, 0, 0])).map(r => r.litres)).toEqual([120, 120, 0, 0])
  })
})

describe('detectFuelEvents — any fall or rise that reaches the threshold', () => {
  it('a drain while moving', () => {
    const levels = [200, 199.6, 199.2, 175, 150, 149.6, 149.2, 148.8]
    const [e, ...rest] = run(levels, driving)
    expect(rest).toEqual([])
    expect(e).toMatchObject({ kind: 'drain', before: 199.2, after: 150, litres: 49.2, context: 'moving', gapMin: null })
  })

  it('a drain at idle', () => {
    const ev = run([150, 150, 130, 110, 100, 100], idling)
    expect(ev).toEqual([expect.objectContaining({ kind: 'drain', before: 150, after: 100, litres: 50, context: 'idle' })])
  })

  it('a drain while parked, including a slow one (engine off uses no fuel)', () => {
    expect(run([150, 150, 149.8, 140, 125, 110, 100, 100, 99.9], parked)).toEqual([expect.objectContaining({ kind: 'drain', before: 149.8, after: 100, litres: 49.8, context: 'stopped' })])
    const slow = Array.from({ length: 20 }, (_, i) => 150 - i * 1.5) // 1.5 L per reading, 28.5 L
    expect(run(slow, parked)).toEqual([expect.objectContaining({ kind: 'drain', litres: 28.5, context: 'stopped' })])
  })

  it('a drain between trips, after a gap: the old trip’s last reading against the new trip’s first', () => {
    // Trip 1 until 08:00, nothing overnight, trip 2 from 06:00 next day with 40 L less.
    const at = i => (i < 4 ? T0 + i * 2 * MIN : T0 + 22 * 3600_000 + (i - 4) * 2 * MIN)
    const state = i => (i < 3 ? driving() : i === 3 ? parked() : driving())
    const pts = cleanSeries(series([180, 179.6, 179.2, 179.2, 139, 138.6, 138.2, 137.8], state, at))
    const ev = detectFuelEvents(pts)
    expect(ev).toEqual([expect.objectContaining({ kind: 'drain', before: 179.2, after: 139, litres: 40.2, context: 'between_trips' })])
    expect(ev[0].gapMin).toBe(22 * 60 - 6)
    expect(contextText(ev[0])).toBe('Between trips (no data for 21 h 54 min)')
  })

  it('a drop after the device was offline while driving reads as a gap', () => {
    const at = i => (i < 3 ? T0 + i * 2 * MIN : T0 + 90 * MIN + (i - 3) * 2 * MIN)
    const ev = detectFuelEvents(cleanSeries(series([180, 179.6, 179.2, 150, 149.6, 149.2], driving, at)))
    expect(ev).toEqual([expect.objectContaining({ kind: 'drain', litres: 29.2, context: 'gap', gapMin: 86 })])
    expect(contextText(ev[0])).toBe('After 1 h 26 min without data')
    // The optional allowance takes the litres the engine may have used meanwhile off: 20 L/h x 86 min.
    const allowed = detectFuelEvents(cleanSeries(series([180, 179.6, 179.2, 150, 149.6, 149.2], driving, at)), { allowanceLph: 20 })
    expect(allowed).toEqual([])
  })

  it('a fill, from the low before it to the high after it', () => {
    const levels = [80, 79.6, 79.2, 79, 95, 130, 160, 180, 180, 179.7]
    const ev = run(levels, parked)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ kind: 'fill', before: 79.2, after: 180, litres: 100.8, context: 'stopped' })
    expect(ev[0].startTs).toBe(T0 + 3 * 2 * MIN)
  })

  it('normal consumption while driving is never a drain', () => {
    const levels = Array.from({ length: 240 }, (_, i) => 200 - i * 0.5) // 120 L over 8 h of driving
    expect(run(levels, driving)).toEqual([])
    expect(fuelSummary(cleanSeries(series(levels)), [])).toMatchObject({ used: 119.5, drains: 0 })
  })

  it('a noise spike is no event', () => {
    expect(run([120, 121, 119.5, 145, 120.5, 120, 118.9, 121.2, 120, 119.8], parked)).toEqual([])
  })

  it('a dropout to 0 and back makes no drain + fill pair', () => {
    expect(run([120, 120, 0, 0, 0, 119.5, 119.4], parked)).toEqual([])
    expect(run([120, 120, 0, 0, 119.5, 119.4], driving)).toEqual([])
  })

  it('exactly at the threshold counts; just under does not', () => {
    expect(run([150, 150, 135, 135, 135], idling)).toEqual([expect.objectContaining({ kind: 'drain', litres: 15 })])
    expect(run([150, 150, 135.1, 135.1, 135.1], idling)).toEqual([])
    expect(run([100, 100, 120, 120, 120], parked, { fillThreshold: 20, drainThreshold: 50 })).toEqual([expect.objectContaining({ kind: 'fill', litres: 20 })])
    expect(run([100, 100, 119.9, 119.9, 119.9], parked, { fillThreshold: 20 })).toEqual([])
  })

  it('one episode across consecutive readings, a small step inside it does not split it', () => {
    const ev = run([150, 150, 140, 130, 129.5, 119, 109, 109, 109], idling)
    expect(ev).toEqual([expect.objectContaining({ kind: 'drain', before: 150, after: 109, litres: 41, readings: 6 })])
  })

  it('a fill and a later drain on one day, with separate thresholds', () => {
    const levels = [60, 60, 100, 140, 140, 139, 138, 120, 105, 104, 104]
    const ev = run(levels, parked)
    expect(ev.map(e => [e.kind, e.litres])).toEqual([['fill', 80], ['drain', 36]])
    expect(run(levels, parked, { drainThreshold: 40 }).map(e => e.kind)).toEqual(['fill'])
    const sum = fuelSummary(cleanSeries(series(levels, parked)), ev)
    expect(sum).toMatchObject({ start: 60, end: 104, min: 60, max: 140, filled: 80, drained: 36, fills: 1, drains: 1, used: 0 })
    expect(sum.drainsByContext).toMatchObject({ stopped: 1, moving: 0 })
  })
})

describe('context and settling', () => {
  it('reading states', () => {
    expect(readingState({ ign: false, speed: 30 })).toBe('stopped')
    expect(readingState({ ign: true, speed: 30 })).toBe('moving')
    expect(readingState({ ign: null, speed: 30 })).toBe('moving')
    expect(readingState({ ign: true, speed: 0 })).toBe('idle')
    expect(readingState({ ign: null, speed: null })).toBe('unknown')
  })
  it('engine off then on inside the event is between trips', () => {
    const pts = series([100, 80, 60], i => (i === 0 ? parked() : driving()))
    expect(eventContext(pts, 0, 2)).toEqual({ context: 'between_trips', gapMin: null })
  })
  it('an event is settled once 3 readings follow it', () => {
    const pts = cleanSeries(series([150, 150, 100, 100, 100], parked))
    const [e] = detectFuelEvents(pts)
    expect(isSettled(e, pts)).toBe(false)
    expect(isSettled(e, cleanSeries(series([150, 150, 100, 100, 100, 100], parked)))).toBe(true)
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
