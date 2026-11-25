/**
 * The Uffizio fuel-vehicle feed (lib/uffizio.js, routes/uffizio.js). Uffizio
 * and Flespi are both faked here — no test reaches the network, and every
 * name, number and IMEI below is invented.
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
const { buildAcl } = await import('../src/lib/flespiGrant.js')
const { buildScope } = await import('../src/lib/scope.js')
const U = await import('../src/lib/uffizio.js')
const { signToken } = await import('../src/lib/jwt.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
let up

const BASE = 'https://uffizio.example.test'
const USER = 'fleet-user-x'
const PASS = 'Sup3r-Secret-Pass'
const TOKEN = 'tok-abc-123456'
const COMPANY = 'Desert Lark Leasing'
const ENV = { UFFIZIO_BASE: BASE, UFFIZIO_USER: USER, UFFIZIO_PASS: PASS, UFFIZIO_COMPANY: COMPANY, UFFIZIO_PROJECT_ID: '49' }

/** An invented VehicleData row in Uffizio's shape. */
const row = (n, extra = {}) => ({
  Vehicle_Name: `ZZ ${1000 + n} Q1`,
  Vehicle_No: `90 00${n} 01`,
  Company: COMPANY,
  Branch: 'Test Yard',
  Vehicletype: 'Truck',
  Latitude: '24.4' + n,
  Longitude: '54.6' + n,
  Speed: '0',
  Angle: '90',
  IGN: 'OFF',
  Status: 'STOP',
  GPS: 'ON',
  Power: 'ON',
  ExternalVolt: '27.1',
  Temperature: '--',
  Odometer: '12345',
  DeviceModel: 'FMC130',
  Imeino: `35000000000000${n}`,
  Datetime: '24-11-2026 13:05:09',
  GPSActualTime: '24-11-2026 13:05:00',
  Location: 'Invented Road, Test City',
  Driver_First_Name: '--',
  'Ibutton/RFID': '',
  Fuel: [{ port_name: 'BLE Fuel Level #1', value: 3000 + n }],
  ...extra,
})

/** A tiny Uffizio: sign-in, live data, and a log of what was asked. */
function fakeUffizio() {
  const s = {
    rows: [row(1), row(2)],
    loginOk: true,
    liveStatus: 200,
    liveBody: null, // overrides the answer when set
    calls: [],
    flespiCalls: [],
  }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  s.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(url)
    if (u.host.includes('flespi')) {
      s.flespiCalls.push(`${init.method ?? 'GET'} ${u.pathname}`)
      if (u.pathname === '/gw/devices/all') return json({ result: [] })
      return json({ result: [] })
    }
    const op = u.searchParams.get('token')
    const body = init.body ? JSON.parse(init.body) : {}
    s.calls.push({ op, headers: init.headers ?? {}, body, project: u.searchParams.get('ProjectId') })
    if (op === 'generateAccessToken') {
      if (!s.loginOk || body.username !== USER || body.password !== PASS) return json({ result: 0, message: 'Incorrect username or password' })
      return json({ result: 1, data: { token: TOKEN }, message: '' })
    }
    if (op === 'getTokenBaseLiveData') {
      if (s.liveStatus !== 200) return json({ message: 'busy' }, s.liveStatus)
      if (s.liveBody) return json(s.liveBody)
      if (init.headers?.['auth-code'] !== TOKEN) return json({ result: 0, message: 'Invalid auth-code token' })
      if (body.company_names !== COMPANY) return json({ result: 0, message: `${body.company_names} Does Not Belongs To Given User` })
      return json({ root: { VehicleData: s.rows } })
    }
    return json({ result: 0, message: 'unknown' }, 404)
  })
  return s
}

const saved = {}
const setEnv = vars => {
  for (const k of ['UFFIZIO_BASE', 'UFFIZIO_USER', 'UFFIZIO_PASS', 'UFFIZIO_COMPANY', 'UFFIZIO_PROJECT_ID', 'UFFIZIO_BG_ID', 'UFFIZIO_POLL_MS']) {
    if (!(k in saved)) saved[k] = process.env[k]
    delete process.env[k]
  }
  Object.assign(process.env, vars)
}

let clock
const now = () => clock

