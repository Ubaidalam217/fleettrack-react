import { describe, it, expect } from 'vitest'
import { normalizeLiveRefresh, liveRefreshTag, vehiclesGained, LIVE_REFRESH_OPTIONS } from './liveRefresh'

describe('Live refresh setting', () => {
  it('offers Live, 10 s, 30 s and 60 s', () => {
    expect(LIVE_REFRESH_OPTIONS.map(o => o.sec)).toEqual([0, 10, 30, 60])
  })

  it('reads anything unknown or missing as Live', () => {
    expect(normalizeLiveRefresh(undefined)).toBe(0)
    expect(normalizeLiveRefresh(null)).toBe(0)
    expect(normalizeLiveRefresh('15')).toBe(0)
    expect(normalizeLiveRefresh('30')).toBe(30)
    expect(normalizeLiveRefresh(60)).toBe(60)
  })

  it('shows a new vehicle or a first report at once, but holds plain updates for the tick', () => {
    const a = { id: 1, lastTs: null }
    const b = { id: 2, lastTs: 100 }
    expect(vehiclesGained([a, b], [{ ...a, lastTs: 200 }, b])).toBe(true)   // first report
    expect(vehiclesGained([b], [a, b])).toBe(true)                           // joined the list
    expect(vehiclesGained([a, b], [a, { ...b, lastTs: 300 }])).toBe(false)   // just newer data
  })

  it('tags the LIVE badge only when the map is not live', () => {
    expect(liveRefreshTag(0)).toBeNull()
    expect(liveRefreshTag(10)).toBe('10s')
  })
})
