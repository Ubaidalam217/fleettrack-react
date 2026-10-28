/**
 * Flespi access: the scope each role reaches (buildAcl), the single-token proxy
 * that enforces it, and the retired per-user token endpoints.
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
import { auth, resetDb, seedFixture, TEST_PASSWORD } from './factories.js'
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

      /**
       * The real API REFUSES an empty id list, verbatim as below.
       *
       * Mirrored here because the mock's permissiveness is what let the bug ship:
       * an account whose scope reached no device sent `ids: []`, Flespi rejected it,
       * the endpoint answered 502, and the browser sat on "Reconnecting…" forever.
       * With this, any future attempt to mint for an empty scope fails in the suite.
       */
      const emptyIds = (spec.access?.acl ?? []).some(e => Array.isArray(e.ids) && e.ids.length === 0)
      if (emptyIds) {
        return json({
          errors: [{
            reason: '#/[0]/access/acl[0]/ids: array items number 0 is less than allowed minimum 1',
          }],
        }, 400)
      }

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

    // Anything else under gw/devices: what the proxy forwards. Echoed back.
    if (u.includes('/gw/devices/')) return json({ result: [{ forwarded: u, method }] })

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

// ── Per-user tokens are retired ─────────────────────────────────────────────
//
// The client asked for ONE Flespi key. Every login used to mint a token, which
// filled the Flespi panel with them; now nothing mints and the browser goes
// through /api/flespi/proxy with the single server-side Master token.

describe('per-user Flespi tokens are retired', () => {
  it('POST /api/flespi/token answers 410 and mints nothing', async () => {
    const res = await request(app).post('/api/flespi/token').set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(410)
    expect(res.body.error.code).toBe('FLESPI_TOKENS_RETIRED')
    expect(mintCount()).toBe(0)
  })

  it('login no longer mints a token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dispatch@alhabtoorlog.ae', password: TEST_PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(res.body.flespi).toBeNull()
    expect(mintCount()).toBe(0)
  })

  it('sign-out still deletes a token left over from before, at Flespi too', async () => {
    minted.set(777, { key: 'mock-key-777', acl: [], expire: 0, deleted: false })
    await prisma.flespiGrant.create({
      data: {
        userId: fx.users.bgUserA1a.id,
        flespiTokenId: 777,
        expiresAt: new Date(Date.now() + 3600_000),
        scopeHash: 'legacy',
      },
    })
    const res = await request(app).post('/api/flespi/revoke').set(auth(fx.tokens.bgUserA1a))
    expect(res.body.data.revoked).toBe(true)
    expect(minted.get(777).deleted).toBe(true)
    expect(await prisma.flespiGrant.count()).toBe(0)
  })
})

// ── The proxy ───────────────────────────────────────────────────────────────

/** Requests the proxy forwarded, i.e. everything except deviceMap()'s lookup. */
const forwards = () => calls.filter(c => !c.url.includes('fields=id,configuration'))
const proxy = path => `/api/flespi/proxy${path}`