beforeEach(async () => {
  await resetDb()
  clearDeviceCache()
  __resetFlespiDevices()
  U.__resetUffizio()
  fx = await seedFixture()
  setEnv({ ...ENV, UFFIZIO_BG_ID: fx.bgA2.id })
  up = fakeUffizio()
  vi.stubGlobal('fetch', up.fetch)
  clock = Date.now()
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

const later = sec => { clock += sec * 1000 }
const liveCalls = () => up.calls.filter(c => c.op === 'getTokenBaseLiveData')

describe('parsing', () => {
  it('reads Uffizio times as UAE time (UTC+4)', () => {
    expect(new Date(U.parseUffizioTime('24-11-2026 13:05:09')).toISOString()).toBe('2026-11-24T09:05:09.000Z')
    expect(new Date(U.parseUffizioTime('01-01-2027 02:00:00')).toISOString()).toBe('2026-12-31T22:00:00.000Z')
    expect(new Date(U.parseUffizioTime('2026-11-24T13:05:09Z')).toISOString()).toBe('2026-11-24T13:05:09.000Z')
    expect(U.parseUffizioTime('31-02-2026 10:00:00')).toBeNull()
    expect(U.parseUffizioTime('--')).toBeNull()
    expect(U.parseUffizioTime('')).toBeNull()
  })

  it('normalises one row', () => {
    const r = U.normaliseRow(row(3, { IGN: 'ON', Speed: '42.5', 'Ibutton/RFID': '01AB23CD', Fuel: [{ port_name: 'BLE Fuel Level #1', value: 788 }, { port_name: 'X', value: '--' }] }))
    expect(r).toMatchObject({
      imei: '350000000000003', plate: 'ZZ 1003 Q1', fleetNo: '90 003 01', model: 'FMC130',
      ign: true, speed: 42.5, odometer: 12345, driverTag: '01AB23CD',
      fuel: [{ port: 'BLE Fuel Level #1', raw: 788 }],
    })
    expect(r.lat).toBeCloseTo(24.43)
    expect(new Date(r.ts).toISOString()).toBe('2026-11-24T09:05:09.000Z')
    expect(U.normaliseRow({ Vehicle_Name: 'no imei' })).toBeNull()
    expect(U.normaliseRow(row(4, { Latitude: '0', Longitude: '0', IGN: 'OFF', 'Ibutton/RFID': '0000' }))).toMatchObject({ lat: null, lng: null, ign: false, driverTag: null })
  })
})

describe('polling', () => {
  it('signs in, reads the company, and adds the vehicles to the BG as Uffizio vehicles', async () => {
    const r = await U.pollOnce({ now })
    expect(r).toMatchObject({ ok: true, rows: 2, created: 2, inserted: 2 })
    const login = up.calls.find(c => c.op === 'generateAccessToken')
    expect(login.body).toEqual({ username: USER, password: PASS })
    const live = liveCalls()[0]
    expect(live.headers['auth-code']).toBe(TOKEN)
    expect(live.body).toEqual({ company_names: COMPANY })
    expect(live.project).toBe('49')

    const vs = await prisma.vehicle.findMany({ where: { dataSource: 'UFFIZIO' }, orderBy: { imei: 'asc' } })
    expect(vs.map(v => [v.bgId, v.plateNo, v.fleetNo, v.deviceType, v.imei])).toEqual([
      [fx.bgA2.id, 'ZZ 1001 Q1', '90 001 01', 'FMC130', '350000000000001'],
      [fx.bgA2.id, 'ZZ 1002 Q1', '90 002 01', 'FMC130', '350000000000002'],
    ])
    const readings = await prisma.fuelReading.findMany({ orderBy: { raw: 'asc' } })
    expect(readings.map(x => [x.port, x.raw, x.ign, x.ts.toISOString()])).toEqual([
      ['BLE Fuel Level #1', 3001, false, '2026-11-24T09:05:09.000Z'],
      ['BLE Fuel Level #1', 3002, false, '2026-11-24T09:05:09.000Z'],
    ])
    // The install is in the Reallocation History, and no Flespi device was touched.
    expect(await prisma.vehicleMove.count({ where: { level: 'device', vehicleId: vs[0].id } })).toBe(1)
    expect(up.flespiCalls.filter(c => !c.startsWith('GET'))).toEqual([])
  })

  it('is idempotent: the same record twice adds nothing; a new Datetime adds readings; a rename in Uffizio is only noted', async () => {
    await U.pollOnce({ now })
    later(125)
    const again = await U.pollOnce({ now })
    expect(again).toMatchObject({ ok: true, created: 0, updated: 0, inserted: 0 })
    expect(await prisma.vehicle.count({ where: { dataSource: 'UFFIZIO' } })).toBe(2)
    expect(await prisma.fuelReading.count()).toBe(2)

    up.rows = [row(1, { Datetime: '24-11-2026 13:07:10', Fuel: [{ port_name: 'BLE Fuel Level #1', value: 2950 }] }), row(2, { Vehicle_Name: 'ZZ 2002 Q9', DeviceModel: 'FMM130' })]
    later(125)
    const third = await U.pollOnce({ now })
    expect(third).toMatchObject({ ok: true, created: 0, updated: 1, inserted: 1 })
    expect(await prisma.fuelReading.count()).toBe(3)
    // Imported as it was, edited in FleetmaxX later: Uffizio's new name is kept beside it, not copied.
    const v2 = await prisma.vehicle.findUnique({ where: { imei: '350000000000002' } })
    expect(v2).toMatchObject({ plateNo: 'ZZ 1002 Q1', deviceType: 'FMC130', uffizioName: 'ZZ 2002 Q9', uffizioNo: '90 002 01' })
    expect(await prisma.vehicleMove.count({ where: { vehicleId: v2.id, level: 'rename' } })).toBe(0)
    const st = await request(app).get('/api/uffizio/status').set(auth(fx.tokens.superAdmin))
    expect(st.body.data.renamed).toEqual([expect.objectContaining({ id: v2.id, plateNo: 'ZZ 1002 Q1', uffizioName: 'ZZ 2002 Q9' })])
  })

  it('edits made in FleetmaxX survive every poll', async () => {
    await U.pollOnce({ now })
    const v1 = await prisma.vehicle.findUnique({ where: { imei: '350000000000001' } })
    const branch = await prisma.branch.create({ data: { bgId: fx.bgA2.id, name: 'Invented Depot' } })
    const edit = await request(app).put(`/api/vehicles/${v1.id}`).set(auth(fx.tokens.superAdmin))
      .send({ plateNo: 'AA 111 X', fleetNo: 'FL-7', model: 'Actros', deviceType: 'Teltonika FMC130 (edited)', branchId: branch.id })
    expect(edit.status).toBe(200)
    await request(app).put(`/api/vehicles/${v1.id}/custom-fields`).set(auth(fx.tokens.superAdmin)).send({ fields: [{ name: 'Contract', value: 'C-1' }] })
    later(125)
    up.rows = [row(1, { Datetime: '24-11-2026 13:09:00' }), row(2)]
    expect(await U.pollOnce({ now })).toMatchObject({ ok: true, created: 0 })
    const after = await prisma.vehicle.findUnique({ where: { id: v1.id } })
    expect(after).toMatchObject({ plateNo: 'AA 111 X', fleetNo: 'FL-7', model: 'Actros', deviceType: 'Teltonika FMC130 (edited)', branchId: branch.id, uffizioName: 'ZZ 1001 Q1' })
    expect(up.flespiCalls.filter(c => !c.startsWith('GET'))).toEqual([])
  })

  it('a vehicle removed in FleetmaxX stays removed, is listed, and can be restored; a new one is still imported', async () => {
    await U.pollOnce({ now })
    const v1 = await prisma.vehicle.findUnique({ where: { imei: '350000000000001' } })
    const del = await request(app).delete(`/api/vehicles/${v1.id}`).set(auth(fx.tokens.superAdmin))
    expect(del.status).toBe(200)
    expect(del.body.data).toMatchObject({ id: v1.id, archived: true })
    const archived = await prisma.vehicle.findUnique({ where: { id: v1.id } })
    expect(archived.deletedAt).not.toBeNull()
    expect(archived.imei).toBe('350000000000001')
    // Gone from the register.
    const list = await request(app).get('/api/vehicles').set(auth(fx.tokens.superAdmin))
    expect(list.body.data.map(v => v.id)).not.toContain(v1.id)

    up.rows = [row(1, { Datetime: '24-11-2026 13:09:00' }), row(2), row(3)]
    later(125)
    const r = await U.pollOnce({ now })
    expect(r).toMatchObject({ ok: true, created: 1, removed: 1 })
    expect(await prisma.vehicle.count({ where: { imei: '350000000000001' } })).toBe(1)
    expect(await prisma.fuelReading.count({ where: { vehicleId: v1.id } })).toBe(1) // nothing new for it
    expect(await prisma.vehicle.findUnique({ where: { imei: '350000000000003' } })).toMatchObject({ dataSource: 'UFFIZIO', bgId: fx.bgA2.id })

    const st = await request(app).get('/api/uffizio/status').set(auth(fx.tokens.superAdmin))
    expect(st.body.data.removed).toEqual([expect.objectContaining({ id: v1.id, imei: '350000000000001', plateNo: 'ZZ 1001 Q1' })])
    expect(st.body.data.vehicles).toBe(2)

    expect((await request(app).post(`/api/uffizio/vehicles/${v1.id}/restore`).set(auth(fx.tokens.bgUserA1a))).status).toBe(403)
    const back = await request(app).post(`/api/uffizio/vehicles/${v1.id}/restore`).set(auth(fx.tokens.superAdmin))
    expect(back.status).toBe(200)
    expect(back.body.data.status.removed).toEqual([])
    expect((await prisma.vehicle.findUnique({ where: { id: v1.id } })).deletedAt).toBeNull()
    expect((await request(app).post(`/api/uffizio/vehicles/${v1.id}/restore`).set(auth(fx.tokens.superAdmin))).status).toBe(404)
    const hist = await prisma.vehicleMove.findMany({ where: { vehicleId: v1.id, level: 'device' }, orderBy: { movedAt: 'asc' } })
    expect(hist.map(h => h.note)).toEqual(['Added from Uffizio', expect.stringMatching(/^Removed in FleetmaxX/), 'Restored in FleetmaxX'])
  })

  it('a Flespi vehicle is still deleted for good', async () => {
    const res = await request(app).delete(`/api/vehicles/${fx.vehicles.v1.id}`).set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    expect(await prisma.vehicle.findUnique({ where: { id: fx.vehicles.v1.id } })).toBeNull()
  })

  it('never takes over a Flespi vehicle with the same IMEI', async () => {
    up.rows = [row(1, { Imeino: fx.vehicles.v1.imei, Vehicle_Name: 'ZZ HIJACK' }), row(2)]
    const r = await U.pollOnce({ now })
    expect(r).toMatchObject({ ok: true, created: 1, inserted: 1 })
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0]).toMatchObject({ reason: 'flespi', imei: fx.vehicles.v1.imei })
    const v1 = await prisma.vehicle.findUnique({ where: { id: fx.vehicles.v1.id } })
    expect(v1).toMatchObject({ dataSource: 'FLESPI', bgId: fx.vehicles.v1.bgId, plateNo: fx.vehicles.v1.plateNo })
    expect(await prisma.fuelReading.count({ where: { vehicleId: v1.id } })).toBe(0)
  })

  it('keeps at least 120 s between live-data calls', async () => {
    await U.pollOnce({ now })
    later(60)
    const soon = await U.pollOnce({ now })
    expect(soon).toMatchObject({ ok: false, rate: true })
    expect(soon.retryAt).toBe(clock - 60_000 + U.MIN_GAP_MS)
    expect(liveCalls()).toHaveLength(1)
    later(61)
    expect(await U.pollOnce({ now })).toMatchObject({ ok: true })
    expect(liveCalls()).toHaveLength(2)
    // The token was reused: one sign-in for both calls.
    expect(up.calls.filter(c => c.op === 'generateAccessToken')).toHaveLength(1)
  })

  it('answers 429 on Poll now inside the gap, with when it can run', async () => {
    const first = await request(app).post('/api/uffizio/poll').set(auth(fx.tokens.superAdmin))
    expect(first.status).toBe(200)
    expect(first.body.data.result).toMatchObject({ ok: true, created: 2 })
    const second = await request(app).post('/api/uffizio/poll').set(auth(fx.tokens.superAdmin))
    expect(second.status).toBe(429)
    expect(second.body.error.message).toMatch(/one call every 2 minutes/)
    expect(liveCalls()).toHaveLength(1)
  })

  it('backs off after a 429 or a 5xx', async () => {
    up.liveStatus = 429
    const r = await U.pollOnce({ now })
    expect(r).toMatchObject({ ok: false, kind: 'http' })
    expect(r.error).toMatch(/429/)
    expect(U.nextAllowedAt()).toBeGreaterThanOrEqual(clock + 2 * U.MIN_GAP_MS)
    up.liveStatus = 200
    later(125)
    expect(await U.pollOnce({ now })).toMatchObject({ ok: false, rate: true })
    later(200)
    expect(await U.pollOnce({ now })).toMatchObject({ ok: true })
  })

  it('reports a wrong login without the credentials, and does not call for data', async () => {
    up.loginOk = false
    const r = await U.pollOnce({ now })
    expect(r).toMatchObject({ ok: false, kind: 'login' })
    expect(r.error).toBe('Uffizio sign-in failed: Incorrect username or password')
    expect(liveCalls()).toHaveLength(0)
    const res = await request(app).get('/api/uffizio/status').set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    const text = JSON.stringify(res.body)
    expect(text).toContain('Incorrect username or password')
    for (const secret of [PASS, USER, TOKEN]) expect(text).not.toContain(secret)
  })

  it('reports a company that is not the user’s', async () => {
    process.env.UFFIZIO_COMPANY = 'Somebody Else Ltd'
    const r = await U.pollOnce({ now })
    expect(r).toMatchObject({ ok: false, kind: 'company' })
    expect(r.error).toBe('Uffizio: Somebody Else Ltd Does Not Belongs To Given User')
    expect(await prisma.vehicle.count({ where: { dataSource: 'UFFIZIO' } })).toBe(0)
  })

  it('drops a refused token and signs in again on the next poll', async () => {
    await U.pollOnce({ now })
    up.liveBody = { result: 0, message: 'Invalid auth-code token' }
    later(125)
    expect(await U.pollOnce({ now })).toMatchObject({ ok: false, kind: 'token' })
    expect(U.__hasToken()).toBe(false)
    up.liveBody = null
    later(125)
    expect(await U.pollOnce({ now })).toMatchObject({ ok: true })
    expect(up.calls.filter(c => c.op === 'generateAccessToken')).toHaveLength(2)
  })

  it('stays idle with a clear status when not set up', async () => {
    delete process.env.UFFIZIO_BG_ID
    delete process.env.UFFIZIO_PASS
    const r = await U.pollOnce({ now })
    expect(r).toMatchObject({ ok: false, idle: true })
    expect(r.error).toMatch(/UFFIZIO_PASS, UFFIZIO_BG_ID missing/)
    expect(up.calls).toHaveLength(0)
    const res = await request(app).get('/api/uffizio/status').set(auth(fx.tokens.superAdmin))
    expect(res.body.data).toMatchObject({ configured: false, missing: ['UFFIZIO_PASS', 'UFFIZIO_BG_ID'] })
    const poll = await request(app).post('/api/uffizio/poll').set(auth(fx.tokens.superAdmin))
    expect(poll.status).toBe(400)
  })

  it('test connection signs in only', async () => {
    const res = await request(app).post('/api/uffizio/test').set(auth(fx.tokens.superAdmin))
    expect(res.body.data).toEqual({ ok: true, message: 'Signed in to Uffizio' })
    expect(liveCalls()).toHaveLength(0)
    expect(U.nextAllowedAt()).toBe(0)
  })
})

