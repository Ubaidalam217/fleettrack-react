/**
 * Approval is a choice on each journey (client 2026-11-24: "some journeys do
 * not need approval; we only create them and follow them"). needsApproval:
 * false creates the journey Scheduled (approvalStatus NOT_REQUIRED) with every
 * check that is not about approval, logs CREATED_WITHOUT_APPROVAL, is never
 * pushed back to Draft by an edit, and is run by the engine like an approved one.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { signToken } from '../src/lib/jwt.js'
import { __clearJourneySettingsCache, mergeSettings, JOURNEY_DEFAULTS, setJourneySettings } from '../src/lib/journeySettings.js'
import { runJourneyPass, stepJourney } from '../src/lib/journeyEngine.js'
import { FATIGUE_DEFAULTS } from '../src/lib/driverPerformance.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

const P = { a: { lat: 24.35, lng: 54.5 }, b: { lat: 24.35, lng: 54.95 }, c: { lat: 24.35, lng: 55.4 } }
const tomorrow = (h = 10) => { const d = new Date(Date.now() + 86_400_000); d.setUTCHours(h - 4, 0, 0, 0); return d }

const body = (vehicleId, extra = {}) => ({
  title: 'No approval run',
  vehicleId,
  plannedStart: tomorrow(10).toISOString(),
  routeSource: 'STRAIGHT',
  stops: [
    { name: 'Depot', ...P.a },
    { name: 'Fuel stop', ...P.b, stayMin: 30, legDriveMin: 120, legSource: 'MANUAL' },
    { name: 'Site B', ...P.c, legDriveMin: 120, legSource: 'MANUAL' },
  ],
  ...extra,
})

const post = (path, token, data) => request(app).post(path).set(auth(token)).send(data)
const put = (path, token, data) => request(app).put(path).set(auth(token)).send(data)
const get = (path, token) => request(app).get(path).set(auth(token))
const events = id => prisma.journeyEvent.findMany({ where: { journeyId: id }, orderBy: { occurredAt: 'asc' } })

beforeEach(async () => {
  await resetDb()
  __clearJourneySettingsCache()
  fx = await seedFixture()
})

describe('creating without approval', () => {
  it('is Scheduled at once, flagged, and logged in its history', async () => {
    const res = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false }))
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ status: 'Scheduled', approvalStatus: 'NOT_REQUIRED', display: 'Scheduled' })
    expect((await events(res.body.data.id)).map(e => e.type)).toEqual(['CREATED_WITHOUT_APPROVAL'])
    // It is in the detail, with no approve / submit buttons.
    const d = await get(`/api/journeys/${res.body.data.id}`, fx.tokens.bgUserA1a)
    expect(d.body.data.can).toMatchObject({ submit: false, approve: false, edit: true })
    expect(d.body.data.events.map(e => e.type)).toContain('CREATED_WITHOUT_APPROVAL')
    // No approval request rang anyone's bell.
    expect(await prisma.alertEvent.count({ where: { type: 'journey_submitted' } })).toBe(0)
  })

  it('leaving the choice out keeps the usual flow (a draft)', async () => {
    const res = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id))
    expect(res.body.data).toMatchObject({ status: 'Draft', approvalStatus: 'NONE' })
    const on = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v2.id, { needsApproval: true, submit: true }))
    expect(on.body.data).toMatchObject({ approvalStatus: 'PENDING', display: 'Pending' })
  })

  it('still refuses a suspended driver, an expired licence, a busy vehicle and a start in the past', async () => {
    const suspended = await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Rashid', status: 'Suspended' } })
    const r1 = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false, driverId: suspended.id }))
    expect(r1.status).toBe(400)
    expect(r1.body.error.message).toMatch(/suspended/)

    const expired = await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Omar', status: 'Active', licenseExpiry: new Date('2025-01-01') } })
    const r2 = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false, driverId: expired.id }))
    expect(r2.status).toBe(400)
    expect(r2.body.error.message).toMatch(/licence expired/)

    const ok = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false }))
    expect(ok.status).toBe(201)
    const busy = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false, title: 'Second' }))
    expect(busy.status).toBe(409)
    expect(busy.body.error.message).toMatch(/one journey at a time/)

    const past = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v2.id, { needsApproval: false, plannedStart: new Date(Date.now() - 24 * 3600_000).toISOString() }))
    expect(past.status).toBe(400)
  })

  it('a Scheduled no-approval journey holds the vehicle against a journey sent for approval', async () => {
    await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false }))
    const send = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true, title: 'Other' }))
    expect(send.status).toBe(409)
  })

  it('"Allow journeys without approval" off: refused (403), and the options say so', async () => {
    await setJourneySettings(fx.bgA1a.id, { allowNoApproval: false })
    const res = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false }))
    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(/switched off/)
    expect(await prisma.journey.count()).toBe(0)
    const o = await get('/api/journeys/options', fx.tokens.bgUserA1a)
    expect(o.body.data.settings).toMatchObject({ allowNoApproval: false, approvalByDefault: true })
  })
})

describe('settings', () => {
  it('both switches default to on and read back', () => {
    expect(mergeSettings(undefined)).toMatchObject({ approvalByDefault: true, allowNoApproval: true })
    expect(mergeSettings({ approvalByDefault: false })).toMatchObject({ approvalByDefault: false, allowNoApproval: true })
    expect(mergeSettings({ approvalByDefault: 'no' }).approvalByDefault).toBe(true)
  })
})

describe('editing', () => {
  it('a no-approval journey that has not started stays Scheduled, even when the plan changes', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false }))
    const id = c.body.data.id
    const changed = body(fx.vehicles.v1.id, {
      needsApproval: false, plannedStart: tomorrow(12).toISOString(),
      stops: [{ name: 'Depot', ...P.a }, { name: 'Site B', ...P.c, legDriveMin: 90, legSource: 'MANUAL' }],
    })
    const res = await put(`/api/journeys/${id}`, fx.tokens.bgUserA1a, changed)
    expect(res.status).toBe(200)
    expect(res.body.resent).toBe(false)
    expect(res.body.data).toMatchObject({ status: 'Scheduled', approvalStatus: 'NOT_REQUIRED' })
    expect(res.body.data.stops).toHaveLength(2)
    // An older client that does not send the choice changes nothing either.
    const { needsApproval: _n, ...legacy } = changed
    const res2 = await put(`/api/journeys/${id}`, fx.tokens.bgUserA1a, { ...legacy, title: 'Renamed' })
    expect(res2.body.data).toMatchObject({ status: 'Scheduled', approvalStatus: 'NOT_REQUIRED', title: 'Renamed' })
  })

  it('an edit that makes the vehicle busy is refused', async () => {
    const a = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false }))
    await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v2.id, { needsApproval: false, title: 'Other vehicle' }))
    const clash = await put(`/api/journeys/${a.body.data.id}`, fx.tokens.bgUserA1a, body(fx.vehicles.v2.id, { needsApproval: false }))
    expect(clash.status).toBe(409)
  })

  it('switching "Needs approval" back on makes it a draft that can be sent', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false }))
    const res = await put(`/api/journeys/${c.body.data.id}`, fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: true }))
    expect(res.body.data).toMatchObject({ status: 'Draft', approvalStatus: 'NONE' })
    const sent = await put(`/api/journeys/${c.body.data.id}`, fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: true, submit: true }))
    expect(sent.body.data).toMatchObject({ approvalStatus: 'PENDING', display: 'Pending' })
  })

  it('a draft can become a no-approval journey; one that was sent cannot skip approval', async () => {
    const draft = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id))
    const made = await put(`/api/journeys/${draft.body.data.id}`, fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: false }))
    expect(made.body.data).toMatchObject({ status: 'Scheduled', approvalStatus: 'NOT_REQUIRED' })
    expect((await events(draft.body.data.id)).map(e => e.type)).toContain('CREATED_WITHOUT_APPROVAL')

    const sent = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v2.id, { submit: true }))
    const skip = await put(`/api/journeys/${sent.body.data.id}`, fx.tokens.bgUserA1a, body(fx.vehicles.v2.id, { needsApproval: false }))
    expect(skip.status).toBe(400)
    expect(skip.body.error.details.needsApproval).toMatch(/cannot skip/)
  })

  it('an approved journey still goes back for approval when its plan changes', async () => {
    const approver = await prisma.user.create({ data: { email: 'approver@alhabtoorlog.ae', passwordHash: 'x', role: 'BG_USER', bgId: fx.bgA1a.id, mustChangePassword: false, screenAccess: { 'journey-approval': 'modify' } } })
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    await post(`/api/journeys/${c.body.data.id}/approve`, signToken(approver))
    const res = await put(`/api/journeys/${c.body.data.id}`, fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { needsApproval: true, plannedStart: tomorrow(14).toISOString() }))
    expect(res.body.resent).toBe(true)
    expect(res.body.data).toMatchObject({ approvalStatus: 'PENDING', display: 'Pending' })
  })
})

describe('the engine treats it as an approved, Scheduled journey', () => {
  const settings = mergeSettings(JOURNEY_DEFAULTS)
  const T0 = Math.floor(Date.parse('2026-11-18T06:00:00Z') / 1000)
  const LAT = 24.35
  const stops = () => [
    { seq: 0, kind: 'ORIGIN', name: 'Depot', arrivalType: 'RADIUS', lat: LAT, lng: 54.5, radiusM: 300, stayMin: 0, status: 'PENDING', plannedDepart: new Date(T0 * 1000), alongKm: 0, visitVia: 'MAP' },
    { seq: 1, kind: 'DESTINATION', name: 'Site', arrivalType: 'RADIUS', lat: LAT, lng: 54.9, radiusM: 300, stayMin: 0, status: 'PENDING', plannedArrive: new Date((T0 + 2400) * 1000), alongKm: 40, visitVia: 'MAP' },
  ]
  const journey = approvalStatus => ({
    id: 'j', status: 'Scheduled', approvalStatus, plannedStart: new Date(T0 * 1000), expectedArrival: new Date((T0 + 2400) * 1000), routeSource: 'STRAIGHT',
    plannedPath: null, plannedDistanceKm: 40, plannedDriveMin: 40, engineState: null, offRouteCount: 0, offRouteSec: 0, unplannedStops: 0, unplannedStopSec: 0, startBufferMin: 60,
  })
  const fixes = [
    ...Array.from({ length: 6 }, (_, i) => ({ timestamp: T0 - 300 + i * 60, 'position.latitude': LAT, 'position.longitude': 54.5, 'position.speed': 0, 'engine.ignition.status': true })),
    ...Array.from({ length: 10 }, (_, i) => ({ timestamp: T0 + 60 + i * 60, 'position.latitude': LAT, 'position.longitude': 54.5 + (i + 1) * 0.004, 'position.speed': 50, 'engine.ignition.status': true })),
  ]

  it('stepJourney gives the same answer whatever the approval status', () => {
    const run = a => stepJourney({ journey: journey(a), stops: stops(), messages: fixes, now: fixes[fixes.length - 1].timestamp, settings, fatigue: FATIGUE_DEFAULTS })
    const approved = run('APPROVED'), none = run('NOT_REQUIRED')
    expect(none.patch.status).toBe('InProgress')
    expect(none.patch).toEqual(approved.patch)
    expect(none.events.map(e => e.type)).toEqual(approved.events.map(e => e.type))
  })

  it('a pass reads it from the database and sets it on the road like any Scheduled journey', async () => {
    const vehicle = fx.vehicles.v1
    const start = new Date(Date.now() + 10 * 60_000)
    const res = await post('/api/journeys', fx.tokens.bgUserA1a, body(vehicle.id, { needsApproval: false, plannedStart: start.toISOString() }))
    expect(res.status).toBe(201)
    const now = Math.floor(Date.now() / 1000)
    const at = (t, lng, speed) => ({ timestamp: t, 'position.latitude': P.a.lat, 'position.longitude': lng, 'position.speed': speed, 'engine.ignition.status': true })
    const msgs = [
      ...Array.from({ length: 6 }, (_, i) => at(now - 600 + i * 60, 54.5, 0)),
      ...Array.from({ length: 4 }, (_, i) => at(now - 240 + i * 60, 54.5 + (i + 1) * 0.01, 50)),
    ]
    await runJourneyPass(now, { deviceByImei: new Map([[String(vehicle.imei).replace(/\D/g, ''), 4242]]), fetchMessages: async ids => new Map(ids.map(id => [id, msgs])) })
    const row = await prisma.journey.findUnique({ where: { id: res.body.data.id } })
    expect(row.lastFixAt).not.toBeNull()
    expect(row.status).toBe('InProgress')
    expect(row.approvalStatus).toBe('NOT_REQUIRED')
  })
})

describe('schedules keep their approval, and a template can carry the choice', () => {
  it('a repeating template with needsApproval false makes Scheduled, no-approval journeys', async () => {
    const { rollSchedules } = await import('../src/lib/journeySchedules.js')
    const stops = [{ name: 'Depot', ...P.a, stayMin: 0 }, { name: 'Site B', ...P.c, stayMin: 0, legDriveMin: 40, legSource: 'MANUAL' }]
    const mk = (name, vehicleId, extra) => prisma.journeyTemplate.create({
      data: {
        bgId: fx.bgA1a.id, name, vehicleId, scheduleKind: 'RELATIVE', repeat: 'DAILY', startTime: '06:00',
        validFrom: new Date(Date.now() - 86_400_000), horizonDays: 2, body: { title: name, routeSource: 'STRAIGHT', stops, ...extra },
      },
    })
    const skip = await mk('Skip', fx.vehicles.v1.id, { needsApproval: false })
    const usual = await mk('Usual', fx.vehicles.v2.id, {})
    await rollSchedules(Date.now(), { force: true })
    const a = await prisma.journey.findMany({ where: { templateId: skip.id } })
    const b = await prisma.journey.findMany({ where: { templateId: usual.id } })
    expect(a.length).toBeGreaterThan(0)
    expect(a.every(j => j.status === 'Scheduled' && j.approvalStatus === 'NOT_REQUIRED')).toBe(true)
    expect(b.length).toBeGreaterThan(0)
    expect(b.every(j => j.status === 'Draft' && j.approvalStatus === 'PENDING')).toBe(true)
  })
})
