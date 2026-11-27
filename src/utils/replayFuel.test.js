import { describe, expect, it } from 'vitest'
import { fuelFromServer, fuelFromPoints, fuelAt, fuelGeometry } from './replayFuel'

describe('replay fuel', () => {
  it('takes the server series as litres (or raw without a calibration)', () => {
    const cal = fuelFromServer({ calibrated: true, series: [{ ts: 1000, v: 50 }, { ts: 2000, v: 20 }], events: [{ kind: 'drain', startTs: 1500, litres: 30, before: 50, after: 20 }] })
    expect(cal).toMatchObject({ unit: 'L', note: null, events: [{ kind: 'drain' }] })
    const raw = fuelFromServer({ calibrated: false, series: [{ ts: 1000, v: 84 }], events: [{ kind: 'fill' }] })
    expect(raw).toMatchObject({ unit: 'raw', note: 'not calibrated', events: [] })
    expect(fuelFromServer({ series: [] })).toBeNull()
    expect(fuelFromServer(null)).toBeNull()
  })

  it('builds the CAN fallback from points, with a drain found by the report rules', () => {
    const base = 1_800_000_000
    const levels = [60, 60, 60, 60, 30, 30, 30, 30]
    const points = levels.map((l, i) => ({ ts: base + i * 120, fuelL: l, ignition: false, speed: 0, lat: 25, lng: 55 }))
    const f = fuelFromPoints(points)
    expect(f).toMatchObject({ source: 'can', unit: 'L' })
    expect(f.events.map(e => [e.kind, e.litres])).toEqual([['drain', 30]])
    expect(fuelFromPoints([{ ts: base, fuelL: 22 }])).toBeNull() // one reading is no line
    expect(fuelFromPoints(points.map(p => ({ ...p, fuelL: 0 })))).toBeNull() // 0 = not provided
    expect(fuelFromPoints([{ ts: base }, { ts: base + 60 }])).toBeNull()
  })

  it('reads the level at the playhead', () => {
    const s = [{ ts: 1000, v: 10 }, { ts: 3000, v: 30 }, { ts: 5000, v: 50 }]
    expect(fuelAt(s, 500).v).toBe(10)
    expect(fuelAt(s, 3000).v).toBe(30)
    expect(fuelAt(s, 4999).v).toBe(30)
    expect(fuelAt(s, 99999).v).toBe(50)
    expect(fuelAt([], 1)).toBeNull()
  })

  it('lays the line and its markers out over the replay span', () => {
    const fuel = { series: [{ ts: 0, v: 60 }, { ts: 50_000, v: 60 }, { ts: 100_000, v: 30 }], events: [{ kind: 'drain', startTs: 50_000, litres: 30, before: 60, after: 30 }, { kind: 'fill', startTs: 999_000_000, litres: 9, before: 1, after: 10 }] }
    const g = fuelGeometry(fuel, 0, 100, { w: 1000, h: 34, pad: 4 })
    expect(g.path.startsWith('M0,')).toBe(true)
    expect(g.marks).toHaveLength(1) // the fill is outside the span
    expect(g.marks[0].x).toBe(500)
    expect(g.x(50_000)).toBe(500)
    expect(fuelGeometry(null, 0, 100)).toBeNull()
  })
})
