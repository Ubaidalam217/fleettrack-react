/**
 * Replay share links (routes/replayShares.js): made signed in, opened without
 * signing in, refused once expired or switched off.
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
const { default: prisma } = await import('../src/prisma.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
let messageCalls

const FROM = 1_800_000_000
const TO = FROM + 2 * 86_400 - 1 // two days → two requests

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  messageCalls = 0
  vi.stubGlobal('fetch', async url => {
    const u = String(url)
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.includes('/gw/devices/all')) {
      return json({ result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, configuration: { ident: `86307101123450${i + 1}` } })) })
    }
    if (/\/gw\/devices\/101\/messages/.test(u)) {
      messageCalls += 1
      const q = JSON.parse(new URL(u).searchParams.get('data'))
      return json({ result: [
        { timestamp: q.from + 60, 'position.latitude': 24.45, 'position.longitude': 54.37, 'position.speed': 40, 'position.direction': 90, 'engine.ignition.status': true },
        { timestamp: q.from + 120, 'position.latitude': 24.46, 'position.longitude': 54.38, 'position.speed': 0, 'engine.ignition.status': false },
        { timestamp: q.from + 180 }, // no position — dropped
      ] })
    }
    return json({ result: [] })
  })
})

afterEach(() => vi.unstubAllGlobals())

const BG = () => auth(fx.tokens.bgUserA1a)
const inDays = d => new Date(Date.now() + d * 86_400_000).toISOString()
const make = (body = {}) => request(app).post('/api/replay-shares').set(BG())
  .send({ deviceId: 101, vehicleName: 'AD 12345', fromTs: FROM, toTs: TO, expiresAt: inDays(1), ...body })

describe('POST /api/replay-shares', () => {
  it('stores the track and returns an unguessable token', async () => {
    const res = await make()
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ deviceId: 101, vehicleName: 'AD 12345', pointCount: 4, truncated: false })
    expect(res.body.data.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(res.body.data.points).toBeUndefined()
    expect(messageCalls).toBe(2)
  })

  it('refuses a vehicle outside the caller scope, a bad range and a past expiry', async () => {
    expect((await make({ deviceId: 108 })).status).toBe(404)
    expect((await make({ toTs: FROM })).status).toBe(400)
    expect((await make({ toTs: FROM + 40 * 86_400 })).status).toBe(400)
    expect((await make({ expiresAt: inDays(-1) })).status).toBe(400)
    expect((await make({ expiresAt: inDays(400) })).status).toBe(400)
  })

  it('needs a sign-in', async () => {
    expect((await request(app).post('/api/replay-shares').send({})).status).toBe(401)
  })
})

describe('GET /api/public/replay/:token', () => {
  it('opens without signing in while the link is valid', async () => {
    const { token } = (await make()).body.data
    const res = await request(app).get(`/api/public/replay/${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ vehicleName: 'AD 12345', fromTs: FROM, toTs: TO })
    expect(res.body.data.points[0]).toEqual([FROM + 60, 24.45, 54.37, 40, 90, 1])
    expect(res.body.data.points[1]).toEqual([FROM + 120, 24.46, 54.38, 0, null, 0])
  })

  it('answers 410 once expired and 404 once switched off or unknown', async () => {
    const { id, token } = (await make()).body.data
    await prisma.replayShare.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const expired = await request(app).get(`/api/public/replay/${token}`)
    expect(expired.status).toBe(410)
    expect(expired.body.error.message).toMatch(/expired/)

    const other = (await make()).body.data
    expect((await request(app).delete(`/api/replay-shares/${other.id}`).set(BG())).status).toBe(200)
    expect((await request(app).get(`/api/public/replay/${other.token}`)).status).toBe(404)
    expect((await request(app).get('/api/public/replay/not-a-real-token-at-all-xyz')).status).toBe(404)
  })

  it('lists only my own links, and only I can switch one off', async () => {
    const mine = (await make()).body.data
    const list = await request(app).get('/api/replay-shares').set(BG())
    expect(list.body.data.map(s => s.id)).toEqual([mine.id])
    expect((await request(app).delete(`/api/replay-shares/${mine.id}`).set(auth(fx.tokens.bgUserB1a))).status).toBe(404)
  })
})
