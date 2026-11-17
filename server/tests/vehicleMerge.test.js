/**
 * Merge a stale vehicle into the one that has its tracker now, archive the
 * stale one (lib/trackers.js), the rename history, and the searchable history
 * (GET /api/vehicle-moves ?q= &user= &vehicleId=). No Flespi here: the token
 * is empty, so nothing can reach it.
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

const merge = (source, target, body = {}, token = fx.tokens.bgUserA1a) =>
  request(app).post(`/api/vehicles/${source.id}/merge`).set(auth(token)).send({ targetId: target.id, ...body })
const moves = (token, query = {}) => request(app).get('/api/vehicle-moves').query(query).set(auth(token))

/** v3 (stale "Test Bench") with everything a vehicle can carry; v4 is the vehicle with its tracker now. */
async function staleWithEverything() {
  const { v3, v4, v1 } = fx.vehicles
  const driver = await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Ubaid', vehicleId: v3.id } })
  await prisma.driverAssignment.create({ data: { driverId: driver.id, vehicleId: v3.id, role: 'Primary', startDate: new Date('2026-11-01T00:00:00Z') } })
  await prisma.vehicleDocument.create({ data: { vehicleId: v3.id, name: 'Mulkiya', docType: 'Registration' } })
  await prisma.expense.create({ data: { bgId: fx.bgA1a.id, vehicleId: v3.id, vehicleLabel: 'PLATE-3', category: 'Fuel', type: 'Variable', amount: 120 } })
  const rule = await prisma.reminderRule.create({ data: { bgId: fx.bgA1a.id, name: 'Oil', type: 'Oil Change' } })
  const rule2 = await prisma.reminderRule.create({ data: { bgId: fx.bgA1a.id, name: 'Tyres', type: 'Tyre' } })
  await prisma.reminderVehicle.create({ data: { ruleId: rule.id, vehicleId: v3.id, startDate: new Date() } })
  await prisma.reminderVehicle.create({ data: { ruleId: rule2.id, vehicleId: v3.id, startDate: new Date() } })
  await prisma.reminderVehicle.create({ data: { ruleId: rule2.id, vehicleId: v4.id, startDate: new Date() } })
  await prisma.vehicleShare.create({ data: { vehicleId: v3.id, level: 'bg', targetId: fx.bgA1b.id, bgId: fx.bgA1b.id } })
  await prisma.subuserVehicle.create({ data: { userId: fx.users.subUserA1a.id, vehicleId: v3.id } })
  await prisma.vehicleMove.create({ data: { bgId: fx.bgA1a.id, vehicleId: v3.id, vehicleLabel: 'PLATE-3', imei: v3.imei, level: 'branch', fromName: 'A', toName: 'B' } })
  return { driver, rule, rule2, v1, v3, v4 }
}

