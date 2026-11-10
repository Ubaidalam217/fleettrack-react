/**
 * Live location share links (client, 2026-11-10): "share the live or current
 * location from the 3 dots, with a time after which the link expires".
 *   POST   /api/location-shares          make a link            (signed in)
 *   GET    /api/location-shares          my open links          (signed in; ?deviceId= narrows)
 *   DELETE /api/location-shares/:id      stop sharing           (signed in)
 *   GET    /api/public/location/:token   where it is now        (no sign-in)
 *
 * Unlike a replay share nothing is stored: the public page asks every few
 * seconds and gets the vehicle's latest position — from our own telemetry
 * copy while the webhook delivers, else one Flespi telemetry read. Readings are
 * cached CACHE_MS per vehicle, so however many people have a link open the
 * account pays at most one Flespi read per vehicle per CACHE_MS; a public page
 * must not be a way to spend its rate limit.
 *
 * The token is the only key (32 random URL-safe characters). Unknown, stopped
 * and expired links answer 404 / 410 without naming the vehicle.
 */

import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, HttpError, notFound } from '../lib/http.js'
import { validate } from '../middleware/validate.js'
import { buildAcl } from '../lib/flespiGrant.js'
import { ROLES } from '../lib/scope.js'
import * as flespi from '../lib/flespi.js'
import { telemetryResponse } from '../lib/telemetry.js'

/** A live location may be shared for at most this long. */
export const MAX_SHARE_HOURS = 7 * 24
export const CACHE_MS = 15_000

const FIELDS = 'position.latitude,position.longitude,position.speed,position.direction,engine.ignition.status,timestamp'

const newToken = () => crypto.randomBytes(24).toString('base64url')
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const shape = s => ({
  id: s.id,
  token: s.token,
  deviceId: s.deviceId,
  vehicleName: s.vehicleName,
  expiresAt: s.expiresAt,
  createdAt: s.createdAt,
  revokedAt: s.revokedAt,
})

// ── the position, cached per vehicle ────────────────────────────────────────

const cache = new Map() // deviceId -> { at, value }

/** Clears the per-vehicle cache (tests). */
export const __clearLocationCache = () => cache.clear()

async function latestPosition(deviceId) {
  const hit = cache.get(deviceId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  let payload = telemetryResponse([deviceId])
  if (!payload) {
    const res = await flespi.forward(`/gw/devices/${deviceId}/telemetry/${FIELDS}`, { timeoutMs: 15_000 })
    if (res.status === 429) throw new HttpError(429, 'Busy — trying again shortly')
    if (res.status !== 200) throw new HttpError(502, 'The position could not be read just now')
    payload = JSON.parse(res.text)
  }
  const t = payload.result?.find(r => r.id === deviceId)?.telemetry ?? {}
  const v = k => t[k]?.value
  const stamps = Object.values(t).map(x => x?.ts).filter(Boolean)
  const value = {
    lat: num(v('position.latitude')),
    lng: num(v('position.longitude')),
    speed: num(v('position.speed')),
    heading: num(v('position.direction')),
    ignition: typeof v('engine.ignition.status') === 'boolean' ? v('engine.ignition.status') : null,
    ts: num(v('timestamp')) ?? (stamps.length ? Math.max(...stamps) : null),
  }
  cache.set(deviceId, { at: Date.now(), value })
  return value
}

// ── signed in ────────────────────────────────────────────────────────────────

export const router = Router()

const createSchema = z.object({
  deviceId: z.coerce.number().int().positive(),
  vehicleName: z.string().trim().min(1).max(120),
  expiresAt: z.string().trim().min(1),
})

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { deviceId, vehicleName } = req.body
    const expiresAt = new Date(req.body.expiresAt)
    const now = Date.now()
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) throw badRequest('Choose an expiry in the future', { expiresAt: 'Must be in the future' })
    if (expiresAt.getTime() > now + MAX_SHARE_HOURS * 3600_000) throw badRequest('A live location can be shared for up to 7 days', { expiresAt: 'Too far ahead' })

    if (!flespi.isConfigured()) throw new HttpError(503, 'Live tracking is not configured on this server')
    const { deviceIds } = await buildAcl(req.scope)
    if (deviceIds !== null && !deviceIds.includes(deviceId)) throw notFound('Vehicle')

    const share = await prisma.locationShare.create({
      data: { token: newToken(), deviceId, vehicleName, expiresAt, createdById: req.scope.userId },
    })
    res.status(201).json({ data: shape(share) })
  })
)

router.get(
  '/',
  validate(z.object({ deviceId: z.coerce.number().int().positive().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { deviceId } = req.validatedQuery
    const rows = await prisma.locationShare.findMany({
      where: { createdById: req.scope.userId, revokedAt: null, expiresAt: { gt: new Date() }, ...(deviceId ? { deviceId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ data: rows.map(shape) })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const share = await prisma.locationShare.findUnique({ where: { id: req.params.id } })
    if (!share || (share.createdById !== req.scope.userId && req.scope.role !== ROLES.SUPER_ADMIN)) throw notFound('Link')
    const done = await prisma.locationShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } })
    res.json({ data: shape(done) })
  })
)

// ── public ───────────────────────────────────────────────────────────────────

export const publicRouter = Router()

publicRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const token = String(req.params.token ?? '')
    const share = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await prisma.locationShare.findUnique({ where: { token } }) : null
    if (!share || share.revokedAt) throw new HttpError(404, 'This link does not exist or was switched off')
    if (share.expiresAt.getTime() <= Date.now()) throw new HttpError(410, 'This link has expired')
    const position = await latestPosition(share.deviceId)
    res.json({ data: { vehicleName: share.vehicleName, expiresAt: share.expiresAt, refreshSec: CACHE_MS / 1000, position } })
  })
)

export default router
