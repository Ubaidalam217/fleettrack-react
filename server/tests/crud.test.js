/**
 * The relational rules: branch parentage, the subtree delete and its side
 * effects, sub-user assignment, and alert scope.
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

describe('branch parentage', () => {
  it('accepts a parent in the same BG, at any depth', async () => {
    const res = await request(app)
      .post('/api/branches')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Night Shift — Team B', bgId: fx.bgA1a.id, parentBranchId: fx.branches.nightShift.id })
    expect(res.status).toBe(201)
    expect(res.body.data.parentBranchId).toBe(fx.branches.nightShift.id)
  })

  it('rejects a parent in a different BG', async () => {
    const res = await request(app)
      .post('/api/branches')
      .set(auth(fx.tokens.superAdmin))
      .send({ name: 'Mismatched', bgId: fx.bgA1a.id, parentBranchId: fx.branches.sharjah.id })
    expect(res.status).toBe(400)
  })

  it('rejects a branch as its own parent', async () => {
    const res = await request(app)
      .put(`/api/branches/${fx.branches.depot.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Mussafah Depot', parentBranchId: fx.branches.depot.id })
    expect(res.status).toBe(400)
  })

  it('rejects a cycle through a descendant', async () => {
    // depot → bay1 → nightShift. Making nightShift the parent of depot would
    // detach the whole chain from the tree.
    const res = await request(app)
      .put(`/api/branches/${fx.branches.depot.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Mussafah Depot', parentBranchId: fx.branches.nightShift.id })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/sub-branch/i)
  })

  it('allows re-parenting to a sibling', async () => {
    const res = await request(app)
      .put(`/api/branches/${fx.branches.yard.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Al Ain Yard', parentBranchId: fx.branches.depot.id })
    expect(res.status).toBe(200)
    expect(res.body.data.parentBranchId).toBe(fx.branches.depot.id)
  })

  it('returns the tree with depths when asked', async () => {
    const res = await request(app)
      .get('/api/branches')
      .query({ bgId: fx.bgA1a.id, tree: '1' })
      .set(auth(fx.tokens.bgUserA1a))

    expect(res.status).toBe(200)
    const byName = Object.fromEntries(res.body.data.map(b => [b.name, b.depth]))
    expect(byName['Mussafah Depot']).toBe(0)
    expect(byName['Mussafah — Bay 1']).toBe(1)
    expect(byName['Bay 1 — Night Shift']).toBe(2)
    expect(byName['Al Ain Yard']).toBe(0)
  })
})

describe('DELETE /api/branches/:id — subtree, detach, strip', () => {
  it('deletes the whole subtree', async () => {
    const res = await request(app)
      .delete(`/api/branches/${fx.branches.depot.id}`)
      .set(auth(fx.tokens.bgUserA1a))

    expect(res.status).toBe(200)
    // depot + bay1 + nightShift
    expect(res.body.data.removed).toBe(3)
    expect(res.body.data.subBranches).toBe(2)

    const left = await prisma.branch.findMany({ where: { bgId: fx.bgA1a.id } })
    expect(left.map(b => b.id)).toEqual([fx.branches.yard.id])
  })

  it('detaches the subtree’s vehicles instead of deleting them', async () => {
    const res = await request(app)
      .delete(`/api/branches/${fx.branches.depot.id}`)
      .set(auth(fx.tokens.bgUserA1a))

    // v1 was in depot, v2 in bay1.
    expect(res.body.data.vehiclesDetached).toBe(2)

    const v1 = await prisma.vehicle.findUnique({ where: { id: fx.vehicles.v1.id } })
    const v2 = await prisma.vehicle.findUnique({ where: { id: fx.vehicles.v2.id } })
    expect(v1).not.toBeNull()
    expect(v2).not.toBeNull()
    expect(v1.branchId).toBeNull()
    expect(v2.branchId).toBeNull()
    // And still in their BG.
    expect(v1.bgId).toBe(fx.bgA1a.id)
  })

  it('strips the sub-user’s branch assignment', async () => {
    const before = await prisma.subuserBranch.count({ where: { userId: fx.users.subUserA1a.id } })
    expect(before).toBe(1)

    const res = await request(app)
      .delete(`/api/branches/${fx.branches.depot.id}`)
      .set(auth(fx.tokens.bgUserA1a))
    expect(res.body.data.subuserAssignmentsStripped).toBe(1)

    const after = await prisma.subuserBranch.count({ where: { userId: fx.users.subUserA1a.id } })
    expect(after).toBe(0)
  })

  it('leaves the sub-user’s vehicle assignments alone', async () => {
    await request(app)
      .delete(`/api/branches/${fx.branches.depot.id}`)
      .set(auth(fx.tokens.bgUserA1a))

    // The vehicles were only detached from a branch; the grant is a separate join.
    const res = await request(app).get('/api/vehicles').set(auth(fx.tokens.subUserA1a))
    expect(res.body.data.map(v => v.id).sort()).toEqual(
      [fx.vehicles.v1.id, fx.vehicles.v2.id].sort()
    )
  })

  it('deletes only a leaf when the branch has no children', async () => {
    const res = await request(app)
      .delete(`/api/branches/${fx.branches.yard.id}`)
      .set(auth(fx.tokens.bgUserA1a))
    expect(res.body.data.removed).toBe(1)
    expect(res.body.data.subBranches).toBe(0)
    expect(res.body.data.vehiclesDetached).toBe(1) // v3
  })
})

describe('DELETE /api/vehicles/:id', () => {
  it('removes the vehicle from sub-user assignments', async () => {
    const res = await request(app)
      .delete(`/api/vehicles/${fx.vehicles.v1.id}`)
      .set(auth(fx.tokens.bgUserA1a))

    expect(res.status).toBe(200)
    expect(res.body.data.subuserAssignmentsStripped).toBe(1)

    // The sub-user's count drops rather than reporting a vehicle it cannot see.
    const sub = await request(app).get('/api/vehicles').set(auth(fx.tokens.subUserA1a))
    expect(sub.body.data.map(v => v.id)).toEqual([fx.vehicles.v2.id])
  })

  it('removes the vehicle from an alert’s explicit scope', async () => {
    const res = await request(app)
      .delete(`/api/vehicles/${fx.vehicles.v8.id}`)
      .set(auth(fx.tokens.bgUserB1a))

    expect(res.body.data.alertAssignmentsStripped).toBe(1)

    const alert = await request(app)
      .get(`/api/alerts/${fx.alerts.alertB1a.id}`)
      .set(auth(fx.tokens.bgUserB1a))
    expect(alert.body.data.vehicleIds).toEqual([])
  })
})

describe('vehicle odometer and group', () => {
  // Added in Phase 2: the frontend's Vehicle form collects both, and before these
  // columns existed a save silently discarded what the operator typed.
  it('round-trips odometer as free text', async () => {
    const created = await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ bgId: fx.bgA1a.id, imei: '869999000011111', plateNo: 'ODO-1', odometer: '184320' })

    expect(created.status).toBe(201)
    expect(created.body.data.odometer).toBe('184320')

    const updated = await request(app)
      .put(`/api/vehicles/${created.body.data.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ imei: '869999000011111', plateNo: 'ODO-1', odometer: '184999' })
    expect(updated.body.data.odometer).toBe('184999')

    // Cleared, not left at the old value — the form submits '' for an emptied box.
    const cleared = await request(app)
      .put(`/api/vehicles/${created.body.data.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ imei: '869999000011111', plateNo: 'ODO-1', odometer: '' })
    expect(cleared.body.data.odometer).toBeNull()
  })

  it('accepts a group in the same GGB and rejects one from another tenant', async () => {
    // bgA2 has no group of its own, which is the only case the frontend leaves the
    // Group field selectable in.
    const ok = await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.ggbAdminA))
      .send({ bgId: fx.bgA2.id, imei: '869999000022222', plateNo: 'GRP-1', groupId: fx.groupA1.id })
    expect(ok.status).toBe(201)
    expect(ok.body.data.groupId).toBe(fx.groupA1.id)

    const cross = await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.superAdmin))
      .send({ bgId: fx.bgA2.id, imei: '869999000033333', plateNo: 'GRP-2', groupId: fx.groupB1.id })
    expect(cross.status).toBe(400)
    expect(cross.body.error.details.groupId).toBeTruthy()
  })

  it('leaves a vehicle in place when its group is deleted', async () => {
    const v = await request(app)
      .post('/api/vehicles')
      .set(auth(fx.tokens.ggbAdminA))
      .send({ bgId: fx.bgA2.id, imei: '869999000044444', plateNo: 'GRP-3', groupId: fx.groupA2.id })
    expect(v.status).toBe(201)

    await request(app).delete(`/api/groups/${fx.groupA2.id}`).set(auth(fx.tokens.ggbAdminA))

    // groupId is deliberately a plain column with no relation: a foreign key would
    // cascade a group delete into the fleet, and a vehicle must outlive an optional
    // grouping tier.
    const still = await prisma.vehicle.findUnique({ where: { id: v.body.data.id } })
    expect(still).not.toBeNull()
    expect(still.plateNo).toBe('GRP-3')
  })
})

describe('sub-user assignment', () => {
  it('replaces the vehicle set', async () => {
    const res = await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}/vehicles`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ids: [fx.vehicles.v3.id, fx.vehicles.v4.id] })

    expect(res.status).toBe(200)
    expect(res.body.data.vehicleIds.sort()).toEqual([fx.vehicles.v3.id, fx.vehicles.v4.id].sort())

    // And what the sub-user can actually see follows immediately.
    const seen = await request(app).get('/api/vehicles').set(auth(fx.tokens.subUserA1a))
    expect(seen.body.data.map(v => v.id).sort()).toEqual(
      [fx.vehicles.v3.id, fx.vehicles.v4.id].sort()
    )
  })

  it('rejects a vehicle from another BG, even for a super admin', async () => {
    const res = await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}/vehicles`)
      .set(auth(fx.tokens.superAdmin))
      .send({ ids: [fx.vehicles.v1.id, fx.vehicles.v8.id] })

    expect(res.status).toBe(400)
    expect(res.body.error.details.vehicleIds).toContain(fx.vehicles.v8.id)

    // Nothing was applied — the whole replacement is one transaction.
    const held = await prisma.subuserVehicle.findMany({ where: { userId: fx.users.subUserA1a.id } })
    expect(held.map(h => h.vehicleId).sort()).toEqual([fx.vehicles.v1.id, fx.vehicles.v2.id].sort())
  })

  it('rejects a vehicle from another BG in the same group', async () => {
    const res = await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}/vehicles`)
      .set(auth(fx.tokens.groupAdminA1))
      .send({ ids: [fx.vehicles.v5.id] })
    expect(res.status).toBe(400)
  })

  it('clears the set with an empty list', async () => {
    const res = await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}/vehicles`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ids: [] })

    expect(res.status).toBe(200)
    expect(res.body.data.vehicleIds).toEqual([])

    // A sub-user with no assignments sees nothing — not everything.
    const seen = await request(app).get('/api/vehicles').set(auth(fx.tokens.subUserA1a))
    expect(seen.body.data).toEqual([])
    const map = await request(app).get('/api/me/vehicles').set(auth(fx.tokens.subUserA1a))
    expect(map.body.count).toBe(0)
  })

  it('replaces the branch set, and rejects a branch from another BG', async () => {
    const ok = await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}/branches`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ids: [fx.branches.yard.id, fx.branches.bay1.id] })
    expect(ok.status).toBe(200)
    expect(ok.body.data.branchIds.sort()).toEqual([fx.branches.yard.id, fx.branches.bay1.id].sort())

    const bad = await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}/branches`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ ids: [fx.branches.sharjah.id] })
    expect(bad.status).toBe(400)
  })

  it('refuses assignment on a non-sub-user account', async () => {
    const res = await request(app)
      .put(`/api/users/${fx.users.bgUserA1a.id}/vehicles`)
      .set(auth(fx.tokens.ggbAdminA))
      .send({ ids: [fx.vehicles.v1.id] })
    expect(res.status).toBe(403)
  })

  it('cannot be driven from another BG', async () => {
    const res = await request(app)
      .put(`/api/users/${fx.users.subUserA1a.id}/vehicles`)
      .set(auth(fx.tokens.bgUserB1a))
      .send({ ids: [] })
    expect(res.status).toBe(404)
  })

  it('accepts assignments at creation time', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.bgUserA1a))
      .send({
        email: 'yard.dispatch@alhabtoorlog.ae',
        role: 'SUB_USER',
        shortName: 'Yard Dispatch',
        bgId: fx.bgA1a.id,
        vehicleIds: [fx.vehicles.v3.id],
        branchIds: [fx.branches.yard.id],
        userSetting: { timeZone: 'UTC+04:00 - Asia/Dubai', immobilization: true },
        screenAccess: { '/tracking': 'view', '/settings/vehicle': 'none' },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.vehicleIds).toEqual([fx.vehicles.v3.id])
    expect(res.body.data.branchIds).toEqual([fx.branches.yard.id])
    // The tab blobs round-trip untouched.
    expect(res.body.data.userSetting.timeZone).toBe('UTC+04:00 - Asia/Dubai')
    expect(res.body.data.screenAccess['/settings/vehicle']).toBe('none')
  })

  it('rejects assignments on a non-sub-user at creation time', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(fx.tokens.ggbAdminA))
      .send({
        email: 'bgwithvehicles@alhabtoorlog.ae',
        role: 'BG_USER',
        bgId: fx.bgA1a.id,
        vehicleIds: [fx.vehicles.v1.id],
      })
    expect(res.status).toBe(400)
  })
})

describe('alerts', () => {
  it('creates a fleet-wide alert and stores no vehicle ids', async () => {
    const res = await request(app)
      .post('/api/alerts')
      .set(auth(fx.tokens.bgUserA1a))
      .send({
        name: 'Cabin overheat',
        type: 'temperature',
        bgId: fx.bgA1a.id,
        allVehicles: true,
        // Sent, and deliberately discarded: "all" is a mode, not a snapshot.
        vehicleIds: [fx.vehicles.v1.id],
        maxTemp: 45,
        notify: { inApp: true, email: false, sms: false },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.allVehicles).toBe(true)
    expect(res.body.data.vehicleIds).toEqual([])
  })

  it('creates an explicit alert and keeps the ids', async () => {
    const res = await request(app)
      .post('/api/alerts')
      .set(auth(fx.tokens.bgUserA1a))
      .send({
        name: 'Two vans',
        bgId: fx.bgA1a.id,
        allVehicles: false,
        vehicleIds: [fx.vehicles.v3.id, fx.vehicles.v4.id],
        minTemp: 2,
        maxTemp: 8,
      })
    expect(res.status).toBe(201)
    expect(res.body.data.vehicleIds.sort()).toEqual([fx.vehicles.v3.id, fx.vehicles.v4.id].sort())
  })

  it('rejects a vehicle from another BG', async () => {
    const res = await request(app)
      .post('/api/alerts')
      .set(auth(fx.tokens.superAdmin))
      .send({
        name: 'Cross tenant',
        bgId: fx.bgA1a.id,
        allVehicles: false,
        vehicleIds: [fx.vehicles.v8.id],
        maxTemp: 10,
      })
    expect(res.status).toBe(400)
  })

  it('rejects an explicit alert with no vehicles, and a temperature alert with no bounds', async () => {
    const noVehicles = await request(app)
      .post('/api/alerts')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Empty', bgId: fx.bgA1a.id, allVehicles: false, vehicleIds: [], maxTemp: 10 })
    expect(noVehicles.status).toBe(400)

    const noBounds = await request(app)
      .post('/api/alerts')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Boundless', bgId: fx.bgA1a.id, allVehicles: true })
    expect(noBounds.status).toBe(400)
  })

  it('rejects a minimum above the maximum', async () => {
    const res = await request(app)
      .post('/api/alerts')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Inverted', bgId: fx.bgA1a.id, allVehicles: true, minTemp: 40, maxTemp: 5 })
    expect(res.status).toBe(400)
  })

  it('accepts a one-sided bound', async () => {
    const res = await request(app)
      .post('/api/alerts')
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Ceiling only', bgId: fx.bgA1a.id, allVehicles: true, minTemp: '', maxTemp: 45 })
    expect(res.status).toBe(201)
    expect(res.body.data.minTemp).toBeNull()
    expect(res.body.data.maxTemp).toBe(45)
  })

  it('switching to all-vehicles clears the stored ids', async () => {
    const created = await request(app)
      .post('/api/alerts')
      .set(auth(fx.tokens.bgUserA1a))
      .send({
        name: 'Narrow then wide',
        bgId: fx.bgA1a.id,
        allVehicles: false,
        vehicleIds: [fx.vehicles.v3.id],
        maxTemp: 30,
      })

    const updated = await request(app)
      .put(`/api/alerts/${created.body.data.id}`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({ name: 'Narrow then wide', allVehicles: true, maxTemp: 30 })

    expect(updated.status).toBe(200)
    expect(updated.body.data.vehicleIds).toEqual([])
    const rows = await prisma.alertVehicle.count({ where: { alertId: created.body.data.id } })
    expect(rows).toBe(0)
  })
})

describe('cascade deletes', () => {
  it('deleting a BG takes its branches, vehicles, users and alerts', async () => {
    const res = await request(app)
      .delete(`/api/bgs/${fx.bgA1a.id}`)
      .set(auth(fx.tokens.ggbAdminA))

    expect(res.status).toBe(200)
    expect(res.body.data.removed.branches).toBe(4)
    expect(res.body.data.removed.vehicles).toBe(4)
    expect(res.body.data.removed.alerts).toBe(1)

    expect(await prisma.branch.count({ where: { bgId: fx.bgA1a.id } })).toBe(0)
    expect(await prisma.vehicle.count({ where: { bgId: fx.bgA1a.id } })).toBe(0)
    expect(await prisma.user.count({ where: { bgId: fx.bgA1a.id } })).toBe(0)
    // Including the join rows for the sub-user that went with it.
    expect(await prisma.subuserVehicle.count()).toBe(0)
  })

  it('deleting a group detaches its BGs rather than deleting them', async () => {
    const res = await request(app)
      .delete(`/api/groups/${fx.groupA1.id}`)
      .set(auth(fx.tokens.ggbAdminA))

    expect(res.status).toBe(200)
    expect(res.body.data.businessGroupsDetached).toBe(2)
    expect(res.body.data.groupAdminsRemoved).toBe(1)

    const bg = await prisma.businessGroup.findUnique({ where: { id: fx.bgA1a.id } })
    expect(bg).not.toBeNull()
    // Null groupId is the documented "BG is its own group" state.
    expect(bg.groupId).toBeNull()
    expect(await prisma.vehicle.count({ where: { bgId: fx.bgA1a.id } })).toBe(4)
  })

  it('deleting a GGB takes everything under it and nothing beside it', async () => {
    const res = await request(app)
      .delete(`/api/ggbs/${fx.ggbA.id}`)
      .set(auth(fx.tokens.superAdmin))

    expect(res.status).toBe(200)
    expect(res.body.data.removed.businessGroups).toBe(3)
    expect(res.body.data.removed.vehicles).toBe(7)

    // The other GGB is untouched.
    expect(await prisma.businessGroup.count({ where: { ggbId: fx.ggbB.id } })).toBe(1)
    expect(await prisma.vehicle.count()).toBe(2)
  })
})

describe('reset-password', () => {
  it('puts an account back on the default and re-arms the first-login gate', async () => {
    const res = await request(app)
      .post(`/api/users/${fx.users.subUserA1a.id}/reset-password`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data.password).toBe('Aa@123456')
    expect(res.body.data.mustChangePassword).toBe(true)

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dispatch@alhabtoorlog.ae', password: 'Aa@123456' })
    expect(login.status).toBe(200)
    expect(login.body.mustChangePassword).toBe(true)

    // And the gate is closed until they change it.
    expect((await request(app).get('/api/vehicles').set(auth(login.body.token))).status).toBe(428)
  })

  it('cannot be aimed at an account outside the caller’s scope', async () => {
    const res = await request(app)
      .post(`/api/users/${fx.users.subUserA1a.id}/reset-password`)
      .set(auth(fx.tokens.bgUserB1a))
      .send({})
    expect(res.status).toBe(404)
  })

  it('cannot be aimed at an account at or above the caller’s rank', async () => {
    const res = await request(app)
      .post(`/api/users/${fx.users.bgUserA1a.id}/reset-password`)
      .set(auth(fx.tokens.bgUserA1a))
      .send({})
    expect(res.status).toBe(403)
  })
})