describe('merge', () => {
  it('dry run says what moves and changes nothing', async () => {
    const { v3, v4 } = await staleWithEverything()
    const res = await merge(v3, v4, { dryRun: true })
    expect(res.status).toBe(200)
    expect(res.body.data.plan).toMatchObject({
      moves: 1, assignments: 1, documents: 1, expenses: 1, reminders: 1, remindersAlreadyOnTarget: 1, shares: 1, subusers: 1,
      driver: { name: 'Ubaid', outcome: 'moved' }, trackerRemoved: v3.imei,
    })
    expect(res.body.data.plan.summary).toMatch(/^Moved: 1 history row, 1 driver assignment, 1 document, 1 expense, 1 reminder/)
    expect((await prisma.vehicle.findUnique({ where: { id: v3.id } })).deletedAt).toBeNull()
  })

  it('moves history, driver, papers, expenses, reminders, shares and access, then archives the stale row', async () => {
    const { driver, rule, rule2, v3, v4 } = await staleWithEverything()
    const res = await merge(v3, v4, { note: 'same truck, tracker swapped in Flespi' })
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(v4.id)

    const stale = await prisma.vehicle.findUnique({ where: { id: v3.id } })
    expect(stale).toMatchObject({ imei: null, mergedIntoId: v4.id, deletedBy: 'hassan@alhabtoorlog.ae' })
    expect(stale.deletedAt).toBeInstanceOf(Date)

    expect(await prisma.driver.findUnique({ where: { id: driver.id } })).toMatchObject({ vehicleId: v4.id })
    expect(await prisma.driverAssignment.count({ where: { vehicleId: v4.id, driverId: driver.id, endDate: null } })).toBe(1)
    expect(await prisma.vehicleDocument.count({ where: { vehicleId: v4.id } })).toBe(1)
    expect(await prisma.expense.findFirst({ where: { vehicleId: v4.id } })).toMatchObject({ vehicleLabel: 'PLATE-3' })
    expect((await prisma.reminderVehicle.findMany({ where: { vehicleId: v4.id } })).map(r => r.ruleId).sort()).toEqual([rule.id, rule2.id].sort())
    expect(await prisma.reminderVehicle.count({ where: { vehicleId: v3.id } })).toBe(0)
    expect(await prisma.vehicleShare.count({ where: { vehicleId: v4.id, targetId: fx.bgA1b.id } })).toBe(1)
    expect(await prisma.subuserVehicle.count({ where: { vehicleId: v4.id, userId: fx.users.subUserA1a.id } })).toBe(1)

    // Its history is the target's now, with the merge explained; the archive and the tracker out stay on the stale row.
    const onTarget = await prisma.vehicleMove.findMany({ where: { vehicleId: v4.id }, orderBy: { movedAt: 'asc' } })
    expect(onTarget.map(m => m.level).sort()).toEqual(['branch', 'merge'])
    const mergeRow = onTarget.find(m => m.level === 'merge')
    expect(mergeRow).toMatchObject({ fromName: 'PLATE-3', toName: 'PLATE-4', imei: v3.imei })
    expect(mergeRow.note).toMatch(/^same truck, tracker swapped in Flespi — Moved: /)
    const onStale = await prisma.vehicleMove.findMany({ where: { vehicleId: v3.id } })
    expect(onStale.map(m => [m.level, m.imei, m.fromName]).sort()).toEqual([['archive', v3.imei, 'PLATE-3'], ['device', v3.imei, 'PLATE-3']])

    // Gone from every list and every write; the history still finds it by its old plate and IMEI.
    const list = await request(app).get('/api/vehicles').set(auth(fx.tokens.superAdmin))
    expect(list.body.data.map(v => v.id)).not.toContain(v3.id)
    expect((await request(app).get(`/api/vehicles/${v3.id}`).set(auth(fx.tokens.superAdmin))).status).toBe(404)
    expect((await merge(v3, v4)).status).toBe(404)
    const byImei = await moves(fx.tokens.bgUserA1a, { q: v3.imei })
    expect(byImei.body.data.map(m => m.level).sort()).toEqual(['archive', 'branch', 'device', 'merge'])
    // Its IMEI is free for another vehicle.
    expect(await prisma.vehicle.count({ where: { imei: v3.imei } })).toBe(0)
  })

  it('leaves the target its own driver: the stale row’s driver is freed, its past stays', async () => {
    const { driver, v3, v4 } = await staleWithEverything()
    const own = await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Kamal', vehicleId: v4.id } })
    const res = await merge(v3, v4)
    expect(res.status).toBe(200)
    expect(res.body.merge.plan.driver).toMatchObject({ name: 'Ubaid', outcome: 'unassigned', targetDriver: 'Kamal' })
    expect(await prisma.driver.findUnique({ where: { id: driver.id } })).toMatchObject({ vehicleId: null })
    expect(await prisma.driver.findUnique({ where: { id: own.id } })).toMatchObject({ vehicleId: v4.id })
    const a = await prisma.driverAssignment.findFirst({ where: { driverId: driver.id } })
    expect(a.vehicleId).toBe(v4.id)
    expect(a.endDate).toBeInstanceOf(Date)
  })

  it('only within one Business Group, by someone who owns both', async () => {
    const { v3 } = fx.vehicles
    const cross = await merge(v3, fx.vehicles.v5, {}, fx.tokens.superAdmin)
    expect(cross.status).toBe(400)
    expect(cross.body.error.message).toMatch(/another Business Group \(Desert Rose Transport\)/)
    expect((await merge(v3, v3)).status).toBe(400)
    // Another BG's user cannot see either; a sub-user cannot write vehicles.
    expect((await merge(v3, fx.vehicles.v4, {}, fx.tokens.bgUserB1a)).status).toBe(404)
    expect([403, 404]).toContain((await merge(fx.vehicles.v1, fx.vehicles.v2, {}, fx.tokens.subUserA1a)).status)
    expect(await prisma.vehicle.count({ where: { deletedAt: { not: null } } })).toBe(0)
  })
})

