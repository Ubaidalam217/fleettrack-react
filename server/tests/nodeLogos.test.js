/**
 * GGB / Group / BG / Branch logos (client, 2026-11-13): upload, serve and
 * remove under the node's own write and scope rules, and the chain of logos a
 * report header may show for each account (GET /api/me/logos).
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

// Tiny but real file headers: the server reads the type from the bytes.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64')
const PDF = Buffer.from('%PDF-1.4\n% test document\n').toString('base64')

const upload = (path, token, image = PNG) => request(app).put(`${path}/logo`).set(auth(token)).send({ image })
const chain = async token => (await request(app).get('/api/me/logos').set(auth(token))).body.data

describe('node logos', () => {
  it('uploads a BG logo, serves it publicly by key, and removes it', async () => {
    const up = await upload(`/api/bgs/${fx.bgA1a.id}`, fx.tokens.groupAdminA1)
    expect(up.status).toBe(200)
    const key = up.body.data.logoKey
    expect(key).toMatch(/^[a-f0-9]{32}$/)
    const img = await request(app).get(`/api/node-logos/${key}`)
    expect(img.status).toBe(200)
    expect(img.headers['content-type']).toBe('image/png')
    // The BG row carries the key, so Settings can show the logo.
    expect((await request(app).get(`/api/bgs/${fx.bgA1a.id}`).set(auth(fx.tokens.bgUserA1a))).body.data.logoKey).toBe(key)

    // A new upload replaces the old key.
    const again = await upload(`/api/bgs/${fx.bgA1a.id}`, fx.tokens.groupAdminA1)
    expect(again.body.data.logoKey).not.toBe(key)
    expect((await request(app).get(`/api/node-logos/${key}`)).status).toBe(404)

    const gone = await request(app).delete(`/api/bgs/${fx.bgA1a.id}/logo`).set(auth(fx.tokens.groupAdminA1))
    expect(gone.status).toBe(200)
    expect(gone.body.data.logoKey).toBeNull()
    expect(await prisma.nodeLogo.count()).toBe(0)
  })

  it('keeps to the write and scope rules of the node itself', async () => {
    // Not an image.
    expect((await upload(`/api/branches/${fx.branches.depot.id}`, fx.tokens.bgUserA1a, PDF)).status).toBe(400)
    // A BG user may not edit its own BG, a sub-user nothing.
    expect((await upload(`/api/bgs/${fx.bgA1a.id}`, fx.tokens.bgUserA1a)).status).toBe(403)
    expect((await upload(`/api/branches/${fx.branches.depot.id}`, fx.tokens.subUserA1a)).status).toBe(403)
    // Another tenant's node is a 404, as for any other write.
    expect((await upload(`/api/branches/${fx.branches.depot.id}`, fx.tokens.bgUserB1a)).status).toBe(404)
    expect((await upload(`/api/groups/${fx.groupA1.id}`, fx.tokens.ggbAdminB)).status).toBe(404)
    // Only a Super Admin writes GGBs.
    expect((await upload(`/api/ggbs/${fx.ggbA.id}`, fx.tokens.ggbAdminA)).status).toBe(403)
    expect((await upload(`/api/ggbs/${fx.ggbA.id}`, fx.tokens.superAdmin)).status).toBe(200)
  })

  it('lists the logos up each account chain, nearest first, and none for a Super Admin', async () => {
    await upload(`/api/ggbs/${fx.ggbA.id}`, fx.tokens.superAdmin)
    await upload(`/api/groups/${fx.groupA1.id}`, fx.tokens.ggbAdminA)
    await upload(`/api/bgs/${fx.bgA1a.id}`, fx.tokens.groupAdminA1)
    await upload(`/api/branches/${fx.branches.depot.id}`, fx.tokens.bgUserA1a)
    // Below the sub-user's branch, so not in its chain.
    await upload(`/api/branches/${fx.branches.bay1.id}`, fx.tokens.bgUserA1a)

    const kinds = rows => rows.map(r => `${r.kind}:${r.name}`)
    expect(kinds(await chain(fx.tokens.subUserA1a))).toEqual([
      'branch:Mussafah Depot', 'bg:Al Habtoor Logistics', 'group:Dubai Metro', 'ggb:Gulf Telematics',
    ])
    expect(kinds(await chain(fx.tokens.bgUserA1a))).toEqual(['bg:Al Habtoor Logistics', 'group:Dubai Metro', 'ggb:Gulf Telematics'])
    expect(kinds(await chain(fx.tokens.groupAdminA1))).toEqual(['group:Dubai Metro', 'ggb:Gulf Telematics'])
    expect(kinds(await chain(fx.tokens.ggbAdminA))).toEqual(['ggb:Gulf Telematics'])
    expect(await chain(fx.tokens.ggbAdminB)).toEqual([])
    expect(await chain(fx.tokens.superAdmin)).toEqual([])

    const [first] = await chain(fx.tokens.subUserA1a)
    expect(first.url).toMatch(/^\/api\/node-logos\/[a-f0-9]{32}$/)
    expect((await request(app).get(first.url)).status).toBe(200)
  })

  it('goes with its node', async () => {
    await upload(`/api/branches/${fx.branches.yard.id}`, fx.tokens.bgUserA1a)
    expect(await prisma.nodeLogo.count()).toBe(1)
    expect((await request(app).delete(`/api/branches/${fx.branches.yard.id}`).set(auth(fx.tokens.bgUserA1a))).status).toBe(200)
    expect(await prisma.nodeLogo.count()).toBe(0)
  })
})
