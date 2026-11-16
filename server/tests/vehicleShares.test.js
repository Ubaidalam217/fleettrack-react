/**
 * One vehicle in several places (VehicleShare — client, 2026-11-13: "One vehicle
 * can be assigned to multiple Group, BG, Branch"): who sees a shared vehicle,
 * that only its owner may change it, the share API, what a share removal and a
 * transfer take with them, and the alert engine on a shared vehicle.
 *
 * Flespi is mocked (devices 101-109 = v1-v9, as in flespi.test.js); nothing
 * here reaches the real account.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, FLESPI_TOKEN: 'mock-master-token' })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
const { clearDeviceCache } = await import('../src/lib/flespi.js')
const { runAlertPass } = await import('../src/lib/alertEngine.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
/** deviceId -> telemetry the mocked Flespi answers with. */
let telemetry = {}
/** Writes the mocked Flespi received. */
let puts = []

const NOW = Math.floor(Date.UTC(2026, 10, 14, 6, 0, 0) / 1000)

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  telemetry = {}
  puts = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const u = String(url)
    const method = (init.method ?? 'GET').toUpperCase()
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (method !== 'GET') { puts.push({ url: u, method }); return json({ result: [{}] }) }
    if (/\/gw\/devices\/\d+\/settings\/all/.test(u)) return json({ result: [] })
    if (u.includes('/gw/devices/all/telemetry/')) {
      return json({
        result: Object.entries(telemetry).map(([id, t]) => ({
          id: Number(id),
          telemetry: Object.fromEntries(Object.entries(t).map(([k, value]) => [k, { value, ts: t.timestamp }])),
        })),
      })
    }
    if (u.includes('/gw/devices/all')) {
      return json({ result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, configuration: { ident: `86307101123450${i + 1}` } })) })
    }
    return json({ result: [] })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearDeviceCache()
})

const as = key => auth(fx.tokens[key])
const share = (key, vehicles, level, targetId) =>
  request(app).post('/api/vehicle-shares/add').set(as(key)).send({ vehicleIds: vehicles.map(v => v.id), level, targetId })
const unshare = (key, vehicles, level, targetId) =>
  request(app).post('/api/vehicle-shares/remove').set(as(key)).send({ vehicleIds: vehicles.map(v => v.id), level, targetId })
const vehiclesOf = async key => {
  const res = await request(app).get('/api/vehicles').set(as(key))
  expect(res.status).toBe(200)
  return res.body.data
}
const plates = rows => rows.map(v => v.plateNo).sort()

// ── who sees it ─────────────────────────────────────────────────────────────

