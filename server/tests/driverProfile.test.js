/**
 * Driver Management, phase 1: profile and licence details, Suspended status,
 * photo, scanned documents, and the expiry alert over every driver date.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
const { evaluateLicence } = await import('../src/lib/alertEngine.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

// Tiny but real file headers: the server reads the type from the bytes.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64')
const PDF = Buffer.from('%PDF-1.4\n% test document\n').toString('base64')

const create = (body, token = fx.tokens.bgUserA1a) =>
  request(app).post('/api/drivers').set(auth(token)).send({ bgId: fx.bgA1a.id, ...body })

describe('driver profile', () => {
  it('stores the profile and licence details, numbers drivers, and allows Suspended', async () => {
    const a = await create({
      name: 'Ahmed Khan', email: 'Ahmed@Example.com', nationality: 'Pakistan', dateOfBirth: '1990-04-12',
      employeeId: 'EMP-7', department: 'Logistics', joiningDate: '2024-01-15',
      licenseNo: 'AD-1', licenseCategory: 'Light Vehicle', licenseIssueDate: '2020-01-01', licenseExpiry: '2027-03-31',
      licenseCountry: 'UAE', visaExpiry: '2026-12-01', emiratesId: '784-1990-1234567-1', emiratesIdExpiry: '2027-01-01',
      medicalExpiry: '2026-11-20', status: 'Suspended',
    })
    expect(a.status).toBe(201)
    expect(a.body.data).toMatchObject({
      email: 'ahmed@example.com', dateOfBirth: '1990-04-12', joiningDate: '2024-01-15', licenseCategory: 'Light Vehicle',
      licenseIssueDate: '2020-01-01', visaExpiry: '2026-12-01', emiratesIdExpiry: '2027-01-01', medicalExpiry: '2026-11-20',
      status: 'Suspended',
    })
    const b = await create({ name: 'Bilal' })
    expect(b.body.data.driverNo).toBe(a.body.data.driverNo + 1)
    expect((await create({ name: 'X', email: 'not-an-email' })).status).toBe(400)
    expect((await create({ name: 'X', visaExpiry: '01/12/2026' })).status).toBe(400)
  })

  it('keeps departments to the fixed list and a suspended driver off any vehicle', async () => {
    expect((await create({ name: 'X', department: 'Logistics' })).status).toBe(201)
    expect((await create({ name: 'X', department: 'Rocket Science' })).status).toBe(400)
    const s = await create({ name: 'Off duty', status: 'Suspended', vehicleId: fx.vehicles.v1.id })
    expect(s.status).toBe(400)
    expect(s.body.error.details).toEqual({ vehicleId: 'Not for a suspended driver' })
  })

  it('takes a photo, serves it publicly by key, and removes it', async () => {
    const d = (await create({ name: 'Photo Driver' })).body.data
    const up = await request(app).put(`/api/drivers/${d.id}/photo`).set(auth(fx.tokens.bgUserA1a)).send({ image: PNG })
    expect(up.status).toBe(200)
    const key = up.body.data.photoKey
    expect(key).toMatch(/^[a-f0-9]{32}$/)
    const img = await request(app).get(`/api/driver-photos/${key}`)
    expect(img.status).toBe(200)
    expect(img.headers['content-type']).toBe('image/png')
    expect((await request(app).put(`/api/drivers/${d.id}/photo`).set(auth(fx.tokens.bgUserA1a)).send({ image: PDF })).status).toBe(400)
    const gone = await request(app).delete(`/api/drivers/${d.id}/photo`).set(auth(fx.tokens.bgUserA1a))
    expect(gone.body.data.photoKey).toBeNull()
    expect((await request(app).get(`/api/driver-photos/${key}`)).status).toBe(404)
  })

  it('uploads, lists, serves and deletes documents, within the driver scope only', async () => {
    const d = (await create({ name: 'Doc Driver' })).body.data
    const base = `/api/drivers/${d.id}/documents`
    const up = await request(app).post(base).set(auth(fx.tokens.bgUserA1a))
      .send({ title: 'Licence front', docType: 'Driving Licence', expiryDate: '2027-03-31', fileName: 'licence.pdf', data: PDF })
    expect(up.status).toBe(201)
    expect(up.body.data).toMatchObject({ title: 'Licence front', mimeType: 'application/pdf', expiryDate: '2027-03-31' })
    expect(up.body.data.data).toBeUndefined()

    const list = await request(app).get(base).set(auth(fx.tokens.bgUserA1a))
    expect(list.body.data).toHaveLength(1)
    const file = await request(app).get(`${base}/${up.body.data.id}/file`).set(auth(fx.tokens.bgUserA1a))
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toMatch(/application\/pdf/)

    // Another tenant cannot see it; a text file is refused.
    expect((await request(app).get(base).set(auth(fx.tokens.bgUserB1a))).status).toBe(404)
    const txt = await request(app).post(base).set(auth(fx.tokens.bgUserA1a))
      .send({ title: 'x', fileName: 'x.txt', data: Buffer.from('hello there, plain text').toString('base64') })
    expect(txt.status).toBe(400)

    expect((await request(app).delete(`${base}/${up.body.data.id}`).set(auth(fx.tokens.bgUserA1a))).status).toBe(200)
    expect((await request(app).get(base).set(auth(fx.tokens.bgUserA1a))).body.data).toHaveLength(0)
  })

  it('keeps the rest of the profile: address, second contact, Tag Via, dates, insurance and mediclaim', async () => {
    const a = await create({
      name: 'Full Profile', contactNumber2: '04 555 1234', country: 'United Arab Emirates', state: 'Abu Dhabi', city: 'Mussafah',
      zipCode: '00000', street1: 'M-37', street2: 'Plot 12', tagType: 'RFID', leavingDate: '2030-01-31', retirementDate: '2045-04-12',
      drivingSince: '2012-06-01', licenseAvailable: false, licenseCategory: 'Light Vehicle, Heavy Vehicle',
      lifeInsuranceNo: 'LI-77', lifeInsuranceExpiry: '2027-05-01', mediclaimNo: 'MC-9', mediclaimExpiry: '2026-12-31',
    })
    expect(a.status).toBe(201)
    expect(a.body.data).toMatchObject({
      contactNumber2: '04 555 1234', city: 'Mussafah', street2: 'Plot 12', tagType: 'RFID', leavingDate: '2030-01-31',
      retirementDate: '2045-04-12', drivingSince: '2012-06-01', licenseAvailable: false, licenseCategory: 'Light Vehicle, Heavy Vehicle',
      lifeInsuranceExpiry: '2027-05-01', mediclaimNo: 'MC-9', mediclaimExpiry: '2026-12-31',
    })
    // Licence available is the default; Tag Via is a fixed list.
    expect((await create({ name: 'Default' })).body.data.licenseAvailable).toBe(true)
    expect((await create({ name: 'X', tagType: 'Barcode' })).status).toBe(400)
  })

  it('keeps a leave register per driver, in scope', async () => {
    const d = (await create({ name: 'On Leave' })).body.data
    const base = `/api/drivers/${d.id}/leaves`
    const add = await request(app).post(base).set(auth(fx.tokens.bgUserA1a))
      .send({ leaveType: 'Annual', days: '14', validFrom: '2026-12-01', validTo: '2026-12-14', notes: 'Home' })
    expect(add.status).toBe(201)
    expect(add.body.data).toMatchObject({ leaveType: 'Annual', days: 14, validFrom: '2026-12-01', validTo: '2026-12-14' })
    const backwards = await request(app).post(base).set(auth(fx.tokens.bgUserA1a)).send({ leaveType: 'Sick', validFrom: '2026-12-10', validTo: '2026-12-01' })
    expect(backwards.status).toBe(400)
    expect(backwards.body.error.details).toEqual({ validTo: 'On or after the From date' })
    expect((await request(app).post(base).set(auth(fx.tokens.bgUserA1a)).send({ leaveType: 'Holiday', validFrom: '2026-12-01' })).status).toBe(400)
    expect((await request(app).post(base).set(auth(fx.tokens.bgUserA1a)).send({ leaveType: 'Sick' })).status).toBe(400)

    expect((await request(app).get(base).set(auth(fx.tokens.bgUserB1a))).status).toBe(404)
    expect((await request(app).get(base).set(auth(fx.tokens.bgUserA1a))).body.data).toHaveLength(1)
    expect((await request(app).delete(`${base}/${add.body.data.id}`).set(auth(fx.tokens.bgUserA1a))).status).toBe(200)
    expect((await request(app).get(base).set(auth(fx.tokens.bgUserA1a))).body.data).toHaveLength(0)
  })

  it('keeps a document issue date', async () => {
    const d = (await create({ name: 'Papers' })).body.data
    const up = await request(app).post(`/api/drivers/${d.id}/documents`).set(auth(fx.tokens.bgUserA1a))
      .send({ title: 'Licence', docType: 'Driving Licence', issueDate: '2021-03-01', expiryDate: '2031-03-01', fileName: 'l.pdf', data: PDF })
    expect(up.status).toBe(201)
    expect(up.body.data).toMatchObject({ issueDate: '2021-03-01', expiryDate: '2031-03-01' })
  })

  it('deleting a driver takes its photo and documents with it', async () => {
    const d = (await create({ name: 'Gone' })).body.data
    await request(app).put(`/api/drivers/${d.id}/photo`).set(auth(fx.tokens.bgUserA1a)).send({ image: PNG })
    await request(app).post(`/api/drivers/${d.id}/documents`).set(auth(fx.tokens.bgUserA1a)).send({ title: 't', fileName: 'a.pdf', data: PDF })
    await request(app).delete(`/api/drivers/${d.id}`).set(auth(fx.tokens.bgUserA1a))
    expect(await prisma.driverPhoto.count()).toBe(0)
    expect(await prisma.driverDocument.count()).toBe(0)
  })
})

describe('document expiry alert', () => {
  const NOW = Math.floor(Date.UTC(2026, 10, 6, 6) / 1000)
  it('names the document that is expiring', () => {
    const r = evaluateLicence({ type: 'license_expiry', params: { days: 30 } }, { visaExpiry: new Date('2026-11-20T00:00:00Z') }, {}, NOW, 'visaExpiry', 'Visa')
    expect(r.fire.message).toBe('Visa expires in 14 days')
  })

  it('watches life insurance and mediclaim too', async () => {
    const { DRIVER_EXPIRIES } = await import('../src/lib/alertEngine.js')
    expect(DRIVER_EXPIRIES.map(([f]) => f)).toEqual(expect.arrayContaining(['lifeInsuranceExpiry', 'mediclaimExpiry']))
    const r = evaluateLicence({ type: 'license_expiry', params: { days: 30 } }, { mediclaimExpiry: new Date('2026-11-20T00:00:00Z') }, {}, NOW, 'mediclaimExpiry', 'Mediclaim')
    expect(r.fire.message).toBe('Mediclaim expires in 14 days')
  })
})
