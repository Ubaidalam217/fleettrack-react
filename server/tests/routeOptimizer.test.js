/**
 * Route optimization (client 2026-11-21, after Uffizio): the solver
 * (lib/routeOptimizer.js) on estimated distances, the distance provider's
 * fallback, and the API (options, solve, saving a vehicle's capacity).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { optimizeRoutes, twoOpt, nearestNeighbour, tripKm } from '../src/lib/routeOptimizer.js'
import { estimateMatrix, distanceMatrix } from '../src/lib/distanceProvider.js'
import { readCapacity } from '../src/routes/routeOptimization.js'
import { __clearJourneySettingsCache } from '../src/lib/journeySettings.js'
import { auth, resetDb, seedFixture } from './factories.js'

const start = { name: 'Depot', lat: 24.35, lng: 54.5 }
/** Points on a ring round the depot (≈ r km), weights given. */
const ring = (n, r = 20, w = () => 100) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * 2 * Math.PI
  return { name: `P${i}`, lat: start.lat + (r / 111) * Math.cos(a), lng: start.lng + (r / 101) * Math.sin(a), weight: w(i), stayMin: 10 }
})
const solve = (points, vehicles, extra = {}) => {
  const { km, min } = estimateMatrix([start, ...points], { roadFactor: 1.3, speedKmh: 60 })
  return optimizeRoutes({ start, points, vehicles, km, min, startAt: Date.parse('2026-11-22T04:00:00Z'), ...extra })
}

describe('the solver', () => {
  it('2-opt never makes a trip longer, and untangles a crossed one', () => {
    const pts = [{ lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }, { lat: 0, lng: 0.5 }]
    const { km } = estimateMatrix([{ lat: 0, lng: 0 }, ...pts])
    const crossed = [1, 3, 2, 4]
    const fixed = twoOpt(crossed, km)
    expect(tripKm(fixed, km)).toBeLessThanOrEqual(tripKm(crossed, km))
    expect(tripKm(fixed, km)).toBeLessThan(tripKm(crossed, km) - 1)
    expect(new Set(fixed)).toEqual(new Set(crossed))
    expect(nearestNeighbour([1, 2, 3, 4], km)[0]).toBe(4)
  })

  it('DISTANCE: shares the points out evenly and visits each once', () => {
    const pts = ring(12)
    const r = solve(pts, [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }])
    expect(r.unassigned).toEqual([])
    expect(r.trips).toHaveLength(3)
    expect(r.trips.map(t => t.stops.length)).toEqual([4, 4, 4])
    const names = r.trips.flatMap(t => t.stops.map(s => s.name)).sort()
    expect(names).toEqual(pts.map(p => p.name).sort())
    // Neighbours stay together: each trip spans a quarter-ish of the ring, not the whole of it.
    for (const t of r.trips) expect(t.distanceKm).toBeLessThan(2 * 20 * 1.3 + 4 * 2 * Math.PI * 20 * 1.3 / 12 + 1)
    expect(r.totalKm).toBeCloseTo(r.trips.reduce((s, t) => s + t.distanceKm, 0), 0)
  })

  it('DISTANCE_WEIGHT: never above a vehicle\'s capacity; FULL fills, extra trips when needed', () => {
    const pts = ring(10, 15, () => 300) // 3000 in all
    const vehicles = [{ id: 'big', capacity: 1200 }, { id: 'small', capacity: 600 }]
    const r = solve(pts, vehicles, { mode: 'DISTANCE_WEIGHT', loadType: 'FULL' })
    expect(r.unassigned).toEqual([])
    for (const t of r.trips) expect(t.totalWeight).toBeLessThanOrEqual(t.capacity)
    expect(r.trips.reduce((s, t) => s + t.totalWeight, 0)).toBe(3000)
    // 3000 over 1200 + 600 needs more than one trip each.
    expect(Math.max(...r.trips.map(t => t.tripNo))).toBeGreaterThan(1)
    // A vehicle's second trip starts after its first ends.
    const big = r.trips.filter(t => t.vehicleId === 'big').sort((a, b) => a.tripNo - b.tripNo)
    expect(Date.parse(big[1].startAt)).toBeGreaterThan(Date.parse(big[0].endAt))
  })

  it('leaves out what is outside the radius or too heavy, and says why', () => {
    const pts = [...ring(4, 10), { name: 'Far', lat: 25.5, lng: 56.0, weight: 10 }, { name: 'Heavy', lat: 24.36, lng: 54.51, weight: 5000 }]
    const r = solve(pts, [{ id: 'a', capacity: 1000 }], { mode: 'DISTANCE_WEIGHT', radiusKm: 50 })
    expect(r.unassigned.map(u => u.name).sort()).toEqual(['Far', 'Heavy'])
    expect(r.unassigned.find(u => u.name === 'Far').reason).toMatch(/radius/)
    expect(r.unassigned.find(u => u.name === 'Heavy').reason).toMatch(/Heavier/)
  })

  it('works out the stop times with the stays, waits for a window and flags a missed one', () => {
    const pts = [
      { name: 'Early', lat: 24.36, lng: 54.52, stayMin: 15, windowFrom: '09:00' },
      { name: 'Missed', lat: 24.37, lng: 54.53, stayMin: 0, windowTo: '08:00' },
    ]
    const r = solve(pts, [{ id: 'a' }]) // leaves 08:00 UAE
    const [t] = r.trips
    const early = t.stops.find(s => s.name === 'Early')
    expect(early.arriveAt).toBe('2026-11-22T05:00:00.000Z') // waited for 09:00 UAE
    expect(t.lateStops).toBe(1)
    expect(t.stops.find(s => s.name === 'Missed').windowLate).toBeGreaterThan(0)
    expect(t.stayMin).toBe(15)
  })

  it('no vehicle with a capacity: nothing is planned by weight', () => {
    const r = solve(ring(3), [{ id: 'a' }], { mode: 'DISTANCE_WEIGHT' })
    expect(r.trips).toEqual([])
    expect(r.unassigned).toHaveLength(3)
  })
})

