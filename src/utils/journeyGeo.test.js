import { describe, expect, it } from 'vitest'
import { cumulativeKm, project, passBy, passThrough, inStop, simplifyPath, stopsAlong, splitPath, pathKm } from './journeyGeo.js'

// A straight east-west road along 24.35°N, ~10 km a step (0.1° ≈ 10.1 km here).
const path = [[24.35, 54.5], [24.35, 54.6], [24.35, 54.7], [24.35, 54.8]]
const cum = cumulativeKm(path)

describe('project', () => {
  it('measures along and across the line', () => {
    const p = project(path, cum, [24.36, 54.65])
    expect(p.alongKm).toBeGreaterThan(15)
    expect(p.alongKm).toBeLessThan(15.4)
    expect(p.crossM).toBeGreaterThan(1000)
    expect(p.crossM).toBeLessThan(1200)
    expect(p.segIdx).toBe(1)
  })

  it('never snaps back before the segment it already reached (round trips)', () => {
    // Out and back on the same road: the return leg must be matched, not the outbound one.
    const loop = [[24.35, 54.5], [24.35, 54.7], [24.35, 54.5]]
    const c = cumulativeKm(loop)
    const out = project(loop, c, [24.35, 54.6], 0)
    expect(out.segIdx).toBe(0)
    const back = project(loop, c, [24.35, 54.6], 2)
    expect(back.segIdx).toBe(1)
    expect(back.alongKm).toBeGreaterThan(c[1])
  })
})

describe('arrival areas', () => {
  const stop = { arrivalType: 'RADIUS', lat: 24.35, lng: 54.65, radiusM: 300 }

  it('catches a drive-through between two fixes 1.6 km apart', () => {
    const a = { lat: 24.3505, lng: 54.642, ts: 1000 }
    const b = { lat: 24.3505, lng: 54.658, ts: 1060 }
    expect(inStop(a.lat, a.lng, stop)).toBe(false)
    expect(inStop(b.lat, b.lng, stop)).toBe(false)
    const hit = passThrough(a, b, stop)
    expect(hit).toBeGreaterThan(1025)
    expect(hit).toBeLessThan(1035)
    expect(passBy(a, b, [stop.lat, stop.lng]).m).toBeLessThan(100)
  })

  it('uses the geofence polygon when the stop has one', () => {
    const poly = { arrivalType: 'GEOFENCE', polygon: [{ lat: 24.34, lng: 54.64 }, { lat: 24.34, lng: 54.66 }, { lat: 24.36, lng: 54.66 }, { lat: 24.36, lng: 54.64 }], lat: 24.35, lng: 54.65, radiusM: 1 }
    expect(inStop(24.355, 54.645, poly)).toBe(true)
    expect(inStop(24.37, 54.645, poly)).toBe(false)
    expect(passThrough({ lat: 24.35, lng: 54.63, ts: 0 }, { lat: 24.35, lng: 54.67, ts: 100 }, poly)).not.toBeNull()
  })
})

describe('paths', () => {
  it('simplifies a dense straight line to its ends', () => {
    const dense = Array.from({ length: 50 }, (_, i) => [24.35, 54.5 + i * 0.002, i])
    const s = simplifyPath(dense, 30)
    expect(s).toHaveLength(2)
    expect(s[1][2]).toBe(49)
  })

  it('places stops along the line in order, and straight legs × road factor without a line', () => {
    const stops = [{ lat: 24.35, lng: 54.5 }, { lat: 24.351, lng: 54.65 }, { lat: 24.35, lng: 54.8 }]
    const along = stopsAlong(path, stops)
    expect(along[0]).toBe(0)
    expect(along[1]).toBeCloseTo(cum[3] / 2, 0)
    expect(along[2]).toBeCloseTo(pathKm(path), 3)
    const straight = stopsAlong(null, stops)
    expect(straight[2]).toBeGreaterThan(pathKm(path) * 1.2)
  })

  it('splits driven and still to go', () => {
    const { done, todo } = splitPath(path, 15)
    expect(done[done.length - 1]).toEqual(todo[0])
    expect(pathKm(done)).toBeCloseTo(15, 3)
  })
})
