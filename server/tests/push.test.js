/**
 * Mobile push notifications: phones registering (routes/me.js) and alert
 * events reaching exactly the accounts that can see them (lib/push.js), with
 * FCM and Google's token endpoint stubbed.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// Hoisted with vi.mock: the static imports below load env.js first.
const { KEY_FILE } = vi.hoisted(() => ({
  KEY_FILE: `${process.cwd()}/tests/.tmp-fcm-service-account.json`,
}))

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, FCM_SERVICE_ACCOUNT_FILE: KEY_FILE })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { pushEvents, __resetPush } = await import('../src/lib/push.js')
const { default: prisma } = await import('../src/prisma.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
let fx
let sent // [{ token, title, body, data }]
let tokenRequests

const tokenOf = name => `fcm-token-for-${name}-0123456789`

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  fs.writeFileSync(KEY_FILE, JSON.stringify({
    project_id: 'fleetmax-test', client_email: 'push@fleetmax-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }))
  __resetPush()
  sent = []
  tokenRequests = 0
  vi.stubGlobal('fetch', async (url, opts) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      tokenRequests++
      // The JWT is signed with the service account's key.
      const assertion = new URLSearchParams(String(opts.body)).get('assertion')
      const [h, p, sig] = assertion.split('.')
      const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url'))
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
      if (!ok || claims.scope !== 'https://www.googleapis.com/auth/firebase.messaging') return new Response('{}', { status: 400 })
      return Response.json({ access_token: 'access-1', expires_in: 3600 })
    }
    if (String(url) === 'https://fcm.googleapis.com/v1/projects/fleetmax-test/messages:send') {
      expect(opts.headers.Authorization).toBe('Bearer access-1')
      const { message } = JSON.parse(opts.body)
      if (message.token.startsWith('dead-')) {
        return Response.json({ error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 })
      }
      sent.push({ token: message.token, title: message.notification.title, body: message.notification.body, data: message.data, channel: message.android.notification.channel_id })
      return Response.json({ name: 'projects/fleetmax-test/messages/1' })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  fs.rmSync(KEY_FILE, { force: true })
})

const register = (who, token = tokenOf(who)) =>
  request(app).put('/api/me/push-devices').set(auth(fx.tokens[who])).send({ token, platform: 'android' })

const event = vehicle => prisma.alertEvent.create({
  data: { bgId: vehicle.bgId, vehicleId: vehicle.id, deviceId: 12345, type: 'speed', severity: 'High', title: 'Overspeed', message: `${vehicle.plateNo} at 132 km/h` },
})

describe('PUT / DELETE /api/me/push-devices', () => {
  it('registers a phone, moves it on another sign-in, and lets only its owner remove it', async () => {
    expect((await register('bgUserA1a')).status).toBe(204)
    expect(await prisma.pushDevice.findUnique({ where: { token: tokenOf('bgUserA1a') } })).toMatchObject({ userId: fx.users.bgUserA1a.id, platform: 'android' })

    // The same phone, now signed in as the sub-user.
    expect((await register('subUserA1a', tokenOf('bgUserA1a'))).status).toBe(204)
    expect(await prisma.pushDevice.count()).toBe(1)
    expect((await prisma.pushDevice.findFirst()).userId).toBe(fx.users.subUserA1a.id)

    // Someone else's sign-out does not touch it; its owner's does.
    await request(app).delete('/api/me/push-devices').set(auth(fx.tokens.bgUserA1a)).send({ token: tokenOf('bgUserA1a') })
    expect(await prisma.pushDevice.count()).toBe(1)
    await request(app).delete('/api/me/push-devices').set(auth(fx.tokens.subUserA1a)).send({ token: tokenOf('bgUserA1a') })
    expect(await prisma.pushDevice.count()).toBe(0)
  })

  it('needs a sign-in and a real token', async () => {
    expect((await request(app).put('/api/me/push-devices').send({ token: tokenOf('x'), platform: 'android' })).status).toBe(401)
    expect((await request(app).put('/api/me/push-devices').set(auth(fx.tokens.bgUserA1a)).send({ token: 'short', platform: 'android' })).status).toBe(400)
    expect((await request(app).put('/api/me/push-devices').set(auth(fx.tokens.bgUserA1a)).send({ token: tokenOf('x'), platform: 'windows' })).status).toBe(400)
  })
})

describe('pushEvents', () => {
  it('reaches only the accounts that can see the event', async () => {
    for (const who of ['superAdmin', 'bgUserA1a', 'subUserA1a', 'bgUserB1a']) expect((await register(who)).status).toBe(204)

    // v3 sits in the Al Ain Yard, outside the sub-user's vehicles and branch.
    const e = await event(fx.vehicles.v3)
    const { sent: n } = await pushEvents([e])
    expect(n).toBe(2)
    expect(sent.map(s => s.token).sort()).toEqual([tokenOf('bgUserA1a'), tokenOf('superAdmin')].sort())
    expect(sent[0]).toMatchObject({ title: 'Overspeed', body: 'PLATE-3 at 132 km/h', channel: 'alerts' })
    expect(sent[0].data).toEqual({ kind: 'alert', eventId: e.id, type: 'speed', deviceId: '12345' })

    // v1 is the sub-user's: now it hears too. The token is reused, not fetched again.
    sent = []
    await pushEvents([await event(fx.vehicles.v1)])
    expect(sent.map(s => s.token).sort()).toEqual([tokenOf('bgUserA1a'), tokenOf('subUserA1a'), tokenOf('superAdmin')].sort())
    expect(tokenRequests).toBe(1)
  })

  it('skips read records and accounts that turned Mobile off, and drops dead tokens', async () => {
    await register('bgUserA1a')
    await register('superAdmin', 'dead-token-0123456789-abcdef')
    const e = await event(fx.vehicles.v3)

    // A within-grace record (already read) is not a notification.
    await pushEvents([{ ...e, readAt: new Date() }])
    expect(sent).toEqual([])

    await pushEvents([e])
    expect(sent.map(s => s.token)).toEqual([tokenOf('bgUserA1a')])
    expect(await prisma.pushDevice.findUnique({ where: { token: 'dead-token-0123456789-abcdef' } })).toBeNull()

    // User settings › Notification without "Mobile".
    sent = []
    await prisma.user.update({ where: { id: fx.users.bgUserA1a.id }, data: { userSetting: { notification: ['Web'] } } })
    await pushEvents([e])
    expect(sent).toEqual([])
  })

  it('does nothing without a service account', async () => {
    fs.rmSync(KEY_FILE, { force: true })
    __resetPush()
    await register('bgUserA1a')
    expect(await pushEvents([await event(fx.vehicles.v3)])).toEqual({ sent: 0 })
    expect(sent).toEqual([])
  })
})