describe('visibility', () => {
  it('a BG share shows the vehicle to the target BG, read as shared, once for everyone', async () => {
    const { v1 } = fx.vehicles
    const res = await share('superAdmin', [v1], 'bg', fx.bgB1a.id)
    expect(res.status).toBe(200)
    expect(res.body.data.added).toEqual([v1.id])

    const b = await vehiclesOf('bgUserB1a')
    expect(plates(b)).toEqual(['PLATE-1', 'PLATE-8', 'PLATE-9'])
    const shared = b.find(v => v.id === v1.id)
    expect(shared.owned).toBe(false)
    expect(shared.shares).toEqual([expect.objectContaining({ level: 'bg', bgId: fx.bgB1a.id, label: fx.bgB1a.name })])
    expect(b.find(v => v.plateNo === 'PLATE-8').owned).toBe(true)

    // The owner sees where its vehicle went; the other GGB's admin sees it too.
    const a = await vehiclesOf('bgUserA1a')
    expect(a.find(v => v.id === v1.id)).toMatchObject({ owned: true, shares: [expect.objectContaining({ label: fx.bgB1a.name })] })
    expect(plates(await vehiclesOf('ggbAdminB'))).toEqual(['PLATE-1', 'PLATE-8', 'PLATE-9'])
    // Nobody gets it twice: a filter, not a join.
    expect(await vehiclesOf('superAdmin')).toHaveLength(9)
    expect(await vehiclesOf('ggbAdminA')).toHaveLength(7)

    const me = await request(app).get('/api/me/vehicles').set(as('bgUserB1a'))
    expect(me.body.count).toBe(3)
    expect(me.body.data.find(v => v.id === v1.id).owned).toBe(false)
    // ?bgId= takes the shared ones too.
    const byBg = await request(app).get('/api/vehicles').query({ bgId: fx.bgB1a.id }).set(as('superAdmin'))
    expect(plates(byBg.body.data)).toEqual(['PLATE-1', 'PLATE-8', 'PLATE-9'])
  })

  it('a non-owner never learns where else the vehicle is shared', async () => {
    const { v1 } = fx.vehicles
    await share('superAdmin', [v1], 'bg', fx.bgB1a.id)
    await share('superAdmin', [v1], 'bg', fx.bgA1b.id)
    const b = (await vehiclesOf('bgUserB1a')).find(v => v.id === v1.id)
    expect(b.shares.map(s => s.bgId)).toEqual([fx.bgB1a.id])
    const owner = (await vehiclesOf('bgUserA1a')).find(v => v.id === v1.id)
    expect(owner.shares.map(s => s.bgId).sort()).toEqual([fx.bgB1a.id, fx.bgA1b.id].sort())
  })

  it('a branch share reaches the branch, and a sub-user filed above it', async () => {
    const { v8 } = fx.vehicles
    // bay1 is under depot, the fixture sub-user's branch.
    expect((await share('superAdmin', [v8], 'branch', fx.branches.bay1.id)).status).toBe(200)
    expect(plates(await vehiclesOf('bgUserA1a'))).toContain('PLATE-8')
    expect(plates(await vehiclesOf('subUserA1a'))).toEqual(['PLATE-1', 'PLATE-2', 'PLATE-8'])
    const row = (await vehiclesOf('subUserA1a')).find(v => v.id === v8.id)
    expect(row).toMatchObject({ owned: false, shares: [expect.objectContaining({ level: 'branch', label: `${fx.bgA1a.name} / ${fx.branches.bay1.name}` })] })
  })

  it('a Group share reaches the Group admins, not the BG users under the Group', async () => {
    const { v7 } = fx.vehicles // bgA2, no group
    expect((await share('superAdmin', [v7], 'group', fx.groupA1.id)).status).toBe(200)
    expect(plates(await vehiclesOf('groupAdminA1'))).toContain('PLATE-7')
    expect(await vehiclesOf('groupAdminA1')).toHaveLength(7)
    expect(plates(await vehiclesOf('bgUserA1a'))).not.toContain('PLATE-7')
  })

  it('the Reallocation History shows the share to the owner and to the place it went', async () => {
    const { v1 } = fx.vehicles
    await share('superAdmin', [v1], 'bg', fx.bgB1a.id)
    await unshare('superAdmin', [v1], 'bg', fx.bgB1a.id)
    for (const key of ['bgUserA1a', 'bgUserB1a']) {
      const rows = (await request(app).get('/api/vehicle-moves').query({ level: 'share' }).set(as(key))).body.data
      expect(rows.map(r => [r.fromName, r.toName])).toEqual([[fx.bgB1a.name, null], [null, fx.bgB1a.name]])
    }
    expect((await request(app).get('/api/vehicle-moves').set(as('ggbAdminA'))).body.data).toHaveLength(2)
  })
})

// ── only the owner changes it ───────────────────────────────────────────────

