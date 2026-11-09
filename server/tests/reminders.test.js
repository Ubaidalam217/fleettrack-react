/**
 * Maintenance and renewal reminders: the counting (lib/reminders.js), the
 * rules API, Reminder Status, Mark done, the history, and the engine pass
 * that raises Due / Overdue notifications and counts engine hours.
 *
 * Flespi is mocked as in alertEngine.test.js.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const H = vi.hoisted(() => ({ flespiToken: 'mock-master-token' }))
vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => {
    const copy = { ...frozen }
    Object.defineProperty(copy, 'FLESPI_TOKEN', { get: () => H.flespiToken, configurable: true, enumerable: true })
    return copy
  }
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
const { reminderStatus, describe: describeStatus, runReminderPass } = await import('../src/lib/reminders.js')
const { fetchTelemetry } = await import('../src/lib/alertEngine.js')
import { auth, resetDb, seedFixture } from './factories.js'
import { clearDeviceCache, deviceMap } from '../src/lib/flespi.js'

const app = createApp()
let fx
/** deviceId -> telemetry the mocked Flespi answers with (device 101 is v1, 102 is v2…). */
let telemetry = {}

function installFlespiMock() {
  vi.stubGlobal('fetch', url => {
    const u = String(url)
    const json = body => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
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
}

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  telemetry = {}
  installFlespiMock()
})
afterEach(() => {
  vi.unstubAllGlobals()
  clearDeviceCache()
})

const d = s => new Date(`${s}T00:00:00Z`)

describe('reminderStatus (pure)', () => {
  const base = { byDuration: false, byDistance: false, byEngineHours: false, recurring: true, frequency: 'Monthly' }
  it('duration: upcoming, due inside the notify window, overdue after the date', () => {
    const rule = { ...base, byDuration: true, every: 6, notifyDays: 7 }
    const rv = { startDate: d('2026-05-10') }
    expect(reminderStatus(rule, rv, {}, d('2026-10-01')).status).toBe('upcoming')
    const due = reminderStatus(rule, rv, {}, d('2026-11-05'))
    expect(due.status).toBe('due')
    expect(describeStatus(due)).toBe('due 10 Nov 2026, in 5 days')
    const over = reminderStatus(rule, rv, {}, d('2026-11-12'))
    expect(over.status).toBe('overdue')
    expect(describeStatus(over)).toBe('2 days overdue (was due 10 Nov 2026)')
    expect(reminderStatus({ ...rule, frequency: 'Weekly', every: 2 }, rv, {}, d('2026-05-24')).parts[0].dueDate).toBe('2026-05-24')
    // A renewal's own expiry stands for the interval.
    expect(reminderStatus(rule, { ...rv, expiryDate: d('2026-12-31') }, {}, d('2026-12-28')).status).toBe('due')
  })

  it('distance counts km already run before the start plus the odometer since; the worst basis wins', () => {
    const rule = { ...base, byDistance: true, everyKm: 10000, notifyKm: 500, byDuration: true, every: 12, notifyDays: 7 }
    const rv = { startDate: d('2026-10-01'), kmBefore: 3000, startOdometer: 50000 }
    const r = reminderStatus(rule, rv, { odometer: 56600 }, d('2026-10-20'))
    expect(r.status).toBe('due') // 3000 + 6600 = 9600, 400 left
    expect(describeStatus(r)).toBe('9,600 of 10,000 km, 400 left')
    expect(reminderStatus(rule, rv, { odometer: 57100 }, d('2026-10-20')).status).toBe('overdue')
    expect(reminderStatus(rule, rv, { odometer: 51000 }, d('2026-10-20')).status).toBe('upcoming')
  })

  it('engine hours and a completed One Time reminder', () => {
    const rule = { ...base, byEngineHours: true, everyHours: 250, notifyHours: 10 }
    expect(reminderStatus(rule, { startDate: d('2026-01-01'), hoursBefore: 0, startEngineHours: 100 }, { engineHours: 345 }).status).toBe('due')
    expect(reminderStatus(rule, { startDate: d('2026-01-01'), completedAt: d('2026-02-01') }, {}).status).toBe('completed')
  })
})

