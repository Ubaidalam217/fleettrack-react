/**
 * Device Data Monitor (client, 2026-11-16): per-device traffic from the
 * webhook, our own Flespi usage, the overload rules and their episodes, the
 * "busy, retry" protection in the proxy and the Super-Admin-only API.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const H = vi.hoisted(() => ({ token: 'test-ingest-token-datamon-0123456789' }))

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, INGEST_TOKEN: H.token, FLESPI_TOKEN: 'mock-master-token', TELEMETRY_RETENTION_DAYS: 90 })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
const T = await import('../src/lib/telemetry.js')
const TM = await import('../src/lib/trafficMonitor.js')
const DM = await import('../src/lib/dataMonitor.js')
const flespi = await import('../src/lib/flespi.js')
const { runAsJob } = await import('../src/lib/requestSource.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
const S = TM.DEFAULT_SETTINGS
const MIN = 60_000
/** A minute boundary, so arrival minutes are predictable. */
const T0 = Math.floor(Date.now() / MIN) * MIN - 3 * 3_600_000
const V1_IMEI = '863071011234501'
let fx

const post = body => request(app).post('/api/ingest/flespi').set('Authorization', `Bearer ${H.token}`).send(body)

const raw = (id, ts, over = {}) => ({
  'device.id': id, ident: V1_IMEI, timestamp: ts, 'position.speed': 40, 'engine.ignition.status': true,
  'position.latitude': 25.2, 'position.longitude': 55.3, ...over,
})

/**
 * `perMinute` messages a minute for `minutes` minutes from `startMs`, each
 * stamped with its arrival second — as a tracker reporting every 60/perMinute s.
 */
function feed(id, { startMs, minutes, perMinute, ...over }) {
  const gapMs = 60_000 / perMinute
  for (let k = 0; k < minutes; k++) {
    for (let i = 0; i < perMinute; i++) {
      const arrival = startMs + k * MIN + i * gapMs
      const m = raw(id, Math.floor(arrival / 1000), over)
      TM.noteMessage(m, T.normalize(m), arrival)
    }
  }
}

const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(async () => {
  await resetDb()
  T.__resetTelemetry()
  TM.__resetTraffic()
  DM.__resetDataMonitor({ startMs: 0 }) // warmed up
  fx = await seedFixture()
})

afterEach(() => vi.unstubAllGlobals())

// ── rules ────────────────────────────────────────────────────────────────────

