/**
 * Journey Management, phase 1 API (routes/journeys.js, routeTemplates.js,
 * journeySettings.js): the chained schedule, the HSE approval flow, one vehicle
 * one journey, the permissions (journey-approval deny-by-default), scoping,
 * journey alerts in the bell, the delivery signature and the settings.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { signToken } from '../src/lib/jwt.js'
import { levelOf } from '../src/lib/permissions.js'
import { __clearJourneySettingsCache, mergeSettings } from '../src/lib/journeySettings.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

const HOUR = 3600_000
/** A start time tomorrow, so nothing is "in the past". */
const tomorrow = (h = 10, m = 0) => {
  const d = new Date(Date.now() + 86_400_000)
  d.setUTCHours(h - 4, m, 0, 0) // UAE local h:m
  return d
}

// Mussafah → Hyderabad-like legs: ~50 km apart along a straight line east.
const P = {
  a: { lat: 24.35, lng: 54.50 },
  b: { lat: 24.35, lng: 54.95 },
  c: { lat: 24.35, lng: 55.40 },
}

const body = (vehicleId, extra = {}) => ({
  title: 'Diesel delivery to Ruwais',
  vehicleId,
  plannedStart: tomorrow(10).toISOString(),
  routeSource: 'STRAIGHT',
  stops: [
    { name: 'Depot', ...P.a },
    { name: 'Fuel stop', ...P.b, stayMin: 30, legDriveMin: 120, legSource: 'MANUAL', signatureRequired: true },
    { name: 'Site B', ...P.c, legDriveMin: 120, legSource: 'MANUAL' },
  ],
  ...extra,
})

async function makeUser(email, role, extra = {}) {
  const u = await prisma.user.create({
    data: { email, passwordHash: 'x', role, mustChangePassword: false, ...extra },
  })
  return { user: u, token: signToken(u) }
}

const post = (path, token, data) => request(app).post(path).set(auth(token)).send(data)
const get = (path, token) => request(app).get(path).set(auth(token))

beforeEach(async () => {
  await resetDb()
  __clearJourneySettingsCache()
  fx = await seedFixture()
})

