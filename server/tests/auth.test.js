/**
 * Login, the first-login password change, and the gate that enforces it.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { auth, resetDb, seedFixture, TEST_PASSWORD } from './factories.js'

const app = createApp()
let fx

beforeAll(async () => {
  await resetDb()
})

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

describe('GET /api/health', () => {
  it('is reachable without a token and reports the database', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.database.reachable).toBe(true)
  })
})

describe('POST /api/auth/login', () => {
  it('returns a token, the profile and mustChangePassword', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hassan@alhabtoorlog.ae', password: TEST_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(res.body.tokenType).toBe('Bearer')
    expect(res.body.user.email).toBe('hassan@alhabtoorlog.ae')
    expect(res.body.user.role).toBe('BG_USER')
    expect(res.body.mustChangePassword).toBe(false)
  })

  it('accepts the email in any case', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '  HASSAN@AlHabtoorLog.AE  ', password: TEST_PASSWORD })
    expect(res.status).toBe(200)
  })

  it('never returns the password hash', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hassan@alhabtoorlog.ae', password: TEST_PASSWORD })
    expect(JSON.stringify(res.body)).not.toContain('$2')
    expect(res.body.user.passwordHash).toBeUndefined()
  })

  it('rejects a wrong password, and an unknown email, identically', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hassan@alhabtoorlog.ae', password: 'not-the-password' })
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@nowhere.test', password: TEST_PASSWORD })

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    // Same wording, so the endpoint cannot be used to find out which accounts
    // exist.
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message)
  })

  it('rejects an inactive account with the same 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'retired@alhabtoorlog.ae', password: TEST_PASSWORD })
    expect(res.status).toBe(401)
  })
})

describe('authentication', () => {
  it('rejects a missing, malformed and forged token', async () => {
    expect((await request(app).get('/api/vehicles')).status).toBe(401)
    expect(
      (await request(app).get('/api/vehicles').set('Authorization', 'Bearer nonsense')).status
    ).toBe(401)
    // Correct JWT structure, signed with the wrong key.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwiaWF0IjoxfQ.' +
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    expect(
      (await request(app).get('/api/vehicles').set('Authorization', `Bearer ${forged}`)).status
    ).toBe(401)
  })

  it('rejects a valid token whose account has since been deactivated', async () => {
    const token = fx.tokens.bgUserA1a
    expect((await request(app).get('/api/vehicles').set(auth(token))).status).toBe(200)

    await prisma.user.update({
      where: { id: fx.users.bgUserA1a.id },
      data: { status: 'Inactive' },
    })

    // The user row is re-read on every request, so this takes effect immediately
    // rather than when the token happens to expire.
    const after = await request(app).get('/api/vehicles').set(auth(token))
    expect(after.status).toBe(403)
  })

  it('rejects a valid token whose account has since been deleted', async () => {
    const token = fx.tokens.bgUserA1a
    await prisma.user.delete({ where: { id: fx.users.bgUserA1a.id } })
    expect((await request(app).get('/api/vehicles').set(auth(token))).status).toBe(401)
  })
})

describe('GET /api/auth/me', () => {
  it('reports the role and scope for each tier', async () => {
    const ggb = await request(app).get('/api/auth/me').set(auth(fx.tokens.ggbAdminA))
    expect(ggb.status).toBe(200)
    expect(ggb.body.role).toBe('GGB_ADMIN')
    expect(ggb.body.scope.ggbId).toBe(fx.ggbA.id)
    expect(ggb.body.scope.bgId).toBeNull()

    const group = await request(app).get('/api/auth/me').set(auth(fx.tokens.groupAdminA1))
    expect(group.body.scope.groupId).toBe(fx.groupA1.id)

    const bg = await request(app).get('/api/auth/me').set(auth(fx.tokens.bgUserA1a))
    expect(bg.body.scope.bgId).toBe(fx.bgA1a.id)
  })

  it('includes a sub-user’s assignments', async () => {
    const res = await request(app).get('/api/auth/me').set(auth(fx.tokens.subUserA1a))
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('SUB_USER')
    expect(res.body.scope.vehicleIds.sort()).toEqual([fx.vehicles.v1.id, fx.vehicles.v2.id].sort())
    expect(res.body.scope.branchIds).toEqual([fx.branches.depot.id])
  })
})

describe('first login', () => {
  it('logs in with the default password and reports mustChangePassword', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'fresh@alhabtoorlog.ae', password: 'Aa@123456' })

    expect(res.status).toBe(200)
    expect(res.body.mustChangePassword).toBe(true)
    expect(res.body.user.mustChangePassword).toBe(true)
  })

  it('blocks every other endpoint with 428 until the password is changed', async () => {
    const token = fx.tokens.freshUser
    for (const path of ['/api/vehicles', '/api/branches', '/api/me/vehicles', '/api/users']) {
      const res = await request(app).get(path).set(auth(token))
      expect(res.status, path).toBe(428)
      expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    }
    // ...but /api/auth/me stays reachable, so the client can greet them by name.
    expect((await request(app).get('/api/auth/me').set(auth(token))).status).toBe(200)
  })

  it('changes the password, clears the flag and opens the API', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'fresh@alhabtoorlog.ae', password: 'Aa@123456' })

    const changed = await request(app)
      .post('/api/auth/change-password')
      .set(auth(login.body.token))
      .send({ currentPassword: 'Aa@123456', newPassword: 'Brand-New-Pass-1' })

    expect(changed.status).toBe(200)
    expect(changed.body.mustChangePassword).toBe(false)
    expect(changed.body.token).toBeTruthy()

    // The fresh token works everywhere now.
    const after = await request(app).get('/api/vehicles').set(auth(changed.body.token))
    expect(after.status).toBe(200)

    // The old password no longer logs in; the new one does.
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'fresh@alhabtoorlog.ae', password: 'Aa@123456' })
      ).status
    ).toBe(401)
    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'fresh@alhabtoorlog.ae', password: 'Brand-New-Pass-1' })
    expect(relogin.status).toBe(200)
    expect(relogin.body.mustChangePassword).toBe(false)
  })

  it('refuses a change-password with the wrong current password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(auth(fx.tokens.freshUser))
      .send({ currentPassword: 'wrong-one', newPassword: 'Brand-New-Pass-1' })

    expect(res.status).toBe(400)
    expect(res.body.error.details.currentPassword).toBeTruthy()

    // And the flag is untouched, so the gate is still closed.
    const user = await prisma.user.findUnique({ where: { id: fx.users.freshUser.id } })
    expect(user.mustChangePassword).toBe(true)
  })

  it('refuses a too-short new password, and one identical to the current', async () => {
    const short = await request(app)
      .post('/api/auth/change-password')
      .set(auth(fx.tokens.freshUser))
      .send({ currentPassword: 'Aa@123456', newPassword: 'abc' })
    expect(short.status).toBe(400)

    const same = await request(app)
      .post('/api/auth/change-password')
      .set(auth(fx.tokens.freshUser))
      .send({ currentPassword: 'Aa@123456', newPassword: 'Aa@123456' })
    expect(same.status).toBe(400)
  })

  it('requires a token to change a password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'Aa@123456', newPassword: 'Brand-New-Pass-1' })
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/me — own profile', () => {
  it('lets any role change its own name and mobile, and nothing else', async () => {
    const res = await request(app)
      .patch('/api/me')
      .set(auth(fx.tokens.subUserA1a))
      .send({ shortName: '  Hassan  ', mobile: '+971 50 000 0000', role: 'SUPER_ADMIN', email: 'x@y.z' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ shortName: 'Hassan', mobile: '+971 50 000 0000', role: 'SUB_USER' })
    expect(res.body.data.email).toBe(fx.users.subUserA1a.email)
    expect(res.body.data.passwordHash).toBeUndefined()
  })

  it('needs a login', async () => {
    expect((await request(app).patch('/api/me').send({ shortName: 'X' })).status).toBe(401)
  })
})

describe('Profile photo — PUT/DELETE /api/me/avatar, GET /api/avatars/:key', () => {
  // Only the first bytes decide the format; the rest can be anything.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 3)])

  it('stores a photo, serves it publicly by an unguessable key, and shows it on the account', async () => {
    const put = await request(app).put('/api/me/avatar').set(auth(fx.tokens.subUserA1a)).send({ image: jpeg.toString('base64') })
    expect(put.status).toBe(200)
    expect(put.body.data.avatarUrl).toMatch(/^\/api\/avatars\/[a-f0-9]{32}$/)

    const img = await request(app).get(put.body.data.avatarUrl)   // no token
    expect(img.status).toBe(200)
    expect(img.headers['content-type']).toBe('image/jpeg')
    expect(img.headers['cache-control']).toContain('immutable')
    expect(Buffer.compare(img.body, jpeg)).toBe(0)

    const me = await request(app).get('/api/auth/me').set(auth(fx.tokens.subUserA1a))
    expect(me.body.user?.avatarUrl ?? me.body.data?.user?.avatarUrl ?? me.body.data?.avatarUrl).toBe(put.body.data.avatarUrl)
  })

  it('gives a new URL on every upload and retires the old one', async () => {
    const first = await request(app).put('/api/me/avatar').set(auth(fx.tokens.subUserA1a)).send({ image: jpeg.toString('base64') })
    const second = await request(app).put('/api/me/avatar').set(auth(fx.tokens.subUserA1a)).send({ image: `data:image/png;base64,${png.toString('base64')}` })
    expect(second.status).toBe(200)
    expect(second.body.data.avatarUrl).not.toBe(first.body.data.avatarUrl)
    expect((await request(app).get(first.body.data.avatarUrl)).status).toBe(404)
    const now = await request(app).get(second.body.data.avatarUrl)
    expect(now.headers['content-type']).toBe('image/png')
  })

  it('refuses anything that is not an image, and oversized files', async () => {
    const text = await request(app).put('/api/me/avatar').set(auth(fx.tokens.subUserA1a)).send({ image: Buffer.from('<svg onload=alert(1)>hello there</svg>').toString('base64') })
    expect(text.status).toBe(400)
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(530 * 1024)])
    const tooBig = await request(app).put('/api/me/avatar').set(auth(fx.tokens.subUserA1a)).send({ image: big.toString('base64') })
    expect([400, 413]).toContain(tooBig.status)
  })

  it('removes the photo', async () => {
    const put = await request(app).put('/api/me/avatar').set(auth(fx.tokens.bgUserA1a)).send({ image: jpeg.toString('base64') })
    const del = await request(app).delete('/api/me/avatar').set(auth(fx.tokens.bgUserA1a))
    expect(del.status).toBe(200)
    expect(del.body.data.avatarUrl).toBeNull()
    expect((await request(app).get(put.body.data.avatarUrl)).status).toBe(404)
  })

  it('needs a login to change, and 404s a malformed key', async () => {
    expect((await request(app).put('/api/me/avatar').send({ image: jpeg.toString('base64') })).status).toBe(401)
    expect((await request(app).delete('/api/me/avatar')).status).toBe(401)
    expect((await request(app).get('/api/avatars/not-a-key')).status).toBe(404)
  })
})
