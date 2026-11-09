/**
 * Vehicle custom fields (PUT /api/vehicles/:id/custom-fields): free name →
 * value pairs, saved on their own and never through the vehicle form.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
})

const put = (token, id, fields) => request(app).put(`/api/vehicles/${id}/custom-fields`).set(auth(token)).send({ fields })

describe('PUT /api/vehicles/:id/custom-fields', () => {
  it('saves the fields in order, drops blank rows and records who edited them', async () => {
    const res = await put(fx.tokens.bgUserA1a, fx.vehicles.v1.id, [
      { name: '  Contract SAP Number ', value: ' P30312 ' },
      { name: '', value: '' },
      { name: 'Contract End Date', value: '09/07/2027' },
    ])
    expect(res.status).toBe(200)
    expect(res.body.data.customFields).toEqual([
      { name: 'Contract SAP Number', value: 'P30312' },
      { name: 'Contract End Date', value: '09/07/2027' },
    ])
    expect(res.body.data.customFieldsUpdatedBy).toBeTruthy()
    expect(res.body.data.customFieldsUpdatedAt).toBeTruthy()

    // The list carries them too, and the vehicle form's own save leaves them alone.
    const list = await request(app).get('/api/vehicles').set(auth(fx.tokens.bgUserA1a))
    expect(list.body.data.find(v => v.id === fx.vehicles.v1.id).customFields).toHaveLength(2)
    const v = list.body.data.find(x => x.id === fx.vehicles.v1.id)
    const form = await request(app).put(`/api/vehicles/${v.id}`).set(auth(fx.tokens.bgUserA1a)).send({ imei: v.imei, plateNo: 'NEW 1' })
    expect(form.status).toBe(200)
    expect(form.body.data.customFields).toHaveLength(2)
  })

  it('points at a nameless value and at a name used twice', async () => {
    const res = await put(fx.tokens.bgUserA1a, fx.vehicles.v1.id, [
      { name: 'Contact', value: 'A' },
      { name: '', value: 'orphan value' },
      { name: 'contact', value: 'B' },
    ])
    expect(res.status).toBe(400)
    expect(res.body.error.details).toMatchObject({ 'fields.1.name': expect.any(String), 'fields.2.name': expect.any(String) })
  })

  it('clears with an empty list', async () => {
    await put(fx.tokens.bgUserA1a, fx.vehicles.v1.id, [{ name: 'A', value: '1' }])
    const res = await put(fx.tokens.bgUserA1a, fx.vehicles.v1.id, [])
    expect(res.body.data.customFields).toEqual([])
  })

  it('is refused to a sub-user and hides another tenant’s vehicle', async () => {
    expect((await put(fx.tokens.subUserA1a, fx.vehicles.v1.id, [{ name: 'A', value: '1' }])).status).toBe(403)
    expect((await put(fx.tokens.bgUserB1a, fx.vehicles.v1.id, [{ name: 'A', value: '1' }])).status).toBe(404)
  })
})
