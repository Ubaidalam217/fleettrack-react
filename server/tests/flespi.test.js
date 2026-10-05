/**
 * Per-user Flespi ACL tokens: scope, caching, and invalidation.
 *
 * ── Why Flespi is mocked ────────────────────────────────────────────────────
 *
 * These assert on the ACL we *send*, which is the thing that can be wrong in a way
 * that leaks another tenant's devices. Hitting the real API would make the suite
 * depend on a third party, mint real tokens on every run, and — because Flespi
 * throttles on REST traffic volume per minute — fail intermittently for reasons
 * that say nothing about this code. The live account was verified separately; the
 * recorded behaviour is in the header of src/lib/flespi.js.
 *
 * The mock replaces global.fetch and records every request, so a test can assert
 * on the exact JSON body that would have gone to /platform/tokens.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

/**
 * FLESPI_TOKEN, swappable.
 *
 * `env` is Object.freeze'd on purpose, so vi.spyOn cannot redefine a property on it
 * — and a Proxy cannot lie about one either: returning a different value for a
 * non-configurable, non-writable data property violates a JS invariant and throws.
 *
 * So the env module is mocked with a plain mutable COPY carrying a getter for this
 * one key, read from a holder a test can reassign. `vi.hoisted` is what lets the
 * holder exist above the hoisted vi.mock factory.
 *
 * This matters beyond convenience: server/.env now holds a real Master token, so
 * without a working override these tests would mint real tokens against the live
 * account.
 */
const H = vi.hoisted(() => ({ flespiToken: 'mock-master-token' }))

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => {
    // A spread of a frozen object is an ordinary mutable one, so defineProperty
    // below is legal where a Proxy trap would not be.
    const copy = { ...frozen }
    Object.defineProperty(copy, 'FLESPI_TOKEN', {
      get: () => H.flespiToken,
      configurable: true,
      enumerable: true,
    })
    return copy
  }
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
import { auth, resetDb, seedFixture } from './factories.js'
import { clearDeviceCache } from '../src/lib/flespi.js'
import { buildAcl, scopeHash, methodsForRole, expiryFor } from '../src/lib/flespiGrant.js'
import { buildScope, ROLES } from '../src/lib/scope.js'

const app = createApp()
let fx

/**
 * Flespi device ids for the fixture's IMEIs.
 *
 * factories.js seeds imei `86307101123450<n>` for v1..v9. The map below is what a
 * real `GET /gw/devices/all?fields=id,configuration` would return — plus one extra
 * device (9999) that exists in Flespi but is registered to no vehicle, which is the
 * case a Super Admin must still see.
 */
const DEVICE_BY_IMEI = {
  863071011234501: 101,
  863071011234502: 102,
  863071011234503: 103,
  863071011234504: 104,
  863071011234505: 105,
  863071011234506: 106,
  863071011234507: 107,
  863071011234508: 108,
  863071011234509: 109,
}
const UNREGISTERED_DEVICE_ID = 9999

/** Every request the mock saw, newest last. */
let calls = []
/** flespiTokenId -> { key, acl, expire, deleted } */
let minted = new Map()
let nextTokenId = 500

function installFlespiMock({ failCreate = false } = {}) {
  calls = []
  minted = new Map()
  nextTokenId = 500

  const json = (body, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }))

  vi.stubGlobal('fetch', (url, init = {}) => {
    const u = String(url)
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url: u, method, body })

    // Device list
    if (u.includes('/gw/devices/all')) {
      const result = Object.entries(DEVICE_BY_IMEI).map(([ident, id]) => ({
        id,
        configuration: { ident },
      }))
      result.push({ id: UNREGISTERED_DEVICE_ID, configuration: { ident: '999999999999999' } })
      return json({ result })
    }

    // Mint
    if (u.endsWith('/platform/tokens') && method === 'POST') {
      if (failCreate) return json({ errors: [{ reason: 'nope' }] }, 500)
      const spec = body[0]
      const id = nextTokenId++
      const key = `mock-key-${id}`
      minted.set(id, { key, acl: spec.access.acl, expire: spec.expire, info: spec.info, deleted: false })
      return json({ result: [{ id, key, expire: spec.expire, info: spec.info, access: spec.access }] })
    }

    // Read one back
    const readMatch = /\/platform\/tokens\/(\d+)$/.exec(u)
    if (readMatch && method === 'GET') {
      const t = minted.get(Number(readMatch[1]))
      if (!t || t.deleted) return json({ errors: [{ reason: 'not found' }] }, 404)
      return json({ result: [{ id: Number(readMatch[1]), key: t.key, expire: t.expire }] })
    }

    // Delete
    if (readMatch && method === 'DELETE') {
      const t = minted.get(Number(readMatch[1]))
      if (t) t.deleted = true
      return json({ result: {} })
    }

    return json({ errors: [{ reason: `unmocked ${method} ${u}` }] }, 500)
  })
}

