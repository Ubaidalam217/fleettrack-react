/**
 * POST /api/journeys/route (lib/roadRoute.js): the road route through the
 * stops. The provider's fetch is always mocked here — no test touches the
 * network or a real key. No key set up is the estimate, never an error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { signToken } from '../src/lib/jwt.js'
import { __clearJourneySettingsCache, setJourneySettings } from '../src/lib/journeySettings.js'
import { __clearRoadRouteCache, decodePolyline, routeProvider } from '../src/lib/roadRoute.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

const A = { lat: 24.35, lng: 54.5 }
const B = { lat: 24.35, lng: 54.95 }
const C = { lat: 24.35, lng: 55.4 }

const route = (token, points, extra = {}) => request(app).post('/api/journeys/route').set(auth(token)).send({ points, ...extra })

/** An OpenRouteService answer for the stops: a wiggly line and two legs. */
const orsAnswer = () => ({
  features: [{
    geometry: { coordinates: [[54.5, 24.35], [54.6, 24.4], [54.95, 24.36], [55.2, 24.3], [55.4, 24.35]] },
    properties: { segments: [{ distance: 52_300, duration: 2_700 }, { distance: 51_000, duration: 2_400 }] },
  }],
})

const jsonResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

let fetchMock
const KEYS = ['OPENROUTESERVICE_API_KEY', 'GOOGLE_MAPS_API_KEY']
const saved = {}

beforeEach(async () => {
  await resetDb()
  __clearJourneySettingsCache()
  __clearRoadRouteCache()
  fx = await seedFixture()
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('no provider set up', () => {
  it('answers the estimate and never calls out', async () => {
    const res = await route(fx.tokens.bgUserA1a, [A, B, C])
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.estimated).toBe(true)
    expect(d.provider).toBe('ESTIMATE')
    expect(d.note).toMatch(/not set up/i)
    expect(d.legs).toHaveLength(2)
    // 0.45° of longitude at 24.35° N ≈ 45.7 km, × 1.3 road factor ≈ 59 km a leg, at 70 km/h ≈ 51 min
    expect(d.legs[0].distanceKm).toBeGreaterThan(55)
    expect(d.legs[0].distanceKm).toBeLessThan(63)
    expect(d.legs[0].durationMin).toBeGreaterThan(45)
    expect(d.legs[0].durationMin).toBeLessThan(58)
    expect(d.geometry).toEqual([[A.lat, A.lng], [B.lat, B.lng], [C.lat, C.lng]])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a picked provider without its key is the estimate too, naming it', async () => {
    await setJourneySettings(fx.bgA1a.id, { routing: { provider: 'GOOGLE' } })
    const res = await route(fx.tokens.bgUserA1a, [A, B])
    expect(res.status).toBe(200)
    expect(res.body.data.estimated).toBe(true)
    expect(res.body.data.note).toMatch(/GOOGLE is not set up/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('with OpenRouteService', () => {
  beforeEach(() => { process.env.OPENROUTESERVICE_API_KEY = 'test-key-not-real' })

  it('returns the road line and each leg from the provider', async () => {
    await setJourneySettings(fx.bgA1a.id, { routing: { provider: 'ORS' } })
    fetchMock.mockResolvedValueOnce(jsonResponse(orsAnswer()))
    const res = await route(fx.tokens.bgUserA1a, [A, B, C])
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d).toMatchObject({ estimated: false, provider: 'ORS', note: null })
    expect(d.legs).toEqual([{ distanceKm: 52.3, durationMin: 45 }, { distanceKm: 51, durationMin: 40 }])
    expect(d.distanceKm).toBe(103.3)
    expect(d.durationMin).toBe(85)
    expect(d.geometry[0]).toEqual([24.35, 54.5]) // [lat, lng]
    expect(d.geometry.length).toBeGreaterThanOrEqual(2)
    // one request, the key in the header only, and one best route (no alternatives)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('api.heigit.org/openrouteservice/v2/directions/driving-car')
    expect(init.headers.Authorization).toBe('test-key-not-real')
    expect(JSON.parse(init.body).coordinates).toEqual([[54.5, 24.35], [54.95, 24.35], [55.4, 24.35]])
    expect(JSON.parse(init.body).alternative_routes).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('test-key-not-real')
  })

  it('the "Estimate" setting still uses it, because the key was only set for road routes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(orsAnswer()))
    const res = await route(fx.tokens.bgUserA1a, [A, B, C])
    expect(res.body.data.provider).toBe('ORS')
    expect(routeProvider({ provider: 'ESTIMATE' })).toBe('ORS')
  })

  it('caches by the rounded coordinates (a second call costs nothing)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(orsAnswer()))
    const a = await route(fx.tokens.bgUserA1a, [A, B, C])
    const b = await route(fx.tokens.bgUserA1a, [{ lat: A.lat + 0.000001, lng: A.lng }, B, C])
    expect(a.body.data.estimated).toBe(false)
    expect(b.body.data.estimated).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a provider that fails is the estimate with a note, not an error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 503))
    const res = await route(fx.tokens.bgUserA1a, [A, B])
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ estimated: true, provider: 'ESTIMATE' })
    expect(res.body.data.note).toMatch(/ORS did not answer/)
    // a failure is not cached: the next call asks again
    fetchMock.mockResolvedValueOnce(jsonResponse(orsAnswer()))
    const again = await route(fx.tokens.bgUserA1a, [A, B, C])
    expect(again.body.data.estimated).toBe(false)
  })

  it('an answer that does not match the stops is the estimate', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(orsAnswer())) // two legs for a 2-point request
    const res = await route(fx.tokens.bgUserA1a, [A, B])
    expect(res.body.data.estimated).toBe(true)
  })

  it('more points than the provider takes are estimated without a call', async () => {
    const many = Array.from({ length: 55 }, (_, i) => ({ lat: 24.3 + i * 0.001, lng: 54.5 + i * 0.001 }))
    const res = await route(fx.tokens.bgUserA1a, many)
    expect(res.body.data.estimated).toBe(true)
    expect(res.body.data.note).toMatch(/More than 50 points/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('with OSRM and Google (stubs on mocked answers)', () => {
  it('OSRM: the route service of the client\'s own server', async () => {
    await setJourneySettings(fx.bgA1a.id, { routing: { provider: 'OSRM', osrmUrl: 'http://10.0.0.5:5000' } })
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 'Ok',
      routes: [{ geometry: { coordinates: [[54.5, 24.35], [54.95, 24.36]] }, legs: [{ distance: 50_000, duration: 2_400 }] }],
    }))
    const res = await route(fx.tokens.bgUserA1a, [A, B])
    expect(res.body.data).toMatchObject({ provider: 'OSRM', estimated: false, distanceKm: 50, durationMin: 40 })
    expect(fetchMock.mock.calls[0][0]).toContain('http://10.0.0.5:5000/route/v1/driving/54.5,24.35;54.95,24.35')
  })

  it('Google: only when picked and keyed; decodes its polyline', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'google-test-key'
    await setJourneySettings(fx.bgA1a.id, { routing: { provider: 'GOOGLE' } })
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'OK',
      routes: [{ legs: [{ distance: { value: 50_000 }, duration: { value: 2_400 }, steps: [{ polyline: { points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] }] }],
    }))
    const res = await route(fx.tokens.bgUserA1a, [A, B])
    expect(res.body.data).toMatchObject({ provider: 'GOOGLE', estimated: false, distanceKm: 50, durationMin: 40 })
    expect(res.body.data.geometry[0]).toEqual([38.5, -120.2])
    expect(fetchMock.mock.calls[0][0]).toContain('directions/json')
  })

  it('decodes the polyline of Google\'s documentation example', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
  })
})

