/**
 * Reallocation History (lib/vehicleMoves.js, GET /api/vehicle-moves): a row per
 * vehicle each time it lands under another branch, group or GGB.
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

const moves = (token, query = {}) => request(app).get('/api/vehicle-moves').query(query).set(auth(token))
const put = (v, body) => request(app).put(`/api/vehicles/${v.id}`).set(auth(fx.tokens.bgUserA1a)).send({ imei: v.imei, plateNo: v.plateNo, ...body })

describe('vehicle edit', () => {
  it('records a new branch, naming the BG when the vehicle had none', async () => {
    const v1 = fx.vehicles.v1
    expect((await put(v1, { branchId: fx.branches.yard.id })).status).toBe(200)
    expect((await put(fx.vehicles.v4, { branchId: fx.branches.depot.id })).status).toBe(200)

    const res = await moves(fx.tokens.superAdmin)
    expect(res.status).toBe(200)
    const byPlate = Object.fromEntries(res.body.data.map(m => [m.vehicleLabel, m]))
    expect(byPlate['PLATE-1']).toMatchObject({ level: 'branch', fromName: 'Mussafah Depot', toName: 'Al Ain Yard', movedByName: 'hassan@alhabtoorlog.ae', imei: v1.imei })
    expect(byPlate['PLATE-4']).toMatchObject({ level: 'branch', fromName: fx.bgA1a.name, toName: 'Mussafah Depot' })
    expect(byPlate['PLATE-1'].bg.name).toBe(fx.bgA1a.name)
  })

  it('records nothing when the branch and group stay', async () => {
    expect((await put(fx.vehicles.v1, { branchId: fx.branches.depot.id, make: 'Volvo' })).status).toBe(200)
    expect((await moves(fx.tokens.superAdmin)).body.data).toHaveLength(0)
  })
})

describe('BG and group moves', () => {
  it('records every vehicle of a BG moved to a group of another GGB, at both levels', async () => {
    expect((await request(app).post(`/api/bgs/${fx.bgA1b.id}/move`).set(auth(fx.tokens.superAdmin)).send({ groupId: fx.groupB1.id })).status).toBe(200)
    const rows = (await moves(fx.tokens.superAdmin)).body.data
    expect(rows).toHaveLength(4) // v5 and v6, group and GGB each
    expect(rows.filter(m => m.level === 'group').map(m => [m.fromName, m.toName])).toEqual([['Dubai Metro', 'Cold Chain Division'], ['Dubai Metro', 'Cold Chain Division']])
    expect(rows.filter(m => m.level === 'ggb')[0]).toMatchObject({ fromName: 'Gulf Telematics', toName: 'Emirates Fleet Systems', movedByName: expect.any(String) })
  })

  it('records a group moved to another GGB for each of its vehicles', async () => {
    await request(app).post(`/api/groups/${fx.groupA1.id}/move`).set(auth(fx.tokens.superAdmin)).send({ ggbId: fx.ggbB.id })
    const rows = (await moves(fx.tokens.superAdmin)).body.data
    expect(rows).toHaveLength(6)
    expect(new Set(rows.map(m => m.level))).toEqual(new Set(['ggb']))
  })
})

describe('GET /api/vehicle-moves', () => {
  it('is scoped like the vehicles and filters by date', async () => {
    await put(fx.vehicles.v1, { branchId: fx.branches.yard.id })
    await put(fx.vehicles.v3, { branchId: fx.branches.depot.id })
    expect((await moves(fx.tokens.bgUserB1a)).body.data).toHaveLength(0)
    // The sub-user holds v1 and v2 only.
    expect((await moves(fx.tokens.subUserA1a)).body.data.map(m => m.vehicleLabel)).toEqual(['PLATE-1'])
    const later = new Date(Date.now() + 60_000).toISOString()
    expect((await moves(fx.tokens.superAdmin, { from: later })).body.data).toHaveLength(0)
    expect((await moves(fx.tokens.superAdmin, { from: 'yesterday' })).status).toBe(400)
  })
})

describe('POST /api/vehicles/:id/transfer', () => {
  const transfer = (token, v, body) => request(app).post(`/api/vehicles/${v.id}/transfer`).set(auth(token)).send(body)

  it('moves one vehicle to another Business Group and leaves the old assignments behind', async () => {
    const v1 = fx.vehicles.v1
    const res = await transfer(fx.tokens.groupAdminA1, v1, { bgId: fx.bgA1b.id, branchId: fx.branches.jebelAli.id })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ bgId: fx.bgA1b.id, branchId: fx.branches.jebelAli.id })
    expect(res.body.stripped.subuserAssignments).toBe(1) // subUserA1a held v1
    // The old BG no longer has it; its sub-user lost it.
    expect((await request(app).get('/api/vehicles').set(auth(fx.tokens.bgUserA1a))).body.data.map(v => v.id)).not.toContain(v1.id)
    expect((await request(app).get('/api/vehicles').set(auth(fx.tokens.subUserA1a))).body.data.map(v => v.id)).toEqual([fx.vehicles.v2.id])

    const [m] = (await moves(fx.tokens.superAdmin)).body.data
    expect(m).toMatchObject({ level: 'bg', fromName: fx.bgA1a.name, toName: `${fx.bgA1b.name} / Jebel Ali Hub`, fromBgId: fx.bgA1a.id, bgId: fx.bgA1b.id })
    // The BG it left still sees the move out; a BG with nothing to do with it does not.
    expect((await moves(fx.tokens.bgUserA1a)).body.data.map(x => x.level)).toEqual(['bg'])
    expect((await moves(fx.tokens.bgUserB1a)).body.data).toHaveLength(0)
  })

  it('needs both Business Groups in reach, and a different one', async () => {
    expect((await transfer(fx.tokens.bgUserA1a, fx.vehicles.v1, { bgId: fx.bgB1a.id })).status).toBe(404)
    expect((await transfer(fx.tokens.groupAdminA1, fx.vehicles.v1, { bgId: fx.bgA1a.id })).status).toBe(400)
    expect((await transfer(fx.tokens.subUserA1a, fx.vehicles.v1, { bgId: fx.bgA1b.id })).status).toBe(403)
  })
})

describe('tracker history', () => {
  it('records a tracker installed with a new vehicle, swapped on an edit, and taken out on delete', async () => {
    const created = await request(app).post('/api/vehicles').set(auth(fx.tokens.bgUserA1a)).send({ bgId: fx.bgA1a.id, imei: '869999000011111', plateNo: 'NEW-1' })
    expect(created.status).toBe(201)
    const id = created.body.data.id
    await request(app).put(`/api/vehicles/${id}`).set(auth(fx.tokens.bgUserA1a)).send({ imei: '869999000022222', plateNo: 'NEW-1' })
    await request(app).delete(`/api/vehicles/${id}`).set(auth(fx.tokens.bgUserA1a))

    // The swap's two rows share a moment, so compare without order.
    const rows = (await moves(fx.tokens.superAdmin, { level: 'device' })).body.data
      .map(m => [m.imei, m.fromName, m.toName, m.vehicleId]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))
    expect(rows).toEqual([
      ['869999000011111', 'NEW-1', null, null],
      ['869999000011111', null, 'NEW-1', null],
      ['869999000022222', 'NEW-1', null, null],
      ['869999000022222', null, 'NEW-1', null],
    ])
  })
})

describe('PUT /api/vehicles/:id/branch', () => {
  const place = (token, v, branchId) => request(app).put(`/api/vehicles/${v.id}/branch`).set(auth(token)).send({ branchId })

  it('puts a vehicle in another branch of its BG, records it, and can take it out again', async () => {
    const v1 = fx.vehicles.v1
    const res = await place(fx.tokens.bgUserA1a, v1, fx.branches.yard.id)
    expect(res.status).toBe(200)
    expect(res.body.data.branchId).toBe(fx.branches.yard.id)
    expect((await place(fx.tokens.bgUserA1a, v1, null)).body.data.branchId).toBeNull()
    const rows = (await moves(fx.tokens.superAdmin)).body.data.map(m => [m.fromName, m.toName]).reverse()
    expect(rows).toEqual([['Mussafah Depot', 'Al Ain Yard'], ['Al Ain Yard', fx.bgA1a.name]])
  })

  it('refuses a branch of another BG and a sub-user', async () => {
    expect((await place(fx.tokens.bgUserA1a, fx.vehicles.v1, fx.branches.jebelAli.id)).status).toBe(400)
    expect((await place(fx.tokens.subUserA1a, fx.vehicles.v1, fx.branches.yard.id)).status).toBe(403)
  })
})

