/**
 * Replay share links (client, 2026-11-09): "generate a link of a replay — 1 day
 * or 1 month — with a time after which the link no longer works", opened
 * without signing in.
 *
 *   POST   /api/replay-shares          make a link        (signed in)
 *   GET    /api/replay-shares          my links           (signed in)
 *   DELETE /api/replay-shares/:id      switch one off     (signed in)
 *   GET    /api/public/replay/:token   open a link        (no sign-in)
 *
 * The track is fetched once, when the link is made, and stored with it. Opening
 * the link then costs no Flespi request (a public page must not be a way to
 * spend the account's rate limit), and shows exactly what was shared.
 *
 * The token is the only key: 32 random URL-safe characters, unguessable. A
 * link that is unknown, switched off or expired answers the same 404 / 410
 * without saying which vehicle it was for.
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
import { messagesResponse } from '../lib/telemetry.js'

const DAY = 86_400
/** The longest replay a link may carry, and how far ahead its expiry may be set. */
export const MAX_RANGE_SEC = 31 * DAY + 3600
export const MAX_EXPIRY_DAYS = 365
/** Enough for a month of one vehicle at the usual 1-minute interval. */
export const MAX_POINTS = 50_000
const PER_REQUEST = 100_000

const FIELDS = 'position.latitude,position.longitude,position.speed,position.direction,engine.ignition.status,timestamp'

const round = (v, dp) => (Number.isFinite(v) ? Number(v.toFixed(dp)) : null)

/**
 * The vehicle's track over [fromTs, toTs] as compact rows
 * [ts, lat, lng, speed, heading, ignition], one day per request — from our own
 * history when it covers the day, else from Flespi.
 */
export async function fetchTrack(deviceId, fromTs, toTs) {
  const rows = []
  let truncated = false
  for (let start = fromTs; start <= toTs; start += DAY) {
    const end = Math.min(start + DAY - 1, toTs)
    const data = JSON.stringify({ from: start, to: end, count: PER_REQUEST, fields: FIELDS })
    const local = await messagesResponse([deviceId], data)
    const answer = local ?? await flespi.request(`/gw/devices/${deviceId}/messages?data=${encodeURIComponent(data)}`, { timeoutMs: 60_000 })
    const messages = Array.isArray(answer?.result) ? answer.result : []
    if (messages.length >= PER_REQUEST) truncated = true
    for (const m of messages) {
      const lat = m['position.latitude'], lng = m['position.longitude']
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(m.timestamp)) continue
      const ign = m['engine.ignition.status']
      rows.push([
        Math.round(m.timestamp), round(lat, 6), round(lng, 6),
        Math.round(m['position.speed'] ?? 0), Number.isFinite(m['position.direction']) ? Math.round(m['position.direction']) : null,
        ign == null ? null : ign ? 1 : 0,
      ])
    }
  }
  rows.sort((a, b) => a[0] - b[0])
  if (rows.length <= MAX_POINTS) return { points: rows, truncated }
  // Evenly thinned, keeping the last point so the route ends where it ended.
  const step = rows.length / MAX_POINTS
  const thin = []
  for (let i = 0; i < MAX_POINTS - 1; i++) thin.push(rows[Math.floor(i * step)])
  thin.push(rows[rows.length - 1])
  return { points: thin, truncated: true }
}

const newToken = () => crypto.randomBytes(24).toString('base64url')

const publicShape = s => ({
  id: s.id,
  token: s.token,
  deviceId: s.deviceId,
  vehicleName: s.vehicleName,
  fromTs: s.fromTs,
  toTs: s.toTs,
  expiresAt: s.expiresAt,
  pointCount: s.pointCount,
  truncated: s.truncated,
  createdAt: s.createdAt,
  revokedAt: s.revokedAt,
})

// ── signed in ────────────────────────────────────────────────────────────────

export const router = Router()

const createSchema = z.object({
  deviceId: z.coerce.number().int().positive(),
  vehicleName: z.string().trim().min(1).max(120),
  fromTs: z.coerce.number().int().positive(),
  toTs: z.coerce.number().int().positive(),
  expiresAt: z.string().trim().min(1),
})

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { deviceId, vehicleName, fromTs, toTs } = req.body
    if (toTs <= fromTs) throw badRequest('The replay must end after it starts')
    if (toTs - fromTs > MAX_RANGE_SEC) throw badRequest('A shared replay can cover up to 31 days')
    const expiresAt = new Date(req.body.expiresAt)
    const now = Date.now()
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) throw badRequest('Choose an expiry in the future', { expiresAt: 'Must be in the future' })
    if (expiresAt.getTime() > now + MAX_EXPIRY_DAYS * DAY * 1000) throw badRequest(`A link can stay open for up to ${MAX_EXPIRY_DAYS} days`, { expiresAt: 'Too far ahead' })

    if (!flespi.isConfigured()) throw new HttpError(503, 'Live tracking is not configured on this server')
    const { deviceIds } = await buildAcl(req.scope)
    if (deviceIds !== null && !deviceIds.includes(deviceId)) throw notFound('Vehicle')

    let track
    try {
      track = await fetchTrack(deviceId, fromTs, toTs)
    } catch (err) {
      if (err?.isThrottled) throw new HttpError(429, 'Flespi is busy right now — try again in a minute')
      throw err
    }
    if (!track.points.length) throw badRequest('This vehicle has no positions in that period')

    const share = await prisma.replayShare.create({
      data: {
        token: newToken(),
        deviceId, vehicleName, fromTs, toTs, expiresAt,
        points: track.points,
        pointCount: track.points.length,
        truncated: track.truncated,
        createdById: req.scope.userId,
      },
    })
    res.status(201).json({ data: publicShape(share) })
  })
)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.replayShare.findMany({
      where: { createdById: req.scope.userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      omit: { points: true },
    })
    res.json({ data: rows.map(publicShape) })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const share = await prisma.replayShare.findUnique({ where: { id: req.params.id }, omit: { points: true } })
    if (!share || (share.createdById !== req.scope.userId && req.scope.role !== ROLES.SUPER_ADMIN)) throw notFound('Link')
    const done = await prisma.replayShare.update({ where: { id: share.id }, data: { revokedAt: new Date() }, omit: { points: true } })
    res.json({ data: publicShape(done) })
  })
)

// ── public ───────────────────────────────────────────────────────────────────

export const publicRouter = Router()

publicRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const token = String(req.params.token ?? '')
    const share = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await prisma.replayShare.findUnique({ where: { token } }) : null
    if (!share || share.revokedAt) throw new HttpError(404, 'This link does not exist or was switched off')
    if (share.expiresAt.getTime() <= Date.now()) throw new HttpError(410, 'This link has expired')
    res.json({
      data: {
        vehicleName: share.vehicleName,
        fromTs: share.fromTs,
        toTs: share.toTs,
        expiresAt: share.expiresAt,
        truncated: share.truncated,
        points: share.points,
      },
    })
  })
)

export default router
