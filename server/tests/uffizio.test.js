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

  it('is idempotent: the same record twice adds nothing; a new Datetime adds readings; a new plate renames', async () => {
    await U.pollOnce({ now })
    later(125)
    const again = await U.pollOnce({ now })
    expect(again).toMatchObject({ ok: true, created: 0, updated: 0, inserted: 0 })
    expect(await prisma.vehicle.count({ where: { dataSource: 'UFFIZIO' } })).toBe(2)
    expect(await prisma.fuelReading.count()).toBe(2)

    up.rows = [row(1, { Datetime: '24-11-2026 13:07:10', Fuel: [{ port_name: 'BLE Fuel Level #1', value: 2950 }] }), row(2, { Vehicle_Name: 'ZZ 2002 Q9' })]
    later(125)
    const third = await U.pollOnce({ now })
    expect(third).toMatchObject({ ok: true, created: 0, updated: 1, inserted: 1 })
    expect(await prisma.fuelReading.count()).toBe(3)
    const renamed = await prisma.vehicle.findUnique({ where: { imei: '350000000000002' } })
    expect(renamed.plateNo).toBe('ZZ 2002 Q9')
    const hist = await prisma.vehicleMove.findFirst({ where: { vehicleId: renamed.id, level: 'rename' } })
    expect(hist).toMatchObject({ fromName: 'ZZ 1002 Q1', toName: 'ZZ 2002 Q9', movedByName: 'Uffizio sync' })
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
