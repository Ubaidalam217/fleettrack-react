/**
 * Live location share links (routes/locationShares.js): made signed in, opened
 * without signing in, showing the vehicle's latest position until expired or
 * switched off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, FLESPI_TOKEN: 'mock-master-token' })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { clearDeviceCache } = await import('../src/lib/flespi.js')
const { __clearLocationCache } = await import('../src/routes/locationShares.js')
const { default: prisma } = await import('../src/prisma.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
let telemetryCalls
let speed

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  __clearLocationCache()
  telemetryCalls = 0
  speed = 42
  vi.stubGlobal('fetch', async url => {
    const u = String(url)
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (/\/gw\/devices\/101\/telemetry\//.test(u)) {
      telemetryCalls += 1
      const t = { 'position.latitude': 24.45, 'position.longitude': 54.37, 'position.speed': speed, 'position.direction': 90, 'engine.ignition.status': true, timestamp: 1_800_000_000 }
      return json({ result: [{ id: 101, telemetry: Object.fromEntries(Object.entries(t).map(([k, value]) => [k, { value, ts: 1_800_000_000 }])) }] })
    }
    if (u.includes('/gw/devices/all')) {
      return json({ result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, configuration: { ident: `86307101123450${i + 1}` } })) })
    }
    return json({ result: [] })
  })
})

afterEach(() => vi.unstubAllGlobals())

const BG = () => auth(fx.tokens.bgUserA1a)
const inHours = h => new Date(Date.now() + h * 3_600_000).toISOString()
const make = (body = {}) => request(app).post('/api/location-shares').set(BG())
  .send({ deviceId: 101, vehicleName: 'PLATE-1', expiresAt: inHours(1), ...body })
const open = token => request(app).get(`/api/public/location/${token}`)

describe('POST /api/location-shares', () => {
  it('makes an unguessable link for a vehicle in reach', async () => {
    const res = await make()
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ deviceId: 101, vehicleName: 'PLATE-1' })
    expect(res.body.data.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('refuses a vehicle outside the caller scope, a past expiry and more than 7 days', async () => {
    expect((await make({ deviceId: 108 })).status).toBe(404)
    expect((await make({ expiresAt: inHours(-1) })).status).toBe(400)
    expect((await make({ expiresAt: inHours(8 * 24) })).status).toBe(400)
    expect((await request(app).post('/api/location-shares').send({})).status).toBe(401)
  })
})

describe('GET /api/public/location/:token', () => {
  it('shows where the vehicle is now, read at most once per 15 s', async () => {
    const { token } = (await make()).body.data
    const first = await open(token)
    expect(first.status).toBe(200)
    expect(first.body.data).toMatchObject({ vehicleName: 'PLATE-1', refreshSec: 15, position: { lat: 24.45, lng: 54.37, speed: 42, heading: 90, ignition: true, ts: 1_800_000_000 } })
    speed = 80
    expect((await open(token)).body.data.position.speed).toBe(42) // cached
    expect(telemetryCalls).toBe(1)
    __clearLocationCache()
    expect((await open(token)).body.data.position.speed).toBe(80)
  })

  it('answers 410 once expired, 404 once switched off or unknown', async () => {
    const { id, token } = (await make()).body.data
    await prisma.locationShare.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await open(token)).status).toBe(410)
    const other = (await make()).body.data
    expect((await request(app).delete(`/api/location-shares/${other.id}`).set(BG())).status).toBe(200)
    expect((await open(other.token)).status).toBe(404)
    expect((await open('x'.repeat(32))).status).toBe(404)
  })

  it('lists my open links for a vehicle', async () => {
    await make()
    await make({ deviceId: 102 })
    const res = await request(app).get('/api/location-shares?deviceId=101').set(BG())
    expect(res.body.data.map(s => s.deviceId)).toEqual([101])
  })
})