describe('a shared vehicle is read-only where it is shared', () => {
  beforeEach(async () => {
    await share('superAdmin', [fx.vehicles.v1], 'bg', fx.bgB1a.id)
  })

  it('every vehicle write answers 404 to the place it is shared into', async () => {
    const { v1 } = fx.vehicles
    const B = as('bgUserB1a')
    expect((await request(app).get(`/api/vehicles/${v1.id}`).set(B)).body.data.owned).toBe(false)
    expect((await request(app).put(`/api/vehicles/${v1.id}`).set(B).send({ imei: v1.imei, plateNo: 'X' })).status).toBe(404)
    expect((await request(app).put(`/api/vehicles/${v1.id}/branch`).set(B).send({ branchId: fx.branches.sharjah.id })).status).toBe(404)
    expect((await request(app).patch(`/api/vehicles/${v1.id}/details`).set(B).send({ make: 'X' })).status).toBe(404)
    expect((await request(app).put(`/api/vehicles/${v1.id}/custom-fields`).set(B).send({ fields: [{ name: 'a', value: 'b' }] })).status).toBe(404)
    expect((await request(app).put(`/api/vehicles/${v1.id}/odometer`).set(B).send({ reading: 100 })).status).toBe(404)
    expect((await request(app).post(`/api/vehicles/${v1.id}/transfer`).set(B).send({ bgId: fx.bgB1a.id })).status).toBe(404)
    expect((await request(app).delete(`/api/vehicles/${v1.id}`).set(B)).status).toBe(404)
    expect(await prisma.vehicle.findUnique({ where: { id: v1.id }, select: { plateNo: true } })).toEqual({ plateNo: 'PLATE-1' })
  })

  it('no expense and no document can be written on it; its papers can be read', async () => {
    const { v1 } = fx.vehicles
    const B = as('bgUserB1a')
    const expense = await request(app).post('/api/expenses').set(B).send({
      vehicleId: v1.id, category: 'Variable', type: 'Fuel', expenseDate: '2026-11-05', fuelSource: 'Fuel card', amount: '50',
    })
    expect(expense.status).toBe(400)
    expect(await prisma.expense.count()).toBe(0)

    await prisma.vehicleDocument.create({ data: { vehicleId: v1.id, name: 'Mulkiya', docType: 'Registration' } })
    const docs = await request(app).get(`/api/vehicles/${v1.id}/documents`).set(B)
    expect(docs.status).toBe(200)
    expect(docs.body.data).toHaveLength(1)
    const add = await request(app).post(`/api/vehicles/${v1.id}/documents`).set(B).send({ name: 'Insurance', docType: 'Insurance' })
    expect(add.status).toBe(404)
    expect((await request(app).delete(`/api/vehicles/${v1.id}/documents/${docs.body.data[0].id}`).set(B)).status).toBe(404)
    // The owner still can.
    expect((await request(app).post(`/api/vehicles/${v1.id}/documents`).set(as('bgUserA1a')).send({ name: 'Insurance', docType: 'Insurance' })).status).toBe(201)
  })

  it('Flespi: the shared place reads the tracker but cannot write to it', async () => {
    const B = as('bgUserB1a')
    expect((await request(app).get('/api/flespi/proxy/gw/devices/101/telemetry/all').set(B)).status).toBe(200)
    const put = await request(app).put('/api/flespi/proxy/gw/devices/101').set(B).send({ metadata: { x: 1 } })
    expect(put.status).toBe(403)
    expect(puts).toHaveLength(0)
    // Its own vehicle, yes; the owner's side, yes.
    expect((await request(app).put('/api/flespi/proxy/gw/devices/108').set(B).send({ metadata: { x: 1 } })).status).toBe(200)
    expect((await request(app).put('/api/flespi/proxy/gw/devices/101').set(as('bgUserA1a')).send({ metadata: { x: 1 } })).status).toBe(200)
  })

  it('device settings: read-only for an administrator it is shared to', async () => {
    const res = await request(app).get('/api/device-settings/101').set(as('ggbAdminB'))
    expect(res.status).toBe(200)
    expect(res.body.data.canEdit).toBe(false)
    expect((await request(app).post('/api/device-settings/101/reset').set(as('ggbAdminB')).send({})).status).toBe(403)
    expect((await request(app).get('/api/device-settings/101').set(as('ggbAdminA'))).body.data.canEdit).toBe(true)
  })

  it('the shared BG cannot pass it on', async () => {
    const res = await share('bgUserB1a', [fx.vehicles.v1], 'branch', fx.branches.sharjah.id)
    expect(res.status).toBe(404)
  })
})

