/**
 * Vehicle documents (/api/vehicles/:vehicleId/documents): scope, permissions,
 * the uploaded file, and the expiry alert that reads them.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import prisma from '../src/prisma.js'
import { evaluateVehicleDocument, runAlertPass } from '../src/lib/alertEngine.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

const base = id => `/api/vehicles/${id}/documents`
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const add = (token, vehicleId, body) => request(app).post(base(vehicleId)).set(auth(token)).send(body)
const setAccess = (user, screenAccess) => prisma.user.update({ where: { id: user.id }, data: { screenAccess } })

describe('vehicle documents', () => {
  it('adds, lists, edits and deletes a document with its file', async () => {
    const res = await add(fx.tokens.bgUserA1a, fx.vehicles.v1.id, {
      docType: 'Insurance', number: 'POL-1', issueDate: '2026-01-01', expiryDate: '2027-01-01', notifyBeforeDays: '45',
      fileName: 'policy.pdf', data: PDF.toString('base64'),
    })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      name: 'Insurance', docType: 'Insurance', number: 'POL-1', expiryDate: '2027-01-01', notifyBeforeDays: 45,
      fileName: 'policy.pdf', mimeType: 'application/pdf', size: PDF.length, hasFile: true,
    })
    expect(res.body.data.data).toBeUndefined()
    const id = res.body.data.id

    const list = await request(app).get(base(fx.vehicles.v1.id)).set(auth(fx.tokens.subUserA1a))
    expect(list.status).toBe(200)
    expect(list.body.data.map(d => d.id)).toEqual([id])

    const file = await request(app).get(`${base(fx.vehicles.v1.id)}/${id}/file?download=1`).set(auth(fx.tokens.subUserA1a))
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('application/pdf')
    expect(file.headers['content-disposition']).toContain('attachment; filename="policy.pdf"')
    expect(Buffer.from(file.body).equals(PDF)).toBe(true)

    // An edit without a file keeps it; a new one replaces it.
    const kept = await request(app).put(`${base(fx.vehicles.v1.id)}/${id}`).set(auth(fx.tokens.bgUserA1a))
      .send({ docType: 'Insurance', name: 'Fleet insurance', expiryDate: '2027-02-01', notifyBeforeDays: 30 })
    expect(kept.status).toBe(200)
    expect(kept.body.data).toMatchObject({ name: 'Fleet insurance', expiryDate: '2027-02-01', number: null, fileName: 'policy.pdf' })
    const replaced = await request(app).put(`${base(fx.vehicles.v1.id)}/${id}`).set(auth(fx.tokens.bgUserA1a))
      .send({ docType: 'Insurance', fileName: 'scan.png', data: PNG.toString('base64') })
    expect(replaced.body.data).toMatchObject({ fileName: 'scan.png', mimeType: 'image/png' })
    const removed = await request(app).put(`${base(fx.vehicles.v1.id)}/${id}`).set(auth(fx.tokens.bgUserA1a))
      .send({ docType: 'Insurance', removeFile: true })
    expect(removed.body.data).toMatchObject({ fileName: null, hasFile: false })
    expect((await request(app).get(`${base(fx.vehicles.v1.id)}/${id}/file`).set(auth(fx.tokens.bgUserA1a))).status).toBe(404)

    const del = await request(app).delete(`${base(fx.vehicles.v1.id)}/${id}`).set(auth(fx.tokens.bgUserA1a))
    expect(del.status).toBe(200)
    expect((await request(app).get(base(fx.vehicles.v1.id)).set(auth(fx.tokens.bgUserA1a))).body.data).toEqual([])
  })

  it('refuses a file that is not a PDF or an image, whatever its name says', async () => {
    const res = await add(fx.tokens.bgUserA1a, fx.vehicles.v1.id, {
      docType: 'Permit', fileName: 'permit.pdf', data: Buffer.from('MZ this is an executable, honest').toString('base64'),
    })
    expect(res.status).toBe(400)
    expect(await prisma.vehicleDocument.count()).toBe(0)
  })

  it('checks the fields', async () => {
    const res = await add(fx.tokens.bgUserA1a, fx.vehicles.v1.id, { docType: 'Passport', expiryDate: '31/12/2027', notifyBeforeDays: 400 })
    expect(res.status).toBe(400)
    expect(Object.keys(res.body.error.details).sort()).toEqual(['docType', 'expiryDate', 'notifyBeforeDays'])
  })

  it('hides another tenant’s vehicle and documents behind 404', async () => {
    const own = await add(fx.tokens.bgUserB1a, fx.vehicles.v8.id, { docType: 'Permit' })
    expect(own.status).toBe(201)
    const path = `${base(fx.vehicles.v8.id)}/${own.body.data.id}`
    for (const r of [
      await request(app).get(base(fx.vehicles.v8.id)).set(auth(fx.tokens.bgUserA1a)),
      await add(fx.tokens.bgUserA1a, fx.vehicles.v8.id, { docType: 'Permit' }),
      await request(app).get(`${path}/file`).set(auth(fx.tokens.bgUserA1a)),
      await request(app).put(path).set(auth(fx.tokens.bgUserA1a)).send({ docType: 'Other' }),
      await request(app).delete(path).set(auth(fx.tokens.bgUserA1a)),
      // A document id under the wrong vehicle is not found either.
      await request(app).delete(`${base(fx.vehicles.v1.id)}/${own.body.data.id}`).set(auth(fx.tokens.bgUserA1a)),
    ]) expect(r.status).toBe(404)
    // A sub-user sees only its assigned vehicles' documents.
    expect((await request(app).get(base(fx.vehicles.v3.id)).set(auth(fx.tokens.subUserA1a))).status).toBe(404)
    expect(await prisma.vehicleDocument.count()).toBe(1)
  })

  it('lets a sub-user read but not write', async () => {
    const res = await add(fx.tokens.subUserA1a, fx.vehicles.v1.id, { docType: 'Permit' })
    expect(res.status).toBe(403)
  })

  it('follows the Vehicle screen level: View reads, Edit changes, Full adds and deletes', async () => {
    const made = await add(fx.tokens.bgUserA1a, fx.vehicles.v1.id, { docType: 'Permit' })
    const path = `${base(fx.vehicles.v1.id)}/${made.body.data.id}`

    await setAccess(fx.users.bgUserA1a, { '/settings/vehicle': 'view' })
    expect((await request(app).get(base(fx.vehicles.v1.id)).set(auth(fx.tokens.bgUserA1a))).status).toBe(200)
    expect((await request(app).put(path).set(auth(fx.tokens.bgUserA1a)).send({ docType: 'Permit' })).status).toBe(403)

    await setAccess(fx.users.bgUserA1a, { '/settings/vehicle': 'modify' })
    expect((await request(app).put(path).set(auth(fx.tokens.bgUserA1a)).send({ docType: 'Permit', number: 'P-9' })).status).toBe(200)
    expect((await add(fx.tokens.bgUserA1a, fx.vehicles.v1.id, { docType: 'Other' })).status).toBe(403)
    expect((await request(app).delete(path).set(auth(fx.tokens.bgUserA1a))).status).toBe(403)

    await setAccess(fx.users.bgUserA1a, { '/settings/vehicle': 'addDelete' })
    expect((await request(app).delete(path).set(auth(fx.tokens.bgUserA1a))).status).toBe(200)
  })

  it('goes with the vehicle when the vehicle is deleted', async () => {
    await add(fx.tokens.bgUserA1a, fx.vehicles.v4.id, { docType: 'Permit' })
    await prisma.vehicle.delete({ where: { id: fx.vehicles.v4.id } })
    expect(await prisma.vehicleDocument.count()).toBe(0)
  })
})

describe('document expiry alert', () => {
  const NOW = Math.floor(Date.parse('2026-11-11T08:00:00Z') / 1000)
  // The fixture's temperature rule would read Flespi; nothing here needs it.
  const NO_TELEMETRY = { telemetry: new Map(), deviceByImei: new Map() }

  it('warns the document’s own notify-before days ahead, then on expiry', () => {
    const doc = { name: 'Insurance', expiryDate: new Date('2026-12-01T00:00:00Z'), notifyBeforeDays: 30 }
    const due = evaluateVehicleDocument(doc, {}, NOW)
    expect(due.fire.message).toBe('Insurance expires in 20 days')
    expect(evaluateVehicleDocument({ ...doc, notifyBeforeDays: 10 }, {}, NOW).fire).toBeNull()
    // Once per stage, not every pass.
    expect(evaluateVehicleDocument(doc, due.state, NOW).fire).toBeNull()
    const gone = evaluateVehicleDocument({ ...doc, expiryDate: new Date('2026-11-01T00:00:00Z') }, due.state, NOW)
    expect(gone.fire.message).toBe('Insurance expired 10 days ago')
  })

  it('raises an event for a vehicle of the rule’s BG only', async () => {
    await prisma.alert.create({
      data: { bgId: fx.bgA1a.id, name: 'Expiry', type: 'license_expiry', severity: 'High', status: 'Active', allVehicles: true, params: { days: 30 } },
    })
    await add(fx.tokens.bgUserA1a, fx.vehicles.v1.id, { docType: 'Registration', expiryDate: '2026-11-20', notifyBeforeDays: 30 })
    await add(fx.tokens.bgUserB1a, fx.vehicles.v8.id, { docType: 'Registration', expiryDate: '2026-11-20', notifyBeforeDays: 30 })
    const events = await runAlertPass(NOW, NO_TELEMETRY)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ vehicleId: fx.vehicles.v1.id, type: 'license_expiry' })
    expect(events[0].message).toMatch(/Registration expires in 9 days$/)
    expect(await runAlertPass(NOW + 60, NO_TELEMETRY)).toHaveLength(0)
  })
})
