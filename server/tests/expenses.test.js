/**
 * Settings › Master › Expense (/api/expenses): Variable and Fix expenses,
 * their checks, scope, the list filters, delete-selected and bills.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'

const { createApp } = await import('../src/app.js')
const { default: prisma } = await import('../src/prisma.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

const PDF = Buffer.from('%PDF-1.4\n% test bill\n').toString('base64')

const post = (body, token = fx.tokens.bgUserA1a) => request(app).post('/api/expenses').set(auth(token)).send(body)
const fuel = (extra = {}) => ({
  vehicleId: fx.vehicles.v1.id, category: 'Variable', type: 'Fuel', expenseDate: '2026-11-05',
  odometer: '120450', workHours: '2:30', fuelSource: 'Fuel card', vendor: 'ADNOC', amount: '250.5', referenceNo: 'INV-1', ...extra,
})

describe('expenses', () => {
  it('stores a Variable expense with its date, odometer and work time', async () => {
    const res = await post(fuel())
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      bgId: fx.bgA1a.id, category: 'Variable', type: 'Fuel', expenseDate: '2026-11-05', fromDate: null,
      odometer: 120450, workHours: '2:30', fuelSource: 'Fuel card', vendor: 'ADNOC', amount: 250.5,
      vehicleLabel: fx.vehicles.v1.plateNo, createdByName: expect.any(String),
    })
    expect(res.body.data.vehicle.id).toBe(fx.vehicles.v1.id)
  })

  it('stores a Fix expense over a period, without the one-day fields', async () => {
    const res = await post({
      vehicleId: fx.vehicles.v2.id, category: 'Fix', type: 'Insurance', fromDate: '2026-01-01', toDate: '2026-12-31',
      expenseDate: '2026-05-05', odometer: 10, workHours: '1:00', fuelSource: 'Cash', amount: 4200,
    })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ fromDate: '2026-01-01', toDate: '2026-12-31', expenseDate: null, odometer: null, workHours: null, fuelSource: null })
  })

  it('checks the type against the category, the dates, the amount and the work time', async () => {
    const wrongType = await post(fuel({ category: 'Fix', type: 'Fuel', fromDate: '2026-01-01', toDate: '2026-02-01' }))
    expect(wrongType.status).toBe(400)
    expect(wrongType.body.error.details).toEqual({ type: 'Not a Fix expense type' })

    const noDate = await post(fuel({ expenseDate: '' }))
    expect(noDate.body.error.details).toEqual({ expenseDate: 'Expense date is required' })

    const backwards = await post({ vehicleId: fx.vehicles.v1.id, category: 'Fix', type: 'Taxes and Rates', fromDate: '2026-03-01', toDate: '2026-02-01', amount: 1 })
    expect(backwards.body.error.details).toEqual({ toDate: 'On or after the From date' })

    expect((await post(fuel({ amount: '0' }))).body.error.details.amount).toBe('Enter an amount above 0')
    expect((await post(fuel({ workHours: '2.5' }))).body.error.details.workHours).toBe('Use hours:minutes, e.g. 2:30')
  })

  it('keeps to the caller’s vehicles and BG; a sub-user reads its own vehicles only', async () => {
    const other = await post(fuel({ vehicleId: fx.vehicles.v8.id }))
    expect(other.status).toBe(400)
    expect(other.body.error.details).toEqual({ vehicleId: 'Not one of your vehicles' })

    await post(fuel())
    await post(fuel({ vehicleId: fx.vehicles.v3.id }))
    const mine = await request(app).get('/api/expenses').set(auth(fx.tokens.bgUserA1a))
    expect(mine.body.data).toHaveLength(2)
    expect((await request(app).get('/api/expenses').set(auth(fx.tokens.bgUserB1a))).body.data).toHaveLength(0)

    const sub = await request(app).get('/api/expenses').set(auth(fx.tokens.subUserA1a))
    expect(sub.body.data.map(e => e.vehicleId)).toEqual([fx.vehicles.v1.id])
    expect((await post(fuel(), fx.tokens.subUserA1a)).status).toBe(403)
  })

  it('filters by category, type, vehicle and date range (a Fix period overlapping it counts)', async () => {
    await post(fuel({ expenseDate: '2026-10-01' }))
    await post(fuel({ type: 'Fines', expenseDate: '2026-11-03', vehicleId: fx.vehicles.v2.id }))
    await post({ vehicleId: fx.vehicles.v1.id, category: 'Fix', type: 'Insurance', fromDate: '2026-01-01', toDate: '2026-12-31', amount: 900 })
    const get = q => request(app).get('/api/expenses').query(q).set(auth(fx.tokens.bgUserA1a))

    expect((await get({ category: 'Fix' })).body.data).toHaveLength(1)
    expect((await get({ type: 'Fines' })).body.data).toHaveLength(1)
    expect((await get({ vehicleId: fx.vehicles.v2.id })).body.data).toHaveLength(1)
    const nov = await get({ from: '2026-11-01', to: '2026-11-30' })
    expect(nov.body.data.map(e => e.type).sort()).toEqual(['Fines', 'Insurance'])
  })

  it('edits, deletes one, and deletes a selection within scope', async () => {
    const a = (await post(fuel())).body.data
    const b = (await post(fuel({ type: 'Tire' }))).body.data
    const c = (await post(fuel({ type: 'Fines' }))).body.data

    const edit = await request(app).put(`/api/expenses/${a.id}`).set(auth(fx.tokens.bgUserA1a)).send(fuel({ amount: 300, vendor: 'ENOC' }))
    expect(edit.status).toBe(200)
    expect(edit.body.data).toMatchObject({ amount: 300, vendor: 'ENOC' })

    expect((await request(app).delete(`/api/expenses/${a.id}`).set(auth(fx.tokens.bgUserB1a))).status).toBe(404)
    expect((await request(app).delete(`/api/expenses/${a.id}`).set(auth(fx.tokens.bgUserA1a))).status).toBe(200)

    // Another BG's token deletes nothing of ours.
    const theirs = await request(app).delete('/api/expenses').query({ ids: `${b.id},${c.id}` }).set(auth(fx.tokens.bgUserB1a))
    expect(theirs.body.data.deleted).toBe(0)
    const ours = await request(app).delete('/api/expenses').query({ ids: `${b.id},${c.id}` }).set(auth(fx.tokens.bgUserA1a))
    expect(ours.body.data.deleted).toBe(2)
    expect((await request(app).get('/api/expenses').set(auth(fx.tokens.bgUserA1a))).body.data).toHaveLength(0)
  })

  it('keeps up to three bills, serves them, and keeps the cost when the vehicle goes', async () => {
    const e = (await post(fuel())).body.data
    const base = `/api/expenses/${e.id}/bills`
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post(base).set(auth(fx.tokens.bgUserA1a)).send({ fileName: `b${i}.pdf`, data: PDF })).status).toBe(201)
    }
    const fourth = await request(app).post(base).set(auth(fx.tokens.bgUserA1a)).send({ fileName: 'b4.pdf', data: PDF })
    expect(fourth.status).toBe(400)
    const txt = await request(app).post(`/api/expenses/${(await post(fuel())).body.data.id}/bills`).set(auth(fx.tokens.bgUserA1a))
      .send({ fileName: 'x.txt', data: Buffer.from('just some plain text here').toString('base64') })
    expect(txt.status).toBe(400)

    const list = await request(app).get('/api/expenses').set(auth(fx.tokens.bgUserA1a))
    const bills = list.body.data.find(x => x.id === e.id).bills
    expect(bills).toHaveLength(3)
    const file = await request(app).get(`${base}/${bills[0].id}/file`).set(auth(fx.tokens.bgUserA1a))
    expect(file.headers['content-type']).toMatch(/application\/pdf/)
    expect((await request(app).get(`${base}/${bills[0].id}/file`).set(auth(fx.tokens.bgUserB1a))).status).toBe(404)
    expect((await request(app).delete(`${base}/${bills[0].id}`).set(auth(fx.tokens.bgUserA1a))).status).toBe(200)

    await prisma.vehicle.delete({ where: { id: fx.vehicles.v1.id } })
    const after = await prisma.expense.findUnique({ where: { id: e.id } })
    expect(after).toMatchObject({ vehicleId: null, vehicleLabel: fx.vehicles.v1.plateNo })
  })
})