describe('history', () => {
  it('records a rename of the plate and of the fleet no.', async () => {
    const v = fx.vehicles.v1
    const put = body => request(app).put(`/api/vehicles/${v.id}`).set(auth(fx.tokens.bgUserA1a)).send({ imei: v.imei, ...body })
    expect((await put({ plateNo: 'AD 149', fleetNo: 'FL-01' })).status).toBe(200)
    expect((await put({ plateNo: 'AD 149', fleetNo: 'FL-99' })).status).toBe(200)
    expect((await put({ plateNo: 'AD 149', fleetNo: 'FL-99', make: 'Volvo' })).status).toBe(200)
    const rows = (await moves(fx.tokens.bgUserA1a, { level: 'rename' })).body.data.reverse()
    expect(rows.map(r => [r.fromName, r.toName, r.note])).toEqual([
      ['PLATE-1', 'AD 149', null],
      ['Fleet no. FL-01', 'Fleet no. FL-99', null],
    ])
    expect(rows[0].vehicleLabel).toBe('AD 149')
  })

  it('is searched by plate, old or new IMEI, user and vehicle, inside the caller’s scope', async () => {
    const v = fx.vehicles.v1
    await request(app).post(`/api/vehicles/${v.id}/tracker`).set(auth(fx.tokens.bgUserA1a)).send({ imei: '869 166 081 174 012', note: 'faulty' })
    await request(app).post(`/api/vehicles/${fx.vehicles.v8.id}/tracker/remove`).set(auth(fx.tokens.bgUserB1a)).send({})

    const oldImei = await moves(fx.tokens.bgUserA1a, { q: v.imei })
    expect(oldImei.body.data.map(m => m.toName ? 'in' : 'out').sort()).toEqual(['in', 'out']) // the "in" row names it in its note
    const newImei = await moves(fx.tokens.bgUserA1a, { q: '869-166-081' })
    expect(newImei.body.data).toHaveLength(2)
    expect((await moves(fx.tokens.bgUserA1a, { q: 'faulty' })).body.data).toHaveLength(2)
    expect((await moves(fx.tokens.bgUserA1a, { user: 'HASSAN' })).body.data).toHaveLength(2)
    expect((await moves(fx.tokens.bgUserA1a, { user: 'y.kareem' })).body.data).toHaveLength(0)
    expect((await moves(fx.tokens.superAdmin, { vehicleId: fx.vehicles.v8.id })).body.data).toHaveLength(1)
    expect((await moves(fx.tokens.superAdmin, { vehicleId: v.id, limit: 1 })).body.data).toHaveLength(1)

    // Another BG sees none of v1's; the sub-user sees v1's (assigned) and not v8's.
    expect((await moves(fx.tokens.bgUserB1a, { q: v.imei })).body.data).toHaveLength(0)
    expect((await moves(fx.tokens.subUserA1a)).body.data.every(m => m.vehicleId === v.id)).toBe(true)
    expect((await moves(fx.tokens.subUserA1a)).body.data).toHaveLength(2)
  })
})
