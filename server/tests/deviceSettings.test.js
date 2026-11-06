/**
 * Device settings from FleetmaxX (routes/deviceSettings.js) and the
 * Suspended Driver Driving alert.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, FLESPI_TOKEN: 'mock-master-token' })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { clearDeviceCache } = await import('../src/lib/flespi.js')
const { evaluate } = await import('../src/lib/alertEngine.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
let settings
let puts

const baseSettings = (host = 'iavmep.itc.gov.ae') => [
  { name: 'overspeeding_dout3', current: { max_speed: 120, output: { control: 0 }, prio: 1 }, pending: null, updated: 100 },
  { name: 'green_driving_dout3', current: { duration: false, max_accel: 2.5, max_angle: 3.4, max_brake: 2.7, output: { control: 0 }, prio: 0, source: 0 }, pending: null, updated: 100 },
  { name: 'idling_dout3', current: { move_time: 5, output: { control: 0 }, prio: 0, record: true, stop_time: 300 }, pending: null, updated: 100 },
  { name: 'cpureset', current: null, pending: null, updated: 0 },
  { name: 'gprs_server', current: { host, port: 31000, protocol: 0 }, pending: null, updated: 100 },
]

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  settings = baseSettings()
  puts = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const u = String(url)
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    let m
    if ((m = /\/gw\/devices\/(\d+)\/settings\/all/.exec(u))) return json({ result: settings })
    if ((m = /\/gw\/devices\/(\d+)\/settings\/([a-z_0-9]+)/.exec(u)) && init.method === 'PUT') {
      const body = JSON.parse(init.body)
      puts.push({ device: Number(m[1]), name: m[2], body })
      const s = settings.find(x => x.name === m[2])
      if (s) s.pending = body.properties ?? {}
      return json({ result: [s] })
    }
    if (u.includes('/gw/devices/all')) {
      return json({ result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, configuration: { ident: `86307101123450${i + 1}` } })) })
    }
    return json({ result: [] })
  })
})

afterEach(() => vi.unstubAllGlobals())

const SA = () => auth(fx.tokens.superAdmin)
const BG = () => auth(fx.tokens.bgUserA1a)

describe('GET /api/device-settings/:deviceId', () => {
  it('reads the editable settings and the platform the tracker reports to first', async () => {
    const res = await request(app).get('/api/device-settings/101').set(SA())
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      supported: true, canEdit: true, primaryPlatform: { host: 'iavmep.itc.gov.ae', itc: true },
      settings: { overspeed: { name: 'overspeeding_dout3', current: { max_speed: 120 } }, idling: { current: { stop_time: 300 } } },
    })
    expect((await request(app).get('/api/device-settings/101').set(BG())).body.data.canEdit).toBe(false)
  })

  it('hides a device outside the caller scope', async () => {
    // v8/v9 belong to another tenant: device 108 is not bgUserA1a's.
    expect((await request(app).get('/api/device-settings/108').set(BG())).status).toBe(404)
  })
})

describe('PUT /api/device-settings/:deviceId/:key', () => {
  it('lets only an administrator change a setting', async () => {
    const res = await request(app).put('/api/device-settings/101/overspeed').set(BG()).send({ values: { max_speed: 80 }, confirmPlatform: true })
    expect(res.status).toBe(403)
    expect(puts).toHaveLength(0)
  })

  it('needs confirmation on a tracker that reports to another platform first', async () => {
    const res = await request(app).put('/api/device-settings/101/overspeed').set(SA()).send({ values: { max_speed: 80 } })
    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/UAE ITC/)
    expect(puts).toHaveLength(0)
  })

  it('sends the whole setting with the new value and reports it pending', async () => {
    const res = await request(app).put('/api/device-settings/101/overspeed').set(SA()).send({ values: { max_speed: 80 }, confirmPlatform: true })
    expect(res.status).toBe(200)
    expect(puts[0]).toEqual({ device: 101, name: 'overspeeding_dout3', body: { address: 'connection', properties: { max_speed: 80, output: { control: 0 }, prio: 1 } } })
    expect(res.body.data.setting.pending).toMatchObject({ max_speed: 80 })
  })

  it('needs no confirmation on a Flespi-only tracker, and keeps values inside the device limits', async () => {
    settings = baseSettings('ch1397963.flespi.gw')
    const ok = await request(app).put('/api/device-settings/101/greenDriving').set(SA()).send({ values: { max_angle: 3.0, max_brake: 2.5 } })
    expect(ok.status).toBe(200)
    expect(puts[0].body.properties).toMatchObject({ max_angle: 3, max_brake: 2.5, max_accel: 2.5, source: 0 })
    expect((await request(app).put('/api/device-settings/101/greenDriving').set(SA()).send({ values: { max_angle: 20.05 } })).status).toBe(400)
    expect((await request(app).put('/api/device-settings/101/overspeed').set(SA()).send({ values: { max_speed: 80.5 } })).status).toBe(400)
    expect((await request(app).put('/api/device-settings/101/overspeed').set(SA()).send({ values: { output: 1 } })).status).toBe(400)
    expect((await request(app).put('/api/device-settings/101/gprs').set(SA()).send({ values: { port: 1 } })).status).toBe(404)
  })

  it('restarts the tracker on request', async () => {
    const res = await request(app).post('/api/device-settings/101/reset').set(SA()).send({ confirmPlatform: true })
    expect(res.status).toBe(200)
    expect(puts[0]).toEqual({ device: 101, name: 'cpureset', body: { address: 'connection' } })
  })
})

describe('Suspended Driver Driving alert', () => {
  const NOW = 1_800_000_000
  const ctx = { suspendedByTag: new Map([['AAAA', { name: 'Off Duty' }]]) }
  const tel = o => ({ speed: 30, ignition: true, ts: NOW - 20, ibutton: 'AAAA', ...o })

  it('fires once when a suspended driver tag is read with the engine on, and again after the tag is removed', () => {
    const a = { type: 'suspended_driver' }
    let r = evaluate(a, tel(), {}, NOW, ctx)
    expect(r.fire.message).toBe('Suspended driver Off Duty is driving (iButton AAAA)')
    expect(evaluate(a, tel(), r.state, NOW, ctx).fire).toBeNull()
    r = evaluate(a, tel({ ibutton: '' }), r.state, NOW, ctx)
    expect(r.state.tag).toBeNull()
    expect(evaluate(a, tel(), r.state, NOW, ctx).fire).not.toBeNull()
    expect(evaluate(a, tel({ ibutton: 'BBBB' }), {}, NOW, ctx).fire).toBeNull()
    expect(evaluate(a, tel({ ignition: false, speed: 0 }), {}, NOW, ctx).fire).toBeNull()
  })
})
