/**
 * /api/geofences — scope (BG-wide, sub-user read-only) and the geometry
 * validation lib/geofences.js enforces.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

const TRIANGLE = [
  { lat: 24.4, lng: 54.4 },
  { lat: 24.4, lng: 54.5 },
  { lat: 24.5, lng: 54.45 },
]

// Classic bowtie: edge (1)-(2) and edge (3)-(0) cross in the middle.
const BOWTIE = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 1 },
  { lat: 1, lng: 0 },
  { lat: 1, lng: 1 },
]

const polygonBody = (overrides = {}) => ({
  name: 'Kizad Yard',
  kind: 'GEOFENCE',
  shape: 'POLYGON',
  points: TRIANGLE,
  ...overrides,
})

const circleBody = (overrides = {}) => ({
  name: 'NFPC Depot',
  kind: 'ADDRESS',
  shape: 'CIRCLE',
  centerLat: 25.0,
  centerLng: 55.0,
  radius: 200,
  category: 'Depot',
  ...overrides,
})

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

async function seedGeofence(bgId, overrides = {}) {
  return prisma.geofence.create({
    data: {
      bgId,
      name: 'Seed Zone',
      kind: 'GEOFENCE',
      shape: 'POLYGON',
      points: TRIANGLE,
      active: true,
      ...overrides,
    },
  })
}

describe('GET /api/geofences — scope', () => {
  it('a BG-wide row, not narrowed by vehicle assignment: sub-user sees exactly its BG’s geofences', async () => {
    const gA1 = await seedGeofence(fx.bgA1a.id, { name: 'A1a Zone 1' })
    const gA2 = await seedGeofence(fx.bgA1a.id, { name: 'A1a Zone 2' })
    await seedGeofence(fx.bgB1a.id, { name: 'B1a Zone' })

    const res = await request(app).get('/api/geofences').set(auth(fx.tokens.subUserA1a))
    expect(res.status).toBe(200)
    expect(res.body.data.map(r => r.id).sort()).toEqual([gA1.id, gA2.id].sort())
  })

  it('SUPER_ADMIN sees every BG’s geofences; a BG user sees only its own', async () => {
    const gA = await seedGeofence(fx.bgA1a.id, { name: 'A Zone' })
    const gB = await seedGeofence(fx.bgB1a.id, { name: 'B Zone' })

    const su = await request(app).get('/api/geofences').set(auth(fx.tokens.superAdmin))
    expect(su.body.data.map(r => r.id).sort()).toEqual([gA.id, gB.id].sort())

    const bg = await request(app).get('/api/geofences').set(auth(fx.tokens.bgUserA1a))
    expect(bg.body.data.map(r => r.id)).toEqual([gA.id])
  })

  it('a GROUP_ADMIN of an empty group sees none, even though rows exist elsewhere in the GGB', async () => {
    await seedGeofence(fx.bgA2.id, { name: 'A2 Zone' })
    const res = await request(app).get('/api/geofences').set(auth(fx.tokens.groupAdminA2))
    expect(res.body.data).toEqual([])
  })

  it('GET /:id on another tenant’s geofence is a 404, not a 403', async () => {
    const gB = await seedGeofence(fx.bgB1a.id, { name: 'B Zone' })
    const res = await request(app).get(`/api/geofences/${gB.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(404)
  })

  it('filters by kind', async () => {
    await seedGeofence(fx.bgA1a.id, { name: 'Fence', kind: 'GEOFENCE' })
    await seedGeofence(fx.bgA1a.id, {
      name: 'Addr', kind: 'ADDRESS', shape: 'CIRCLE', points: null,
      centerLat: 24.4, centerLng: 54.4, radius: 150,
    })
    const res = await request(app)
      .get('/api/geofences')
      .query({ bgId: fx.bgA1a.id, kind: 'ADDRESS' })
      .set(auth(fx.tokens.bgUserA1a))
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('Addr')
  })
})

describe('write permission', () => {
  it('SUB_USER cannot create, update or delete', async () => {
    const existing = await seedGeofence(fx.bgA1a.id)

    const create = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.subUserA1a))
      .send({ ...polygonBody(), bgId: fx.bgA1a.id })
    expect(create.status).toBe(403)

    const update = await request(app)
      .put(`/api/geofences/${existing.id}`)
      .set(auth(fx.tokens.subUserA1a))
      .send(polygonBody({ name: 'Renamed' }))
    expect(update.status).toBe(403)

    const del = await request(app)
      .delete(`/api/geofences/${existing.id}`)
      .set(auth(fx.tokens.subUserA1a))
    expect(del.status).toBe(403)
  })

  it('a BG user creates and edits its own BG’s geofences', async () => {
    const create = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...polygonBody(), bgId: fx.bgA1a.id })
    expect(create.status).toBe(201)
    expect(create.body.data.bgId).toBe(fx.bgA1a.id)

    const update = await request(app)
      .put(`/api/geofences/${create.body.data.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send(polygonBody({ name: 'Kizad Yard — East' }))
    expect(update.status).toBe(200)
    expect(update.body.data.name).toBe('Kizad Yard — East')
  })

  it('a BG user cannot create a geofence naming another BG — 404, not 403', async () => {
    const res = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...polygonBody(), bgId: fx.bgB1a.id })
    expect(res.status).toBe(404)
  })
})

describe('geometry validation', () => {
  it('rejects a polygon with fewer than 3 points', async () => {
    const res = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...polygonBody(), points: TRIANGLE.slice(0, 2), bgId: fx.bgA1a.id })
    expect(res.status).toBe(400)
    expect(res.body.error.details.points).toBeTruthy()
  })

  it('rejects a self-intersecting polygon', async () => {
    const res = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...polygonBody(), points: BOWTIE, bgId: fx.bgA1a.id })
    expect(res.status).toBe(400)
    expect(res.body.error.details.points).toBeTruthy()
  })

  it('rejects a degenerate (collinear) polygon', async () => {
    const collinear = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }]
    const res = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...polygonBody(), points: collinear, bgId: fx.bgA1a.id })
    expect(res.status).toBe(400)
  })

  it('accepts a valid circle', async () => {
    const res = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...circleBody(), bgId: fx.bgA1a.id })
    expect(res.status).toBe(201)
    expect(res.body.data.radius).toBe(200)
    expect(res.body.data.points).toBeNull()
  })

  it('rejects a circle with radius 0', async () => {
    const res = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...circleBody(), radius: 0, bgId: fx.bgA1a.id })
    expect(res.status).toBe(400)
    expect(res.body.error.details.radius).toBeTruthy()
  })

  it('rejects a circle whose radius exceeds the sane maximum', async () => {
    const res = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...circleBody(), radius: 200_000, bgId: fx.bgA1a.id })
    expect(res.status).toBe(400)
  })

  it('clears the polygon fields when a row is switched from POLYGON to CIRCLE', async () => {
    const create = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...polygonBody(), bgId: fx.bgA1a.id })

    const update = await request(app)
      .put(`/api/geofences/${create.body.data.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send(circleBody({ name: polygonBody().name }))
    expect(update.status).toBe(200)
    expect(update.body.data.shape).toBe('CIRCLE')
    expect(update.body.data.points).toBeNull()
    expect(update.body.data.radius).toBe(200)
  })
})

describe('unique name per BG', () => {
  it('rejects a duplicate name within the same BG', async () => {
    await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...polygonBody(), bgId: fx.bgA1a.id })

    const res = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ...polygonBody(), bgId: fx.bgA1a.id })
    expect(res.status).toBe(409)
    expect(res.body.error.details.name).toBeTruthy()
  })

  it('allows the same name in a different BG', async () => {
    await seedGeofence(fx.bgA1a.id, { name: 'Main Gate' })
    const res = await request(app)
      .post('/api/geofences')
      .set(auth(fx.tokens.superAdmin))
      .send({ ...polygonBody({ name: 'Main Gate' }), bgId: fx.bgB1a.id })
    expect(res.status).toBe(201)
  })

  it('lets a row keep its own name on update', async () => {
    const g = await seedGeofence(fx.bgA1a.id, { name: 'Main Gate' })
    const res = await request(app)
      .put(`/api/geofences/${g.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send(polygonBody({ name: 'Main Gate', description: 'Updated' }))
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/geofences/:id', () => {
  it('removes the row', async () => {
    const g = await seedGeofence(fx.bgA1a.id)
    const res = await request(app).delete(`/api/geofences/${g.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(200)
    expect(await prisma.geofence.findUnique({ where: { id: g.id } })).toBeNull()
  })

  it('cascades when the owning BG is deleted', async () => {
    const g = await seedGeofence(fx.bgA1a.id)
    await request(app).delete(`/api/bgs/${fx.bgA1a.id}`).set(auth(fx.tokens.superAdmin))
    expect(await prisma.geofence.findUnique({ where: { id: g.id } })).toBeNull()
  })
})
