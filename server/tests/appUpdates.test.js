/**
 * Mobile app over-the-air updates (routes/appUpdates.js): the Expo Updates
 * protocol's manifest and asset requests, served from uploaded folders.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(here, '.tmp-app-updates')

vi.mock('../src/env.js', async importOriginal => {
  const actual = await importOriginal()
  const wrap = frozen => ({ ...frozen, appUpdatesDir: DIR })
  return { ...actual, env: wrap(actual.env), default: wrap(actual.default) }
})

const { createApp } = await import('../src/app.js')
const app = createApp()

const RV = '1.1.0'
const BUNDLE = '_expo/static/js/android/entry-abc.hbc'

async function writeUpdate(stamp, code) {
  const dir = path.join(DIR, RV, String(stamp))
  await fs.mkdir(path.join(dir, '_expo/static/js/android'), { recursive: true })
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
  await fs.writeFile(path.join(dir, BUNDLE), code)
  await fs.writeFile(path.join(dir, 'assets', 'f00d'), 'png-bytes')
  await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify({
    version: 0, bundler: 'metro', build: code,
    fileMetadata: { android: { bundle: BUNDLE, assets: [{ path: 'assets/f00d', ext: 'png' }] } },
  }))
  await fs.writeFile(path.join(dir, 'expoConfig.json'), JSON.stringify({ name: 'FleetmaxX', slug: 'fleetmax' }))
}

// supertest leaves a multipart/mixed body unread; read it as text.
const asText = (res, cb) => {
  let data = ''
  res.setEncoding('utf8')
  res.on('data', chunk => { data += chunk })
  res.on('end', () => cb(null, data))
}

const manifestReq = (headers = {}) => request(app).get('/api/app-updates/manifest').set({
  'expo-protocol-version': '1', 'expo-platform': 'android', 'expo-runtime-version': RV, ...headers,
}).buffer(true).parse(asText)

/** The JSON of one named part of a multipart/mixed answer. */
function part(res, name) {
  const text = res.body
  const at = text.indexOf(`name="${name}"`)
  if (at < 0) return null
  const start = text.indexOf('\r\n\r\n', at) + 4
  return JSON.parse(text.slice(start, text.indexOf('\r\n--', start)))
}

beforeAll(async () => {
  await fs.rm(DIR, { recursive: true, force: true })
  await writeUpdate(1700000000, 'old()')
  await writeUpdate(1800000000, 'new()')
})

afterAll(async () => {
  await fs.rm(DIR, { recursive: true, force: true })
})

describe('GET /api/app-updates/manifest', () => {
  it('serves the newest update of the app’s runtime, without signing in', async () => {
    const res = await manifestReq()
    expect(res.status).toBe(200)
    expect(res.headers['expo-protocol-version']).toBe('1')
    expect(res.headers['content-type']).toMatch(/^multipart\/mixed; boundary=/)
    const m = part(res, 'manifest')
    expect(m.runtimeVersion).toBe(RV)
    expect(m.createdAt).toBe(new Date(1800000000 * 1000).toISOString())
    expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(m.launchAsset.contentType).toBe('application/javascript')
    expect(m.assets).toHaveLength(1)
    expect(m.assets[0]).toMatchObject({ contentType: 'image/png', fileExtension: '.png' })
    expect(m.extra.expoClient.slug).toBe('fleetmax')

    // The launch asset's URL hands back the newest bundle.
    const url = new URL(m.launchAsset.url)
    const asset = await request(app).get(`${url.pathname}${url.search}`).buffer(true).parse(asText)
    expect(asset.status).toBe(200)
    expect(asset.body).toBe('new()')
  })

  it('says there is nothing new when the app already runs that update', async () => {
    const id = part(await manifestReq(), 'manifest').id
    const res = await manifestReq({ 'expo-current-update-id': id })
    expect(part(res, 'manifest')).toBeNull()
    expect(part(res, 'directive')).toEqual({ type: 'noUpdateAvailable' })
  })

  it('has nothing for a runtime with no upload, and refuses a bad request', async () => {
    const none = await manifestReq({ 'expo-runtime-version': '9.9.9' })
    expect(part(none, 'directive')).toEqual({ type: 'noUpdateAvailable' })
    expect((await manifestReq({ 'expo-platform': 'windows' })).status).toBe(400)
    expect((await manifestReq({ 'expo-runtime-version': '../etc' })).status).toBe(400)
  })
})

describe('GET /api/app-updates/assets', () => {
  it('serves only files inside the update folder', async () => {
    const q = { runtimeVersion: RV, platform: 'android' }
    const ok = await request(app).get('/api/app-updates/assets').query({ ...q, asset: 'assets/f00d' })
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toMatch(/^image\/png/)
    for (const asset of ['../1700000000/metadata.json', '../../1.1.0/1700000000/' + BUNDLE, 'nope']) {
      expect((await request(app).get('/api/app-updates/assets').query({ ...q, asset })).status).toBe(404)
    }
  })
})
