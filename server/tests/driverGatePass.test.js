/**
 * Gate pass on the driver (client 2026-11-24, Expiry Gate Pass report): tag
 * number, expiry date and contractor are stored per driver, kept inside the
 * Business Group's scope, and watched by the licence expiry alert.
 * Names and numbers below are made up.
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

const A = () => auth(fx.tokens.bgUserA1a)
const create = (body, token = fx.tokens.bgUserA1a, bgId = fx.bgA1a.id) =>
  request(app).post('/api/drivers').set(auth(token)).send({ bgId, ...body })
const sec = iso => Math.floor(Date.parse(iso) / 1000)

describe('gate pass fields', () => {
  it('stores tag, expiry and contractor and hands the expiry back as a date', async () => {
    const r = await create({
      name: 'Sample Driver', employeeId: 'E-100', gatePassTag: '04A1B2C3D4E5F60718AB', gatePassExpiry: '2027-02-01', contractorName: 'Acme Contracting',
    })
    expect(r.status).toBe(201)
    expect(r.body.data).toMatchObject({
      gatePassTag: '04A1B2C3D4E5F60718AB', gatePassExpiry: '2027-02-01', contractorName: 'Acme Contracting', employeeId: 'E-100',
    })
    const list = await request(app).get('/api/drivers').set(A())
    expect(list.body.data[0]).toMatchObject({ gatePassTag: '04A1B2C3D4E5F60718AB', gatePassExpiry: '2027-02-01', contractorName: 'Acme Contracting' })
  })

  it('all three are optional: omitted, blank and null arrive as null, and an update clears them', async () => {
    const a = (await create({ name: 'Plain' })).body.data
    expect(a).toMatchObject({ gatePassTag: null, gatePassExpiry: null, contractorName: null })
    const b = (await create({ name: 'Blank', gatePassTag: '  ', gatePassExpiry: '', contractorName: null })).body.data
    expect(b).toMatchObject({ gatePassTag: null, gatePassExpiry: null, contractorName: null })
    const c = (await create({ name: 'Has', gatePassTag: 'AB12', gatePassExpiry: '2027-01-01', contractorName: 'Site B' })).body.data
    const cleared = await request(app).put(`/api/drivers/${c.id}`).set(A()).send({ name: 'Has' })
    expect(cleared.status).toBe(200)
    expect(cleared.body.data).toMatchObject({ gatePassTag: null, gatePassExpiry: null, contractorName: null })
  })

  it('rejects a bad date and over-long values', async () => {
    expect((await create({ name: 'X', gatePassExpiry: '01/02/2027' })).status).toBe(400)
    expect((await create({ name: 'X', gatePassExpiry: '2027-13-45' })).status).toBe(400)
    expect((await create({ name: 'X', gatePassTag: 'A'.repeat(61) })).status).toBe(400)
    expect((await create({ name: 'X', contractorName: 'C'.repeat(121) })).status).toBe(400)
  })

  it('the same tag number may sit on two drivers (it is not the unique iButton code)', async () => {
    expect((await create({ name: 'One', gatePassTag: 'DEAD0001' })).status).toBe(201)
    expect((await create({ name: 'Two', gatePassTag: 'DEAD0001' })).status).toBe(201)
  })

  it('is scoped: another tenant neither sees nor changes the driver', async () => {
    const d = (await create({ name: 'Mine', gatePassTag: 'AB12', gatePassExpiry: '2027-01-01' })).body.data
    const theirs = await request(app).get('/api/drivers').set(auth(fx.tokens.bgUserB1a))
    expect(theirs.body.data.map(x => x.id)).not.toContain(d.id)
    const put = await request(app).put(`/api/drivers/${d.id}`).set(auth(fx.tokens.bgUserB1a)).send({ name: 'Mine', gatePassTag: 'HACK' })
    expect(put.status).toBe(404)
    expect((await prisma.driver.findUnique({ where: { id: d.id } })).gatePassTag).toBe('AB12')
  })

  it('a removed driver leaves the list (and so the report) but keeps the row', async () => {
    const d = (await create({ name: 'Left', gatePassTag: 'AB12', gatePassExpiry: '2026-01-01', ibuttonCode: 'BEEF0099' })).body.data
    await request(app).delete(`/api/drivers/${d.id}`).set(A())
    const list = await request(app).get('/api/drivers').set(A())
    expect(list.body.data.map(x => x.id)).not.toContain(d.id)
    const removed = await request(app).get('/api/drivers?removed=1').set(A())
    expect(removed.body.data.find(x => x.id === d.id)).toMatchObject({ gatePassTag: 'AB12' })
  })
})

describe('gate pass expiry alert', () => {
  it('is one of the driver dates the licence expiry alert watches', async () => {
    const { DRIVER_EXPIRIES, evaluateLicence } = await import('../src/lib/alertEngine.js')
    expect(DRIVER_EXPIRIES.map(([f]) => f)).toContain('gatePassExpiry')
    // The state subjects stay distinct, so one date's state never overwrites another's.
    expect(new Set(DRIVER_EXPIRIES.map(([, , s]) => s)).size).toBe(DRIVER_EXPIRIES.length)
    const NOW = sec('2026-11-24T06:00:00Z')
    const soon = evaluateLicence({ type: 'license_expiry', params: { days: 30 } }, { gatePassExpiry: new Date('2026-12-04T00:00:00Z') }, {}, NOW, 'gatePassExpiry', 'Gate pass')
    expect(soon.fire.message).toBe('Gate pass expires in 10 days')
    const gone = evaluateLicence({ type: 'license_expiry', params: { days: 30 } }, { gatePassExpiry: new Date('2026-11-20T00:00:00Z') }, {}, NOW, 'gatePassExpiry', 'Gate pass')
    expect(gone.fire.message).toBe('Gate pass expired 4 days ago')
  })

  it('fires once for an expired gate pass, for the driver of the rule’s BG only', async () => {
    const d = (await create({ name: 'Sample Driver', gatePassTag: 'AB12', gatePassExpiry: '2026-11-20' })).body.data
    // A driver in another BG with the same dates must not fire for this BG's rule.
    await create({ name: 'Other BG Driver', gatePassExpiry: '2026-11-20' }, fx.tokens.bgUserB1a, fx.bgB1a.id)
    await prisma.alert.updateMany({ data: { status: 'Inactive' } })
    await prisma.alert.create({ data: { name: 'Expiry', type: 'license_expiry', bgId: fx.bgA1a.id, allVehicles: true, params: { days: 30 } } })
    const { runAlertPass } = await import('../src/lib/alertEngine.js')
    const events = await runAlertPass(sec('2026-11-24T06:00:00Z'))
    const mine = events.filter(e => e.driverId === d.id)
    expect(mine).toHaveLength(1)
    expect(mine[0].message).toContain('Gate pass expired 4 days ago')
    expect(events.some(e => e.message.includes('Other BG Driver'))).toBe(false)
    // A second pass does not repeat it.
    expect((await runAlertPass(sec('2026-11-24T07:00:00Z'))).filter(e => e.driverId === d.id)).toEqual([])
  })
})
