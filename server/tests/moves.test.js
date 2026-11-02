/**
 * Moving a Group or a BG with everything under it (lib/moves.js):
 * POST /api/groups/:id/move and POST /api/bgs/:id/move.
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

const moveGroup = (token, id, body) => request(app).post(`/api/groups/${id}/move`).set(auth(token)).send(body)
const moveBg = (token, id, body) => request(app).post(`/api/bgs/${id}/move`).set(auth(token)).send(body)

describe('POST /api/groups/:id/move', () => {
  it('moves the group and every BG under it to the new GGB; the rest follows', async () => {
    const res = await moveGroup(fx.tokens.superAdmin, fx.groupA1.id, { ggbId: fx.ggbB.id })
    expect(res.status).toBe(200)
    expect(res.body.data.moved).toMatchObject({ businessGroups: 2, vehicles: 6 })

    const group = await prisma.group.findUnique({ where: { id: fx.groupA1.id } })
    expect(group.ggbId).toBe(fx.ggbB.id)
    const bgs = await prisma.businessGroup.findMany({ where: { groupId: fx.groupA1.id } })
    expect(bgs.map(b => b.ggbId)).toEqual([fx.ggbB.id, fx.ggbB.id])

    // Access follows at once: the new GGB's admin sees the moved BGs, the old one does not.
    const newAdmin = await request(app).get('/api/bgs').set(auth(fx.tokens.ggbAdminB))
    expect(newAdmin.body.data.map(b => b.id)).toEqual(expect.arrayContaining([fx.bgA1a.id, fx.bgA1b.id]))
    const oldAdmin = await request(app).get('/api/bgs').set(auth(fx.tokens.ggbAdminA))
    expect(oldAdmin.body.data.map(b => b.id)).toEqual([fx.bgA2.id])
    // The group admin still has its group, BGs and vehicles.
    const groupAdmin = await request(app).get('/api/vehicles').set(auth(fx.tokens.groupAdminA1))
    expect(groupAdmin.body.data).toHaveLength(6)
  })

  it('is Super Admin only, and refuses the GGB it is already in', async () => {
    expect((await moveGroup(fx.tokens.ggbAdminA, fx.groupA1.id, { ggbId: fx.ggbB.id })).status).toBe(403)
    expect((await moveGroup(fx.tokens.superAdmin, fx.groupA1.id, { ggbId: fx.ggbA.id })).status).toBe(400)
    expect((await moveGroup(fx.tokens.superAdmin, fx.groupA1.id, { ggbId: 'nope' })).status).toBe(400)
  })
})

describe('POST /api/bgs/:id/move', () => {
  it('moves a BG into a group of another GGB, with its branches, vehicles and accounts', async () => {
    const res = await moveBg(fx.tokens.superAdmin, fx.bgA1a.id, { groupId: fx.groupB1.id })
    expect(res.status).toBe(200)
    expect(res.body.data.to).toEqual({ ggbId: fx.ggbB.id, groupId: fx.groupB1.id })
    expect(res.body.data.moved).toMatchObject({ businessGroups: 1, branches: 4, vehicles: 4 })

    const bg = await prisma.businessGroup.findUnique({ where: { id: fx.bgA1a.id } })
    expect([bg.ggbId, bg.groupId]).toEqual([fx.ggbB.id, fx.groupB1.id])
    // BG user and sub-user stay with their BG.
    const me = await request(app).get('/api/vehicles').set(auth(fx.tokens.bgUserA1a))
    expect(me.body.data).toHaveLength(4)
    // The old group admin lost it.
    const old = await request(app).get('/api/vehicles').set(auth(fx.tokens.groupAdminA1))
    expect(old.body.data).toHaveLength(2)
  })

  it('moves a BG directly under a GGB with no group', async () => {
    const res = await moveBg(fx.tokens.superAdmin, fx.bgA1b.id, { ggbId: fx.ggbB.id, groupId: null })
    expect(res.status).toBe(200)
    const bg = await prisma.businessGroup.findUnique({ where: { id: fx.bgA1b.id } })
    expect([bg.ggbId, bg.groupId]).toEqual([fx.ggbB.id, null])
  })

  it('lets a GGB admin move only inside its own GGB', async () => {
    expect((await moveBg(fx.tokens.ggbAdminA, fx.bgA2.id, { groupId: fx.groupA2.id })).status).toBe(200)
    expect((await moveBg(fx.tokens.ggbAdminA, fx.bgA1a.id, { groupId: fx.groupB1.id })).status).toBe(403)
    expect((await moveBg(fx.tokens.groupAdminA1, fx.bgA1a.id, { groupId: fx.groupA2.id })).status).toBe(403)
    expect((await moveBg(fx.tokens.bgUserA1a, fx.bgA1a.id, { groupId: fx.groupA2.id })).status).toBe(403)
  })

  it('refuses a move to where it already is', async () => {
    expect((await moveBg(fx.tokens.superAdmin, fx.bgA1a.id, { groupId: fx.groupA1.id })).status).toBe(400)
  })
})