describe('the plan', () => {
  it('chains the stop times from the start, the leg times and the stays', async () => {
    const res = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id))
    expect(res.status).toBe(201)
    const j = res.body.data
    expect(j.display).toBe('Draft')
    expect(j.type).toBe('MULTI_STOP')
    expect(j.ref).toMatch(/^JRN-\d{4}-0001$/)
    const [o, s, d] = j.stops
    const start = tomorrow(10).getTime()
    expect(new Date(o.plannedDepart).getTime()).toBe(start)
    expect(new Date(s.plannedArrive).getTime()).toBe(start + 2 * HOUR) // 10:00 + 2 h
    expect(new Date(s.plannedDepart).getTime()).toBe(start + 2.5 * HOUR) // + 30 min stay
    expect(new Date(d.plannedArrive).getTime()).toBe(start + 4.5 * HOUR) // + 2 h
    expect(new Date(j.expectedArrival).getTime()).toBe(start + 4.5 * HOUR)
    expect(s.signatureRequired).toBe(true)
    expect(j.plannedDriveMin).toBe(240)
    expect(j.plannedStayMin).toBe(30)
  })

  it('saves what the web form sends when the options are left blank (null, not missing)', async () => {
    // Client, 2026-11-24: "unable to save any journey". A blank option is sent as null,
    // and a coerced null is 0: lowest 0 was not below highest 0, so every save failed.
    const blank = {
      startBufferMin: null, routeToleranceM: null, forceCloseMin: null, tempMin: null, tempMax: null,
      loadState: null, convoy: [], convoyToleranceM: 200, startLogic: 'ANY_DATA', priority: 'Normal',
      stops: [
        { name: 'Depot', ...P.a, arrivalType: 'RADIUS', radiusM: 300, stayMin: 0, legDriveMin: null, legSource: null },
        { name: 'Site B', ...P.c, arrivalType: 'RADIUS', radiusM: 300, stayMin: 0, legDriveMin: null, legSource: null },
      ],
    }
    const res = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, blank))
    expect(res.status).toBe(201)
    const row = await prisma.journey.findUnique({ where: { id: res.body.data.id } })
    expect(row.tempMin).toBeNull()
    expect(row.tempMax).toBeNull()
    expect(row.forceCloseMin).toBeNull()
    expect(row.startBufferMin).toBeGreaterThan(0) // the setting's default, not 0
    // A real pair still has to be ordered.
    const bad = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { tempMin: 8, tempMax: 2 }))
    expect(bad.status).toBe(400)
  })

  it('works a leg out from km ÷ the planned speed when not given', async () => {
    const b = body(fx.vehicles.v1.id)
    b.stops[1] = { name: 'Fuel stop', ...P.b }
    b.stops[2] = { name: 'Site B', ...P.c }
    const res = await post('/api/journeys', fx.tokens.bgUserA1a, b)
    expect(res.status).toBe(201)
    const leg = res.body.data.stops[1]
    expect(leg.legSource).toBe('SPEED')
    // ~45.6 km straight × 1.25 road ≈ 57 km at 70 km/h ≈ 49 min
    expect(leg.legKm).toBeGreaterThan(50)
    expect(leg.legDriveMin).toBe(Math.round((leg.legKm / 70) * 60))
  })

  it('needs at least a start and a destination', async () => {
    const b = body(fx.vehicles.v1.id)
    b.stops = b.stops.slice(0, 1)
    const res = await post('/api/journeys', fx.tokens.bgUserA1a, b)
    expect(res.status).toBe(400)
  })

  it('snapshots a geofence stop', async () => {
    const g = await prisma.geofence.create({ data: { bgId: fx.bgA1a.id, kind: 'ADDRESS', shape: 'CIRCLE', name: 'Yard', centerLat: 24.36, centerLng: 54.51, radius: 450 } })
    const b = body(fx.vehicles.v1.id)
    b.stops[0] = { name: 'Yard', arrivalType: 'GEOFENCE', geofenceId: g.id, lat: 0, lng: 0 }
    const res = await post('/api/journeys', fx.tokens.bgUserA1a, b)
    expect(res.status).toBe(201)
    expect(res.body.data.stops[0]).toMatchObject({ arrivalType: 'GEOFENCE', geofenceId: g.id, lat: 24.36, lng: 54.51, radiusM: 450 })
  })
})

