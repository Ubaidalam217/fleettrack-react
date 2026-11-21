/**
 * Journey Management, the rest of the Uffizio Job module (client 2026-11-21):
 * the new journey fields (QR stops with codes, forms, convoy, temperature
 * limits, start logic), the address book with its bulk add, stop forms,
 * templates and recurring schedules (HSE approval kept), force close, the
 * public links, expenses on a journey, the office's check-in / form / photo,
 * Journey Alerts and the report feed.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { signToken } from '../src/lib/jwt.js'
import { __clearJourneySettingsCache } from '../src/lib/journeySettings.js'
import { rollSchedules, forceClose, dueForceClose, automaticStep } from '../src/lib/journeySchedules.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

const HOUR = 3600_000
const tomorrow = (h = 10, m = 0) => {
  const d = new Date(Date.now() + 86_400_000)
  d.setUTCHours(h - 4, m, 0, 0)
  return d
}
const P = { a: { lat: 24.35, lng: 54.50 }, b: { lat: 24.35, lng: 54.95 }, c: { lat: 24.35, lng: 55.40 } }
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const body = (vehicleId, extra = {}, stopExtra = {}) => ({
  title: 'Diesel delivery to Ruwais',
  vehicleId,
  plannedStart: tomorrow(10).toISOString(),
  routeSource: 'STRAIGHT',
  stops: [
    { name: 'Depot', ...P.a },
    { name: 'Fuel stop', ...P.b, stayMin: 30, legDriveMin: 120, legSource: 'MANUAL', ...stopExtra },
    { name: 'Site B', ...P.c, legDriveMin: 120, legSource: 'MANUAL' },
  ],
  ...extra,
})

async function makeUser(email, role, extra = {}) {
  const u = await prisma.user.create({ data: { email, passwordHash: 'x', role, mustChangePassword: false, ...extra } })
  return { user: u, token: signToken(u) }
}

const post = (path, token, data) => request(app).post(path).set(auth(token)).send(data)
const put = (path, token, data) => request(app).put(path).set(auth(token)).send(data)
const get = (path, token) => request(app).get(path).set(auth(token))
const del = (path, token) => request(app).delete(path).set(auth(token))

beforeEach(async () => {
  await resetDb()
  __clearJourneySettingsCache()
  fx = await seedFixture()
})

describe('the new journey fields', () => {
  it('gives every stop a code, keeps QR / purpose / load state, and copies the form', async () => {
    const t = fx.tokens.bgUserA1a
    const form = await post('/api/journey-forms', t, { name: 'Delivery note', fields: [{ label: 'Seal number', type: 'TEXT', required: true }, { label: 'Pallets', type: 'NUMBER' }] })
    expect(form.status).toBe(201)
    const res = await post('/api/journeys', t, body(fx.vehicles.v1.id,
      { startLogic: 'IGNITION_ON', startBufferMin: 30, routeToleranceM: 50, convoy: [fx.vehicles.v2.id], convoyToleranceM: 250, loadState: 'Loaded', forceCloseMin: 120 },
      { visitVia: 'QR', purpose: 'DELIVERY', loadState: 'Empty', formId: form.body.data.id }))
    expect(res.status).toBe(201)
    const j = res.body.data
    expect(j.stops.every(s => /^[A-Z2-9]{6}$/.test(s.code))).toBe(true)
    expect(new Set(j.stops.map(s => s.code)).size).toBe(3)
    expect(j.stops[1]).toMatchObject({ visitVia: 'QR', purpose: 'DELIVERY', loadState: 'Empty', formName: 'Delivery note' })
    expect(j.stops[1].formFields.map(f => f.key)).toEqual(['seal_number', 'pallets'])
    expect(j).toMatchObject({ startLogic: 'IGNITION_ON', startBufferMin: 30, routeToleranceM: 50, convoyToleranceM: 250, loadState: 'Loaded', forceCloseMin: 120 })
    expect(j.convoy).toEqual([expect.objectContaining({ vehicleId: fx.vehicles.v2.id })])
  })

  it('keeps the stop codes through an edit, so printed QR sheets stay right', async () => {
    const t = fx.tokens.bgUserA1a
    const c = await post('/api/journeys', t, body(fx.vehicles.v1.id))
    const codes = c.body.data.stops.map(s => s.code)
    const e = await put(`/api/journeys/${c.body.data.id}`, t, body(fx.vehicles.v1.id, { plannedStart: tomorrow(11).toISOString() }))
    expect(e.status).toBe(200)
    expect(e.body.data.stops.map(s => s.code)).toEqual(codes)
  })

  it('refuses a convoy with the lead in it, a form from elsewhere and upside-down temperature limits', async () => {
    const t = fx.tokens.bgUserA1a
    expect((await post('/api/journeys', t, body(fx.vehicles.v1.id, { convoy: [fx.vehicles.v1.id] }))).status).toBe(400)
    expect((await post('/api/journeys', t, body(fx.vehicles.v1.id, { tempMin: 8, tempMax: 2 }))).status).toBe(400)
    expect((await post('/api/journeys', t, body(fx.vehicles.v1.id, {}, { formId: 'nope' }))).status).toBe(400)
    // Another BG's vehicle in the convoy: not found for this account.
    expect((await post('/api/journeys', t, body(fx.vehicles.v1.id, { convoy: [fx.vehicles.v5.id] }))).status).toBe(404)
  })

  it('lists the address book, forms and templates in options, and flags vehicles with a temperature probe', async () => {
    await prisma.deviceState.create({ data: { deviceId: 9001, ident: fx.vehicles.v1.imei, ts: Math.floor(Date.now() / 1000), temperature: 4.5 } })
    await prisma.deviceState.create({ data: { deviceId: 9002, ident: fx.vehicles.v2.imei, ts: Math.floor(Date.now() / 1000), temperature: 0, extra: { 'ble.sensor.humidity.1': 0, 'ble.sensor.battery.voltage.1': 0 } } })
    const o = await get('/api/journeys/options', fx.tokens.bgUserA1a)
    expect(o.status).toBe(200)
    const v = id => o.body.data.vehicles.find(x => x.id === id)
    expect(v(fx.vehicles.v1.id).hasTemperature).toBe(true)
    expect(v(fx.vehicles.v2.id).hasTemperature).toBe(false)
    expect(o.body.data.settings.loadStates).toEqual(['Empty', 'Loaded', 'Partially loaded'])
    expect(o.body.data).toHaveProperty('addresses')
    expect(o.body.data).toHaveProperty('forms')
  })
})

describe('the address book', () => {
  it('adds, refuses a duplicate name, renames and deletes', async () => {
    const t = fx.tokens.bgUserA1a
    const a = await post('/api/journey-addresses', t, { name: 'Ruwais Gate 2', lat: 24.11, lng: 52.73, radiusM: 250, purpose: 'DELIVERY' })
    expect(a.status).toBe(201)
    expect((await post('/api/journey-addresses', t, { name: 'Ruwais Gate 2', lat: 24.1, lng: 52.7 })).status).toBe(409)
    const r = await put(`/api/journey-addresses/${a.body.data.id}`, t, { name: 'Ruwais Gate 3', lat: 24.11, lng: 52.73 })
    expect(r.body.data.name).toBe('Ruwais Gate 3')
    expect((await get('/api/journey-addresses', fx.tokens.bgUserB1a)).status).toBe(200)
    expect((await del(`/api/journey-addresses/${a.body.data.id}`, t)).status).toBe(200)
  })

  it('bulk add: each row on its own, errors per row', async () => {
    const t = fx.tokens.bgUserA1a
    await post('/api/journey-addresses', t, { name: 'Yard', lat: 24.3, lng: 54.5 })
    const res = await post('/api/journey-addresses/bulk', t, {
      rows: [
        { row: 2, name: 'Site A', lat: 24.4, lng: 54.6, radiusM: 300, purpose: 'LOADING' },
        { row: 3, name: 'Yard', lat: 24.3, lng: 54.5 },
        { row: 4, name: 'Bad', lat: 200, lng: 54.5 },
      ],
    })
    expect(res.status).toBe(201)
    expect(res.body.data.map(a => a.name)).toEqual(['Site A'])
    expect(res.body.errors.map(e => e.row)).toEqual([3, 4])
  })

  it('a sub-user without Journeys = Edit cannot change it', async () => {
    const sub = await makeUser('sub@x.ae', 'SUB_USER', { bgId: fx.bgA1a.id })
    expect((await post('/api/journey-addresses', sub.token, { name: 'X', lat: 24, lng: 54 })).status).toBe(403)
  })
})

describe('stop forms', () => {
  it('needs at least two choices in a dropdown', async () => {
    const res = await post('/api/journey-forms', fx.tokens.bgUserA1a, { name: 'F', fields: [{ label: 'Condition', type: 'DROPDOWN', options: ['Good'] }] })
    expect(res.status).toBe(400)
    expect(res.body.error.details['fields.0.options']).toBeTruthy()
  })
})

describe('templates and schedules', () => {
  let approver
  beforeEach(async () => {
    approver = await makeUser('hse@alhabtoorlog.ae', 'BG_USER', { bgId: fx.bgA1a.id, screenAccess: { 'journey-approval': 'modify' } })
  })
  const tplBody = () => {
    const b = body(null)
    delete b.vehicleId; delete b.plannedStart
    return b
  }
  const daily = (extra = {}) => ({
    name: 'Daily Ruwais run', vehicleId: fx.vehicles.v1.id, body: tplBody(), scheduleKind: 'RELATIVE', repeat: 'DAILY',
    startTime: '06:00', validFrom: new Date(Date.now() - 86_400_000).toISOString(), horizonDays: 3, ...extra,
  })

  it('a template without a vehicle is fine; a schedule needs one, and its days', async () => {
    const t = fx.tokens.bgUserA1a
    expect((await post('/api/journey-templates', t, { name: 'Ruwais run', body: tplBody() })).status).toBe(201)
    const bad = await post('/api/journey-templates', t, { name: 'X', body: tplBody(), scheduleKind: 'RELATIVE', repeat: 'WEEKLY', startTime: '06:00', validFrom: new Date().toISOString() })
    expect(bad.status).toBe(400)
    expect(Object.keys(bad.body.error.details)).toEqual(expect.arrayContaining(['weekdays', 'vehicleId']))
  })

  it('makes each day ahead, waiting for HSE; once each; the approved template makes them Scheduled', async () => {
    const t = fx.tokens.bgUserA1a
    const c = await post('/api/journey-templates', t, daily())
    expect(c.status).toBe(201)
    expect(c.body.data.next.length).toBeGreaterThan(0)
    const made = await rollSchedules(Date.now(), { force: true })
    expect(made).toBeGreaterThanOrEqual(3)
    const rows = await prisma.journey.findMany({ where: { templateId: c.body.data.id }, orderBy: { plannedStart: 'asc' } })
    expect(rows.every(r => r.status === 'Draft' && r.approvalStatus === 'PENDING' && r.scheduleKind === 'RELATIVE')).toBe(true)
    expect(new Set(rows.map(r => r.occurrenceKey)).size).toBe(rows.length)
    // 06:00 UAE = 02:00 UTC.
    expect(rows.every(r => r.plannedStart.toISOString().slice(11, 16) === '02:00')).toBe(true)
    // Again: nothing new.
    expect(await rollSchedules(Date.now(), { force: true })).toBe(0)

    // HSE approves a second template: its journeys start approved.
    const c2 = await post('/api/journey-templates', t, daily({ name: 'Approved run', vehicleId: fx.vehicles.v3.id }))
    expect((await post(`/api/journey-templates/${c2.body.data.id}/approve`, t)).status).toBe(403) // not an approver
    expect((await post(`/api/journey-templates/${c2.body.data.id}/approve`, approver.token)).status).toBe(200)
    await rollSchedules(Date.now(), { templateId: c2.body.data.id, force: true })
    const rows2 = await prisma.journey.findMany({ where: { templateId: c2.body.data.id } })
    expect(rows2.length).toBeGreaterThan(0)
    expect(rows2.every(r => r.status === 'Scheduled' && r.approvalStatus === 'APPROVED')).toBe(true)

    // A change to the plan takes the approval away.
    const e = await put(`/api/journey-templates/${c2.body.data.id}`, t, daily({ name: 'Approved run', vehicleId: fx.vehicles.v3.id, startTime: '07:00' }))
    expect(e.body.data.autoApprove).toBe(false)
    expect(e.body.approvalReset).toBe(true)
  })

  it('skips a day the vehicle is already busy, and says why', async () => {
    const t = fx.tokens.bgUserA1a
    const c = await post('/api/journey-templates', t, daily({ horizonDays: 1 }))
    // Hold the vehicle tomorrow 05:00–12:00 UAE with a journey sent to HSE.
    await post('/api/journeys', t, body(fx.vehicles.v1.id, { plannedStart: tomorrow(5).toISOString(), submit: true }))
    await rollSchedules(Date.now(), { force: true })
    const tpl = await prisma.journeyTemplate.findUnique({ where: { id: c.body.data.id } })
    expect(tpl.lastError).toMatch(/already has a journey/)
  })

  it('AUTOMATIC: inside the first stop, then out = started (pure)', () => {
    const origin = { ...P.a, radiusM: 300 }
    const settings = { departAfterSec: 30 }
    const fixes = [
      { ts: 100, lat: 24.35, lng: 54.50, ign: false },
      { ts: 160, lat: 24.35, lng: 54.501, ign: true },
      { ts: 220, lat: 24.35, lng: 54.51, ign: true }, // ~1 km out
    ]
    expect(automaticStep({ state: null, origin, fixes, settings }).startedAt).toBe(220)
    const ign = automaticStep({ state: null, origin, fixes, settings, startLogic: 'IGNITION_ON' })
    expect(ign.startedAt).toBe(160)
    // Never inside first: nothing.
    expect(automaticStep({ state: null, origin, fixes: [fixes[2]], settings }).startedAt).toBe(null)
  })
})

describe('force close', () => {
  it('closes an unfinished journey after its time, shown as Force closed', async () => {
    const t = fx.tokens.bgUserA1a
    const c = await post('/api/journeys', t, body(fx.vehicles.v1.id))
    const id = c.body.data.id
    // Approved, and its arrival 13 h ago.
    await prisma.journey.update({ where: { id }, data: { status: 'InProgress', approvalStatus: 'APPROVED', plannedStart: new Date(Date.now() - 18 * HOUR), expectedArrival: new Date(Date.now() - 13 * HOUR) } })
    const j = await prisma.journey.findUnique({ where: { id } })
    expect(dueForceClose(j, { forceCloseHours: 12 })).toBe(true)
    expect(dueForceClose(j, { forceCloseHours: 0 })).toBe(false)
    expect(dueForceClose({ ...j, forceCloseMin: 24 * 60 }, { forceCloseHours: 12 })).toBe(false)
    expect(await forceClose()).toBe(1)
    const after = await get(`/api/journeys/${id}`, t)
    expect(after.body.data.status).toBe('Cancelled')
    expect(after.body.data.display).toBe('ForceClosed')
    expect(after.body.data.cancelReason).toMatch(/Force closed/)
    expect(after.body.data.events.some(e => e.type === 'FORCE_CLOSED')).toBe(true)
    expect(await forceClose()).toBe(0)
  })
})

describe('links, expenses, the office at a stop', () => {
  async function onTheRoad() {
    const form = await post('/api/journey-forms', fx.tokens.bgUserA1a, { name: 'POD', fields: [{ label: 'Seal', type: 'TEXT', required: true }, { label: 'OK', type: 'YESNO' }] })
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, {}, { formId: form.body.data.id }))
    await prisma.journey.update({ where: { id: c.body.data.id }, data: { status: 'InProgress', approvalStatus: 'APPROVED', actualStart: new Date() } })
    return c.body.data.id
  }

  it('makes, lists and switches off a tracking link', async () => {
    const id = await onTheRoad()
    const t = fx.tokens.bgUserA1a
    const l = await post(`/api/journeys/${id}/links`, t, { kind: 'TRACK', hours: 6 })
    expect(l.status).toBe(201)
    expect(l.body.data.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(new Date(l.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 5.9 * HOUR)
    expect((await get(`/api/journeys/${id}/links`, t)).body.data).toHaveLength(1)
    const off = await del(`/api/journeys/${id}/links/${l.body.data.id}`, t)
    expect(off.body.data.revokedAt).toBeTruthy()
  })

  it('adds an expense from the journey, links another, and totals them', async () => {
    const id = await onTheRoad()
    const t = fx.tokens.bgUserA1a
    const a = await post(`/api/journeys/${id}/expenses`, t, { type: 'Toll Roads', amount: 12.5 })
    expect(a.status).toBe(201)
    const other = await prisma.expense.create({ data: { bgId: fx.bgA1a.id, vehicleId: fx.vehicles.v1.id, vehicleLabel: 'X', category: 'Variable', type: 'Fuel', amount: 100, expenseDate: new Date() } })
    const list = await get(`/api/journeys/${id}/expenses`, t)
    expect(list.body.data.candidates.map(e => e.id)).toContain(other.id)
    expect((await post(`/api/journeys/${id}/expenses/link`, t, { expenseId: other.id })).status).toBe(200)
    const d = await get(`/api/journeys/${id}`, t)
    expect(d.body.data.cost).toEqual({ total: 112.5, count: 2 })
    expect((await del(`/api/journeys/${id}/expenses/${other.id}`, t)).status).toBe(200)
    expect((await get(`/api/journeys/${id}`, t)).body.data.cost.total).toBe(12.5)
  })

  it('checks in at a stop, fills its form and adds a photo; the destination completes it', async () => {
    const id = await onTheRoad()
    const t = fx.tokens.bgUserA1a
    const ci = await post(`/api/journeys/${id}/stops/1/check-in`, t, {})
    expect(ci.status).toBe(200)
    expect(ci.body.data).toMatchObject({ status: 'ARRIVED', checkInSource: 'OFFICE' })
    expect((await post(`/api/journeys/${id}/stops/1/check-in`, t, {})).status).toBe(409)
    const bad = await post(`/api/journeys/${id}/stops/1/form`, t, { answers: { ok: 'yes' } })
    expect(bad.status).toBe(400)
    expect(bad.body.error.details.seal).toBeTruthy()
    const f = await post(`/api/journeys/${id}/stops/1/form`, t, { answers: { seal: 'S-1', ok: 'yes' } })
    expect(f.status).toBe(201)
    expect(f.body.data.form.answers).toEqual({ seal: 'S-1', ok: true })
    const ph = await post(`/api/journeys/${id}/stops/1/photos`, t, { data: PNG, caption: 'Gate' })
    expect(ph.status).toBe(201)
    expect((await get(`/api/journeys/${id}/stops/1/photos/${ph.body.data.id}`, t)).headers['content-type']).toBe('image/png')
    await post(`/api/journeys/${id}/stops/2/check-in`, t, {})
    const d = await get(`/api/journeys/${id}`, t)
    expect(d.body.data.status).toBe('Completed')
    expect(d.body.data.stops[1].photos).toHaveLength(1)
  })

  it('Journey Alerts and the report feed', async () => {
    const id = await onTheRoad()
    const t = fx.tokens.bgUserA1a
    await post(`/api/journeys/${id}/stops/1/check-in`, t, {})
    const ev = await get('/api/journeys/events', t)
    expect(ev.status).toBe(200)
    expect(ev.body.data.some(e => e.type === 'CHECK_IN' && e.journey.id === id)).toBe(true)
    const only = await get('/api/journeys/events?alertsOnly=true', t)
    expect(only.body.data.every(e => e.alert)).toBe(true)
    const from = new Date(Date.now() - 86_400_000).toISOString(), to = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const rep = await get(`/api/journeys/report?from=${from}&to=${to}`, t)
    expect(rep.status).toBe(200)
    expect(rep.body.data[0]).toMatchObject({ id, cost: 0 })
    expect(rep.body.data[0].events.length).toBeGreaterThan(0)
    // Another BG sees none of it.
    const other = await get(`/api/journeys/report?from=${from}&to=${to}`, fx.tokens.bgUserB1a)
    expect(other.body.data ?? []).toHaveLength(0)
  })
})