/** The ACL body of the most recent mint. */
const lastMintedAcl = () =>
  [...calls].reverse().find(c => c.method === 'POST' && c.url.endsWith('/platform/tokens'))?.body[0]
    ?.access?.acl

const mintCount = () =>
  calls.filter(c => c.method === 'POST' && c.url.endsWith('/platform/tokens')).length

const deleteCount = () =>
  calls.filter(c => c.method === 'DELETE' && /\/platform\/tokens\/\d+$/.test(c.url)).length

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  H.flespiToken = 'mock-master-token'
  installFlespiMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearDeviceCache()
})

// ── ACL construction ────────────────────────────────────────────────────────

describe('buildAcl — the ACL matches the account scope', () => {
  const scopeOf = key => buildScope({ ...fx.users[key], vehicles: [], branches: [] })

  it('a SUB_USER gets only its assigned devices, GET only', async () => {
    // The sub-user is assigned v1 and v2; v3 and v4 are in the same BG and must not
    // appear. This is the single most important assertion in the file.
    const scope = buildScope({
      ...fx.users.subUserA1a,
      vehicles: [{ vehicleId: fx.vehicles.v1.id }, { vehicleId: fx.vehicles.v2.id }],
      branches: [],
    })
    const { acl, deviceIds, methods } = await buildAcl(scope)
    expect(deviceIds).toEqual([101, 102])
    expect(methods).toEqual(['GET'])
    expect(acl).toEqual([{ uri: 'gw/devices', ids: [101, 102], methods: ['GET'] }])
  })

  it('a SUB_USER with no assignments gets an EMPTY id list, not all devices', async () => {
    // [] and "no ids key" mean opposite things to Flespi: [] reaches nothing,
    // omitted reaches everything. Getting this backwards would hand a sub-user the
    // entire account.
    const scope = buildScope({ ...fx.users.subUserA1a, vehicles: [], branches: [] })
    const { acl, deviceIds } = await buildAcl(scope)
    expect(deviceIds).toEqual([])
    expect(acl[0].ids).toEqual([])
    expect('ids' in acl[0]).toBe(true)
  })

  it('a BG_USER gets its own BG’s devices with GET+PUT', async () => {
    const { acl, deviceIds, methods } = await buildAcl(scopeOf('bgUserA1a'))
    // bgA1a holds v1..v4.
    expect(deviceIds).toEqual([101, 102, 103, 104])
    expect(methods).toEqual(['GET', 'PUT'])
    expect(acl[0].ids).not.toContain(105) // v5 is in bgA1b
    expect(acl[0].ids).not.toContain(108) // v8 is in the other GGB
  })

  it('a GGB_ADMIN spans its GGB’s BGs but not the other GGB', async () => {
    const { deviceIds } = await buildAcl(scopeOf('ggbAdminA'))
    expect(deviceIds).toEqual([101, 102, 103, 104, 105, 106, 107])
    expect(deviceIds).not.toContain(108)
    expect(deviceIds).not.toContain(109)
  })

  it('a GROUP_ADMIN excludes the ungrouped BG in the same GGB', async () => {
    // bgA2 (v7 -> 107) is in ggbA but not in groupA1. A filter that widened to the
    // GGB would include it.
    const { deviceIds } = await buildAcl(scopeOf('groupAdminA1'))
    expect(deviceIds).toEqual([101, 102, 103, 104, 105, 106])
    expect(deviceIds).not.toContain(107)
  })

  it('a GROUP_ADMIN of an empty group gets an empty list', async () => {
    const { deviceIds } = await buildAcl(scopeOf('groupAdminA2'))
    expect(deviceIds).toEqual([])
  })

  it('a SUPER_ADMIN omits ids entirely, so devices not in Settings stay visible', async () => {
    const { acl, deviceIds, methods } = await buildAcl(scopeOf('superAdmin'))
    expect(deviceIds).toBeNull()
    expect(methods).toEqual(['GET', 'PUT'])
    expect(acl).toEqual([{ uri: 'gw/devices', methods: ['GET', 'PUT'] }])
    // Specifically: no id list that would have excluded device 9999.
    expect('ids' in acl[0]).toBe(false)
  })

  it('reports a vehicle whose IMEI has no Flespi device rather than dropping it', async () => {
    await prisma.vehicle.create({
      data: { bgId: fx.bgA1a.id, imei: '111111111111111', plateNo: 'GHOST' },
    })
    const { deviceIds, unmatchedImeis } = await buildAcl(scopeOf('bgUserA1a'))
    expect(deviceIds).toEqual([101, 102, 103, 104])
    expect(unmatchedImeis).toEqual(['111111111111111'])
  })

  it('only grants GET to a sub-user, GET+PUT to everyone else', () => {
    expect(methodsForRole(ROLES.SUB_USER)).toEqual(['GET'])
    for (const r of [ROLES.BG_USER, ROLES.GROUP_ADMIN, ROLES.GGB_ADMIN, ROLES.SUPER_ADMIN]) {
      expect(methodsForRole(r), r).toEqual(['GET', 'PUT'])
    }
  })
})