describe('GET /api/flespi/proxy', () => {
  it('narrows "all" to a sub-user’s own devices and uses the Master token', async () => {
    const seen = []
    const base = globalThis.fetch
    vi.stubGlobal('fetch', (url, init = {}) => {
      seen.push({ url: String(url), auth: init.headers?.Authorization })
      return base(url, init)
    })
    const res = await request(app)
      .get(proxy('/gw/devices/all/telemetry/position.latitude'))
      .set(auth(fx.tokens.subUserA1a))
    expect(res.status).toBe(200)
    const fwd = seen.find(s => !s.url.includes('fields=id,configuration'))
    expect(fwd.url).toBe('https://flespi.io/gw/devices/101,102/telemetry/position.latitude')
    expect(fwd.auth).toBe('FlespiToken mock-master-token')
  })

  it('keeps the query string', async () => {
    const data = encodeURIComponent(JSON.stringify({ from: 1, to: 2 }))
    await request(app).get(proxy(`/gw/devices/101/messages?data=${data}`)).set(auth(fx.tokens.subUserA1a)).expect(200)
    expect(forwards().at(-1).url).toBe(`https://flespi.io/gw/devices/101/messages?data=${data}`)
  })

  it('answers 404 for a device outside the caller’s scope, without asking Flespi', async () => {
    const res = await request(app).get(proxy('/gw/devices/103/messages')).set(auth(fx.tokens.subUserA1a))
    expect(res.status).toBe(404)
    expect(forwards()).toHaveLength(0)
  })

  it('answers 404 when one id of a list is outside the scope', async () => {
    const res = await request(app).get(proxy('/gw/devices/101,103/messages')).set(auth(fx.tokens.subUserA1a))
    expect(res.status).toBe(404)
    expect(forwards()).toHaveLength(0)
  })

  it('answers an empty result for an account that reaches no device', async () => {
    const res = await request(app).get(proxy('/gw/devices/all')).set(auth(fx.tokens.groupAdminA2))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ result: [] })
    expect(forwards()).toHaveLength(0)
  })

  it('lets a Super Admin keep "all", so devices not in Settings stay visible', async () => {
    await request(app).get(proxy('/gw/devices/all/telemetry/x')).set(auth(fx.tokens.superAdmin)).expect(200)
    expect(forwards().at(-1).url).toBe('https://flespi.io/gw/devices/all/telemetry/x')
  })

  it('only reaches gw/devices', async () => {
    const res = await request(app).get(proxy('/platform/customer')).set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(404)
    expect(forwards()).toHaveLength(0)
  })

  it('rejects a malformed selector', async () => {
    const res = await request(app).get(proxy('/gw/devices/abc/messages')).set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(404)
  })

  it('passes a Flespi rate limit through as 429', async () => {
    vi.stubGlobal('fetch', url => {
      calls.push({ url: String(url), method: 'GET' })
      return Promise.resolve(new Response(JSON.stringify({ errors: [{ reason: 'blocked' }] }), {
        status: 429, headers: { 'Content-Type': 'application/json' },
      }))
    })
    const res = await request(app).get(proxy('/gw/devices/all')).set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(429)
  })

  it('requires a login', async () => {
    expect((await request(app).get(proxy('/gw/devices/all'))).status).toBe(401)
  })

  it('answers 503 when Flespi is not configured', async () => {
    H.flespiToken = undefined
    const res = await request(app).get(proxy('/gw/devices/all')).set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(503)
  })
})

describe('PUT /api/flespi/proxy', () => {
  it('a sub-user is read-only', async () => {
    const res = await request(app).put(proxy('/gw/devices/101/settings/getgps'))
      .set(auth(fx.tokens.subUserA1a)).send({ address: 'connection' })
    expect(res.status).toBe(403)
    expect(forwards()).toHaveLength(0)
  })

  it('a BG user can send Poll (a device setting) to its own device', async () => {
    await request(app).put(proxy('/gw/devices/101/settings/getgps'))
      .set(auth(fx.tokens.bgUserA1a)).send({ address: 'connection' }).expect(200)
    const fwd = forwards().at(-1)
    expect(fwd.method).toBe('PUT')
    expect(fwd.url).toBe('https://flespi.io/gw/devices/101/settings/getgps')
    expect(fwd.body).toEqual({ address: 'connection' })
  })

  it('a BG user can save its own device’s metadata', async () => {
    await request(app).put(proxy('/gw/devices/101'))
      .set(auth(fx.tokens.bgUserA1a)).send({ metadata: { fleet: {} } }).expect(200)
    expect(forwards().at(-1).url).toBe('https://flespi.io/gw/devices/101')
  })

  it('cannot write to another BG’s device', async () => {
    const res = await request(app).put(proxy('/gw/devices/105'))
      .set(auth(fx.tokens.bgUserA1a)).send({ metadata: {} })
    expect(res.status).toBe(404)
    expect(forwards()).toHaveLength(0)
  })

  it('cannot write to anything but a device or its setting', async () => {
    for (const path of ['/gw/devices/101/messages', '/gw/devices/all', '/gw/devices/101,102']) {
      const res = await request(app).put(proxy(path)).set(auth(fx.tokens.bgUserA1a)).send({})
      expect(res.status).toBe(403)
    }
    expect(forwards()).toHaveLength(0)
  })
})
