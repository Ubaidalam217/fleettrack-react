/**
 * Over-the-air updates for the FleetmaxX mobile app, served from our own server
 * (client, 2026-11-10: app updates without a new APK, and no Expo account).
 *
 * Speaks the Expo Updates protocol, version 1, which `expo-updates` in the app
 * talks to through `updates.url` in its app.json:
 *
 *   GET /api/app-updates/manifest   the newest update for the app's runtime
 *   GET /api/app-updates/assets     one file of an update (bundle, image, font)
 *
 * An update is the folder `npx expo export -p android` writes, plus the app's
 * public config as expoConfig.json, uploaded by the app repo's publish script to
 *
 *   APP_UPDATES_DIR/<runtimeVersion>/<unix seconds>/
 *
 * The newest folder of the app's runtime is the update. Runtime versions keep a
 * JS update off an APK whose native code it was not built for: the app sends
 * its own and only a folder of that name answers. Public, like the bundle in any
 * APK; nothing here is a secret.
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import { asyncHandler, HttpError } from '../lib/http.js'
import env from '../env.js'

const router = Router()

const SAFE = /^[A-Za-z0-9._-]+$/

const sha256 = buf => crypto.createHash('sha256').update(buf).digest()
const base64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex')

/** A stable UUID from a hash, so the same upload always has the same id. */
function uuidFrom(hashHex) {
  const h = hashHex.slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const MIME = {
  '.js': 'application/javascript', '.hbc': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
}
const mimeOf = ext => MIME[ext.startsWith('.') ? ext : `.${ext}`] ?? 'application/octet-stream'

/** The folder of the newest update for this runtime, or null. */
async function latestUpdateDir(runtimeVersion) {
  if (!SAFE.test(runtimeVersion)) return null
  const dir = path.join(env.appUpdatesDir, runtimeVersion)
  let names
  try {
    names = await fs.readdir(dir)
  } catch {
    return null
  }
  const stamps = names.filter(n => /^\d+$/.test(n)).map(Number).sort((a, b) => b - a)
  return stamps.length ? { dir: path.join(dir, String(stamps[0])), stamp: stamps[0] } : null
}

function protocolError(message) {
  return new HttpError(400, message)
}

function readHeaders(req) {
  const platform = req.get('expo-platform') ?? req.query.platform
  const runtimeVersion = req.get('expo-runtime-version') ?? req.query['runtime-version']
  if (platform !== 'android' && platform !== 'ios') throw protocolError('Unsupported platform; expected android or ios.')
  if (!runtimeVersion || !SAFE.test(runtimeVersion)) throw protocolError('No or bad runtime version.')
  return { platform, runtimeVersion }
}

async function assetEntry({ base, updateDir, runtimeVersion, platform, rel, ext, isLaunch }) {
  const file = await fs.readFile(path.join(updateDir, rel))
  const params = new URLSearchParams({ asset: rel, runtimeVersion, platform })
  return {
    hash: base64url(sha256(file)),
    key: md5(file),
    fileExtension: `.${ext}`,
    contentType: isLaunch ? 'application/javascript' : mimeOf(ext),
    url: `${base}/api/app-updates/assets?${params}`,
  }
}

/** Sends a multipart/mixed body, the shape the protocol asks for. */
function sendMultipart(res, parts) {
  const boundary = `fmx-${crypto.randomBytes(12).toString('hex')}`
  const body = parts.map(({ name, json }) =>
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${JSON.stringify(json)}\r\n`
  ).join('') + `--${boundary}--\r\n`
  res.set({
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
    'content-type': `multipart/mixed; boundary=${boundary}`,
  })
  // end(), not send(): send() would add "; charset=utf-8" to the multipart type.
  res.end(Buffer.from(body, 'utf8'))
}

router.get(
  '/manifest',
  asyncHandler(async (req, res) => {
    const protocolVersion = Number(req.get('expo-protocol-version') ?? 0)
    const { platform, runtimeVersion } = readHeaders(req)
    const latest = await latestUpdateDir(runtimeVersion)

    if (!latest) {
      // Nothing published for this build yet: it keeps the update it shipped with.
      if (protocolVersion === 1) return sendMultipart(res, [{ name: 'directive', json: { type: 'noUpdateAvailable' } }])
      return res.status(404).json({ error: { message: 'No update for this runtime version' } })
    }

    const metadataBuf = await fs.readFile(path.join(latest.dir, 'metadata.json'))
    const metadata = JSON.parse(metadataBuf.toString('utf8'))
    const files = metadata.fileMetadata?.[platform]
    if (!files?.bundle) throw new HttpError(500, `The update has no ${platform} bundle`)

    const id = uuidFrom(sha256(metadataBuf).toString('hex'))
    if (protocolVersion === 1 && req.get('expo-current-update-id') === id) {
      return sendMultipart(res, [{ name: 'directive', json: { type: 'noUpdateAvailable' } }])
    }

    let expoClient = {}
    try {
      expoClient = JSON.parse(await fs.readFile(path.join(latest.dir, 'expoConfig.json'), 'utf8'))
    } catch { /* optional: the app falls back to its embedded config */ }

    // https in production even if a proxy header goes missing: Android refuses plain http.
    const base = `${env.isProduction ? 'https' : req.protocol}://${req.get('host')}`
    const common = { base, updateDir: latest.dir, runtimeVersion, platform }
    const manifest = {
      id,
      createdAt: new Date(latest.stamp * 1000).toISOString(),
      runtimeVersion,
      launchAsset: await assetEntry({ ...common, rel: files.bundle, ext: 'bundle', isLaunch: true }),
      assets: await Promise.all((files.assets ?? []).map(a => assetEntry({ ...common, rel: a.path, ext: a.ext }))),
      metadata: {},
      extra: { expoClient },
    }
    sendMultipart(res, [{ name: 'manifest', json: manifest }, { name: 'extensions', json: { assetRequestHeaders: {} } }])
  })
)

router.get(
  '/assets',
  asyncHandler(async (req, res) => {
    const { asset, runtimeVersion, platform } = req.query
    if (typeof asset !== 'string' || !asset) throw protocolError('No asset named')
    if (platform !== 'android' && platform !== 'ios') throw protocolError('Unsupported platform')
    const latest = await latestUpdateDir(String(runtimeVersion ?? ''))
    if (!latest) throw new HttpError(404, 'No update for this runtime version')

    // Only files inside the update folder: no `..`, no absolute paths.
    const file = path.resolve(latest.dir, asset)
    if (!file.startsWith(latest.dir + path.sep)) throw new HttpError(404, 'Asset not found')

    let buf
    try {
      buf = await fs.readFile(file)
    } catch {
      throw new HttpError(404, 'Asset not found')
    }
    const metadata = JSON.parse(await fs.readFile(path.join(latest.dir, 'metadata.json'), 'utf8'))
    const files = metadata.fileMetadata?.[platform]
    const isLaunch = files?.bundle === asset
    const ext = files?.assets?.find(a => a.path === asset)?.ext ?? path.extname(asset)
    res.set('Content-Type', isLaunch ? 'application/javascript' : mimeOf(ext))
    // A file of an update never changes; a new upload is a new folder.
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(buf)
  })
)

export default router
