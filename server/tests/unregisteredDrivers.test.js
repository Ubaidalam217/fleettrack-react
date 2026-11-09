/**
 * GET /api/drivers/unregistered-ids — Driver ID (iButton) tags the caller's
 * trackers read lately that no driver holds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, FLESPI_TOKEN: 'mock-master-token' })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const { clearDeviceCache } = await import('../src/lib/flespi.js')
const { default: prisma } = await import('../src/prisma.js')
import { auth, resetDb, seedFixture } from './factories.js'

const app = createApp()
let fx
const NOW = Math.floor(Date.now() / 1000)

beforeEach(async () => {
  await resetDb()
  fx = await seedFixture()
  clearDeviceCache()
  vi.stubGlobal('fetch', async url => {
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).includes('/gw/devices/all')) {
      return json({ result: Array.from({ length: 9 }, (_, i) => ({ id: 101 + i, configuration: { ident: `86307101123450${i + 1}` } })) })
    }
    return json({ result: [] })
  })
  const msg = (deviceId, ts, code) => ({ deviceId, ts, extra: code == null ? undefined : { 'ibutton.code': code } })
  await prisma.telemetryMessage.createMany({
    data: [
      msg(101, NOW - 600, '01A2B3C4'), msg(101, NOW - 300, '01:a2:b3:c4'), // the same tag, two spellings
      msg(101, NOW - 200, 'AAAA0001'),                                      // held by a driver
      msg(101, NOW - 100, '0000000000000000'),                              // no tag inserted
      msg(102, NOW - 50, 'BEEF0002'),
      msg(108, NOW - 40, 'C0FFEE03'),                                       // another tenant's vehicle
      msg(101, NOW - 40 * 86_400, 'OLD00004'),                              // older than the window
      msg(101, NOW - 20),
    ],
  })
  await prisma.driver.create({ data: { bgId: fx.bgA1a.id, name: 'Known Driver', ibuttonCode: 'AAAA0001' } })
})

afterEach(() => vi.unstubAllGlobals())

describe('GET /api/drivers/unregistered-ids', () => {
  it('lists the tags no driver holds, newest first, with the vehicle that read them', async () => {
    const res = await request(app).get('/api/drivers/unregistered-ids').set(auth(fx.tokens.bgUserA1a))
    expect(res.status).toBe(200)
    expect(res.body.data.map(u => u.code)).toEqual(['BEEF0002', '01A2B3C4'])
    expect(res.body.data[1]).toMatchObject({ reads: 2, lastSeen: NOW - 300, deviceId: 101, vehicle: { id: fx.vehicles.v1.id, bgId: fx.bgA1a.id } })
  })

  it('reaches further back on request, and the Super Admin sees every tenant', async () => {
    const wide = await request(app).get('/api/drivers/unregistered-ids?days=60').set(auth(fx.tokens.bgUserA1a))
    expect(wide.body.data.map(u => u.code)).toContain('OLD00004')
    const all = await request(app).get('/api/drivers/unregistered-ids').set(auth(fx.tokens.superAdmin))
    expect(all.body.data.map(u => u.code)).toEqual(['C0FFEE03', 'BEEF0002', '01A2B3C4'])
  })
})
