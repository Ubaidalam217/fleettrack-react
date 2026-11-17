/**
 * Change tracker / Remove tracker / tracker status (lib/trackers.js, client
 * 2026-11-17: FleetmaxX is the master; trackers are changed here and Flespi
 * follows). Flespi is a fake in this file: nothing reaches the real one.
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
const { __resetFlespiDevices } = await import('../src/lib/flespiDevices.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
let fl

function fakeFlespi() {
  const s = { devices: [], subs: new Set(), calls: [], nextId: 9000 }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  s.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    const path = u.pathname
    const body = init.body ? JSON.parse(init.body) : undefined
    s.calls.push(`${method} ${path}`)
    let m
    if (method === 'GET' && path === '/gw/devices/all') return json({ result: s.devices })
    if (method === 'GET' && path.startsWith('/gw/channel-protocols/')) {
      return json({ result: [{ id: 579, title: 'Teltonika FMC130', protocol_id: 14 }, { id: 700, title: 'iTriangle TS101', protocol_id: 13 }] })
    }
    if (method === 'GET' && path === '/gw/streams/all') return json({ result: [{ id: 77, name: 'FleetmaxX webhook' }] })
    if ((m = /^\/gw\/streams\/77\/devices\/(\d+)$/.exec(path))) {
      const id = Number(m[1])
      if (method === 'POST') { s.subs.add(id); return json({ result: [] }) }
      return json({ result: s.subs.has(id) ? [{ device_id: id }] : [] })
    }
    if (method === 'POST' && path === '/gw/devices') {
      const made = body.map(d => ({ id: s.nextId++, ...d }))
      s.devices.push(...made)
      return json({ result: made.map(d => ({ id: d.id })) })
    }
    if ((m = /^\/gw\/devices\/(\d+)$/.exec(path))) {
      const dev = s.devices.find(d => d.id === Number(m[1]))
      if (method === 'PUT') { Object.assign(dev, body); return json({ result: [dev] }) }
      return json({ result: dev ? [dev] : [] })
    }
    return json({ errors: [{ reason: `unexpected ${method} ${path}` }] }, 404)
  })
  return s
}

const writes = () => fl.calls.filter(c => !c.startsWith('GET'))
const moves = v => prisma.vehicleMove.findMany({ where: { vehicleId: v.id }, orderBy: { movedAt: 'asc' } })

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  __resetFlespiDevices()
  fl = fakeFlespi()
  vi.stubGlobal('fetch', fl.fetch)
})

afterEach(() => vi.unstubAllGlobals())

const swap = (v, body, token = fx.tokens.bgUserA1a) => request(app).post(`/api/vehicles/${v.id}/tracker`).set(auth(token)).send(body)

describe('Change tracker', () => {
  it('to an unregistered Flespi tracker: links that device, leaves the old one alone, keeps the history', async () => {
    const v = fx.vehicles.v1
    fl.devices.push(
      { id: 100, name: 'PLATE-1', device_type_id: 579, configuration: { ident: v.imei } },
      { id: 200, name: 'iTriangle', device_type_id: 700, configuration: { ident: '869166081129099' } },
    )
    const res = await swap(v, { imei: '869166081129099', deviceType: 'iTriangle TS101', note: 'old unit faulty' })
    expect(res.status).toBe(200)
    expect(res.body.flespi).toEqual({ deviceId: 200, created: false })
    // Device 200 now carries the plate; device 100 is untouched.
    expect(fl.devices.find(d => d.id === 200)).toMatchObject({ name: 'PLATE-1', configuration: { ident: '869166081129099' } })
    expect(fl.devices.find(d => d.id === 100)).toMatchObject({ name: 'PLATE-1', configuration: { ident: v.imei } })
    expect(writes()).toEqual(['PUT /gw/devices/200', 'POST /gw/streams/77/devices/200'])

    const after = await prisma.vehicle.findUnique({ where: { id: v.id } })
    expect(after).toMatchObject({ imei: '869166081129099', deviceType: 'iTriangle TS101', flespiDeviceId: 200, plateNo: 'PLATE-1' })
    const rows = await moves(v)
    expect(rows.map(r => [r.level, r.imei, r.fromName, r.toName])).toEqual([
      ['device', v.imei, 'PLATE-1', null],
      ['device', '869166081129099', null, 'PLATE-1'],
    ])
    expect(rows[0].note).toBe('Replaced by 869166081129099 — old unit faulty')
    expect(rows[1].note).toBe(`Replaced ${v.imei} — old unit faulty`)
    expect(rows[0].movedByName).toBe('hassan@alhabtoorlog.ae')
  })

  it('never re-types a tracker already in Flespi, even one of a type outside our list', async () => {
    const v = await prisma.vehicle.update({ where: { id: fx.vehicles.v1.id }, data: { deviceType: 'Teltonika FMC130' } })
    fl.devices.push({ id: 210, name: 'iTriangle', device_type_id: 4242, configuration: { ident: '869166081129099' } })
    const res = await swap(v, { imei: '869166081129099', deviceType: 'Teltonika FMC130' })
    expect(res.status).toBe(200)
    expect(fl.devices[0]).toMatchObject({ name: 'PLATE-1', device_type_id: 4242 })
  })

  it('to a new IMEI: the vehicle’s own device takes the new IMEI and type, nothing is created', async () => {
    const v = fx.vehicles.v1
    fl.devices.push({ id: 100, name: 'PLATE-1', device_type_id: 579, configuration: { ident: v.imei, settings_polling: 'once' } })
    const res = await swap(v, { imei: '869166081174012', deviceType: 'iTriangle TS101' })
    expect(res.status).toBe(200)
    expect(res.body.flespi).toEqual({ deviceId: 100, created: false })
    expect(fl.devices).toHaveLength(1)
    expect(fl.devices[0]).toMatchObject({ device_type_id: 700, configuration: { ident: '869166081174012', settings_polling: 'once' } })
    expect(writes()).not.toContain('POST /gw/devices')
  })

  it('to a new IMEI on a different model needs a device type Flespi knows', async () => {
    const v = await prisma.vehicle.update({ where: { id: fx.vehicles.v1.id }, data: { deviceType: 'hand typed' } })
    fl.devices.push({ id: 100, name: 'PLATE-1', device_type_id: 579, configuration: { ident: v.imei } })
    const res = await swap(v, { imei: '869166081174012' })
    expect(res.status).toBe(400)
    expect(res.body.error.details).toMatchObject({ deviceType: expect.any(String) })
    expect(writes()).toEqual([])
    expect((await prisma.vehicle.findUnique({ where: { id: v.id } })).imei).toBe(v.imei)
  })

  it('refuses an IMEI another vehicle has, and the same IMEI', async () => {
    const v = fx.vehicles.v1
    expect((await swap(v, { imei: fx.vehicles.v2.imei })).status).toBe(409)
    expect((await swap(v, { imei: v.imei })).status).toBe(400)
    expect(writes()).toEqual([])
  })

  it('is the owner’s: another BG and a vehicle shared in cannot change it', async () => {
    const res = await swap(fx.vehicles.v1, { imei: '869166081174012', deviceType: 'iTriangle TS101' }, fx.tokens.bgUserB1a)
    expect(res.status).toBe(404)
    expect(writes()).toEqual([])
  })
})

describe('Remove tracker', () => {
  it('keeps the vehicle with no tracker, writes nothing to Flespi, and a tracker can go in again', async () => {
    const v = fx.vehicles.v1
    fl.devices.push({ id: 100, name: 'PLATE-1', device_type_id: 579, configuration: { ident: v.imei } })
    const res = await request(app).post(`/api/vehicles/${v.id}/tracker/remove`).set(auth(fx.tokens.bgUserA1a)).send({ note: 'sold the unit' })
    expect(res.status).toBe(200)
    expect(res.body.data.imei).toBeNull()
    expect(writes()).toEqual([])

    // Still listed, still editable without an IMEI.
    const list = await request(app).get('/api/vehicles').set(auth(fx.tokens.bgUserA1a))
    expect(list.body.data.find(r => r.id === v.id)).toMatchObject({ imei: null })
    const edit = await request(app).put(`/api/vehicles/${v.id}`).set(auth(fx.tokens.bgUserA1a)).send({ plateNo: 'PLATE-1', fleetNo: 'FL-01', make: 'Volvo' })
    expect(edit.status).toBe(200)
    expect(edit.body.data.imei).toBeNull()

    // Its old tracker is an unregistered one now, "was in PLATE-1".
    const unreg = await request(app).get('/api/vehicles/unregistered').set(auth(fx.tokens.superAdmin))
    expect(unreg.body.data).toEqual([expect.objectContaining({ deviceId: 100, imei: v.imei, lastVehicle: expect.objectContaining({ label: 'PLATE-1', installed: false }) })])

    expect((await request(app).post(`/api/vehicles/${v.id}/tracker/remove`).set(auth(fx.tokens.bgUserA1a)).send({})).status).toBe(400)

    // Installing again: one "installed" row, no "taken out" of nothing.
    const back = await swap(v, { imei: v.imei, note: 'refitted' })
    expect(back.status).toBe(200)
    const rows = (await moves(v)).filter(r => r.level === 'device')
    expect(rows.map(r => [r.toName ? 'in' : 'out', r.imei, r.note])).toEqual([
      ['out', v.imei, 'Tracker removed — the vehicle has no tracker now — sold the unit'],
      ['in', v.imei, 'refitted'],
    ])
  })
})

describe('merge, keeping the stale vehicle', () => {
  it('the stale vehicle keeps its number and takes the tracker; only the device name changes in Flespi', async () => {
    // "AD 149" (v3): its tracker was changed in the Flespi panel; device 400
    // now carries the tracker registered as "iTriangle" (v4).
    const { v3, v4 } = fx.vehicles
    fl.devices.push({ id: 400, name: 'iTriangle', device_type_id: 700, configuration: { ident: v4.imei } })
    const res = await request(app).post(`/api/vehicles/${v4.id}/merge`).set(auth(fx.tokens.bgUserA1a))
      .send({ targetId: v3.id, takeTracker: true, note: 'new iTriangle unit in AD 149' })
    expect(res.status).toBe(200)
    expect(res.body.merge.plan).toMatchObject({ trackerMoved: v4.imei, trackerRemoved: v3.imei })
    expect(writes()).toEqual(['PUT /gw/devices/400', 'POST /gw/streams/77/devices/400'])
    expect(fl.devices[0]).toMatchObject({ name: 'PLATE-3', device_type_id: 700, configuration: { ident: v4.imei } })

    const kept = await prisma.vehicle.findUnique({ where: { id: v3.id } })
    expect(kept).toMatchObject({ imei: v4.imei, flespiDeviceId: 400, deletedAt: null })
    expect(await prisma.vehicle.findUnique({ where: { id: v4.id } })).toMatchObject({ imei: null, mergedIntoId: v3.id })
    const rows = (await moves(v3)).filter(r => r.level === 'device')
    expect(rows.map(r => [r.toName ? 'in' : 'out', r.imei]).sort()).toEqual([['in', v4.imei], ['out', v3.imei]])
  })
})

describe('tracker status', () => {
  it('names the device a stale vehicle used and what it carries now', async () => {
    const v = await prisma.vehicle.update({ where: { id: fx.vehicles.v1.id }, data: { flespiDeviceId: 300 } })
    // Device 300 had PLATE-1's tracker; in the Flespi panel it was given v2's tracker.
    fl.devices.push({ id: 300, name: 'swapped by hand', device_type_id: 579, configuration: { ident: fx.vehicles.v2.imei } })
    const res = await request(app).get(`/api/vehicles/${v.id}/tracker-status`).set(auth(fx.tokens.bgUserA1a))
    expect(res.body.data).toMatchObject({ state: 'missing', suggestion: { kind: 'merge', deviceId: 300, target: { id: fx.vehicles.v2.id, label: 'PLATE-2' } } })

    // Given a tracker nobody registered instead, the suggestion is to link to it.
    fl.devices[0].configuration.ident = '869166081174012'
    clearDeviceCache()
    const link = await request(app).get(`/api/vehicles/${v.id}/tracker-status`).set(auth(fx.tokens.bgUserA1a))
    expect(link.body.data.suggestion).toMatchObject({ kind: 'link', imei: '869166081174012', deviceType: 'Teltonika FMC130' })
    expect(writes()).toEqual([])
  })

  it('records the device of each vehicle when the unregistered list is read', async () => {
    fl.devices.push({ id: 101, name: 'x', device_type_id: 579, configuration: { ident: fx.vehicles.v1.imei } })
    await request(app).get('/api/vehicles/unregistered').set(auth(fx.tokens.superAdmin))
    expect((await prisma.vehicle.findUnique({ where: { id: fx.vehicles.v1.id } })).flespiDeviceId).toBe(101)
    const ok = await request(app).get(`/api/vehicles/${fx.vehicles.v1.id}/tracker-status`).set(auth(fx.tokens.bgUserA1a))
    expect(ok.body.data).toMatchObject({ state: 'ok', device: { deviceId: 101, imei: fx.vehicles.v1.imei } })
  })

  it('renames the Flespi device to the plate on request, nothing else', async () => {
    fl.devices.push({ id: 101, name: 'Test Bench', device_type_id: 579, configuration: { ident: fx.vehicles.v1.imei } })
    const res = await request(app).post(`/api/vehicles/${fx.vehicles.v1.id}/tracker/sync`).set(auth(fx.tokens.bgUserA1a)).send({})
    expect(res.status).toBe(200)
    expect(fl.devices[0]).toMatchObject({ name: 'PLATE-1', device_type_id: 579, configuration: { ident: fx.vehicles.v1.imei } })
  })
})