describe('retention', () => {
  it('deletes readings older than 90 days', async () => {
    await U.pollOnce({ now })
    const v = await prisma.vehicle.findFirst({ where: { dataSource: 'UFFIZIO' } })
    await prisma.fuelReading.create({ data: { vehicleId: v.id, ts: new Date(Date.now() - 91 * 86400_000), port: 'BLE Fuel Level #1', raw: 1000 } })
    await prisma.fuelReading.create({ data: { vehicleId: v.id, ts: new Date(Date.now() - 89 * 86400_000), port: 'BLE Fuel Level #1', raw: 1001 } })
    expect(await U.cleanup()).toBe(1)
    expect(await prisma.fuelReading.count()).toBe(3)
  })
})

describe('who may see it', () => {
  it('a Super Admin and the fuel BG’s own accounts; nobody else', async () => {
    expect((await request(app).get('/api/uffizio/status').set(auth(fx.tokens.superAdmin))).status).toBe(200)
    expect((await request(app).get('/api/uffizio/status').set(auth(fx.tokens.ggbAdminA))).status).toBe(200) // bgA2 is in GGB A
    expect((await request(app).get('/api/uffizio/status').set(auth(fx.tokens.groupAdminA1))).status).toBe(403) // A2 is not in group A1
    expect((await request(app).get('/api/uffizio/status').set(auth(fx.tokens.bgUserA1a))).status).toBe(403)
    expect((await request(app).get('/api/uffizio/status').set(auth(fx.tokens.subUserA1a))).status).toBe(403)
  })
})