describe('permissions and input', () => {
  it('needs the Journeys screen at Edit; a viewer may not plan', async () => {
    const viewer = await prisma.user.create({ data: { email: 'view-route@alhabtoorlog.ae', passwordHash: 'x', role: 'BG_USER', bgId: fx.bgA1a.id, mustChangePassword: false, screenAccess: { journeys: 'view' } } })
    expect((await route(signToken(viewer), [A, B])).status).toBe(403)
    const editor = await prisma.user.create({ data: { email: 'edit-route@alhabtoorlog.ae', passwordHash: 'x', role: 'BG_USER', bgId: fx.bgA1a.id, mustChangePassword: false, screenAccess: { journeys: 'modify' } } })
    expect((await route(signToken(editor), [A, B])).status).toBe(200)
  })

  it('refuses fewer than two points and out-of-range coordinates', async () => {
    expect((await route(fx.tokens.bgUserA1a, [A])).status).toBe(400)
    expect((await route(fx.tokens.bgUserA1a, [A, { lat: 95, lng: 10 }])).status).toBe(400)
  })

  it('needs a login', async () => {
    const res = await request(app).post('/api/journeys/route').send({ points: [A, B] })
    expect(res.status).toBe(401)
  })
})

describe('saving a journey planned on the road route', () => {
  const tomorrow = () => { const d = new Date(Date.now() + 86_400_000); d.setUTCHours(6, 0, 0, 0); return d.toISOString() }
  const roadBody = vehicleId => ({
    title: 'Road route run', vehicleId, plannedStart: tomorrow(), routeSource: 'ROAD',
    plannedPath: [[24.35, 54.5], [24.4, 54.6], [24.36, 54.95], [24.3, 55.2], [24.35, 55.4]],
    // what the web form sends: blank options are null
    startBufferMin: null, routeToleranceM: null, forceCloseMin: null, tempMin: null, tempMax: null, loadState: null, convoy: [],
    stops: [
      { name: 'Depot', ...A },
      { name: 'Fuel stop', ...B, stayMin: 30, legDriveMin: 45, legSource: 'ROUTING' },
      { name: 'Site B', ...C, legDriveMin: 40, legSource: 'ROUTING' },
    ],
  })

  it('keeps the road line, its source and the routed leg times', async () => {
    const res = await request(app).post('/api/journeys').set(auth(fx.tokens.bgUserA1a)).send(roadBody(fx.vehicles.v1.id))
    expect(res.status).toBe(201)
    const j = res.body.data
    expect(j.routeSource).toBe('ROAD')
    expect(j.hasPath).toBe(true)
    expect(j.stops.map(s => s.legSource)).toEqual([null, 'ROUTING', 'ROUTING'])
    expect(j.stops[1].legDriveMin).toBe(45)
    expect(j.plannedDriveMin).toBe(85)
    const detail = await request(app).get(`/api/journeys/${j.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(detail.body.data.plannedPath.length).toBeGreaterThanOrEqual(2)
  })

  it('the engine measures against that line (routeSource ROAD counts as a line)', async () => {
    const { lineOf } = await import('../src/lib/journeys.js')
    const row = { routeSource: 'ROAD', plannedPath: [[24.35, 54.5], [24.4, 54.6], [24.35, 55.4]] }
    expect(lineOf(row, [])).toEqual(row.plannedPath)
  })

  it('route templates and journey templates accept the new source', async () => {
    const t = await request(app).post('/api/route-templates').set(auth(fx.tokens.bgUserA1a)).send({
      name: 'Depot to Site B', source: 'ROAD', path: roadBody(fx.vehicles.v1.id).plannedPath, stops: roadBody(fx.vehicles.v1.id).stops,
    })
    expect(t.status).toBe(201)
    expect(t.body.data.source).toBe('ROAD')
  })
})
