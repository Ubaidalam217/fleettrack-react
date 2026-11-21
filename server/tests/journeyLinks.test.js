/**
 * A journey's public links (routes/journeyPublic.js, client 2026-11-21): the
 * tracking link (read only, no codes, the driver's first name) and the driver
 * link (check in — a QR stop needs its code —, form, photo, signature), both
 * without a login; expired and switched-off links; a tracking link cannot write.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { __clearJourneySettingsCache } from '../src/lib/journeySettings.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const P = { a: { lat: 24.35, lng: 54.50 }, b: { lat: 24.35, lng: 54.95 }, c: { lat: 24.35, lng: 55.40 } }

beforeEach(async () => {
  await resetDb()
  __clearJourneySettingsCache()
  fx = await seedFixture()
})

async function journeyWithLinks() {
  const t = fx.tokens.bgUserA1a
  const driver = await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Imran Khan Baloch', mobile: '+971500000000' } })
  const form = await request(app).post('/api/journey-forms').set(auth(t)).send({ name: 'POD', fields: [{ label: 'Pallets', type: 'NUMBER', required: true }] })
  const start = new Date(Date.now() + 3600_000)
  const c = await request(app).post('/api/journeys').set(auth(t)).send({
    title: 'Ruwais delivery', vehicleId: fx.vehicles.v1.id, driverId: driver.id, plannedStart: start.toISOString(), routeSource: 'STRAIGHT', instructions: 'Gate 2',
    stops: [
      { name: 'Depot', ...P.a },
      { name: 'Gate', ...P.b, stayMin: 20, visitVia: 'QR', formId: form.body.data.id, signatureRequired: true },
      { name: 'Site', ...P.c },
    ],
  })
  const id = c.body.data.id
  await prisma.journey.update({ where: { id }, data: { status: 'InProgress', approvalStatus: 'APPROVED', actualStart: new Date(), lastLat: 24.35, lastLng: 54.7, lastFixAt: new Date() } })
  const track = (await request(app).post(`/api/journeys/${id}/links`).set(auth(t)).send({ kind: 'TRACK' })).body.data
  const drv = (await request(app).post(`/api/journeys/${id}/links`).set(auth(t)).send({ kind: 'DRIVER' })).body.data
  return { id, track, drv, codes: c.body.data.stops.map(s => s.code) }
}

describe('the tracking link', () => {
  it('shows the position, the stops and the ETA without a login, and never a stop code', async () => {
    const { track } = await journeyWithLinks()
    const r = await request(app).get(`/api/public/journey/${track.token}`)
    expect(r.status).toBe(200)
    const j = r.body.data.journey
    expect(r.body.data.kind).toBe('TRACK')
    expect(j.position).toMatchObject({ lat: 24.35, lng: 54.7 })
    expect(j.stops).toHaveLength(3)
    expect(j.stops.every(s => s.code === undefined && s.formFields === undefined)).toBe(true)
    expect(j.driverName).toBe('Imran')
    expect(j.instructions).toBe(null)
    expect(j.canAct).toBe(false)
    expect(JSON.stringify(r.body)).not.toMatch(/\+971/)
  })

  it('cannot check in; expired and switched-off links answer 410 / 404', async () => {
    const { id, track } = await journeyWithLinks()
    expect((await request(app).post(`/api/public/journey/${track.token}/stops/1/check-in`).send({})).status).toBe(403)
    await prisma.journeyLink.update({ where: { id: track.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await request(app).get(`/api/public/journey/${track.token}`)).status).toBe(410)
    await request(app).delete(`/api/journeys/${id}/links/${track.id}`).set(auth(fx.tokens.bgUserA1a))
    expect((await request(app).get(`/api/public/journey/${track.token}`)).status).toBe(404)
    expect((await request(app).get('/api/public/journey/not-a-real-token-at-all-123')).status).toBe(404)
  })
})

describe('the driver link', () => {
  it('a QR stop needs its code; then the form, a photo and the signature', async () => {
    const { id, drv, codes } = await journeyWithLinks()
    const base = `/api/public/journey/${drv.token}/stops/1`
    const g = await request(app).get(`/api/public/journey/${drv.token}`)
    expect(g.body.data.journey).toMatchObject({ canAct: true, instructions: 'Gate 2', driverName: 'Imran Khan Baloch' })
    expect(g.body.data.journey.stops[1].formFields).toHaveLength(1)

    expect((await request(app).post(`${base}/check-in`).send({})).status).toBe(400)
    expect((await request(app).post(`${base}/check-in`).send({ code: 'WRONG1' })).status).toBe(400)
    // A scanned QR may carry a link that ends with the code.
    const ok = await request(app).post(`${base}/check-in`).send({ code: `https://x.ae/q/${codes[1].toLowerCase()}`, lat: 24.35, lng: 54.95 })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ status: 'ARRIVED', checkInSource: 'DRIVER', detectedBy: 'QR' })

    expect((await request(app).post(`${base}/form`).send({ answers: {} })).status).toBe(400)
    expect((await request(app).post(`${base}/form`).send({ answers: { pallets: 12 } })).status).toBe(201)
    expect((await request(app).post(`${base}/photos`).send({ data: PNG, caption: 'Seal' })).status).toBe(201)
    const sig = await request(app).post(`${base}/signature`).send({ data: PNG, signedByName: 'Gate officer' })
    expect(sig.status).toBe(201)
    expect(sig.body.data.signed).toBe(true)

    const d = await request(app).get(`/api/journeys/${id}`).set(auth(fx.tokens.bgUserA1a))
    const s1 = d.body.data.stops[1]
    expect(s1.signature.source).toBe('DRIVER_APP')
    expect(s1.form.source).toBe('DRIVER_APP')
    expect(s1.photos).toHaveLength(1)
    expect(d.body.data.events.map(e => e.type)).toEqual(expect.arrayContaining(['CHECK_IN', 'FORM', 'PHOTO', 'SIGNATURE']))
  })

  it('checking in at the destination completes the journey', async () => {
    const { id, drv } = await journeyWithLinks()
    const r = await request(app).post(`/api/public/journey/${drv.token}/stops/2/check-in`).send({})
    expect(r.status).toBe(200)
    expect((await prisma.journey.findUnique({ where: { id } })).status).toBe('Completed')
    // Finished: nothing more can be done there.
    expect((await request(app).get(`/api/public/journey/${drv.token}`)).body.data.journey.canAct).toBe(false)
  })
})