describe('scopeHash', () => {
  it('changes when the device set changes', () => {
    const a = scopeHash({ deviceIds: [1, 2], methods: ['GET'] })
    expect(scopeHash({ deviceIds: [1, 2], methods: ['GET'] })).toBe(a)
    expect(scopeHash({ deviceIds: [1, 2, 3], methods: ['GET'] })).not.toBe(a)
    expect(scopeHash({ deviceIds: [1], methods: ['GET'] })).not.toBe(a)
  })

  it('changes when the methods change', () => {
    expect(scopeHash({ deviceIds: [1], methods: ['GET'] }))
      .not.toBe(scopeHash({ deviceIds: [1], methods: ['GET', 'PUT'] }))
  })

  it('never confuses all-devices with no-devices', () => {
    expect(scopeHash({ deviceIds: null, methods: ['GET'] }))
      .not.toBe(scopeHash({ deviceIds: [], methods: ['GET'] }))
  })
})

describe('expiryFor', () => {
  it('matches the JWT exp, minus a margin so Flespi dies first', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    expect(expiryFor(exp)).toBe(exp - 60)
  })

  it('falls back to 12h for a missing or already-past exp', () => {
    const now = Math.floor(Date.now() / 1000)
    for (const bad of [null, undefined, NaN, now - 5]) {
      const got = expiryFor(bad)
      expect(got).toBeGreaterThan(now + 11 * 3600)
      expect(got).toBeLessThanOrEqual(now + 12 * 3600)
    }
  })
})

// ── The endpoint ────────────────────────────────────────────────────────────

