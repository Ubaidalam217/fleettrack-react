/**
 * The core requirement: every role sees exactly its scope, and nothing outside it
 * is reachable by guessing an id.
 *
 * Structured as a table rather than as prose tests, because the property being
 * checked is "these six roles see these six different sets" — and a table makes a
 * filter that accidentally widens show up as one failing row with the expected and
 * actual counts side by side.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

const ids = res => res.body.data.map(r => r.id).sort()
const sorted = arr => [...arr].sort()

describe('GET /api/bgs — business group visibility', () => {
  it('SUPER_ADMIN sees all four', async () => {
    const res = await request(app).get('/api/bgs').set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    expect(ids(res)).toEqual(sorted([fx.bgA1a.id, fx.bgA1b.id, fx.bgA2.id, fx.bgB1a.id]))
  })

  it('GGB_ADMIN sees only its own GGB’s BGs', async () => {
    const a = await request(app).get('/api/bgs').set(auth(fx.tokens.ggbAdminA))
    expect(ids(a)).toEqual(sorted([fx.bgA1a.id, fx.bgA1b.id, fx.bgA2.id]))

    const b = await request(app).get('/api/bgs').set(auth(fx.tokens.ggbAdminB))
    expect(ids(b)).toEqual([fx.bgB1a.id])
  })

  it('GROUP_ADMIN sees only its group’s BGs — not the ungrouped BG in the same GGB', async () => {
    const res = await request(app).get('/api/bgs').set(auth(fx.tokens.groupAdminA1))
    expect(ids(res)).toEqual(sorted([fx.bgA1a.id, fx.bgA1b.id]))
    expect(ids(res)).not.toContain(fx.bgA2.id)
  })

  it('a GROUP_ADMIN of an empty group sees nothing', async () => {
    const res = await request(app).get('/api/bgs').set(auth(fx.tokens.groupAdminA2))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('BG_USER sees only its own BG', async () => {
    const res = await request(app).get('/api/bgs').set(auth(fx.tokens.bgUserA1a))
    expect(ids(res)).toEqual([fx.bgA1a.id])
  })

  it('SUB_USER sees only its own BG', async () => {
    const res = await request(app).get('/api/bgs').set(auth(fx.tokens.subUserA1a))
    expect(ids(res)).toEqual([fx.bgA1a.id])
  })
})

describe('GET /api/ggbs and /api/groups — upward visibility', () => {
  it('SUPER_ADMIN sees both GGBs; a GGB admin sees only its own', async () => {
    const su = await request(app).get('/api/ggbs').set(auth(fx.tokens.superAdmin))
    expect(ids(su)).toEqual(sorted([fx.ggbA.id, fx.ggbB.id]))

    const a = await request(app).get('/api/ggbs').set(auth(fx.tokens.ggbAdminA))
    expect(ids(a)).toEqual([fx.ggbA.id])
  })

  it('a BG user and a sub-user see no GGBs at all — the tier above is not theirs', async () => {
    expect((await request(app).get('/api/ggbs').set(auth(fx.tokens.bgUserA1a))).body.data).toEqual([])
    expect((await request(app).get('/api/ggbs').set(auth(fx.tokens.subUserA1a))).body.data).toEqual([])
  })

  it('a GGB admin sees its GGB’s groups; a group admin sees only its own', async () => {
    const ggb = await request(app).get('/api/groups').set(auth(fx.tokens.ggbAdminA))
    expect(ids(ggb)).toEqual(sorted([fx.groupA1.id, fx.groupA2.id]))

    const group = await request(app).get('/api/groups').set(auth(fx.tokens.groupAdminA1))
    expect(ids(group)).toEqual([fx.groupA1.id])

    const bg = await request(app).get('/api/groups').set(auth(fx.tokens.bgUserA1a))
    expect(bg.body.data).toEqual([])
  })
})

describe('GET /api/vehicles — the scope table', () => {
  const expected = () => [
    ['superAdmin', ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9']],
    ['ggbAdminA', ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']],
    ['ggbAdminB', ['v8', 'v9']],
    ['groupAdminA1', ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']],
    ['groupAdminA2', []],
    ['bgUserA1a', ['v1', 'v2', 'v3', 'v4']],
    ['bgUserB1a', ['v8', 'v9']],
    ['subUserA1a', ['v1', 'v2']],
  ]

  for (const [who, keys] of expected()) {
    it(`${who} sees exactly ${keys.length} vehicle(s): ${keys.join(' ') || '(none)'}`, async () => {
      const res = await request(app).get('/api/vehicles').set(auth(fx.tokens[who]))
      expect(res.status).toBe(200)
      expect(ids(res)).toEqual(sorted(keys.map(k => fx.vehicles[k].id)))
    })
  }

  it('a sub-user sees exactly its two assigned vehicles, not its BG’s other two', async () => {
    const res = await request(app).get('/api/vehicles').set(auth(fx.tokens.subUserA1a))
    expect(ids(res)).toEqual(sorted([fx.vehicles.v1.id, fx.vehicles.v2.id]))
    expect(ids(res)).not.toContain(fx.vehicles.v3.id)
    expect(ids(res)).not.toContain(fx.vehicles.v4.id)
  })

  it('a branch assignment does not grant that branch’s vehicles', async () => {
    // The sub-user is assigned the depot branch, which holds v1, and bay1 below it
    // holds v2 — but the grant comes from SubuserVehicle, not from the branch. v3
    // is in `yard`, unassigned either way, and stays invisible.
    const res = await request(app).get('/api/vehicles').set(auth(fx.tokens.subUserA1a))
    expect(res.body.data).toHaveLength(2)
  })

  it('a query filter can only narrow, never widen', async () => {
    // Asking for another tenant's BG returns nothing rather than that BG's fleet.
    const res = await request(app)
      .get('/api/vehicles')
      .query({ bgId: fx.bgB1a.id })
      .set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })
})

describe('GET /api/me/vehicles — what the Live Map will subscribe to', () => {
  it('returns IMEIs for each role’s own scope', async () => {
    const bg = await request(app).get('/api/me/vehicles').set(auth(fx.tokens.bgUserA1a))
    expect(bg.status).toBe(200)
    expect(bg.body.count).toBe(4)
    expect(bg.body.data.every(v => /^\d{10,20}$/.test(v.imei))).toBe(true)

    const sub = await request(app).get('/api/me/vehicles').set(auth(fx.tokens.subUserA1a))
    expect(sub.body.count).toBe(2)
    expect(sorted(sub.body.data.map(v => v.imei))).toEqual(
      sorted([fx.vehicles.v1.imei, fx.vehicles.v2.imei])
    )

    const su = await request(app).get('/api/me/vehicles').set(auth(fx.tokens.superAdmin))
    expect(su.body.count).toBe(9)
  })
})

describe('GET /api/branches — branch visibility', () => {
  it('a BG user sees its whole tree; a sub-user sees only assigned branches', async () => {
    const bg = await request(app).get('/api/branches').set(auth(fx.tokens.bgUserA1a))
    expect(ids(bg)).toEqual(
      sorted([fx.branches.depot.id, fx.branches.bay1.id, fx.branches.nightShift.id, fx.branches.yard.id])
    )

    const sub = await request(app).get('/api/branches').set(auth(fx.tokens.subUserA1a))
    expect(ids(sub)).toEqual([fx.branches.depot.id])
  })

  it('a GGB admin sees branches across its BGs but none from the other GGB', async () => {
    const res = await request(app).get('/api/branches').set(auth(fx.tokens.ggbAdminA))
    expect(ids(res)).toContain(fx.branches.jebelAli.id)
    expect(ids(res)).not.toContain(fx.branches.sharjah.id)
  })
})

describe('GET /api/users — account visibility', () => {
  it('a BG user sees its own BG’s accounts only', async () => {
    const res = await request(app).get('/api/users').set(auth(fx.tokens.bgUserA1a))
    const emails = res.body.data.map(u => u.email)
    expect(emails).toContain('hassan@alhabtoorlog.ae')
    expect(emails).toContain('dispatch@alhabtoorlog.ae')
    expect(emails).not.toContain('y.kareem@emiratescold.ae')
    expect(emails).not.toContain('super@fleetmax.test')
  })

  it('a sub-user sees only itself', async () => {
    const res = await request(app).get('/api/users').set(auth(fx.tokens.subUserA1a))
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe(fx.users.subUserA1a.id)
  })

  it('a GGB admin sees accounts at every tier beneath it, and not the other GGB’s', async () => {
    const res = await request(app).get('/api/users').set(auth(fx.tokens.ggbAdminA))
    const emails = res.body.data.map(u => u.email)
    expect(emails).toContain('ggba@fleetmax.test')
    expect(emails).toContain('groupa1@fleetmax.test')
    expect(emails).toContain('hassan@alhabtoorlog.ae')
    expect(emails).toContain('dispatch@alhabtoorlog.ae')
    expect(emails).not.toContain('y.kareem@emiratescold.ae')
    expect(emails).not.toContain('ggbb@fleetmax.test')
  })

  it('never includes a password hash in a list or a single read', async () => {
    const list = await request(app).get('/api/users').set(auth(fx.tokens.superAdmin))
    expect(JSON.stringify(list.body)).not.toContain('$2')

    const one = await request(app)
      .get(`/api/users/${fx.users.subUserA1a.id}`)
      .set(auth(fx.tokens.superAdmin))
    expect(one.body.data.passwordHash).toBeUndefined()
  })
})

describe('GET /api/alerts — alert visibility', () => {
  it('is confined to the caller’s BGs', async () => {
    const a = await request(app).get('/api/alerts').set(auth(fx.tokens.bgUserA1a))
    expect(ids(a)).toEqual([fx.alerts.alertA1a.id])

    const b = await request(app).get('/api/alerts').set(auth(fx.tokens.bgUserB1a))
    expect(ids(b)).toEqual([fx.alerts.alertB1a.id])

    const su = await request(app).get('/api/alerts').set(auth(fx.tokens.superAdmin))
    expect(ids(su)).toEqual(sorted([fx.alerts.alertA1a.id, fx.alerts.alertB1a.id]))
  })

  it('shows a sub-user a fleet-wide alert in its own BG', async () => {
    const res = await request(app).get('/api/alerts').set(auth(fx.tokens.subUserA1a))
    expect(ids(res)).toEqual([fx.alerts.alertA1a.id])
  })
})

// ── Cross-scope access by guessing an id ─────────────────────────────────────

describe('cross-scope reads are 404, not 403', () => {
  const cases = () => [
    ['vehicle in another GGB', 'bgUserA1a', () => `/api/vehicles/${fx.vehicles.v8.id}`],
    ['vehicle in the same BG but unassigned', 'subUserA1a', () => `/api/vehicles/${fx.vehicles.v3.id}`],
    ['vehicle in another BG of the same group', 'bgUserA1a', () => `/api/vehicles/${fx.vehicles.v5.id}`],
    ['BG in another GGB', 'ggbAdminA', () => `/api/bgs/${fx.bgB1a.id}`],
    ['ungrouped BG in the same GGB', 'groupAdminA1', () => `/api/bgs/${fx.bgA2.id}`],
    ['branch in another BG', 'bgUserA1a', () => `/api/branches/${fx.branches.sharjah.id}`],
    ['unassigned branch in the same BG', 'subUserA1a', () => `/api/branches/${fx.branches.yard.id}`],
    ['account in another BG', 'bgUserA1a', () => `/api/users/${fx.users.bgUserB1a.id}`],
    ['the super admin account', 'bgUserA1a', () => `/api/users/${fx.users.superAdmin.id}`],
    ['alert in another BG', 'bgUserA1a', () => `/api/alerts/${fx.alerts.alertB1a.id}`],
    ['GGB above its own BG', 'bgUserA1a', () => `/api/ggbs/${fx.ggbA.id}`],
    ['group above its own BG', 'bgUserA1a', () => `/api/groups/${fx.groupA1.id}`],
  ]

  for (const [what, who, path] of cases()) {
    it(`${who} reading a ${what} gets 404`, async () => {
      const res = await request(app).get(path()).set(auth(fx.tokens[who]))
      expect(res.status).toBe(404)
    })
  }

  it('gives the same 404 for an id that does not exist at all', async () => {
    // The whole point: "not yours" and "not there" must be indistinguishable, or
    // the API is an oracle for enumerating another tenant's ids.
    const notYours = await request(app)
      .get(`/api/vehicles/${fx.vehicles.v8.id}`)
      .set(auth(fx.tokens.bgUserA1a))
    const notThere = await request(app)
      .get('/api/vehicles/clz0000000000000000000000')
      .set(auth(fx.tokens.bgUserA1a))

    expect(notYours.status).toBe(notThere.status)
    expect(notYours.body.error.message).toBe(notThere.body.error.message)
  })
})

describe('cross-scope writes are rejected', () => {
  it('a BG user cannot update or delete another BG’s vehicle', async () => {
    const update = await request(app)
      .put(`/api/vehicles/${fx.vehicles.v8.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ imei: '999999999999999' })
    expect(update.status).toBe(404)

    const del = await request(app)
      .delete(`/api/vehicles/${fx.vehicles.v8.id}`)
      .set(auth(fx.tokens.bgUserA1a))
    expect(del.status).toBe(404)
  })

  it('a BG user cannot create a vehicle in another BG', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ bgId: fx.bgB1a.id, imei: '111111111111111', plateNo: 'X' })
    // 404 on the parent, so a POST cannot confirm that another tenant's bgId is
    // real.
    expect(res.status).toBe(404)
  })

  it('a group admin creates BGs in its own group, with no GGB named', async () => {
    // It cannot see any GGB, so it cannot be asked to name one — the GGB and the
    // group are both derived from who it is.
    const res = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.groupAdminA1))
      .send({ name: 'New Metro BG', email: 'newmetro@x.test' })

    expect(res.status).toBe(201)
    expect(res.body.data.ggbId).toBe(fx.ggbA.id)
    expect(res.body.data.groupId).toBe(fx.groupA1.id)

    // And it can see what it just created.
    const list = await request(app).get('/api/bgs').set(auth(fx.tokens.groupAdminA1))
    expect(list.body.data.map(b => b.id)).toContain(res.body.data.id)
  })

  it('a group admin cannot aim a BG at another GGB or another group', async () => {
    const otherGgb = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.groupAdminA1))
      .send({ name: 'Smuggled', email: 'smuggled@x.test', ggbId: fx.ggbB.id })
    expect(otherGgb.status).toBe(404)

    const otherGroup = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.groupAdminA1))
      .send({ name: 'Smuggled2', email: 'smuggled2@x.test', groupId: fx.groupA2.id })
    expect(otherGroup.status).toBe(400)
  })

  it('a GGB admin creates BGs in its own GGB without naming it', async () => {
    const res = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.ggbAdminA))
      .send({ name: 'Own-group BG', email: 'owngroup@x.test' })

    expect(res.status).toBe(201)
    expect(res.body.data.ggbId).toBe(fx.ggbA.id)
    // No group named → the BG is its own group, which is a legitimate state.
    expect(res.body.data.groupId).toBeNull()
  })

  it('a GGB admin cannot aim a BG at the other GGB', async () => {
    const res = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.ggbAdminA))
      .send({ name: 'Smuggled3', email: 'smuggled3@x.test', ggbId: fx.ggbB.id })
    expect(res.status).toBe(404)
  })

  it('a super admin must name the GGB — there is nothing to infer', async () => {
    const res = await request(app)
      .post('/api/bgs')
      .set(auth(fx.tokens.superAdmin))
      .send({ name: 'Nowhere', email: 'nowhere@x.test' })
    expect(res.status).toBe(400)
    expect(res.body.error.details.ggbId).toBeTruthy()
  })

  it('a BG user cannot create a branch in another BG', async () => {
    const res = await request(app)
      .post('/api/branches')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Trespass', bgId: fx.bgB1a.id })
    expect(res.status).toBe(404)
  })

  it('a GGB admin cannot touch the other GGB', async () => {
    expect(
      (
        await request(app)
          .put(`/api/ggbs/${fx.ggbB.id}`)
          .set(auth(fx.tokens.ggbAdminA))
          .send({ name: 'Renamed' })
      ).status
    ).toBe(403) // its role may not write GGBs at all

    expect(
      (
        await request(app)
          .post('/api/groups')
          .set(auth(fx.tokens.ggbAdminA))
          .send({ name: 'Trespass', ggbId: fx.ggbB.id })
      ).status
    ).toBe(404) // may write groups, but not in that GGB
  })

  it('a sub-user is read-only everywhere', async () => {
    const token = fx.tokens.subUserA1a
    const attempts = [
      request(app).post('/api/vehicles').set(auth(token)).send({ bgId: fx.bgA1a.id, imei: '123456789012345' }),
      request(app).put(`/api/vehicles/${fx.vehicles.v1.id}`).set(auth(token)).send({ imei: '123456789012345' }),
      request(app).delete(`/api/vehicles/${fx.vehicles.v1.id}`).set(auth(token)),
      request(app).post('/api/branches').set(auth(token)).send({ name: 'X', bgId: fx.bgA1a.id }),
      request(app).delete(`/api/branches/${fx.branches.depot.id}`).set(auth(token)),
      request(app).post('/api/users').set(auth(token)).send({ email: 'x@y.test', role: 'SUB_USER', bgId: fx.bgA1a.id }),
      request(app).post('/api/alerts').set(auth(token)).send({ name: 'X', bgId: fx.bgA1a.id, maxTemp: 10 }),
      request(app).post('/api/bgs').set(auth(token)).send({ name: 'X', email: 'x@y.test', ggbId: fx.ggbA.id }),
    ]
    for (const attempt of attempts) {
      const res = await attempt
      // 403 rather than 404: nothing is being probed here, the caller's own role
      // is the reason.
      expect(res.status).toBe(403)
    }
  })

  it('a sub-user cannot edit even its own account row', async () => {
    const res = await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}`)
      .set(auth(fx.tokens.subUserA1a))
      .send({ role: 'BG_USER', bgId: fx.bgA1a.id })
    expect(res.status).toBe(403)
  })
})

describe('privilege escalation', () => {
  it('a BG user cannot create a BG user, a group admin or a super admin', async () => {
    for (const role of ['BG_USER', 'GROUP_ADMIN', 'GGB_ADMIN', 'SUPER_ADMIN']) {
      const res = await request(app)
        .post('/api/users')
        .set(auth(fx.tokens.bgUserA1a))
        .send({
          email: `escalate-${role}@alhabtoorlog.ae`,
          role,
          bgId: fx.bgA1a.id,
          ggbId: fx.ggbA.id,
          groupId: fx.groupA1.id,
        })
      expect(res.status, role).toBe(403)
    }
  })

  it('a BG user can create a sub-user in its own BG', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ email: 'NewSub@AlHabtoorLog.ae', role: 'SUB_USER', bgId: fx.bgA1a.id })

    expect(res.status).toBe(201)
    expect(res.body.data.email).toBe('newsub@alhabtoorlog.ae')
    expect(res.body.data.role).toBe('SUB_USER')
    expect(res.body.data.mustChangePassword).toBe(true)
    expect(res.body.defaultPassword).toBe('Aa@123456')
    expect(res.body.data.passwordHash).toBeUndefined()
  })

  it('a BG user cannot promote one of its own sub-users', async () => {
    const res = await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ role: 'BG_USER', bgId: fx.bgA1a.id })
    expect(res.status).toBe(403)
  })

  it('a BG user cannot create a sub-user in another BG', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ email: 'intruder@emiratescold.ae', role: 'SUB_USER', bgId: fx.bgB1a.id })
    expect(res.status).toBe(404)
  })

  it('a GGB admin cannot create an account in the other GGB', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.ggbAdminA))
      .send({ email: 'intruder2@emiratescold.ae', role: 'BG_USER', bgId: fx.bgB1a.id })
    expect(res.status).toBe(404)
  })

  it('a role needs the scope link that matches it', async () => {
    const noBg = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.superAdmin))
      .send({ email: 'nobg@x.test', role: 'BG_USER' })
    expect(noBg.status).toBe(400)
    expect(noBg.body.error.details.bgId).toBeTruthy()

    const noGroup = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.superAdmin))
      .send({ email: 'nogroup@x.test', role: 'GROUP_ADMIN' })
    expect(noGroup.status).toBe(400)
  })

  it('stores only the scope link the role uses', async () => {
    // A BG user created with a stray ggbId must not keep it: a later role change
    // would turn the stale value live.
    const res = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.superAdmin))
      .send({
        email: 'clean@alhabtoorlog.ae',
        role: 'BG_USER',
        bgId: fx.bgA1a.id,
        ggbId: fx.ggbB.id,
        groupId: fx.groupB1.id,
      })
    expect(res.status).toBe(201)
    expect(res.body.data.scope).toEqual({ ggbId: null, groupId: null, bgId: fx.bgA1a.id })
  })

  it('nobody can delete their own account', async () => {
    const res = await request(app)
      .delete(`/api/users/${fx.users.superAdmin.id}`)
      .set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(403)
  })
})
