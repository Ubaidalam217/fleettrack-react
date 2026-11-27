/**
 * POST /api/vehicles/import — the Master Data sheet upload (client 2026-11-24).
 * Flespi is a fake in this file: nothing reaches the real one. The point of the
 * fake is to count its WRITES: an IMEI already on a device must only be linked.
 * Vehicle names and numbers are made up.
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
  const s = { devices: [], subs: new Set(), calls: [], nextId: 9000, telemetry: {}, limit: false }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  s.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    const path = u.pathname
    const body = init.body ? JSON.parse(init.body) : undefined
    s.calls.push(`${method} ${path}`)
    let m
    if (method === 'GET' && path.startsWith('/gw/devices/all/telemetry')) {
      return json({
        result: Object.entries(s.telemetry).map(([id, t]) => ({
          id: Number(id),
          telemetry: Object.fromEntries(Object.entries(t).map(([k, value]) => [k, { value, ts: 1_800_000_000 }])),
        })),
      })
    }
    if (method === 'GET' && path === '/gw/devices/all') return json({ result: s.devices })
    if (method === 'GET' && path.startsWith('/gw/channel-protocols/')) {
      return json({ result: [{ id: 579, title: 'Teltonika FMC130', protocol_id: 14 }] })
    }
    if (method === 'GET' && path === '/gw/streams/all') return json({ result: [{ id: 77, name: 'FleetmaxX webhook' }] })
    if ((m = /^\/gw\/streams\/77\/devices\/(\d+)$/.exec(path))) {
      const id = Number(m[1])
      if (method === 'POST') { s.subs.add(id); return json({ result: [] }) }
      return json({ result: s.subs.has(id) ? [{ device_id: id }] : [] })
    }
    if (method === 'POST' && path === '/gw/devices') {
      if (s.limit) return json({ errors: [{ code: 1, reason: 'limit on maximum quantity of devices exceeded' }] }, 403)
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

const sheetRow = (row, o) => ({ row, raw: { name: `Import Truck ${row}`, imei: `35000000000${String(1000 + row)}`, ...o } })
const send = (body, token = fx.tokens.bgUserA1a) =>
  request(app).post('/api/vehicles/import').set(auth(token)).send({ bgId: fx.bgA1a.id, ...body })

describe('import: valid rows', () => {
  it('creates the vehicles with the mapped fields, the rest in custom fields, and the install history row', async () => {
    const res = await send({
      branchId: fx.branches.depot.id,
      rows: [sheetRow(4, {
        plate: 'T 1001', model: 'Sample Model', sim: '971500000001', sim2: '971500000002', category: 'Movable', vin: 'SAMPLEVIN1',
        engineNo: 'ENG-1', color: 'Blue', seats: '3', purchaseDate: '2022-02-01', engineHourMode: '1', elockPassword: 'do-not-keep',
      })],
    })
    expect(res.status).toBe(201)
    expect(res.body.data.errors).toEqual([])
    expect(res.body.data.created).toHaveLength(1)
    expect(res.body.data.elockPasswordIgnored).toBe(1)

    const v = await prisma.vehicle.findUnique({ where: { imei: '350000000001004' } })
    expect(v).toMatchObject({
      bgId: fx.bgA1a.id, branchId: fx.branches.depot.id, fleetNo: 'Import Truck 4', plateNo: 'T 1001', model: 'Sample Model', mobileNo: '971500000001',
      flespiDeviceId: null,
    })
    const names = v.customFields.map(f => f.name)
    expect(names).toEqual(expect.arrayContaining([
      'Secondary SIM Number', 'Object Category', 'VIN (Chassis Number)', 'Engine Number', 'Color', 'Passenger Seats', 'Purchase Date', 'Engine Work Hour Consideration',
    ]))
    expect(v.customFields.find(f => f.name === 'Engine Work Hour Consideration').value).toBe('From Device CAN')
    // The Elock password is a secret: kept nowhere.
    expect(JSON.stringify(v)).not.toContain('do-not-keep')
    expect(v.customFieldsUpdatedBy).toBe('hassan@alhabtoorlog.ae')

    const moves = await prisma.vehicleMove.findMany({ where: { vehicleId: v.id } })
    expect(moves.map(m => [m.level, m.imei, m.toName])).toEqual([['device', '350000000001004', 'Import Truck 4 - T 1001']])
    // Nothing was written to Flespi (and the vehicle is listed in its BG).
    expect(writes()).toEqual([])
    const list = await request(app).get('/api/vehicles').set(auth(fx.tokens.bgUserA1a))
    expect(list.body.data.map(x => x.imei)).toContain('350000000001004')
  })

  it('an IMEI already on a Flespi device is only linked: no write, no duplicate, no rename', async () => {
    fl.devices.push({ id: 100, name: 'Old Name In Flespi', device_type_id: 579, configuration: { ident: '350000000001005' } })
    const res = await send({ rows: [sheetRow(5, { plate: 'T 1002' }), sheetRow(6)] })
    expect(res.status).toBe(201)
    const byRow = Object.fromEntries(res.body.data.created.map(c => [c.row, c.flespi]))
    expect(byRow).toEqual({ 5: 'linked', 6: 'none' })
    expect((await prisma.vehicle.findUnique({ where: { imei: '350000000001005' } })).flespiDeviceId).toBe(100)
    expect((await prisma.vehicle.findUnique({ where: { imei: '350000000001006' } })).flespiDeviceId).toBeNull()
    expect(writes()).toEqual([])
    expect(fl.devices).toHaveLength(1)
    expect(fl.devices[0].name).toBe('Old Name In Flespi')
  })

  it('the odometer goes through the odometer correction when the tracker has a reading, else it is kept in a custom field', async () => {
    fl.devices.push({ id: 100, name: 'D', device_type_id: 579, configuration: { ident: '350000000001007' } })
    fl.telemetry = { 100: { 'vehicle.mileage': 1200.5 } }
    const res = await send({ rows: [sheetRow(7, { odometer: '45200' }), sheetRow(8, { odometer: '900' })] })
    expect(res.status).toBe(201)
    const byRow = Object.fromEntries(res.body.data.created.map(c => [c.row, c.odometer]))
    expect(byRow).toEqual({ 7: 'applied', 8: 'pending' })

    const a = await prisma.vehicle.findUnique({ where: { imei: '350000000001007' } })
    expect(a.odometerOffsetKm).toBeCloseTo(45200 - 1200.5)
    expect(a.odometerSetBy).toBe('hassan@alhabtoorlog.ae')
    const adj = await prisma.odometerAdjustment.findMany({ where: { vehicleId: a.id } })
    expect(adj).toHaveLength(1)
    expect(adj[0]).toMatchObject({ readingKm: 45200, deviceKm: 1200.5, note: 'Imported from the Master Data sheet' })

    const b = await prisma.vehicle.findUnique({ where: { imei: '350000000001008' } })
    expect(b.odometerOffsetKm).toBeNull()
    expect(await prisma.odometerAdjustment.count({ where: { vehicleId: b.id } })).toBe(0)
    expect(b.customFields.find(f => f.name === 'Odometer (imported, not yet applied)').value).toBe('900')
    expect(writes()).toEqual([])
  })
})

describe('import: dry run', () => {
  it('checks and reports without saving anything or writing to Flespi', async () => {
    fl.devices.push({ id: 100, name: 'D', device_type_id: 579, configuration: { ident: '350000000001001' } })
    const res = await send({ dryRun: true, rows: [sheetRow(1), sheetRow(2), sheetRow(3, { name: '' })] })
    expect(res.status).toBe(200)
    expect(res.body.data.valid).toBe(2)
    expect(res.body.data.rows.map(r => [r.row, r.ok, r.flespi ?? null])).toEqual([[1, true, 'linked'], [2, true, 'none'], [3, false, null]])
    expect(res.body.data.rows[2].problems).toEqual(['Vehicle Name is required'])
    expect(await prisma.vehicle.count({ where: { imei: { startsWith: '3500000000' } } })).toBe(0)
    expect(writes()).toEqual([])
  })

  it('with the create option it says which IMEIs would get a new device, still without writing', async () => {
    const res = await send({ dryRun: true, createDevices: true, deviceType: 'Teltonika FMC130', rows: [sheetRow(2)] })
    expect(res.body.data.rows[0].flespi).toBe('created')
    expect(writes()).toEqual([])
  })
})

describe('import: bad rows', () => {
  it('reports each bad row and still imports the good ones', async () => {
    const taken = fx.vehicles.v1.imei
    const res = await send({
      rows: [
        sheetRow(1),                                               // good
        sheetRow(2, { imei: taken }),                              // already registered
        sheetRow(3, { imei: '350000000001001' }),                  // same IMEI as row 1
        sheetRow(4, { name: '' }),                                 // no name
        sheetRow(5, { imei: '' }),                                 // no IMEI
        sheetRow(6, { sim: '123' }),                               // bad SIM
        sheetRow(7, { installDate: '31/12/2022' }),                // bad date
        sheetRow(9),                                               // good
      ],
    })
    expect(res.status).toBe(201)
    expect(res.body.data.created.map(c => c.row)).toEqual([1, 9])
    const msg = Object.fromEntries(res.body.data.errors.map(e => [e.row, e.message]))
    expect(msg[2]).toBe('IMEI Number is already registered to a vehicle')
    expect(msg[3]).toBe('IMEI Number appears twice in the file (same as row 1)')
    expect(msg[4]).toBe('Vehicle Name is required')
    expect(msg[5]).toBe('IMEI Number is required')
    expect(msg[6]).toMatch(/Sim Card Number: 6 to 20 digits/)
    expect(msg[7]).toMatch(/Installation Date: use YYYY-MM-DD/)
    // Only the good ones were saved.
    expect(await prisma.vehicle.count({ where: { fleetNo: { startsWith: 'Import Truck' } } })).toBe(2)
  })

  it('a chassis number already on one of the caller’s vehicles is refused', async () => {
    await prisma.vehicle.update({ where: { id: fx.vehicles.v2.id }, data: { customFields: [{ name: 'VIN (Chassis Number)', value: 'abc123' }] } })
    const res = await send({ rows: [sheetRow(1, { vin: 'ABC123' })] })
    expect(res.body.data.created).toEqual([])
    expect(res.body.data.errors[0].message).toBe('VIN (Chassis Number) is already on another vehicle')
  })

  it('refuses an empty list and more than 500 rows', async () => {
    expect((await send({ rows: [] })).status).toBe(400)
    const many = Array.from({ length: 501 }, (_, i) => sheetRow(i + 1))
    expect((await send({ rows: many })).status).toBe(400)
  })
})

describe('import: Flespi devices for the missing IMEIs (opt-in)', () => {
  it('creates one device per missing IMEI exactly as a single add does, and links the ones that exist', async () => {
    fl.devices.push({ id: 100, name: 'Existing', device_type_id: 579, configuration: { ident: '350000000001001' } })
    const res = await send({ createDevices: true, deviceType: 'Teltonika FMC130', rows: [sheetRow(1), sheetRow(2, { plate: 'T 2' })] })
    expect(res.status).toBe(201)
    expect(res.body.data.created.map(c => [c.row, c.flespi])).toEqual([[1, 'linked'], [2, 'created']])
    // One device was created (id 9000), the existing one was neither renamed nor duplicated.
    expect(writes()).toEqual(['POST /gw/devices', 'POST /gw/streams/77/devices/9000'])
    expect(fl.devices.map(d => d.id)).toEqual([100, 9000])
    expect(fl.devices[0].name).toBe('Existing')
    expect(fl.devices[1]).toMatchObject({ name: 'T 2', device_type_id: 579, configuration: { ident: '350000000001002' } })
    const a = await prisma.vehicle.findUnique({ where: { imei: '350000000001001' } })
    const b = await prisma.vehicle.findUnique({ where: { imei: '350000000001002' } })
    expect([a.flespiDeviceId, b.flespiDeviceId]).toEqual([100, 9000])
    expect(b.deviceType).toBe('Teltonika FMC130')
  })

  it('needs a device type when asked to create devices', async () => {
    const res = await send({ createDevices: true, rows: [sheetRow(1)] })
    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual({ deviceType: 'Choose the device type' })
    expect(await prisma.vehicle.count({ where: { imei: '350000000001001' } })).toBe(0)
  })

  it('a refused device (Flespi limit) leaves that vehicle unsaved, and the linked ones are still imported', async () => {
    fl.devices.push({ id: 100, name: 'Existing', device_type_id: 579, configuration: { ident: '350000000001001' } })
    fl.limit = true
    const res = await send({ createDevices: true, deviceType: 'Teltonika FMC130', rows: [sheetRow(1), sheetRow(2), sheetRow(3)] })
    expect(res.body.data.created.map(c => c.row)).toEqual([1])
    expect(res.body.data.errors.map(e => e.row)).toEqual([2, 3])
    expect(res.body.data.errors[0].message).toMatch(/device limit/i)
    expect(await prisma.vehicle.count({ where: { imei: { in: ['350000000001002', '350000000001003'] } } })).toBe(0)
    // Only the first refused POST went out; the second row did not retry.
    expect(writes().filter(c => c === 'POST /gw/devices')).toHaveLength(1)
  })
})

describe('import: scope and permissions', () => {
  it('another tenant’s BG is not writable', async () => {
    const res = await send({ rows: [sheetRow(1)] }, fx.tokens.bgUserB1a)
    expect([403, 404]).toContain(res.status)
    expect(await prisma.vehicle.count({ where: { imei: '350000000001001' } })).toBe(0)
  })

  it('a sub-user (no vehicle write) cannot import', async () => {
    const res = await send({ rows: [sheetRow(1)] }, fx.tokens.subUserA1a)
    expect(res.status).toBe(403)
    expect(await prisma.vehicle.count({ where: { imei: '350000000001001' } })).toBe(0)
  })

  it('a branch of another BG is refused', async () => {
    const res = await send({ branchId: fx.branches.sharjah.id, rows: [sheetRow(1)] })
    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual({ branchId: 'Invalid branch' })
  })

  it('a super admin may import into any BG, and no token means 401', async () => {
    const res = await send({ bgId: fx.bgB1a.id, rows: [sheetRow(1)] }, fx.tokens.superAdmin)
    expect(res.status).toBe(201)
    expect((await prisma.vehicle.findUnique({ where: { imei: '350000000001001' } })).bgId).toBe(fx.bgB1a.id)
    expect((await request(app).post('/api/vehicles/import').send({ bgId: fx.bgA1a.id, rows: [sheetRow(1)] })).status).toBe(401)
  })
})