describe('POST /api/flespi/token', () => {
  it('issues a token scoped to the sub-user’s two devices', async () => {
    const res = await request(app).post('/api/flespi/token').set(auth(fx.tokens.subUserA1a))
    expect(res.status).toBe(200)
    expect(res.body.data.token).toMatch(/^mock-key-\d+$/)
    expect(res.body.data.deviceCount).toBe(2)
    expect(res.body.data.role).toBe('SUB_USER')
    expect(lastMintedAcl()).toEqual([{ uri: 'gw/devices', ids: [101, 102], methods: ['GET'] }])
  })

  it('issues GET+PUT over its own BG for a BG user', async () => {
    const res = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(200)
    expect(res.body.data.deviceCount).toBe(4)
    expect(lastMintedAcl()).toEqual([
      { uri: 'gw/devices', ids: [101, 102, 103, 104], methods: ['GET', 'PUT'] },
    ])
  })

  it('never mints a Master token', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.superAdmin))
    const mint = calls.find(c => c.method === 'POST' && c.url.endsWith('/platform/tokens'))
    expect(mint.body[0].access.type).toBe(2)
    expect(mint.body[0].access.type).not.toBe(1)
  })

  it('sets the Flespi expiry from the caller’s JWT', async () => {
    const res = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    const mint = calls.find(c => c.method === 'POST' && c.url.endsWith('/platform/tokens'))
    const expMs = new Date(res.body.data.expiresAt).getTime()
    expect(mint.body[0].expire * 1000).toBe(expMs)
    // JWT_EXPIRES_IN is 12h in test env; well inside a day either way.
    expect(expMs).toBeGreaterThan(Date.now())
    expect(expMs).toBeLessThan(Date.now() + 25 * 3600 * 1000)
  })

  it('requires a token', async () => {
    expect((await request(app).post('/api/flespi/token')).status).toBe(401)
  })

  it('is blocked behind the first-login gate', async () => {
    const res = await request(app).post('/api/flespi/token').set(auth(fx.tokens.freshUser))
    expect(res.status).toBe(428)
  })

  it('answers 503 when Flespi is not configured, without touching other routes', async () => {
    H.flespiToken = undefined
    const res = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('FLESPI_NOT_CONFIGURED')
    // The rest of the API is unaffected — a missing Flespi key is not an outage.
    expect((await request(app).get('/api/vehicles').set(auth(fx.tokens.bgUserA1a))).status).toBe(200)
  })

  it('surfaces a Flespi failure as 502 rather than a silent empty token', async () => {
    installFlespiMock({ failCreate: true })
    const res = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(502)
    expect(res.body.data?.token).toBeUndefined()
  })
})

// ── Caching ─────────────────────────────────────────────────────────────────