describe('HSE approval and one vehicle, one journey', () => {
  let approver
  beforeEach(async () => {
    approver = await makeUser('hse@alhabtoorlog.ae', 'BG_USER', { bgId: fx.bgA1a.id, screenAccess: { 'journey-approval': 'modify' } })
  })

  it('journey-approval is denied by default, every other screen is not', () => {
    expect(levelOf(null, 'journey-approval')).toBe('none')
    expect(levelOf({}, 'journey-approval')).toBe('none')
    expect(levelOf(null, 'journeys')).toBe('addDelete')
    expect(levelOf({ 'journey-approval': 'modify' }, 'journey-approval')).toBe('modify')
  })

  it('send → approve → Scheduled, by someone else with the HSE right', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    expect(c.status).toBe(201)
    expect(c.body.data.display).toBe('Pending')
    const id = c.body.data.id

    // A BG user with no permission map cannot approve (deny by default).
    const other = await makeUser('ops2@alhabtoorlog.ae', 'BG_USER', { bgId: fx.bgA1a.id })
    expect((await post(`/api/journeys/${id}/approve`, other.token)).status).toBe(403)

    const ok = await post(`/api/journeys/${id}/approve`, approver.token)
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ status: 'Scheduled', approvalStatus: 'APPROVED', display: 'Scheduled' })

    const events = await prisma.journeyEvent.findMany({ where: { journeyId: id }, orderBy: { occurredAt: 'asc' } })
    expect(events.map(e => e.type)).toEqual(['SUBMITTED', 'APPROVED'])
    // The approval request rang the bell.
    expect(await prisma.alertEvent.count({ where: { type: 'journey_submitted' } })).toBe(1)
  })

  it('nobody approves their own journey, not even with the HSE right', async () => {
    const c = await post('/api/journeys', approver.token, body(fx.vehicles.v1.id, { submit: true }))
    expect(c.status).toBe(201)
    const res = await post(`/api/journeys/${c.body.data.id}/approve`, approver.token)
    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(/another HSE approver/)
  })

  it('reject needs a reason and sends it back as Rejected; it can be sent again', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    const id = c.body.data.id
    expect((await post(`/api/journeys/${id}/reject`, approver.token, {})).status).toBe(400)
    const r = await post(`/api/journeys/${id}/reject`, approver.token, { reason: 'Rest stop closed for roadworks' })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ display: 'Rejected', rejectReason: 'Rest stop closed for roadworks' })
    const again = await post(`/api/journeys/${id}/submit`, fx.tokens.bgUserA1a)
    expect(again.status).toBe(200)
    expect(again.body.data.display).toBe('Pending')
  })

  it('refuses a second journey on the same vehicle at an overlapping time, naming the first', async () => {
    const first = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    expect(first.status).toBe(201)
    const clash = await post('/api/journeys', fx.tokens.superAdmin, body(fx.vehicles.v1.id, { submit: true, plannedStart: tomorrow(12).toISOString() }))
    expect(clash.status).toBe(409)
    expect(clash.body.error.message).toMatch(/PLATE-1 already has a journey at this time: JRN-\d{4}-0001 .*One vehicle can only have one journey at a time\./)
    // A draft does not hold the vehicle; a later time is fine.
    expect((await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { plannedStart: tomorrow(12).toISOString() }))).status).toBe(201)
    expect((await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true, plannedStart: tomorrow(16).toISOString() }))).status).toBe(201)
    // The availability check the form uses says the same.
    const a = await get(`/api/journeys/availability?vehicleId=${fx.vehicles.v1.id}&from=${tomorrow(11).toISOString()}&to=${tomorrow(13).toISOString()}`, fx.tokens.bgUserA1a)
    expect(a.body.data.free).toBe(false)
  })

  it('a journey on the road blocks the vehicle past its own window', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    await prisma.journey.update({ where: { id: c.body.data.id }, data: { status: 'Delayed', approvalStatus: 'APPROVED' } })
    const later = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true, plannedStart: tomorrow(18).toISOString() }))
    expect(later.status).toBe(409)
  })

  it('approve checks the overlap again, and the driver', async () => {
    const d = await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Rashid', status: 'Active' } })
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true, driverId: d.id }))
    expect(c.status).toBe(201)
    await prisma.driver.update({ where: { id: d.id }, data: { status: 'Suspended' } })
    const res = await post(`/api/journeys/${c.body.data.id}/approve`, approver.token)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/suspended/)
  })

  it('a change of plan after approval goes back to HSE; a new name does not', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    const id = c.body.data.id
    await post(`/api/journeys/${id}/approve`, approver.token)
    const rename = await request(app).put(`/api/journeys/${id}`).set(auth(fx.tokens.bgUserA1a)).send(body(fx.vehicles.v1.id, { title: 'Renamed' }))
    expect(rename.status).toBe(200)
    expect(rename.body.data).toMatchObject({ display: 'Scheduled', title: 'Renamed' })
    expect(rename.body.resent).toBe(false)
    const moved = await request(app).put(`/api/journeys/${id}`).set(auth(fx.tokens.bgUserA1a)).send(body(fx.vehicles.v1.id, { title: 'Renamed', plannedStart: tomorrow(11).toISOString() }))
    expect(moved.status).toBe(200)
    expect(moved.body.data.display).toBe('Pending')
    expect(moved.body.resent).toBe(true)
  })
})

