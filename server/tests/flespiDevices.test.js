/**
 * Vehicles keep their Flespi device in step (lib/flespiDevices.js): adding a
 * vehicle creates or links the device and subscribes it to the webhook stream,
 * an edit renames / re-idents it, a delete leaves it alone.
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

/** A tiny Flespi: devices, one webhook stream, one device type. */
function fakeFlespi() {
  const s = {
    devices: [],
    subs: new Set(),
    calls: [],
    limitReached: false,
    nextId: 9000,
  }
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
      return json({ result: [{ id: 579, title: 'Teltonika FMC130', protocol_id: 14 }, { id: 102, title: 'Teltonika FMB120', protocol_id: 14 }] })
    }
    if (method === 'GET' && path === '/gw/channels/all') return json({ result: [{ protocol_id: 14, uri: 'ch1.flespi.gw:31122', enabled: true }] })
    if (method === 'GET' && path === '/gw/streams/all') return json({ result: [{ id: 77, name: 'FleetmaxX webhook' }] })
    if ((m = /^\/gw\/streams\/77\/devices\/(\d+)$/.exec(path))) {
      const id = Number(m[1])
      if (method === 'POST') { s.subs.add(id); return json({ result: [{ stream_id: 77, device_id: id }] }) }
      return json({ result: s.subs.has(id) ? [{ stream_id: 77, device_id: id }] : [] })
    }
    if (method === 'POST' && path === '/gw/devices') {
      if (s.limitReached) return json({ errors: [{ reason: "you reached the limit on maximum quantity of '/gw/devices'" }] }, 400)
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

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  __resetFlespiDevices()
  fl = fakeFlespi()
  vi.stubGlobal('fetch', fl.fetch)
})

afterEach(() => vi.unstubAllGlobals())

const add = body => request(app).post('/api/vehicles').set(auth(fx.tokens.superAdmin)).send({ bgId: fx.bgA1a.id, ...body })

describe('vehicles ↔ Flespi devices', () => {
  it('lists the device types and the tracker address for the form', async () => {
    const res = await request(app).get('/api/vehicles/device-types').set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    expect(res.body.data.types.map(t => t.title)).toEqual(['Teltonika FMB120', 'Teltonika FMC130'])
    expect(res.body.data.addresses).toEqual({ 14: 'ch1.flespi.gw:31122' })
  })

  it('lists Flespi devices no vehicle points at, to the Super Admin only', async () => {
    fl.devices.push(
      { id: 801, name: 'Test Bench', device_type_id: 579, configuration: { ident: '863940059213374' } },
      { id: 802, name: 'registered', device_type_id: 102, configuration: { ident: fx.vehicles.v1.imei } },
    )
    const res = await request(app).get('/api/vehicles/unregistered').set(auth(fx.tokens.superAdmin))
    expect(res.body.data).toEqual([{ deviceId: 801, name: 'Test Bench', imei: '863940059213374', deviceType: 'Teltonika FMC130' }])
    const narrow = await request(app).get('/api/vehicles/unregistered').set(auth(fx.tokens.bgUserA1a))
    expect(narrow.body.data).toEqual([])
  })

  it('adding a vehicle creates its Flespi device and subscribes it to the webhook', async () => {
    const res = await add({ imei: '861234567890123', plateNo: 'AD 55555', deviceType: 'Teltonika FMC130' })
    expect(res.status).toBe(201)
    expect(res.body.flespi).toMatchObject({ created: true })
    const dev = fl.devices[0]
    expect(dev).toMatchObject({ name: 'AD 55555', device_type_id: 579, configuration: { ident: '861234567890123' } })
    expect(fl.subs.has(dev.id)).toBe(true)
  })

  it('links to a device already in Flespi instead of making a second one', async () => {
    fl.devices.push({ id: 500, name: 'old name', device_type_id: 102, configuration: { ident: '861234567890123', settings_polling: 'once' } })
    const res = await add({ imei: '861234567890123', plateNo: 'AD 55555' })
    expect(res.status).toBe(201)
    expect(res.body.flespi).toEqual({ deviceId: 500, created: false })
    expect(fl.devices).toHaveLength(1)
    expect(fl.devices[0].name).toBe('AD 55555')
    expect(fl.subs.has(500)).toBe(true)
    expect(writes()).not.toContain('POST /gw/devices')
  })

  it('a new tracker needs its device type, and nothing is saved without it', async () => {
    const res = await add({ imei: '861234567890123', plateNo: 'AD 55555' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/device type/i)
    expect(await prisma.vehicle.count({ where: { imei: '861234567890123' } })).toBe(0)
  })

  it('passes on Flespi refusing the device (plan limit) and saves nothing', async () => {
    fl.limitReached = true
    const res = await add({ imei: '861234567890123', plateNo: 'AD 55555', deviceType: 'Teltonika FMC130' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/device limit reached — upgrade the Flespi plan/)
    expect(await prisma.vehicle.count({ where: { imei: '861234567890123' } })).toBe(0)
  })

  it('an edit moves the device to the new IMEI and name, keeping its other settings', async () => {
    const v = fx.vehicles.v1
    fl.devices.push({ id: 600, name: 'x', device_type_id: 579, configuration: { ident: v.imei, settings_polling: 'once' } })
    const res = await request(app).put(`/api/vehicles/${v.id}`).set(auth(fx.tokens.superAdmin))
      .send({ imei: '869999999999999', plateNo: 'AD 77777' })
    expect(res.status).toBe(200)
    expect(fl.devices[0]).toMatchObject({ name: 'AD 77777', configuration: { ident: '869999999999999', settings_polling: 'once' } })
  })

  it('an edit of an old record with no device and no type changes nothing in Flespi', async () => {
    const v = fx.vehicles.v1
    const res = await request(app).put(`/api/vehicles/${v.id}`).set(auth(fx.tokens.superAdmin)).send({ imei: v.imei, plateNo: 'AD 1' })
    expect(res.status).toBe(200)
    expect(res.body.flespi).toBeNull()
    expect(writes()).toEqual([])
  })

  it('deleting a vehicle leaves its Flespi device in place', async () => {
    const v = fx.vehicles.v1
    fl.devices.push({ id: 700, name: 'x', device_type_id: 579, configuration: { ident: v.imei } })
    const res = await request(app).delete(`/api/vehicles/${v.id}`).set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    expect(writes()).toEqual([])
    expect(fl.devices).toHaveLength(1)
  })
})
