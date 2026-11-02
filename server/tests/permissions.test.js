/**
 * Per-user screen permissions (lib/permissions.js): writes are refused below
 * the level a screen needs; an account with no map is unrestricted; nobody can
 * hand out more than they hold.
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

const setAccess = (user, screenAccess) => prisma.user.update({ where: { id: user.id }, data: { screenAccess } })

describe('screen permissions on writes', () => {
  it('leaves an account with no permissions exactly as its role allows', async () => {
    const res = await request(app).put(`/api/branches/${fx.branches.yard.id}`).set(auth(fx.tokens.bgUserA1a)).send({ name: 'Al Ain Yard 2' })
    expect(res.status).toBe(200)
  })

  it('View only: reads work, every write is refused', async () => {
    await setAccess(fx.users.bgUserA1a, { '/settings/branch': 'view' })
    const t = auth(fx.tokens.bgUserA1a)
    expect((await request(app).get('/api/branches').set(t)).status).toBe(200)
    expect((await request(app).put(`/api/branches/${fx.branches.yard.id}`).set(t).send({ name: 'x' })).status).toBe(403)
    expect((await request(app).post('/api/branches').set(t).send({ name: 'New', bgId: fx.bgA1a.id })).status).toBe(403)
    expect((await request(app).delete(`/api/branches/${fx.branches.yard.id}`).set(t)).status).toBe(403)
  })

  it('Edit: changes allowed, adding and deleting refused', async () => {
    await setAccess(fx.users.bgUserA1a, { '/settings/branch': 'modify' })
    const t = auth(fx.tokens.bgUserA1a)
    expect((await request(app).put(`/api/branches/${fx.branches.yard.id}`).set(t).send({ name: 'Yard B' })).status).toBe(200)
    expect((await request(app).post('/api/branches').set(t).send({ name: 'New', bgId: fx.bgA1a.id })).status).toBe(403)
    expect((await request(app).delete(`/api/branches/${fx.branches.yard.id}`).set(t)).status).toBe(403)
  })

  it('a restriction on one screen does not touch another', async () => {
    await setAccess(fx.users.bgUserA1a, { '/settings/branch': 'none' })
    const res = await request(app).post('/api/branches').set(auth(fx.tokens.bgUserA1a)).send({ name: 'x', bgId: fx.bgA1a.id })
    expect(res.status).toBe(403)
    const ok = await request(app).get('/api/vehicles').set(auth(fx.tokens.bgUserA1a))
    expect(ok.status).toBe(200)
  })

  it('never restricts a Super Admin', async () => {
    await setAccess(fx.users.superAdmin, { '/settings/branch': 'none' })
    const res = await request(app).put(`/api/branches/${fx.branches.yard.id}`).set(auth(fx.tokens.superAdmin)).send({ name: 'Yard C' })
    expect(res.status).toBe(200)
  })

  it('hands the session its own permissions', async () => {
    await setAccess(fx.users.bgUserA1a, { '/tracking': 'none' })
    const me = await request(app).get('/api/auth/me').set(auth(fx.tokens.bgUserA1a))
    expect(me.body.user.screenAccess).toEqual({ '/tracking': 'none' })
  })
})

describe('granting permissions', () => {
  it('clamps what an editor hands out to its own level', async () => {
    await setAccess(fx.users.ggbAdminA, { '/settings/vehicle': 'modify', '/reports/movement': 'view' })
    const res = await request(app).post('/api/users').set(auth(fx.tokens.ggbAdminA)).send({
      email: 'new.bg@example.com', role: 'BG_USER', bgId: fx.bgA1a.id,
      screenAccess: { '/settings/vehicle': 'addDelete', '/reports/movement': 'view', '/charts': 'none' },
    })
    expect(res.status).toBe(201)
    expect(res.body.data.screenAccess).toEqual({ '/settings/vehicle': 'modify', '/reports/movement': 'view', '/charts': 'none' })
  })

  it('refuses to manage accounts without Users permission', async () => {
    await setAccess(fx.users.bgUserA1a, { users: 'view' })
    const res = await request(app).post('/api/users').set(auth(fx.tokens.bgUserA1a)).send({ email: 'x@example.com', role: 'SUB_USER', bgId: fx.bgA1a.id })
    expect(res.status).toBe(403)
  })
})