describe('permissions and scope', () => {
  it('Journeys View cannot plan; Edit can plan but not cancel or delete; Full can', async () => {
    const viewer = await makeUser('view@alhabtoorlog.ae', 'BG_USER', { bgId: fx.bgA1a.id, screenAccess: { journeys: 'view' } })
    expect((await post('/api/journeys', viewer.token, body(fx.vehicles.v1.id))).status).toBe(403)
    expect((await get('/api/journeys', viewer.token)).status).toBe(200)

    const editor = await makeUser('edit@alhabtoorlog.ae', 'BG_USER', { bgId: fx.bgA1a.id, screenAccess: { journeys: 'modify' } })
    const c = await post('/api/journeys', editor.token, body(fx.vehicles.v1.id))
    expect(c.status).toBe(201)
    expect((await request(app).delete(`/api/journeys/${c.body.data.id}`).set(auth(editor.token))).status).toBe(403)
    expect((await post(`/api/journeys/${c.body.data.id}/cancel`, editor.token, {})).status).toBe(403)
    expect((await request(app).delete(`/api/journeys/${c.body.data.id}`).set(auth(fx.tokens.bgUserA1a))).status).toBe(200)

    const none = await makeUser('none@alhabtoorlog.ae', 'BG_USER', { bgId: fx.bgA1a.id, screenAccess: { journeys: 'none' } })
    expect((await get('/api/journeys', none.token)).status).toBe(403)
  })

  it('a sub-user sees the journeys of its own vehicles and may not plan unless given Journeys', async () => {
    await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id))
    await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v3.id))
    // Drafts for tomorrow: outside today's default window, so ask for that day.
    const list = await get(`/api/journeys?from=${tomorrow(0).toISOString()}&to=${tomorrow(23).toISOString()}`, fx.tokens.subUserA1a)
    expect(list.status).toBe(200)
    expect(list.body.data.map(j => j.vehicleLabel)).toEqual(['PLATE-1'])
    expect((await post('/api/journeys', fx.tokens.subUserA1a, body(fx.vehicles.v1.id))).status).toBe(403)
  })

  it('another BG never sees or touches the journey (404)', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id))
    expect((await get(`/api/journeys/${c.body.data.id}`, fx.tokens.bgUserB1a)).status).toBe(404)
    expect((await get('/api/journeys', fx.tokens.bgUserB1a)).body.data).toHaveLength(0)
    // …nor plans on a vehicle it cannot see.
    expect((await post('/api/journeys', fx.tokens.bgUserB1a, body(fx.vehicles.v1.id))).status).toBe(404)
  })

  it('journey alerts stay out of the bell of an account without Journeys', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    expect(c.status).toBe(201)
    const none = await makeUser('none@alhabtoorlog.ae', 'BG_USER', { bgId: fx.bgA1a.id, screenAccess: { journeys: 'none' } })
    const seen = await get('/api/alert-events', fx.tokens.bgUserA1a)
    expect(seen.body.data.some(e => e.type === 'journey_submitted')).toBe(true)
    const hidden = await get('/api/alert-events', none.token)
    expect(hidden.body.data.some(e => e.type.startsWith('journey_'))).toBe(false)
  })
})

describe('list, detail, cancel', () => {
  it('lists today, everything on the road and everything waiting for HSE, with counts', async () => {
    const a = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    const b = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v2.id))
    await prisma.journey.update({ where: { id: b.body.data.id }, data: { status: 'InProgress', approvalStatus: 'APPROVED', delayMin: 12 } })
    const res = await get('/api/journeys', fx.tokens.bgUserA1a)
    expect(res.status).toBe(200)
    expect(res.body.data.map(j => j.id).sort()).toEqual([a.body.data.id, b.body.data.id].sort())
    expect(res.body.counts).toMatchObject({ all: 2, Pending: 1, InProgress: 1, late: 1 })
    const pending = await get('/api/journeys?status=Pending', fx.tokens.bgUserA1a)
    expect(pending.body.data).toHaveLength(1)
  })

  it('the detail carries the stops, the events and what the caller may do', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    const res = await get(`/api/journeys/${c.body.data.id}`, fx.tokens.bgUserA1a)
    expect(res.status).toBe(200)
    expect(res.body.data.stops).toHaveLength(3)
    expect(res.body.data.events[0].type).toBe('SUBMITTED')
    expect(res.body.data.can).toMatchObject({ edit: true, approve: false, cancel: true })
  })

  it('cancels with a reason and keeps the journey', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))
    const res = await post(`/api/journeys/${c.body.data.id}/cancel`, fx.tokens.bgUserA1a, { reason: 'Customer postponed' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'Cancelled', cancelReason: 'Customer postponed' })
    // Cancelled frees the vehicle.
    expect((await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id, { submit: true }))).status).toBe(201)
  })
})