describe('rules', () => {
  it('rate: over the floor AND over 5x the device\'s own median hour', () => {
    const m = msgs => ({ msgs, fastRun: 0, duplicatePct: 0 })
    // No history: the floor alone.
    expect(DM.classify(m(700), null, S)).toMatchObject({ status: 'overload', causes: ['rate'], threshold: 600 })
    // A device that normally sends 200/h: 5 x 200 = 1000 is the line.
    expect(DM.classify(m(700), { median: 200, hours: 48 }, S)).toMatchObject({ status: 'high', causes: [], threshold: 1000 })
    expect(DM.classify(m(1001), { median: 200, hours: 48 }, S).causes).toEqual(['rate'])
    // A quiet device: the floor still applies, so 5 x 20 = 100/h is no overload.
    expect(DM.classify(m(400), { median: 20, hours: 48 }, S)).toMatchObject({ status: 'high', threshold: 600 })
    expect(DM.classify(m(200), { median: 20, hours: 48 }, S).status).toBe('normal')
    // Less than a day of history is no baseline yet.
    expect(DM.rateThreshold({ median: 500, hours: 10 }, S)).toBe(600)
  })

  it('interval: an average gap under 5 s for 10 minutes in a row', () => {
    feed(501, { startMs: T0, minutes: 10, perMinute: 30 }) // every 2 s, 300 messages: under the rate floor
    const now = T0 + 10 * MIN + 1000
    const m = DM.deviceMetrics(TM.deviceSnapshot().get(501).minutes, now, S)
    expect(m.fastRun).toBe(10)
    expect(m.avgIntervalSec).toBeCloseTo(2, 1)
    expect(DM.classify(m, null, S)).toMatchObject({ status: 'overload', causes: ['interval'] })

    // Nine minutes is not ten.
    TM.__resetTraffic()
    feed(501, { startMs: T0, minutes: 9, perMinute: 30 })
    const nine = DM.deviceMetrics(TM.deviceSnapshot().get(501).minutes, T0 + 9 * MIN + 1000, S)
    expect(nine.fastRun).toBe(9)
    expect(DM.classify(nine, null, S)).toMatchObject({ status: 'high', causes: [] })
  })

  it('interval: a quiet minute breaks the run, and a normal interval never counts', () => {
    feed(501, { startMs: T0, minutes: 5, perMinute: 30 })
    feed(501, { startMs: T0 + 6 * MIN, minutes: 5, perMinute: 30 })
    expect(DM.deviceMetrics(TM.deviceSnapshot().get(501).minutes, T0 + 11 * MIN + 1000, S).fastRun).toBe(5)

    TM.__resetTraffic()
    feed(502, { startMs: T0, minutes: 30, perMinute: 2 }) // every 30 s
    const m = DM.deviceMetrics(TM.deviceSnapshot().get(502).minutes, T0 + 30 * MIN + 1000, S)
    expect(m.fastRun).toBe(0)
    expect(DM.classify(m, null, S).status).toBe('normal')
  })

  it('duplicates: over 20% of at least 60 messages', () => {
    expect(DM.classify({ msgs: 100, fastRun: 0, duplicatePct: 25 }, null, S).causes).toEqual(['duplicates'])
    expect(DM.classify({ msgs: 100, fastRun: 0, duplicatePct: 15 }, null, S).status).toBe('high')
    expect(DM.classify({ msgs: 40, fastRun: 0, duplicatePct: 50 }, null, S).status).toBe('normal')
  })

  it('counts a repeated timestamp, and tells an exact copy from a different message', () => {
    const now = T0 + 1000
    const a = raw(501, Math.floor(now / 1000))
    expect(TM.noteMessage(a, T.normalize(a), now)).toBe(true)
    expect(TM.noteMessage({ ...a }, T.normalize(a), now)).toBe(false) // exact copy: dropped
    const b = { ...a, 'position.speed': 41 } // same second, other content: kept
    expect(TM.noteMessage(b, T.normalize(b), now)).toBe(true)
    const m = DM.deviceMetrics(TM.deviceSnapshot().get(501).minutes, now + MIN, S)
    // The exact copy is the stream re-sending, not the tracker: it is not the tracker's message or repeat.
    expect(m).toMatchObject({ received: 3, msgs: 2, duplicates: 2, exactDuplicates: 1, repeats: 1 })
    expect(m.duplicatePct).toBe(50)
  })

  it('a stream retry (exact copies) never makes a tracker look like it is resending', () => {
    const t = T0 + 1000
    const batch = []
    for (let i = 0; i < 80; i++) batch.push(raw(503, Math.floor(t / 1000) - 80 * 30 + i * 30))
    for (const m of batch) TM.noteMessage(m, T.normalize(m), t)
    for (const m of batch) TM.noteMessage({ ...m }, T.normalize(m), t) // the same batch again
    const m = DM.deviceMetrics(TM.deviceSnapshot().get(503).minutes, t + MIN, S)
    expect(m).toMatchObject({ received: 160, msgs: 80, exactDuplicates: 80, duplicatePct: 0 })
    expect(DM.classify(m, null, S).status).toBe('normal')
  })

  it('one episode: no repeat while it lasts, closed only after 15 min back to normal', () => {
    let ep = null
    let opened = 0
    const step = (over, value, t, opts) => {
      const r = DM.stepEpisode(ep, over, value, t, S, opts)
      ep = r.ep
      if (r.action === 'open') opened++
      return r
    }
    expect(step(true, 700, T0).action).toBe('open')
    expect(step(true, 900, T0 + MIN).action).toBe('peak')
    expect(step(true, 800, T0 + 2 * MIN).action).toBe(null)
    expect(ep.peak).toBe(900)
    // Back under, then over again within the 15 min: the same episode.
    step(false, 100, T0 + 3 * MIN)
    expect(step(true, 650, T0 + 5 * MIN).action).toBe(null)
    expect(ep.clearSince).toBe(null)
    // Normal from minute 6: still open at 14 min, closed at 15.
    for (let k = 6; k <= 20; k++) expect(step(false, 0, T0 + k * MIN).action).toBe(null)
    const done = step(false, 0, T0 + 21 * MIN)
    expect(done.action).toBe('close')
    expect(done.closed).toMatchObject({ startMs: T0, endMs: T0 + 6 * MIN, peak: 900 })
    expect(ep).toBe(null)
    // A new overload after that is a new episode.
    expect(step(true, 700, T0 + 30 * MIN).action).toBe('open')
    expect(opened).toBe(2)
    // Just restarted (counts still filling): an episode is never closed.
    step(false, 0, T0 + 31 * MIN, { warm: false })
    expect(step(false, 0, T0 + 99 * MIN, { warm: false }).action).toBe(null)
  })

  it('recommends a fix by cause, and never says it changed the device', () => {
    const base = { msgs: 3600, late: 0, reconnects: 0, duplicatePct: 0, parked: 0, avgIntervalSec: 1 }
    const moving = DM.diagnose(base, S)
    expect(moving.cause).toBe('interval')
    expect(moving.text).toMatch(/~1 s/)
    expect(moving.text).toMatch(/30 s while moving, 5 min parked/)
    expect(moving.text).toMatch(/Ask the client before changing any device setting/)
    expect(DM.diagnose({ ...base, parked: 3000 }, S).cause).toBe('interval-parked')
    expect(DM.diagnose({ ...base, late: 3000 }, S).cause).toBe('backlog')
    // A broken rule is explained before a backlog that cannot explain it.
    expect(DM.diagnose({ ...base, late: 3000, duplicatePct: 40 }, S).cause).toBe('duplicates')
    expect(DM.diagnose({ ...base, reconnects: 30 }, S).cause).toBe('reconnects')
    expect(DM.diagnose({ ...base, duplicatePct: 40 }, S).cause).toBe('duplicates')
    expect(DM.diagnose({ ...base, avgIntervalSec: 12, parked: 3000 }, S).cause).toBe('drift')
    expect(DM.diagnose({ ...base, avgIntervalSec: 12 }, S, { normalPerHour: 100 }).text).toMatch(/usual is ~100\/h/)
  })

  it('names endpoints and devices so one endpoint is one row', () => {
    expect(TM.endpointOf('GET', '/gw/devices/1,2,3/telemetry/position.speed,timestamp')).toBe('GET /gw/devices/{ids}/telemetry/{fields}')
    expect(TM.endpointOf('GET', '/gw/devices/all/messages?data=%7B%7D')).toBe('GET /gw/devices/{ids}/messages')
    expect(TM.endpointOf('PUT', '/gw/devices/5/settings/poll')).toBe('PUT /gw/devices/{ids}/settings/poll')
    expect(TM.endpointOf('GET', '/platform/tokens/123')).toBe('GET /platform/tokens/{ids}')
    expect(TM.deviceKeyOf('/gw/devices/5/messages')).toBe('5')
    expect(TM.deviceKeyOf('/gw/devices/all/telemetry/x')).toBe('all')
    expect(TM.deviceKeyOf('/gw/devices/5,6/telemetry/x')).toBe('several')
    expect(TM.deviceKeyOf('/gw/streams/1/devices/2')).toBe('-')
  })

  it('keeps the settings inside their ranges', () => {
    expect(TM.normalizeSettings({ rateFloorPerHour: '900', duplicatePct: 500, protectFlespi: 'no', junk: 1 }))
      .toMatchObject({ rateFloorPerHour: 900, duplicatePct: 100, protectFlespi: true })
    expect(TM.normalizeSettings(null)).toEqual(TM.DEFAULT_SETTINGS)
  })
})

