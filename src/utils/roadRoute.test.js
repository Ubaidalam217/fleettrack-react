import { describe, expect, it } from 'vitest'
import { applyRoadLegs, clearRoadLegs, estimateBanner, routeKey, routePoints } from './roadRoute'

const stop = (lat, lng, over = {}) => ({ name: 's', lat, lng, legDriveMin: null, legSource: 'SPEED', ...over })
const road = { estimated: false, legs: [{ distanceKm: 52, durationMin: 45 }, { distanceKm: 51, durationMin: 40 }] }

describe('routePoints / routeKey', () => {
  it('needs two or more placed stops', () => {
    expect(routePoints([stop(24, 54)])).toBeNull()
    expect(routePoints([stop(24, 54), stop(null, null)])).toBeNull()
    expect(routePoints([stop(24, 54), stop(25, 55)])).toEqual([{ lat: 24, lng: 54 }, { lat: 25, lng: 55 }])
  })
  it('the key moves with a stop, not with a name or a stay', () => {
    const a = [stop(24, 54), stop(25, 55)]
    expect(routeKey(a)).toBe(routeKey([{ ...a[0], name: 'Yard', stayMin: 20 }, a[1]]))
    expect(routeKey(a)).not.toBe(routeKey([a[0], stop(25.001, 55)]))
    expect(routeKey([stop(24, 54), stop(null, null)])).toBe('')
  })
})

describe('applyRoadLegs', () => {
  const stops = [stop(24, 54), stop(24, 55), stop(24, 56)]
  it('fills each leg from the route as ROUTING', () => {
    const out = applyRoadLegs(stops, road)
    expect(out.map(s => [s.legDriveMin, s.legSource])).toEqual([[null, 'SPEED'], [45, 'ROUTING'], [40, 'ROUTING']])
  })
  it('keeps a leg the user typed', () => {
    const out = applyRoadLegs([stops[0], { ...stops[1], legDriveMin: 99, legSource: 'MANUAL' }, stops[2]], road)
    expect(out[1]).toMatchObject({ legDriveMin: 99, legSource: 'MANUAL' })
    expect(out[2]).toMatchObject({ legDriveMin: 40, legSource: 'ROUTING' })
  })
  it('returns the same array when nothing changes', () => {
    const once = applyRoadLegs(stops, road)
    expect(applyRoadLegs(once, road)).toBe(once)
  })
  it('an estimated route (or none) sets nothing and undoes earlier road legs', () => {
    const once = applyRoadLegs(stops, road)
    const back = applyRoadLegs(once, { estimated: true, legs: [] })
    expect(back.map(s => s.legSource)).toEqual(['SPEED', 'SPEED', 'SPEED'])
    expect(back[1].legDriveMin).toBeNull()
    expect(applyRoadLegs(stops, { estimated: true })).toBe(stops)
    expect(clearRoadLegs(stops)).toBe(stops)
  })
  it('does not touch trip legs when an estimate comes back', () => {
    const t = [stops[0], { ...stops[1], legDriveMin: 30, legSource: 'TRIP' }, stops[2]]
    expect(applyRoadLegs(t, null)).toBe(t)
  })
})

describe('estimateBanner', () => {
  it('says the road routing is not set up', () => {
    expect(estimateBanner('Road routing is not set up')).toBe('Estimated route - road routing is not set up')
    expect(estimateBanner('GOOGLE is not set up on the server')).toBe('Estimated route - road routing is not set up')
    expect(estimateBanner(null)).toBe('Estimated route - road routing is not set up')
  })
  it('says when the service did not answer', () => {
    expect(estimateBanner('ORS did not answer (answered 503), so the route is estimated')).toBe('Estimated route - the road service did not answer')
  })
})