// ── the share API ───────────────────────────────────────────────────────────

describe('/api/vehicle-shares', () => {
  it('a BG user shares between its own branches, and nowhere else', async () => {
    const { v1 } = fx.vehicles
    const res = await share('bgUserA1a', [v1], 'branch', fx.branches.yard.id)
    expect(res.status).toBe(200)
    const row = (await vehiclesOf('bgUserA1a')).find(v => v.id === v1.id)
    expect(row.shares).toEqual([expect.objectContaining({ level: 'branch', label: `${fx.bgA1a.name} / ${fx.branches.yard.name}` })])
    // Another tenant's BG is not a place it can see: the same 404 as a made-up id.
    expect((await share('bgUserA1a', [v1], 'bg', fx.bgB1a.id)).status).toBe(404)
    expect((await share('bgUserA1a', [v1], 'group', fx.groupA1.id)).status).toBe(404)
    expect((await share('subUserA1a', [v1], 'branch', fx.branches.yard.id)).status).toBe(403)
  })

  it('skips the vehicle\'s own place and a repeat, and refuses a level it does not know', async () => {
    const { v1, v3 } = fx.vehicles
    const first = await share('superAdmin', [v1, v3], 'branch', fx.branches.yard.id)
    expect(first.body.data).toMatchObject({ added: [v1.id], skipped: { home: [v3.id], already: [] } })
    const again = await share('superAdmin', [v1], 'branch', fx.branches.yard.id)
    expect(again.body.data).toMatchObject({ added: [], skipped: { already: [v1.id] } })
    expect((await share('superAdmin', [v1], 'bg', fx.bgA1a.id)).body.data.skipped.home).toEqual([v1.id])
    expect((await share('superAdmin', [v1], 'group', fx.groupA1.id)).body.data.skipped.home).toEqual([v1.id])
    expect((await share('superAdmin', [v1], 'ggb', fx.ggbA.id)).status).toBe(400)
    expect(await prisma.vehicleShare.count()).toBe(1)
  })

  it('PUT /vehicle/:id makes the list, keeping the shares the caller cannot see', async () => {
    const { v1 } = fx.vehicles
    await share('superAdmin', [v1], 'bg', fx.bgB1a.id)
    const put = targets => request(app).put(`/api/vehicle-shares/vehicle/${v1.id}`).set(as('bgUserA1a')).send({ targets })

    const res = await put([{ level: 'branch', id: fx.branches.yard.id }])
    expect(res.status).toBe(200)
    expect(res.body.data.map(s => s.targetId).sort()).toEqual([fx.bgB1a.id, fx.branches.yard.id].sort())

    expect((await put([])).body.data.map(s => s.targetId)).toEqual([fx.bgB1a.id])
    // Its own BG is refused, with the field named.
    const home = await put([{ level: 'bg', id: fx.bgA1a.id }])
    expect(home.status).toBe(400)

    const list = await request(app).get('/api/vehicle-shares').query({ vehicleId: v1.id }).set(as('bgUserB1a'))
    expect(list.body.data.map(s => s.targetId)).toEqual([fx.bgB1a.id])
    expect((await request(app).get('/api/vehicle-shares').query({ vehicleId: v1.id }).set(as('groupAdminA2'))).status).toBe(404)
  })

  it('removing a share takes what that BG gave the vehicle — unless it still sees it', async () => {
    const { v1 } = fx.vehicles
    await share('superAdmin', [v1], 'bg', fx.bgB1a.id)
    // BG B's own rule and its own sub-user take the shared vehicle.
    const rule = await request(app).post('/api/alerts').set(as('bgUserB1a'))
      .send({ bgId: fx.bgB1a.id, name: 'B speeding', type: 'overspeed', params: { speedKmh: 100 }, allVehicles: false, vehicleIds: [v1.id] })
    expect(rule.status).toBe(201)
    const sub = await prisma.user.create({ data: { email: 'b.sub@emiratescold.ae', passwordHash: 'x', role: 'SUB_USER', bgId: fx.bgB1a.id, mustChangePassword: false } })
    expect((await request(app).put(`/api/users/${sub.id}/vehicles`).set(as('bgUserB1a')).send({ ids: [v1.id] })).status).toBe(200)
    // Not a vehicle of BG A1b, so not for its rules.
    const other = await request(app).post('/api/alerts').set(as('ggbAdminA'))
      .send({ bgId: fx.bgA1b.id, name: 'x', type: 'overspeed', params: { speedKmh: 100 }, allVehicles: false, vehicleIds: [v1.id] })
    expect(other.status).toBe(400)

    // Still shared to one of B's branches: B keeps both.
    await share('superAdmin', [v1], 'branch', fx.branches.sharjah.id)
    await unshare('superAdmin', [v1], 'bg', fx.bgB1a.id)
    expect(await prisma.alertVehicle.count({ where: { vehicleId: v1.id } })).toBe(1)
    expect(await prisma.subuserVehicle.count({ where: { vehicleId: v1.id, userId: sub.id } })).toBe(1)

    const res = await unshare('superAdmin', [v1], 'branch', fx.branches.sharjah.id)
    expect(res.body.data.stripped).toEqual({ subuserAssignments: 1, alertAssignments: 1 })
    expect(await prisma.alertVehicle.count({ where: { vehicleId: v1.id } })).toBe(0)
    expect(plates(await vehiclesOf('bgUserB1a'))).toEqual(['PLATE-8', 'PLATE-9'])
  })

  it('a share goes with its vehicle and with the place it points at', async () => {
    const { v1, v2 } = fx.vehicles
    await share('superAdmin', [v1, v2], 'branch', fx.branches.sharjah.id)
    await share('superAdmin', [v1], 'bg', fx.bgA1b.id)
    expect(await prisma.vehicleShare.count()).toBe(3)
    await request(app).delete(`/api/branches/${fx.branches.sharjah.id}`).set(as('superAdmin')).expect(200)
    expect(await prisma.vehicleShare.count()).toBe(1)
    await request(app).delete(`/api/vehicles/${v1.id}`).set(as('superAdmin')).expect(200)
    expect(await prisma.vehicleShare.count()).toBe(0)
  })
})