// ── the webhook ──────────────────────────────────────────────────────────────

describe('webhook', () => {
  it('drops an exact copy before it is queued; a different message with the same time still goes in', async () => {
    const now = Math.floor(Date.now() / 1000) - 60
    const a = raw(501, now)
    const res = await post([a, { ...a }, { ...a, 'position.speed': 41 }])
    expect(res.body.data).toEqual({ accepted: 2, skipped: 0, duplicates: 1 })
    // Flespi re-sends the batch: both are copies now, nothing is queued.
    expect((await post([a, { ...a, 'position.speed': 41 }])).body.data).toEqual({ accepted: 0, skipped: 0, duplicates: 2 })
    await T.flush()
    expect(await prisma.telemetryMessage.count()).toBe(1) // (deviceId, ts) is the key, as before
    expect(T.telemetryStats().duplicatesDropped).toBe(3)
  })

  it('keeps every copy when dropping is switched off', async () => {
    await TM.saveSettings({ dropDuplicates: false })
    const a = raw(501, Math.floor(Date.now() / 1000) - 60)
    expect((await post([a, { ...a }])).body.data).toEqual({ accepted: 2, skipped: 0, duplicates: 0 })
  })
})

// ── device overload events ───────────────────────────────────────────────────

describe('data overload events', () => {
  const now = () => Math.floor(Date.now() / MIN) * MIN + 1000

  it('one event per episode, seen by a Super Admin only, closed once back to normal', async () => {
    const t = now()
    feed(501, { startMs: t - 12 * MIN, minutes: 12, perMinute: 60 }) // every second for 12 min
    const created = await DM.monitorTick(t)
    expect(created).toHaveLength(1)
    const e = created[0]
    expect(e).toMatchObject({ type: 'data_overload', bgId: null, vehicleId: fx.vehicles.v1.id, deviceId: 501, alertId: null, endedAt: null })
    const v1 = fx.vehicles.v1
    expect(e.message.startsWith(`${v1.fleetNo} - ${v1.plateNo}: `)).toBe(true) // the vehicle's name first
    expect(e.message).toMatch(/Reporting interval looks like ~1 s/)
    expect(e.message).toMatch(/Ask the client/)

    // Still flooding a minute later: no second event.
    feed(501, { startMs: t, minutes: 1, perMinute: 60 })
    expect(await DM.monitorTick(t + MIN)).toHaveLength(0)
    expect(await prisma.alertEvent.count({ where: { type: 'data_overload' } })).toBe(1)

    const superList = await request(app).get('/api/alert-events').set(auth(fx.tokens.superAdmin))
    expect(superList.body.data.map(x => x.id)).toContain(e.id)
    expect(superList.body.unreadCount).toBeGreaterThanOrEqual(1)
    for (const who of ['bgUserA1a', 'ggbAdminA', 'subUserA1a']) {
      const list = await request(app).get('/api/alert-events').set(auth(fx.tokens[who]))
      expect(list.body.data.map(x => x.id)).not.toContain(e.id)
    }

    // The flood ages out of the hour, then 15 quiet minutes close it.
    const quiet = t + 62 * MIN
    expect(await DM.monitorTick(quiet)).toHaveLength(0)
    await DM.monitorTick(quiet + 14 * MIN)
    expect((await prisma.alertEvent.findUnique({ where: { id: e.id } })).endedAt).toBe(null)
    await DM.monitorTick(quiet + 15 * MIN)
    const closed = await prisma.alertEvent.findUnique({ where: { id: e.id } })
    expect(closed.endedAt.getTime()).toBe(quiet)
    expect(closed.durationSec).toBe((quiet - t) / 1000)
    expect(closed.peakValue).toBeGreaterThanOrEqual(720)

    // A new flood later is a new episode.
    const later = quiet + 30 * MIN
    feed(501, { startMs: later - 12 * MIN, minutes: 12, perMinute: 60 })
    expect(await DM.monitorTick(later)).toHaveLength(1)
    expect(await prisma.alertEvent.count({ where: { type: 'data_overload' } })).toBe(2)
  })

  it('raises it in the vehicle\'s own BG too when "notify BG admins" is on', async () => {
    await TM.saveSettings({ notifyBgAdmins: true })
    const t = now()
    feed(501, { startMs: t - 12 * MIN, minutes: 12, perMinute: 60 })
    const [e] = await DM.monitorTick(t)
    expect(e.bgId).toBe(fx.bgA1a.id)
    const mine = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(mine.body.data.map(x => x.id)).toContain(e.id)
    const other = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserB1a))
    expect(other.body.data.map(x => x.id)).not.toContain(e.id)
  })

  it('a tracker with no vehicle is named by its id', async () => {
    const t = now()
    feed(777, { startMs: t - 12 * MIN, minutes: 12, perMinute: 60, ident: '999000111222333' })
    const [e] = await DM.monitorTick(t)
    expect(e).toMatchObject({ vehicleId: null, bgId: null, deviceId: 777 })
    expect(e.message).toMatch(/^Device 777 \(999000111222333\)/)
  })

  it('after a restart, picks the open episode up again and does not close it while counts refill', async () => {
    const t = now()
    feed(501, { startMs: t - 12 * MIN, minutes: 12, perMinute: 60 })
    const [e] = await DM.monitorTick(t)

    // Restart: memory empty, the event still open in the database.
    TM.__resetTraffic()
    DM.__resetDataMonitor({ startMs: t + MIN })
    expect(await DM.loadOpenEpisodes()).toBe(1)
    feed(501, { startMs: t + MIN, minutes: 5, perMinute: 60 })
    expect(await DM.monitorTick(t + 30 * MIN)).toHaveLength(0) // no second event
    expect(await DM.monitorTick(t + 50 * MIN)).toHaveLength(0)
    expect((await prisma.alertEvent.findUnique({ where: { id: e.id } })).endedAt).toBe(null)
    expect(await prisma.alertEvent.count({ where: { type: 'data_overload' } })).toBe(1)
  })

  it('learns each device\'s normal hour from its own history', async () => {
    const hourNow = Math.floor(Date.now() / 3_600_000) * 3_600_000
    const rows = []
    for (let h = 1; h <= 48; h++) rows.push({ deviceId: 501, hour: new Date(hourNow - h * 3_600_000), msgs: h % 2 ? 200 : 220 })
    await prisma.deviceTrafficStat.createMany({ data: rows })
    await DM.refreshBaselines()
    const b = DM.getBaselines().get(501)
    expect(b.hours).toBe(48)
    expect(b.median).toBe(210)
    expect(DM.rateThreshold(b, S)).toBe(1050)
  })
})

