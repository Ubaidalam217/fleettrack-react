/**
 * The uniqueness rules the frontend already enforces against its mock, checked
 * where they can actually be guaranteed.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

describe('unique BG email', () => {
  it('rejects a duplicate', async () => {
    const res = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.superAdmin))
      .send({ name: 'Copycat', email: 'hassan@alhabtoorlog.ae', ggbId: fx.ggbA.id })
    expect(res.status).toBe(409)
    expect(res.body.error.details.email).toBeTruthy()
  })

  it('rejects a duplicate differing only in case or whitespace', async () => {
    const res = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.superAdmin))
      .send({ name: 'Copycat', email: '  Hassan@AlHabtoorLog.AE ', ggbId: fx.ggbA.id })
    expect(res.status).toBe(409)
  })

  it('rejects a duplicate across GGBs — the email is global, not per-tenant', async () => {
    const res = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.superAdmin))
      .send({ name: 'Copycat', email: 'hassan@alhabtoorlog.ae', ggbId: fx.ggbB.id })
    expect(res.status).toBe(409)
  })

  it('lets a BG keep its own email on update', async () => {
    const res = await request(app)
      .put(`/api/bgs/${fx.bgA1a.id}`)
      .set(auth(fx.tokens.superAdmin))
      .send({ name: 'Al Habtoor Logistics LLC', email: 'hassan@alhabtoorlog.ae' })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Al Habtoor Logistics LLC')
  })

  it('rejects taking another BG’s email on update', async () => {
    const res = await request(app)
      .put(`/api/bgs/${fx.bgA1a.id}`)
      .set(auth(fx.tokens.superAdmin))
      .send({ name: 'Al Habtoor', email: 'ops@desertrose.ae' })
    expect(res.status).toBe(409)
  })

  it('requires a valid email', async () => {
    const res = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.superAdmin))
      .send({ name: 'No Email', email: 'not-an-email', ggbId: fx.ggbA.id })
    expect(res.status).toBe(400)
  })
})

describe('unique user email, case-insensitive', () => {
  it('rejects a duplicate in any case', async () => {
    for (const email of [
      'dispatch@alhabtoorlog.ae',
      'Dispatch@AlHabtoorLog.ae',
      'DISPATCH@ALHABTOORLOG.AE',
      '  dispatch@alhabtoorlog.ae  ',
    ]) {
      const res = await request(app)
        .post('/api/users')
        .set(auth(fx.tokens.bgUserA1a))
        .send({ email, role: 'SUB_USER', bgId: fx.bgA1a.id })
      expect(res.status, email).toBe(409)
      expect(res.body.error.details.email).toBeTruthy()
    }
  })

  it('rejects a duplicate against an account in a different BG', async () => {
    // Global, not per-tenant: the email is the login username.
    const res = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ email: 'y.kareem@emiratescold.ae', role: 'SUB_USER', bgId: fx.bgA1a.id })
    expect(res.status).toBe(409)
  })

  it('stores a new email lower-cased', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ email: 'MiXeD.CaSe@AlHabtoorLog.AE', role: 'SUB_USER', bgId: fx.bgA1a.id })
    expect(res.status).toBe(201)
    expect(res.body.data.email).toBe('mixed.case@alhabtoorlog.ae')

    const row = await prisma.user.findUnique({ where: { id: res.body.data.id } })
    expect(row.email).toBe('mixed.case@alhabtoorlog.ae')
  })

  it('the stored lower-case form is what login matches', async () => {
    await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ email: 'CaseTest@AlHabtoorLog.AE', role: 'SUB_USER', bgId: fx.bgA1a.id })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'CASETEST@alhabtoorlog.ae', password: 'Aa@123456' })
    expect(res.status).toBe(200)
    expect(res.body.mustChangePassword).toBe(true)
  })
})

describe('unique IMEI', () => {
  it('rejects a duplicate', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ bgId: fx.bgA1a.id, imei: fx.vehicles.v1.imei, plateNo: 'DUP-1' })
    expect(res.status).toBe(409)
    expect(res.body.error.details.imei).toBeTruthy()
  })

  it('rejects a duplicate written with separators — the comparison is on digits', async () => {
    const spaced = fx.vehicles.v1.imei.replace(/^(\d{6})(\d{2})(\d+)$/, '$1 $2-$3')
    expect(spaced).not.toBe(fx.vehicles.v1.imei)

    const res = await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ bgId: fx.bgA1a.id, imei: spaced, plateNo: 'DUP-2' })
    expect(res.status).toBe(409)
  })

  it('rejects a duplicate belonging to another tenant’s vehicle', async () => {
    // One Flespi account serves every tenant, so the same device registered in two
    // BGs would make "whose position is this" unanswerable.
    const res = await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ bgId: fx.bgA1a.id, imei: fx.vehicles.v8.imei, plateNo: 'DUP-3' })
    expect(res.status).toBe(409)
  })

  it('stores the IMEI as digits only', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ bgId: fx.bgA1a.id, imei: '8630 7101-9999 01', plateNo: 'NEW-1' })
    expect(res.status).toBe(201)
    expect(res.body.data.imei).toBe('863071019999 01'.replace(/\D/g, ''))
    expect(res.body.data.imei).toBe('86307101999901')
  })

  it('lets a vehicle keep its own IMEI on update', async () => {
    const res = await request(app)
      .put(`/api/vehicles/${fx.vehicles.v1.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ imei: fx.vehicles.v1.imei, plateNo: 'RENAMED' })
    expect(res.status).toBe(200)
    expect(res.body.data.plateNo).toBe('RENAMED')
  })

  it('rejects taking another vehicle’s IMEI on update', async () => {
    const res = await request(app)
      .put(`/api/vehicles/${fx.vehicles.v1.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ imei: fx.vehicles.v2.imei })
    expect(res.status).toBe(409)
  })

  it('rejects an IMEI that is not 10-20 digits', async () => {
    for (const imei of ['', '123', 'abcdefghij', '123456789012345678901']) {
      const res = await request(app)
        .post('/api/vehicles')
        .set(auth(fx.tokens.bgUserA1a))
        .send({ bgId: fx.bgA1a.id, imei, plateNo: 'BAD' })
      expect(res.status, JSON.stringify(imei)).toBe(400)
    }
  })
})