describe('Live Map data (state, trail, endpoints)', () => {
  it('normalises the rest of the live row', () => {
    const r = U.normaliseRow(row(5, {
      Angle: '179', Status: 'running', Temperature: 'analog 2 : 85.16', Odometer: '151983000', SOS: '--', battery_percentage: '87',
      satellite_count: 9, Power: 'ON', Driver_First_Name: 'Sample', Driver_Middle_Name: 'null', Driver_Last_Name: 'Driver', username: 'api-user@invented',
    }))
    expect(r).toMatchObject({ heading: 179, status: 'RUNNING', temperature: 85.16, odometerKm: 151983, sos: null, batteryPct: 87, satellites: 9, power: true, driverName: 'Sample Driver', vehicleType: 'Truck' })
    expect(r.raw).not.toHaveProperty('username')
    expect(r.raw.Angle).toBe('179')
    expect(U.normaliseRow(row(5, { Temperature1: '21.5', SOS: '1' }))).toMatchObject({ temperature: 21.5, sos: true })
  })

  it('keeps the latest row per vehicle and a position per new record', async () => {
    up.rows = [row(1, { Angle: '90', Status: 'STOP' }), row(2, { Latitude: '0', Longitude: '0' })]
    expect(await U.pollOnce({ now })).toMatchObject({ ok: true, positions: 1 })
    const v1 = await prisma.vehicle.findUnique({ where: { imei: '350000000000001' } })
    expect(await prisma.uffizioState.count()).toBe(2)
    expect(await prisma.uffizioPosition.count()).toBe(1) // no fix, no sample
    later(125)
    expect(await U.pollOnce({ now })).toMatchObject({ ok: true, positions: 0 }) // same record
    up.rows = [row(1, { Datetime: '24-11-2026 13:07:10', Speed: '48', IGN: 'ON', Status: 'RUNNING', Latitude: '24.45' }), row(2)]
    later(125)
    await U.pollOnce({ now })
    const st = await prisma.uffizioState.findUnique({ where: { vehicleId: v1.id } })
    expect(st).toMatchObject({ speed: 48, ign: true, status: 'RUNNING', lat: 24.45 })
    expect(st.ts.toISOString()).toBe('2026-11-24T09:07:10.000Z')
    expect(await prisma.uffizioPosition.count({ where: { vehicleId: v1.id } })).toBe(2)
  })

  it('GET /api/live/uffizio: the account’s own Uffizio vehicles, in the Live Map shape', async () => {
    await U.pollOnce({ now })
    const v1 = await prisma.vehicle.findUnique({ where: { imei: '350000000000001' } })
    const res = await request(app).get('/api/live/uffizio').set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    const a = res.body.data.find(x => x.vehicleId === v1.id)
    expect(a).toMatchObject({
      id: `uffizio:${v1.id}`, imei: '350000000000001', source: 'UFFIZIO', speed: 0, heading: 90, ign: false, status: 'STOP',
      externalVolt: 27.1, location: 'Invented Road, Test City', ts: Date.parse('2026-11-24T09:05:09Z') / 1000,
      fuel: { port: 'BLE Fuel Level #1', raw: 3001, calibrated: false, litres: null },
    })
    expect(a.raw).toMatchObject({ Vehicle_Name: 'ZZ 1001 Q1' })
    // Another BG's user sees none of them; the fuel BG's own user sees both.
    expect((await request(app).get('/api/live/uffizio').set(auth(fx.tokens.bgUserA1a))).body.data).toEqual([])
    const user = await prisma.user.create({ data: { email: 'a2-live@example.test', passwordHash: 'x', role: 'BG_USER', bgId: fx.bgA2.id, mustChangePassword: false } })
    const mine = await request(app).get('/api/live/uffizio').set(auth(signToken(user)))
    expect(mine.status).toBe(200)
    expect(mine.body.data.map(x => x.imei).sort()).toEqual(['350000000000001', '350000000000002'])
    // A removed one is gone from the map.
    await request(app).delete(`/api/vehicles/${v1.id}`).set(auth(fx.tokens.superAdmin))
    const after = await request(app).get('/api/live/uffizio').set(auth(fx.tokens.superAdmin))
    expect(after.body.data.map(x => x.vehicleId)).not.toContain(v1.id)
  })

  it('GET /api/live/uffizio/:id/messages: the trail in Flespi’s message shape', async () => {
    await U.pollOnce({ now })
    up.rows = [row(1, { Datetime: '24-11-2026 13:07:10', Speed: '48', IGN: 'ON', Angle: '45', Odometer: '20000' }), row(2)]
    later(125)
    await U.pollOnce({ now })
    const v1 = await prisma.vehicle.findUnique({ where: { imei: '350000000000001' } })
    const from = Date.parse('2026-11-24T09:00:00Z') / 1000
    const res = await request(app).get(`/api/live/uffizio/${v1.id}/messages?from=${from}&to=${from + 3600}`).set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    expect(res.body.result).toHaveLength(2)
    expect(res.body.result[1]).toMatchObject({
      'device.id': `uffizio:${v1.id}`, timestamp: Date.parse('2026-11-24T09:07:10Z') / 1000, 'position.speed': 48,
      'position.direction': 45, 'engine.ignition.status': true, 'vehicle.mileage': 20, 'position.valid': true,
    })
    expect((await request(app).get(`/api/live/uffizio/${v1.id}/messages?from=${from}&to=${from + 3600}`).set(auth(fx.tokens.bgUserA1a))).status).toBe(404)
    expect((await request(app).get(`/api/live/uffizio/${fx.vehicles.v1.id}/messages?from=${from}&to=${from + 3600}`).set(auth(fx.tokens.superAdmin))).status).toBe(404)
    expect((await request(app).get(`/api/live/uffizio/${v1.id}/messages?from=${from}&to=${from + 40 * 86400}`).set(auth(fx.tokens.superAdmin))).status).toBe(400)
  })

  it('positions follow the 90-day retention', async () => {
    await U.pollOnce({ now })
    const v = await prisma.vehicle.findFirst({ where: { dataSource: 'UFFIZIO' } })
    await prisma.uffizioPosition.create({ data: { vehicleId: v.id, ts: new Date(Date.now() - 91 * 86400_000), lat: 24, lng: 54 } })
    await U.cleanup()
    expect(await prisma.uffizioPosition.count({ where: { ts: { lt: new Date(Date.now() - 90 * 86400_000) } } })).toBe(0)
  })
})