// ── transfer ────────────────────────────────────────────────────────────────

describe('POST /api/vehicles/:id/transfer with shares', () => {
  it('drops the shares into the old and new BG, keeps the rest and what those places gave it', async () => {
    const { v1 } = fx.vehicles
    await share('superAdmin', [v1], 'bg', fx.bgB1a.id)
    await share('superAdmin', [v1], 'branch', fx.branches.yard.id) // old BG
    await share('superAdmin', [v1], 'bg', fx.bgA1b.id) // new BG
    const bRule = await prisma.alert.create({ data: { name: 'B', type: 'overspeed', bgId: fx.bgB1a.id, allVehicles: false, vehicles: { create: [{ vehicleId: v1.id }] } } })
    await prisma.alert.create({ data: { name: 'A', type: 'overspeed', bgId: fx.bgA1a.id, allVehicles: false, vehicles: { create: [{ vehicleId: v1.id }] } } })

    const res = await request(app).post(`/api/vehicles/${v1.id}/transfer`).set(as('superAdmin')).send({ bgId: fx.bgA1b.id })
    expect(res.status).toBe(200)
    expect(res.body.stripped).toMatchObject({ sharesRemoved: 2, alertAssignments: 1, subuserAssignments: 1 })
    expect(res.body.data.shares.map(s => s.targetId)).toEqual([fx.bgB1a.id])
    expect(await prisma.alertVehicle.findMany({ where: { vehicleId: v1.id }, select: { alertId: true } })).toEqual([{ alertId: bRule.id }])
    expect(plates(await vehiclesOf('bgUserB1a'))).toContain('PLATE-1')
    const history = (await request(app).get('/api/vehicle-moves').set(as('superAdmin'))).body.data
    expect(history.filter(m => m.level === 'share' && m.fromName)).toHaveLength(2)
  })
})