const ruleBody = (extra = {}) => ({
  bgId: fx.bgA1a.id, name: 'Oil every 10,000 km', type: 'Oil Change', recurring: true,
  byDuration: true, frequency: 'Monthly', every: 6, notifyDays: 7,
  byDistance: true, everyKm: 10000, notifyKm: 500,
  notifyInApp: true, vehicles: [{ vehicleId: fx.vehicles.v1.id, startDate: '2026-10-01', kmBefore: 3000 }],
  ...extra,
})
const post = (body, token = fx.tokens.bgUserA1a) => request(app).post('/api/reminder-rules').set(auth(token)).send(body)

describe('/api/reminder-rules', () => {
  it('stores a rule with its vehicles, the start odometer read from the tracker', async () => {
    telemetry = { 101: { 'vehicle.mileage': 50000, 'position.speed': 0, timestamp: Math.floor(Date.now() / 1000) - 30 } }
    const res = await post(ruleBody())
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ name: 'Oil every 10,000 km', type: 'Oil Change', everyKm: 10000 })
    expect(res.body.data.vehicles[0]).toMatchObject({ vehicleId: fx.vehicles.v1.id, startDate: '2026-10-01', kmBefore: 3000, startOdometer: 50000 })
  })

  it('checks the bases, the notify windows, the emails, and the vehicles’ BG', async () => {
    const none = await post(ruleBody({ byDuration: false, byDistance: false }))
    expect(none.body.error.details.byDuration).toMatch(/at least one/)
    const bad = await post(ruleBody({ notifyKm: 20000, notifyEmail: true, emails: [] }))
    expect(bad.body.error.details).toEqual({ notifyKm: 'Less than the distance', emails: 'Add at least one email' })
    const other = await post(ruleBody({ vehicles: [{ vehicleId: fx.vehicles.v8.id }] }))
    expect(other.status).toBe(400)
    expect((await post(ruleBody(), fx.tokens.subUserA1a)).status).toBe(403)
    expect((await post(ruleBody({ bgId: fx.bgB1a.id, vehicles: [] }))).status).toBe(404)
  })

  it('keeps a vehicle’s count when its start is unchanged, restarts it when changed', async () => {
    telemetry = { 101: { 'vehicle.mileage': 50000, timestamp: Math.floor(Date.now() / 1000) - 30 } }
    const rule = (await post(ruleBody())).body.data
    await prisma.reminderVehicle.updateMany({ data: { alerted: 'due' } })
    telemetry = { 101: { 'vehicle.mileage': 52000, timestamp: Math.floor(Date.now() / 1000) - 30 } }
    const put = body => request(app).put(`/api/reminder-rules/${rule.id}`).set(auth(fx.tokens.bgUserA1a)).send(body)

    await put(ruleBody({ name: 'Renamed' }))
    let rv = await prisma.reminderVehicle.findFirst()
    expect(rv).toMatchObject({ startOdometer: 50000, alerted: 'due' })

    await put(ruleBody({ vehicles: [{ vehicleId: fx.vehicles.v1.id, startDate: '2026-11-01', kmBefore: 0 }] }))
    rv = await prisma.reminderVehicle.findFirst()
    expect(rv).toMatchObject({ startOdometer: 52000, kmBefore: 0, alerted: null })
  })
})