describe('Uffizio vehicles in the Flespi code paths', () => {
  let uv
  beforeEach(async () => {
    await U.pollOnce({ now })
    uv = await prisma.vehicle.findUnique({ where: { imei: '350000000000001' } })
    up.flespiCalls.length = 0
  })

  it('an edit never creates or renames a Flespi device', async () => {
    const res = await request(app).put(`/api/vehicles/${uv.id}`).set(auth(fx.tokens.superAdmin)).send({ plateNo: 'ZZ 1001 Q1', make: 'Volvo', deviceType: 'Teltonika FMC130' })
    expect(res.status).toBe(200)
    expect(res.body.data.make).toBe('Volvo')
    expect(up.flespiCalls).toEqual([])
    const imei = await request(app).put(`/api/vehicles/${uv.id}`).set(auth(fx.tokens.superAdmin)).send({ imei: '350000000000099' })
    expect(imei.status).toBe(400)
  })

  it('is never "missing from Flespi", and its tracker is not changed here', async () => {
    const st = await request(app).get(`/api/vehicles/${uv.id}/tracker-status`).set(auth(fx.tokens.superAdmin))
    expect(st.body.data).toMatchObject({ state: 'external', source: 'UFFIZIO' })
    for (const [path, body] of [['tracker', { imei: '350000000000077' }], ['tracker/remove', {}], ['tracker/sync', {}], ['merge', { targetId: fx.vehicles.v7.id }]]) {
      const r = await request(app).post(`/api/vehicles/${uv.id}/${path}`).set(auth(fx.tokens.superAdmin)).send(body)
      expect(r.status).toBe(400)
    }
    expect(up.flespiCalls.filter(c => !c.startsWith('GET'))).toEqual([])
    expect((await prisma.vehicle.findUnique({ where: { id: uv.id } })).imei).toBe('350000000000001')
  })

  it('is not an unmatched IMEI in a Flespi grant', async () => {
    const user = await prisma.user.create({ data: { email: 'a2@example.test', passwordHash: 'x', role: 'BG_USER', bgId: fx.bgA2.id } })
    const { unmatchedImeis } = await buildAcl(buildScope(user))
    expect(unmatchedImeis).toEqual([fx.vehicles.v7.imei])
  })
})