describe('proof of delivery', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])

  it('stores a stop signature once and serves it only to who can see the journey', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id))
    const id = c.body.data.id
    const up = await post(`/api/journeys/${id}/stops/1/signature`, fx.tokens.bgUserA1a, { data: `data:image/png;base64,${png.toString('base64')}`, signedByName: 'Ahmed (store keeper)' })
    expect(up.status).toBe(201)
    expect(up.body.data.signature).toMatchObject({ signedByName: 'Ahmed (store keeper)', source: 'WEB' })
    expect((await post(`/api/journeys/${id}/stops/1/signature`, fx.tokens.bgUserA1a, { data: png.toString('base64') })).status).toBe(409)
    const img = await get(`/api/journeys/${id}/stops/1/signature`, fx.tokens.bgUserA1a)
    expect(img.status).toBe(200)
    expect(img.headers['content-type']).toBe('image/png')
    expect((await get(`/api/journeys/${id}/stops/1/signature`, fx.tokens.bgUserB1a)).status).toBe(404)
    expect((await request(app).get(`/api/journeys/${id}/stops/1/signature`)).status).toBe(401)
    const detail = await get(`/api/journeys/${id}`, fx.tokens.bgUserA1a)
    expect(detail.body.data.events.some(e => e.type === 'SIGNATURE')).toBe(true)
  })

  it('refuses a non-image', async () => {
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, body(fx.vehicles.v1.id))
    const res = await post(`/api/journeys/${c.body.data.id}/stops/2/signature`, fx.tokens.bgUserA1a, { data: Buffer.from('%PDF-1.4 hello world').toString('base64') })
    expect(res.status).toBe(400)
  })
})

describe('settings and saved routes', () => {
  it('reads the defaults, saves per BG, and keeps a sub-user out', async () => {
    const g = await get('/api/journey-settings', fx.tokens.bgUserA1a)
    expect(g.status).toBe(200)
    expect(g.body.data.value).toMatchObject({ lateDepartureMin: 10, lateArrivalMin: 15, onTimeMin: 10, plannedSpeedKmh: 70 })
    expect(g.body.data.value.channels.whatsapp).toBe(false)
    expect(g.body.data.whatsappConfigured).toBe(false)
    const p = await request(app).put('/api/journey-settings').set(auth(fx.tokens.bgUserA1a)).send({ value: { onTimeMin: 5, plannedSpeedKmh: 60, channels: { whatsapp: true } } })
    expect(p.status).toBe(200)
    expect(p.body.data.value).toMatchObject({ onTimeMin: 5, plannedSpeedKmh: 60 })
    // WhatsApp cannot be switched on before it is set up.
    expect(p.body.data.value.channels.whatsapp).toBe(false)
    expect((await request(app).put('/api/journey-settings').set(auth(fx.tokens.subUserA1a)).send({ value: {} })).status).toBe(403)
    // The new planned speed drives the next plan.
    const b = body(fx.vehicles.v1.id)
    b.stops = [{ name: 'A', ...P.a }, { name: 'C', ...P.c }]
    const c = await post('/api/journeys', fx.tokens.bgUserA1a, b)
    expect(c.body.data.stops[1].legDriveMin).toBe(Math.round((c.body.data.stops[1].legKm / 60) * 60))
  })

  it('clamps nonsense values', () => {
    expect(mergeSettings({ onTimeMin: -5, plannedSpeedKmh: 'x' })).toMatchObject({ onTimeMin: 0, plannedSpeedKmh: 70 })
  })

  it('saves, lists and deletes a route, BG-wide', async () => {
    const t = { name: 'Mussafah → Ruwais', source: 'DRAWN', path: [[24.35, 54.5], [24.35, 54.9], [24.35, 55.4]], stops: [{ name: 'A', ...P.a }, { name: 'C', ...P.c }] }
    const c = await post('/api/route-templates', fx.tokens.bgUserA1a, t)
    expect(c.status).toBe(201)
    expect(c.body.data.distanceKm).toBeGreaterThan(80)
    expect((await post('/api/route-templates', fx.tokens.bgUserA1a, t)).status).toBe(409)
    expect((await get('/api/route-templates', fx.tokens.subUserA1a)).body.data).toHaveLength(1)
    expect((await get('/api/route-templates', fx.tokens.bgUserB1a)).body.data).toHaveLength(0)
    expect((await request(app).delete(`/api/route-templates/${c.body.data.id}`).set(auth(fx.tokens.bgUserA1a))).status).toBe(200)
  })
})