// ── Flespi requests ──────────────────────────────────────────────────────────

describe('Flespi request load', () => {
  const calls = (n, t, extra = {}) => {
    for (let i = 0; i < n; i++) TM.recordFlespiCall({ method: 'GET', path: '/gw/devices/all/telemetry/position.speed', status: 200, bytes: 100, ...extra }, t)
  }

  it('measures the last 60 s against the plan and holds browser reads back near the limit', () => {
    const t = Date.now()
    calls(150, t)
    expect(TM.flespiLoad(t)).toMatchObject({ calls: 150, pctCalls: 75 })
    expect(TM.flespiGate('/messages', t)).toBe(null)
    calls(10, t) // 80%: history reads wait, live ones go
    expect(TM.flespiGate('/messages', t)).toMatchObject({ reason: 'history', retryAfter: 15 })
    expect(TM.flespiGate('/telemetry/position.speed', t)).toBe(null)
    calls(30, t) // 95%: every browser read waits
    expect(TM.flespiGate('/telemetry/position.speed', t)).toMatchObject({ reason: 'limit' })
    // A minute later the window is empty again.
    expect(TM.flespiGate('/messages', t + 61_000)).toBe(null)
  })

  it('counts bytes against the 50 MiB a minute too', () => {
    const t = Date.now()
    TM.recordFlespiCall({ method: 'GET', path: '/gw/devices/all/messages', status: 200, bytes: 48 * 1024 * 1024 }, t)
    expect(TM.flespiLoad(t).pctBytes).toBeCloseTo(96, 0)
    expect(TM.flespiGate('/telemetry/x', t)).toMatchObject({ reason: 'limit' })
  })

  it('after a Flespi 429, waits out the minute; off when protection is switched off', async () => {
    const t = Date.now()
    TM.recordFlespiCall({ method: 'GET', path: '/gw/devices/all/telemetry/x', status: 429, bytes: 50 }, t)
    const g = TM.flespiGate('/telemetry/x', t + 20_000)
    expect(g).toMatchObject({ reason: 'throttled', retryAfter: 40 })
    expect(TM.flespiGate('/telemetry/x', t + 61_000)).toBe(null)
    await TM.saveSettings({ protectFlespi: false })
    expect(TM.flespiGate('/telemetry/x', t + 1000)).toBe(null)
  })

  it('the proxy answers "busy, retry" itself instead of sending a read to Flespi', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    calls(195, Date.now())
    const res = await request(app).get('/api/flespi/proxy/gw/devices/101/telemetry/gsm.signal.level').set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('FLESPI_BUSY')
    expect(res.headers['retry-after']).toBe('15')
    expect(fetchSpy).not.toHaveBeenCalled()
    const view = await DM.requestsView()
    expect(view.lastHour.shed).toBe(1)
    expect(view.now.holdingBack).toBe(true)
  })

  it('names who made each call: the signed-in user, or the server job', async () => {
    const body = { result: [{ id: 101, telemetry: {} }] }
    vi.stubGlobal('fetch', vi.fn(async () => json(body)))
    const res = await request(app).get('/api/flespi/proxy/gw/devices/101/telemetry/gsm.signal.level').set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    await runAsJob('alert-engine', 'Alert engine', () => flespi.forward('/gw/devices/all/telemetry/position.speed'))
    await flespi.forward('/gw/devices/all/telemetry/position.speed') // no source: "server"

    const view = await DM.requestsView()
    const user = view.bySource.find(r => r.key === `user:${fx.users.superAdmin.id}`)
    expect(user).toMatchObject({ calls: 1, bytes: JSON.stringify(body).length, label: fx.users.superAdmin.email, kind: 'user' })
    expect(view.bySource.find(r => r.key === 'job:alert-engine')).toMatchObject({ calls: 1, label: 'Alert engine', kind: 'job' })
    expect(view.bySource.find(r => r.key === 'server')).toMatchObject({ calls: 1 })
    expect(view.byEndpoint[0]).toMatchObject({ key: 'GET /gw/devices/{ids}/telemetry/{fields}', calls: 3 })
    expect(view.byDevice.map(r => r.label)).toEqual(expect.arrayContaining(['Device 101', 'All devices (fleet-wide)']))
    expect(view.lastHour.calls).toBe(3)
  })

  it('raises one request-overload event for a Super Admin', async () => {
    const t = Date.now()
    calls(170, t)
    const created = await DM.monitorTick(t)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ type: 'request_overload', bgId: null, severity: 'High', value: 85 })
    expect(created[0].message).toMatch(/85% of the plan's per-minute limit/)
    calls(20, t + 1000)
    expect(await DM.monitorTick(t + 1000)).toHaveLength(0)
    const bg = await request(app).get('/api/alert-events').set(auth(fx.tokens.bgUserA1a))
    expect(bg.body.data.map(x => x.type)).not.toContain('request_overload')
  })

  it('a burst between two passes still raises it', async () => {
    const t = Date.now()
    calls(170, t - 50_000) // 85% for a moment, 50 s before the pass…
    const created = await DM.monitorTick(t + 20_000) // …and aged out of the 60 s by the time it runs
    expect(TM.flespiLoad(t + 20_000).calls).toBe(0)
    expect(created.map(e => e.type)).toEqual(['request_overload'])
    expect(created[0].value).toBe(85)
  })

  it('adds to the hourly rows on every flush, never overwrites them', async () => {
    const t = Date.now()
    calls(3, t)
    feed(501, { startMs: t, minutes: 1, perMinute: 6 })
    await TM.flushCounters()
    calls(2, t)
    feed(501, { startMs: t + MIN / 2, minutes: 1, perMinute: 4 })
    await TM.flushCounters()
    const [src] = await prisma.flespiRequestStat.findMany({ where: { kind: 'source' } })
    expect(src).toMatchObject({ key: 'server', calls: 5 })
    expect(Number(src.bytes)).toBe(500)
    const dev = await prisma.deviceTrafficStat.findMany({ where: { deviceId: 501 } })
    expect(dev.reduce((n, r) => n + r.msgs, 0)).toBe(10)
  })
})