describe('token reuse', () => {
  it('reuses a valid cached token instead of minting per request', async () => {
    const a = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    const b = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    expect(a.body.data.token).toBe(b.body.data.token)
    expect(a.body.data.reused).toBe(false)
    expect(b.body.data.reused).toBe(true)
    expect(mintCount()).toBe(1)
  })

  it('keeps one grant row per user', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    expect(await prisma.flespiGrant.count({ where: { userId: fx.users.bgUserA1a.id } })).toBe(1)
  })

  it('mints a fresh one when the cached Flespi token has been deleted externally', async () => {
    const a = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    const grant = await prisma.flespiGrant.findUnique({ where: { userId: fx.users.bgUserA1a.id } })
    minted.get(grant.flespiTokenId).deleted = true // somebody deleted it in the panel

    const b = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    expect(b.status).toBe(200)
    expect(b.body.data.token).not.toBe(a.body.data.token)
    expect(mintCount()).toBe(2)
  })

  it('mints a fresh one once the cached grant has expired', async () => {
    const a = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    await prisma.flespiGrant.update({
      where: { userId: fx.users.bgUserA1a.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const b = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    expect(b.body.data.token).not.toBe(a.body.data.token)
    expect(deleteCount()).toBe(1) // the stale one was revoked, not abandoned
  })

  it('does not store the token key in our database', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    const grant = await prisma.flespiGrant.findUnique({ where: { userId: fx.users.bgUserA1a.id } })
    expect(Object.values(grant).join('|')).not.toContain('mock-key-')
    expect(grant.flespiTokenId).toBeTypeOf('number')
  })
})

// ── Invalidation ────────────────────────────────────────────────────────────

describe('invalidation', () => {
  const grantOf = userId => prisma.flespiGrant.findUnique({ where: { userId } })

  it('revokes on explicit sign-out', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    const before = await grantOf(fx.users.bgUserA1a.id)

    const res = await request(app).post('/api/flespi/revoke').set(auth(fx.tokens.bgUserA1a))
    expect(res.body.data.revoked).toBe(true)
    expect(await grantOf(fx.users.bgUserA1a.id)).toBeNull()
    expect(minted.get(before.flespiTokenId).deleted).toBe(true)
  })

  it('revokes when a sub-user’s vehicle assignments change', async () => {
    const r = await request(app).post('/api/flespi/token').set(auth(fx.tokens.subUserA1a))
    expect(r.body.data.deviceCount).toBe(2)
    const before = await grantOf(fx.users.subUserA1a.id)

    await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}/vehicles`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ids: [fx.vehicles.v3.id] })

    expect(await grantOf(fx.users.subUserA1a.id)).toBeNull()
    expect(minted.get(before.flespiTokenId).deleted).toBe(true)

    // The next refresh describes the NEW assignment, not the old one.
    const after = await request(app).post('/api/flespi/token').set(auth(fx.tokens.subUserA1a))
    expect(after.body.data.deviceCount).toBe(1)
    expect(lastMintedAcl()).toEqual([{ uri: 'gw/devices', ids: [103], methods: ['GET'] }])
  })

  it('revokes everyone in the BG when a vehicle is added', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.subUserA1a))

    await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ bgId: fx.bgA1a.id, imei: '863071011234509', plateNo: 'X' })
      .expect(409) // that IMEI is v9's; the point is the next one

    await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ bgId: fx.bgA1a.id, imei: '999999999999999', plateNo: 'NEW' })
      .expect(201)

    expect(await grantOf(fx.users.bgUserA1a.id)).toBeNull()
    expect(await grantOf(fx.users.subUserA1a.id)).toBeNull()
  })

  it('revokes everyone in the BG when a vehicle is deleted', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    await request(app).delete(`/api/vehicles/${fx.vehicles.v4.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(await grantOf(fx.users.bgUserA1a.id)).toBeNull()
  })

  it('revokes when a user’s role changes', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.subUserA1a))
    await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}`)
      .set(auth(fx.tokens.ggbAdminA))
      .send({ role: 'BG_USER', bgId: fx.bgA1a.id })
      .expect(200)
    expect(await grantOf(fx.users.subUserA1a.id)).toBeNull()
  })

  it('revokes at Flespi before a cascade deletes the account', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.subUserA1a))
    const before = await grantOf(fx.users.subUserA1a.id)

    // Deleting the BG cascades the user away; the Flespi token must not survive it.
    await request(app).delete(`/api/bgs/${fx.bgA1a.id}`).set(auth(fx.tokens.ggbAdminA)).expect(200)

    expect(minted.get(before.flespiTokenId).deleted).toBe(true)
    expect(await prisma.flespiGrant.count()).toBe(0)
  })

  it('revokes at Flespi before a user is deleted directly', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.subUserA1a))
    const before = await grantOf(fx.users.subUserA1a.id)
    await request(app)
      .delete(`/api/users/${fx.users.subUserA1a.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .expect(200)
    expect(minted.get(before.flespiTokenId).deleted).toBe(true)
  })

  it('a vehicle change does not disturb a Super Admin’s all-devices grant', async () => {
    await request(app).post('/api/flespi/token').set(auth(fx.tokens.superAdmin))
    await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ bgId: fx.bgA1a.id, imei: '888888888888888', plateNo: 'N2' })
      .expect(201)
    // Still there: "all devices" cannot go stale, so churning it would be waste.
    expect(await grantOf(fx.users.superAdmin.id)).not.toBeNull()
  })
})

describe('login', () => {
  it('returns a grant alongside the session', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dispatch@alhabtoorlog.ae', password: 'Test@123456' })
    expect(res.status).toBe(200)
    expect(res.body.flespi?.token).toMatch(/^mock-key-\d+$/)
    expect(res.body.flespi?.deviceCount).toBe(2)
  })

  it('still logs in when Flespi is down — auth does not depend on it', async () => {
    installFlespiMock({ failCreate: true })
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dispatch@alhabtoorlog.ae', password: 'Test@123456' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(res.body.flespi).toBeNull()
  })
})
