/**
 * Our own telemetry (lib/telemetry.js): the Flespi webhook, batched storage,
 * daily partitions, and the Flespi proxy answering from our copy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const H = vi.hoisted(() => ({ token: 'test-ingest-token-0123456789abcdef' }))
const TOKEN = H.token

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, INGEST_TOKEN: H.token, FLESPI_TOKEN: 'mock-master-token', TELEMETRY_RETENTION_DAYS: 90 })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
const T = await import('../src/lib/telemetry.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

const NOW = Math.floor(Date.now() / 1000)
const msg = (over = {}) => ({
  'device.id': 101, ident: '860000000000001', timestamp: NOW - 60,
  'position.latitude': 24.4, 'position.longitude': 54.4, 'position.speed': 42,
  'position.direction': 90, 'engine.ignition.status': true, 'vehicle.mileage': 1234.5,
  'position.satellites': 12, 'position.valid': true, ...over,
})
const post = (body, token = TOKEN) => request(app).post('/api/ingest/flespi').set('Authorization', `Bearer ${token}`).send(body)

beforeEach(async () => {
  await resetDb()
  T.__resetTelemetry()
  await T.maintainPartitions()
  fx = await seedFixture()
})

afterEach(() => vi.unstubAllGlobals())

describe('normalize', () => {
  it('maps the fields the app reads, and keeps rarer ones in extra', () => {
    const row = T.normalize(msg({ 'ble.sensor.temperature.2': -4, 'external.powersource.status': true, junk: 'x' }))
    expect(row).toMatchObject({ deviceId: 101, ts: NOW - 60, lat: 24.4, speed: 42, ignition: true, odometerKm: 1234.5, satellites: 12, valid: true })
    expect(row.extra).toEqual({ 'ble.sensor.temperature.2': -4, 'external.powersource.status': true })
  })

  it('skips a message with no device or time', () => {
    expect(T.normalize({ timestamp: 1 })).toBeNull()
    expect(T.normalize({ 'device.id': 1 })).toBeNull()
  })

  it('turns a stored row back into a Flespi message', () => {
    expect(T.toFlespiMessage(T.normalize(msg()))).toMatchObject({ 'device.id': 101, timestamp: NOW - 60, 'position.speed': 42, 'engine.ignition.status': true })
  })
})

describe('POST /api/ingest/flespi', () => {
  it('refuses a wrong token', async () => {
    expect((await post([msg()], 'wrong-token-wrong-token-wrong')).status).toBe(401)
  })

  it('stores a batch once, even when Flespi sends it again', async () => {
    const batch = [msg({ timestamp: NOW - 120 }), msg({ timestamp: NOW - 60 }), { nonsense: true }]
    const res = await post(batch)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ accepted: 2, skipped: 1 })
    await post(batch) // a retry of the same batch
    await T.flush()
    expect(await prisma.telemetryMessage.count()).toBe(2)
    const state = await prisma.deviceState.findUnique({ where: { deviceId: 101 } })
    expect(state).toMatchObject({ ts: NOW - 60, speed: 42, ignition: true })
  })

  it('never lets an older message overwrite the latest state', async () => {
    await post([msg({ timestamp: NOW - 10, 'position.speed': 80 })])
    await post([msg({ timestamp: NOW - 500, 'position.speed': 5 })])
    await T.flush()
    expect(T.getLatest(101).speed).toBe(80)
    expect((await prisma.deviceState.findUnique({ where: { deviceId: 101 } })).speed).toBe(80)
  })

  it('keeps the last known value of a field a message leaves out', async () => {
    await post([msg({ timestamp: NOW - 20 })])
    await post([{ 'device.id': 101, timestamp: NOW - 10, 'position.speed': 0 }])
    expect(T.getLatest(101)).toMatchObject({ ts: NOW - 10, speed: 0, lat: 24.4, ignition: true })
  })

  it('accepts 5,000 vehicles in one batch', async () => {
    const big = Array.from({ length: 5000 }, (_, i) => msg({ 'device.id': 1000 + i }))
    const res = await post(big)
    expect(res.body.data.accepted).toBe(5000)
    await T.flush()
    expect(await prisma.telemetryMessage.count()).toBe(5000)
    expect(await prisma.deviceState.count()).toBe(5000)
  })
})

describe('daily partitions', () => {
  it('writes into the day partition and drops days past retention', async () => {
    await post([msg()])
    await T.flush()
    const day = new Date((NOW - 60) * 1000)
    const p = n => String(n).padStart(2, '0')
    const part = `TelemetryMessage_${day.getUTCFullYear()}${p(day.getUTCMonth() + 1)}${p(day.getUTCDate())}`
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${part}"`)
    expect(n).toBe(1)

    // 100 days later that partition is past the 90-day retention.
    const { dropped } = await T.maintainPartitions(NOW + 100 * 86400)
    expect(dropped).toContain(part)
    expect(await prisma.telemetryMessage.count()).toBe(0)
  })
})

describe('Flespi proxy answers from our copy', () => {
  it('serves live telemetry and history locally once the webhook is delivering', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await post([msg({ timestamp: NOW - 300 }), msg({ timestamp: NOW - 30, 'position.speed': 55 })])
    await T.flush()

    const tel = await request(app).get('/api/flespi/proxy/gw/devices/101/telemetry/position.speed').set(auth(fx.tokens.superAdmin))
    expect(tel.status).toBe(200)
    expect(tel.headers['x-fleetmaxx-source']).toBe('local')
    expect(tel.body.result[0]).toMatchObject({ id: 101 })
    expect(tel.body.result[0].telemetry['position.speed'].value).toBe(55)

    const data = JSON.stringify({ from: NOW - 300, to: NOW, count: 3000, fields: 'position.speed,timestamp' })
    const hist = await request(app).get(`/api/flespi/proxy/gw/devices/101/messages?data=${encodeURIComponent(data)}`).set(auth(fx.tokens.superAdmin))
    expect(hist.headers['x-fleetmaxx-source']).toBe('local')
    expect(hist.body.result.map(m => m['position.speed'])).toEqual([42, 55])
    expect(Object.keys(hist.body.result[0]).sort()).toEqual(['device.id', 'position.speed', 'timestamp'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers "all devices" only once the fleet is seeded, parked ones included', async () => {
    await post([msg({ 'device.id': 101, timestamp: NOW - 30 })])
    await T.flush()
    // Only one tracker has sent since the start: "all" must not be answered from that alone.
    expect(T.telemetryResponse(null)).toBeNull()

    // The seed: one Flespi read that also knows the parked device 202.
    const telemetry = { result: [
      { id: 101, telemetry: { timestamp: { value: NOW - 500, ts: NOW - 500 }, 'position.speed': { value: 1, ts: NOW - 500 } } },
      { id: 202, telemetry: { timestamp: { value: NOW - 7200, ts: NOW - 7200 }, 'position.latitude': { value: 25.1, ts: NOW - 7200 } } },
    ] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(telemetry), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await T.seedFromFlespi()).toBe(1) // 202 added; 101 already newer here
    const all = T.telemetryResponse(null)
    expect(all.result.map(r => r.id).sort()).toEqual([101, 202])
    expect(all.result.find(r => r.id === 101).telemetry.timestamp.value).toBe(NOW - 30) // the webhook's newer one kept
  })

  it('live stream: 204 while the webhook is quiet, then a snapshot and pushed updates', async () => {
    const server = app.listen(0)
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      const quiet = await fetch(`${base}/api/live/stream`, { headers: auth(fx.tokens.superAdmin) })
      expect(quiet.status).toBe(204)

      await post([msg({ timestamp: NOW - 30, 'position.speed': 10 })])
      const ctrl = new AbortController()
      const res = await fetch(`${base}/api/live/stream`, { headers: auth(fx.tokens.superAdmin), signal: ctrl.signal })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let text = ''
      const readUntil = async needle => {
        while (!text.includes(needle)) text += dec.decode((await reader.read()).value, { stream: true })
      }
      await readUntil('event: snapshot')
      await readUntil('\n\n')
      expect(text).toContain('"id":101')

      // A new message is pushed within a second.
      await post([msg({ timestamp: NOW - 5, 'position.speed': 77 })])
      await readUntil('event: update')
      await readUntil('"value":77')
      ctrl.abort()
    } finally {
      server.close()
    }
  })

  it('asks Flespi for parameters our copy does not hold', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ result: [{ id: 101, telemetry: {} }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)
    await post([msg()])
    await T.flush()
    for (const fields of ['all', 'gsm.signal.level', 'position.speed,battery.voltage']) {
      const res = await request(app).get(`/api/flespi/proxy/gw/devices/101/telemetry/${fields}`).set(auth(fx.tokens.superAdmin))
      expect(res.status).toBe(200)
      expect(res.headers['x-fleetmaxx-source']).toBeUndefined()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('still asks Flespi for a range older than the history we hold', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ result: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)
    await post([msg()])
    await T.flush()
    const data = JSON.stringify({ from: NOW - 30 * 86400, to: NOW, count: 3000 })
    const res = await request(app).get(`/api/flespi/proxy/gw/devices/101/messages?data=${encodeURIComponent(data)}`).set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    expect(res.headers['x-fleetmaxx-source']).toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
