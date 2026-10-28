/**
 * /api/geocode/reverse — the shared address cache. The live geocoder is
 * stubbed: no test may call the public Nominatim.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
let geocoderCalls

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  geocoderCalls = []
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).includes('/reverse?')) return realFetch(url, init)
    geocoderCalls.push(String(url))
    const lat = new URL(url).searchParams.get('lat')
    return new Response(JSON.stringify({ display_name: `Street at ${lat}, Abu Dhabi` }), { status: 200 })
  })
})

afterEach(() => vi.restoreAllMocks())

const post = (token, body) => request(app).post('/api/geocode/reverse').set(auth(token)).send(body)

describe('POST /api/geocode/reverse', () => {
  it('requires a signed-in user', async () => {
    const res = await request(app).post('/api/geocode/reverse').send({ points: [{ lat: 24.4, lng: 54.4 }] })
    expect(res.status).toBe(401)
  })

  it('answers from the cache without calling the geocoder', async () => {
    await prisma.geocodeCache.create({ data: { key: '24.4000,54.4000', address: 'Cached Road, Musaffah' } })
    const res = await post(fx.tokens.subUserA1a, { points: [{ lat: 24.40001, lng: 54.39998 }] })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ addresses: { '24.4000,54.4000': 'Cached Road, Musaffah' }, pending: 0 })
    expect(geocoderCalls).toHaveLength(0)
  })

  it('with resolve 0, reports misses as pending and looks nothing up', async () => {
    const res = await post(fx.tokens.superAdmin, { points: [{ lat: 24.5, lng: 54.5 }, { lat: 24.6, lng: 54.6 }] })
    expect(res.body.data).toEqual({ addresses: {}, pending: 2 })
    expect(geocoderCalls).toHaveLength(0)
  })

  it('looks up at most `resolve` misses, stores them, and serves them from the cache next time', async () => {
    const points = [{ lat: 24.5, lng: 54.5 }, { lat: 24.6, lng: 54.6 }]
    const first = await post(fx.tokens.superAdmin, { points, resolve: 1 })
    expect(first.body.data.pending).toBe(1)
    expect(first.body.data.addresses['24.5000,54.5000']).toBe('Street at 24.5, Abu Dhabi')
    expect(geocoderCalls).toHaveLength(1)

    const again = await post(fx.tokens.subUserA1a, { points: [{ lat: 24.5, lng: 54.5 }] })
    expect(again.body.data).toEqual({ addresses: { '24.5000,54.5000': 'Street at 24.5, Abu Dhabi' }, pending: 0 })
    expect(geocoderCalls).toHaveLength(1)
  })

  it('does not cache a failed lookup', async () => {
    globalThis.fetch.mockImplementation(async () => new Response('busy', { status: 429 }))
    const res = await post(fx.tokens.superAdmin, { points: [{ lat: 24.5, lng: 54.5 }], resolve: 1 })
    expect(res.body.data).toEqual({ addresses: {}, pending: 1 })
    expect(await prisma.geocodeCache.count()).toBe(0)
  })

  it('rejects out-of-range coordinates and oversized resolve', async () => {
    expect((await post(fx.tokens.superAdmin, { points: [{ lat: 95, lng: 54 }] })).status).toBe(400)
    expect((await post(fx.tokens.superAdmin, { points: [{ lat: 24, lng: 54 }], resolve: 500 })).status).toBe(400)
  })
})
