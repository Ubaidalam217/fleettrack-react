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