// ── API ──────────────────────────────────────────────────────────────────────

describe('/api/data-monitor', () => {
  it('is for a Super Admin only', async () => {
    for (const who of ['ggbAdminA', 'groupAdminA1', 'bgUserA1a', 'subUserA1a']) {
      for (const path of ['devices', 'requests', 'settings']) {
        expect((await request(app).get(`/api/data-monitor/${path}`).set(auth(fx.tokens[who]))).status).toBe(403)
      }
    }
  })

  it('lists every tracker with its hour, day, status and the fix to recommend', async () => {
    const t = Math.floor(Date.now() / MIN) * MIN + 1000
    feed(501, { startMs: t - 12 * MIN, minutes: 12, perMinute: 60 })
    feed(502, { startMs: t - 30 * MIN, minutes: 30, perMinute: 2, ident: '863071011234502' })
    await DM.monitorTick(t)
    const res = await request(app).get('/api/data-monitor/devices').set(auth(fx.tokens.superAdmin))
    expect(res.status).toBe(200)
    const [first, second] = res.body.data.devices
    expect(first).toMatchObject({ deviceId: 501, status: 'overload', vehicle: { plateNo: fx.vehicles.v1.plateNo } })
    expect(first.recommendation.cause).toBe('interval')
    expect(first.episode).toMatchObject({ peakPerHour: expect.any(Number) })
    expect(first.spark).toHaveLength(24)
    expect(first.day.msgs).toBe(first.lastHour.msgs)
    expect(second).toMatchObject({ deviceId: 502, status: 'normal', recommendation: null })
    expect(second.lastHour.avgIntervalSec).toBe(30)
    expect(res.body.data.totals).toMatchObject({ overload: 1, normal: 1 })
  })

  it('saves thresholds within their ranges', async () => {
    const ok = await request(app).put('/api/data-monitor/settings').set(auth(fx.tokens.superAdmin)).send({ rateFloorPerHour: 1000, protectFlespi: false })
    expect(ok.status).toBe(200)
    expect(ok.body.data.settings).toMatchObject({ rateFloorPerHour: 1000, protectFlespi: false, rateMultiplier: 5 })
    expect((await prisma.appSetting.findUnique({ where: { key: 'dataMonitor' } })).value).toMatchObject({ rateFloorPerHour: 1000 })

    const low = await request(app).put('/api/data-monitor/settings').set(auth(fx.tokens.superAdmin)).send({ rateFloorPerHour: 0 })
    expect(low.status).toBe(400)
    expect(low.body.error.details.rateFloorPerHour).toBeTruthy()
    const order = await request(app).put('/api/data-monitor/settings').set(auth(fx.tokens.superAdmin)).send({ requestWarnPct: 90, requestShedPct: 85 })
    expect(order.status).toBe(400)
    const junk = await request(app).put('/api/data-monitor/settings').set(auth(fx.tokens.superAdmin)).send({ nope: 1 })
    expect(junk.status).toBe(400)
    const denied = await request(app).put('/api/data-monitor/settings').set(auth(fx.tokens.bgUserA1a)).send({ rateFloorPerHour: 1000 })
    expect(denied.status).toBe(403)
  })
})
