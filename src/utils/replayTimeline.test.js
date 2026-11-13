import { describe, expect, it } from 'vitest'
import {
  GAP_SEC, pointState, timelineSegments, timeFraction, indexAtTime, indexAtFraction,
  speedSeries, overLimitRuns,
} from './replayTimeline'

const T0 = Math.floor(new Date(2026, 10, 13, 7, 0, 0).getTime() / 1000)

const pt = (dt, status, speed = 0) => ({ ts: T0 + dt, lat: 24.4, lng: 54.5, speed, status })

describe('pointState', () => {
  it('maps the Live Map statuses onto timeline states', () => {
    expect(pointState({ status: 'Running', speed: 40 })).toBe('driving')
    expect(pointState({ status: 'Idle', speed: 0 })).toBe('idle')
    expect(pointState({ status: 'Stopped', speed: 0 })).toBe('stopped')
  })

  it('falls back to movement when the tracker reports no ignition', () => {
    expect(pointState({ status: 'NoData', speed: 12 })).toBe('driving')
    expect(pointState({ status: 'NoData', speed: 0 })).toBe('stopped')
    expect(pointState(null)).toBe('stopped')
  })
})

describe('timelineSegments', () => {
  it('is empty with no points, and one full-width run for a single point', () => {
    expect(timelineSegments([])).toEqual([])
    expect(timelineSegments([pt(0, 'Idle')])).toEqual([
      { state: 'idle', fromTs: T0, toTs: T0, fromIdx: 0, toIdx: 0, start: 0, end: 1 },
    ])
  })

  it('merges consecutive points of one state and lays the runs out by time', () => {
    const pts = [
      pt(0, 'Idle'), pt(60, 'Running', 30), pt(120, 'Running', 50), pt(300, 'Idle'),
      pt(360, 'Stopped'), pt(600, 'Stopped'),
    ]
    const segs = timelineSegments(pts)
    expect(segs.map(s => s.state)).toEqual(['idle', 'driving', 'idle', 'stopped'])
    // Each stretch takes the state of the point that starts it.
    expect(segs[1]).toMatchObject({ fromTs: T0 + 60, toTs: T0 + 300, fromIdx: 1, toIdx: 3 })
    expect(segs[0].start).toBe(0)
    expect(segs[1].start).toBeCloseTo(0.1)
    expect(segs[1].end).toBeCloseTo(0.5)
    expect(segs[segs.length - 1].end).toBe(1)
    // Runs meet end to end: no hole, no overlap.
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end)
  })

  it('marks a stretch with no data longer than GAP_SEC as a gap', () => {
    const pts = [pt(0, 'Running', 40), pt(60, 'Running', 40), pt(60 + GAP_SEC + 1, 'Running', 40), pt(60 + GAP_SEC + 61, 'Idle')]
    expect(timelineSegments(pts).map(s => s.state)).toEqual(['driving', 'gap', 'driving'])
    // Exactly GAP_SEC apart is still data.
    const ok = [pt(0, 'Idle'), pt(GAP_SEC, 'Idle')]
    expect(timelineSegments(ok).map(s => s.state)).toEqual(['idle'])
  })

  it("keeps a parked vehicle's rare readings as stopped, not a gap", () => {
    const pts = [pt(0, 'Stopped'), pt(3600, 'Stopped'), pt(7200, 'Running', 30), pt(7260, 'Stopped'), pt(7260 + GAP_SEC * 3, 'Running', 20)]
    expect(timelineSegments(pts).map(s => s.state)).toEqual(['stopped', 'gap', 'driving', 'gap'])
  })
})

describe('time ↔ index', () => {
  const pts = [pt(0, 'Idle'), pt(100, 'Running', 20), pt(400, 'Running', 30), pt(1000, 'Stopped')]

  it('timeFraction is the moment\'s place on the axis, clamped', () => {
    expect(timeFraction(pts, T0)).toBe(0)
    expect(timeFraction(pts, T0 + 400)).toBeCloseTo(0.4)
    expect(timeFraction(pts, T0 + 5000)).toBe(1)
    expect(timeFraction(pts, T0 - 50)).toBe(0)
  })

  it('indexAtTime picks the nearest point', () => {
    expect(indexAtTime(pts, T0 + 40)).toBe(0)
    expect(indexAtTime(pts, T0 + 60)).toBe(1)
    expect(indexAtTime(pts, T0 + 700)).toBe(2)
    expect(indexAtTime(pts, T0 + 701)).toBe(3)
    expect(indexAtTime(pts, T0 + 99999)).toBe(3)
  })

  it('indexAtFraction maps a timeline position back to a point', () => {
    expect(indexAtFraction(pts, 0)).toBe(0)
    expect(indexAtFraction(pts, 0.38)).toBe(2)
    expect(indexAtFraction(pts, 1)).toBe(3)
    expect(indexAtFraction(pts, 2)).toBe(3)
  })
})

describe('speedSeries', () => {
  it('keeps the top speed of each slice, so a burst is not averaged away', () => {
    const pts = [pt(0, 'Running', 10), pt(10, 'Running', 95), pt(20, 'Running', 12), pt(100, 'Running', 30)]
    const s = speedSeries(pts, 2)
    expect(s).toHaveLength(2)
    expect(s[0].v).toBe(95)
    expect(s[1].v).toBe(30)
  })

  it('runs straight across slices without a reading, and breaks only at a real gap', () => {
    const pts = [pt(0, 'Running', 10), pt(1, 'Running', 10), pt(2, 'Running', 10), pt(100, 'Running', 30)]
    expect(speedSeries(pts, 4).map(x => x.v)).toEqual([10, 30])
    const gap = [pt(0, 'Running', 10), pt(GAP_SEC + 1, 'Running', 30), pt(GAP_SEC + 20, 'Running', 40)]
    expect(speedSeries(gap, 4).map(x => x.v)).toEqual([10, null, 40])
    const parked = [pt(0, 'Stopped'), pt(GAP_SEC * 4, 'Stopped'), pt(GAP_SEC * 4 + 30, 'Running', 50)]
    expect(speedSeries(parked, 4).map(x => x.v)).toEqual([0, 50])
  })
})

describe('overLimitRuns', () => {
  it('returns the stretches driven above the limit, merged', () => {
    const pts = [
      pt(0, 'Running', 60), pt(10, 'Running', 85), pt(20, 'Running', 90), pt(30, 'Running', 70),
      pt(40, 'Running', 81), pt(50, 'Running', 60),
    ]
    expect(overLimitRuns(pts, 80)).toEqual([{ fromIdx: 0, toIdx: 2 }, { fromIdx: 3, toIdx: 4 }])
  })

  it('never draws across a gap, and does nothing without a limit', () => {
    const pts = [pt(0, 'Running', 90), pt(GAP_SEC + 10, 'Running', 90)]
    expect(overLimitRuns(pts, 80)).toEqual([])
    expect(overLimitRuns([pt(0, 'Running', 90), pt(10, 'Running', 95)], 0)).toEqual([])
    expect(overLimitRuns([pt(0, 'Running', 90), pt(10, 'Running', 95)], null)).toEqual([])
  })
})