describe('Reminder Status, Mark done and history', () => {
  it('works each vehicle out now, marks it done, and starts the next cycle', async () => {
    const ts = () => Math.floor(Date.now() / 1000) - 30
    telemetry = { 101: { 'vehicle.mileage': 50000, timestamp: ts() } }
    const rule = (await post(ruleBody())).body.data
    telemetry = { 101: { 'vehicle.mileage': 56700, timestamp: ts() } } // 3000 + 6700 = 9700 of 10,000

    const status = await request(app).get('/api/reminders/status').set(auth(fx.tokens.bgUserA1a))
    expect(status.status).toBe(200)
    expect(status.body.data).toHaveLength(1)
    expect(status.body.data[0]).toMatchObject({ ruleName: 'Oil every 10,000 km', status: 'due', odometer: 56700, detail: '9,700 of 10,000 km, 300 left' })
    expect((await request(app).get('/api/reminders/status').query({ status: 'overdue' }).set(auth(fx.tokens.bgUserA1a))).body.data).toHaveLength(0)
    expect((await request(app).get('/api/reminders/status').set(auth(fx.tokens.bgUserB1a))).body.data).toHaveLength(0)

    const meters = await request(app).get('/api/reminders/meters').query({ vehicleIds: fx.vehicles.v1.id }).set(auth(fx.tokens.bgUserA1a))
    expect(meters.body.data[fx.vehicles.v1.id]).toMatchObject({ odometer: 56700 })

    // Done 200 km ago at 56,500: those 200 km count towards the next cycle.
    const ack = await request(app).post('/api/reminders/ack').set(auth(fx.tokens.bgUserA1a))
      .send({ ruleId: rule.id, vehicleId: fx.vehicles.v1.id, doneAt: '2026-11-09', odometer: 56500, note: 'Shell, 5W-30' })
    expect(ack.status).toBe(201)
    const after = (await request(app).get('/api/reminders/status').set(auth(fx.tokens.bgUserA1a))).body.data[0]
    expect(after).toMatchObject({ status: 'upcoming', startDate: '2026-11-09', lastDoneAt: '2026-11-09' })
    expect(after.parts.find(p => p.basis === 'distance')).toMatchObject({ used: 200, left: 9800 })

    const hist = await request(app).get('/api/reminders/acks').set(auth(fx.tokens.bgUserA1a))
    expect(hist.body.data).toHaveLength(1)
    expect(hist.body.data[0]).toMatchObject({ ruleName: 'Oil every 10,000 km', vehicleLabel: fx.vehicles.v1.plateNo, odometer: 56500, note: 'Shell, 5W-30' })
    expect((await request(app).get('/api/reminders/acks').set(auth(fx.tokens.bgUserB1a))).body.data).toHaveLength(0)
    expect((await request(app).post('/api/reminders/ack').set(auth(fx.tokens.subUserA1a)).send({ ruleId: rule.id, vehicleId: fx.vehicles.v1.id })).status).toBe(403)
  })
})

describe('runReminderPass', () => {
  it('raises Due once, then Overdue once, and counts engine hours from ignition time', async () => {
    const now = Math.floor(Date.now() / 1000)
    telemetry = { 101: { 'vehicle.mileage': 50000, 'engine.ignition.status': true, timestamp: now - 600 } }
    await post(ruleBody())
    const run = async (t, at) => {
      telemetry = { 101: t }
      clearDeviceCache()
      return runReminderPass(await fetchTelemetry(), await deviceMap(), at)
    }

    expect(await run({ 'vehicle.mileage': 51000, 'engine.ignition.status': true, timestamp: now - 600 }, now)).toHaveLength(0)
    const due = await run({ 'vehicle.mileage': 56600, 'engine.ignition.status': true, timestamp: now - 300 }, now)
    expect(due).toHaveLength(1)
    expect(due[0]).toMatchObject({ type: 'reminder', severity: 'Medium', title: 'Oil every 10,000 km', vehicleId: fx.vehicles.v1.id })
    expect(due[0].message).toBe(`${fx.vehicles.v1.plateNo}: Oil Change is due, 9,600 of 10,000 km, 400 left`)
    expect(await run({ 'vehicle.mileage': 56700, 'engine.ignition.status': true, timestamp: now - 200 }, now)).toHaveLength(0)
    const over = await run({ 'vehicle.mileage': 57100, 'engine.ignition.status': true, timestamp: now - 100 }, now)
    expect(over[0]).toMatchObject({ severity: 'High' })
    expect(over[0].message).toMatch(/is overdue, 100 km over/)

    // Ignition on from now-600 to now-100, in steps under the 10-minute gap: 500 s.
    const hours = await prisma.vehicleEngineHours.findUnique({ where: { vehicleId: fx.vehicles.v1.id } })
    expect(hours.hours).toBeCloseTo(500 / 3600, 5)
  })
})