// ── alerts and driver history ───────────────────────────────────────────────

describe('alerts and drivers on a shared vehicle', () => {
  it('the shared BG\'s own rule covers it; each BG gets its own event', async () => {
    const { v1 } = fx.vehicles
    await share('superAdmin', [v1], 'bg', fx.bgB1a.id)
    const rule = bgId => prisma.alert.create({ data: { name: `Speeding ${bgId === fx.bgB1a.id ? 'B' : 'A'}`, type: 'overspeed', bgId, severity: 'High', params: { speedKmh: 120 }, allVehicles: true } })
    await rule(fx.bgB1a.id)
    await rule(fx.bgA1a.id)
    // BG B's driver, by tag, in the vehicle shared to B.
    await prisma.driver.create({ data: { bgId: fx.bgB1a.id, name: 'Bilal (B)', ibuttonCode: 'AB12' } })
    telemetry = { 101: { 'position.speed': 142, 'position.latitude': 24.4, 'position.longitude': 54.4, 'ibutton.code': 'AB12', timestamp: NOW - 20 } }

    const events = await runAlertPass(NOW)
    expect(events.map(e => [e.title, e.bgId, e.vehicleId]).sort()).toEqual([
      ['Speeding A', fx.bgA1a.id, v1.id],
      ['Speeding B', fx.bgB1a.id, v1.id],
    ])
    expect(events.find(e => e.bgId === fx.bgB1a.id).message).toMatch(/Driver: Bilal \(B\)/)

    const b = await request(app).get('/api/alert-events').set(as('bgUserB1a'))
    expect(b.body.data.map(e => e.title)).toEqual(['Speeding B'])
    const a = await request(app).get('/api/alert-events').set(as('bgUserA1a'))
    expect(a.body.data.map(e => e.title)).toEqual(['Speeding A'])
  })

  it('the driver history of a shared vehicle is read by the place it is shared to', async () => {
    const { v1 } = fx.vehicles
    await share('superAdmin', [v1], 'bg', fx.bgB1a.id)
    const d = await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Ahmed (A)', vehicleId: v1.id, ibuttonCode: 'CC01' } })
    await prisma.driverAssignment.create({ data: { driverId: d.id, vehicleId: v1.id, role: 'Primary', startDate: new Date('2026-11-01T00:00:00Z') } })
    await prisma.driverTagHistory.create({ data: { driverId: d.id, code: 'CC01', startDate: new Date('2026-11-01T00:00:00Z') } })
    // An A driver who never drove the shared vehicle stays A's own.
    const other = await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Other (A)', ibuttonCode: 'CC02' } })
    await prisma.driverTagHistory.create({ data: { driverId: other.id, code: 'CC02', startDate: new Date('2026-11-01T00:00:00Z') } })

    const res = await request(app).get('/api/drivers/history').set(as('bgUserB1a'))
    expect(res.status).toBe(200)
    expect(res.body.data.assignments.map(a => a.vehicleId)).toEqual([v1.id])
    expect(res.body.data.drivers.map(x => x.name)).toEqual(['Ahmed (A)'])
    expect(res.body.data.tags.map(t => t.code)).toEqual(['CC01'])
    // The driver record itself stays A's.
    expect((await request(app).get('/api/drivers').set(as('bgUserB1a'))).body.data).toHaveLength(0)
  })
})