describe('distances', () => {
  it('estimate = great circle × the road factor, at the planned speed', () => {
    const { km, min } = estimateMatrix([{ lat: 24, lng: 54 }, { lat: 24, lng: 55 }], { roadFactor: 1.3, speedKmh: 60 })
    expect(km[0][1]).toBeCloseTo(101.6 * 1.3, 0)
    expect(min[0][1]).toBeCloseTo(km[0][1], 5) // 60 km/h: a km a minute
  })

  it('a provider that is not set up falls back to the estimate and says so; nothing is called', async () => {
    const m = await distanceMatrix([start, { lat: 24.4, lng: 54.6 }], { routing: { provider: 'GOOGLE', roadFactor: 1.3 }, speedKmh: 70 })
    expect(m).toMatchObject({ provider: 'ESTIMATE', estimated: true })
    expect(m.note).toMatch(/not set up/)
  })

  it('reads a capacity custom field however it is written', () => {
    expect(readCapacity([{ name: 'Max Load Capacity', value: '12,000 kg' }])).toEqual({ value: 12000, unit: 'kg' })
    expect(readCapacity([{ name: 'max load capacity', value: '7.5' }])).toEqual({ value: 7.5, unit: null })
    expect(readCapacity([{ name: 'Colour', value: '12' }])).toBe(null)
  })
})

describe('the API', () => {
  let fx
  const app = createApp()
  beforeEach(async () => {
    await resetDb()
    __clearJourneySettingsCache()
    fx = await seedFixture()
  })

  it('saves a capacity, lists it, and solves by weight', async () => {
    const t = fx.tokens.bgUserA1a
    const s = await request(app).put(`/api/route-optimization/capacity/${fx.vehicles.v1.id}`).set(auth(t)).send({ capacity: 2000, unit: 'kg' })
    expect(s.status).toBe(200)
    const o = await request(app).get('/api/route-optimization/options').set(auth(t))
    expect(o.body.data.vehicles.find(v => v.id === fx.vehicles.v1.id).capacity).toEqual({ value: 2000, unit: 'kg' })
    expect(o.body.data.providers).toMatchObject({ ESTIMATE: true, GOOGLE: false })
    const v = await prisma.vehicle.findUnique({ where: { id: fx.vehicles.v1.id } })
    expect(v.customFields).toEqual([{ name: 'Max Load Capacity', value: '2000 kg' }])

    const r = await request(app).post('/api/route-optimization/solve').set(auth(t)).send({
      mode: 'DISTANCE_WEIGHT', startAt: new Date(Date.now() + 3600_000).toISOString(), start,
      vehicles: [{ vehicleId: fx.vehicles.v1.id }], points: ring(5, 10, () => 300),
    })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ provider: 'ESTIMATE', estimated: true })
    expect(r.body.data.trips[0].totalWeight).toBeLessThanOrEqual(2000)
  })

  it('another BG\'s vehicle is not found; a sub-user cannot save a capacity', async () => {
    const r = await request(app).post('/api/route-optimization/solve').set(auth(fx.tokens.bgUserA1a)).send({
      startAt: new Date().toISOString(), start, vehicles: [{ vehicleId: fx.vehicles.v7.id }], points: ring(2),
    })
    expect(r.status).toBe(404)
    const s = await request(app).put(`/api/route-optimization/capacity/${fx.vehicles.v1.id}`).set(auth(fx.tokens.subUserA1a)).send({ capacity: 10 })
    expect(s.status).toBe(403)
  })
})
