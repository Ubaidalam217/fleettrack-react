/**
 * GET /api/avatars/:key — a profile photo, by its random key.
 *
 * Public on purpose: an <img src> on the website cannot send the login token,
 * and the mobile app loads it as a plain image too. The key is 128 random bits,
 * replaced on every upload, so the URL is unguessable and can be cached forever;
 * a removed or replaced photo simply stops resolving.
 */

import { Router } from 'express'
import prisma from '../prisma.js'
import { asyncHandler, notFound } from '../lib/http.js'

const router = Router()
const KEY = /^[a-f0-9]{32}$/

router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const { key } = req.params
    if (!KEY.test(key)) throw notFound('Photo')
    const row = await prisma.userAvatar.findUnique({ where: { key }, select: { mimeType: true, data: true } })
    if (!row) throw notFound('Photo')
    res.set('Content-Type', row.mimeType)
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    // helmet defaults to same-origin; the dev website (another port) and the app must be able to show it.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    res.send(Buffer.from(row.data))
  })
)

export default router
