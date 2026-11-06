/**
 * GET /api/driver-photos/:key — a driver's photo, by its random key.
 * Public for the same reason as /api/avatars: an <img src> cannot send the
 * login token. The key is 128 random bits and changes on every upload.
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
    const row = await prisma.driverPhoto.findUnique({ where: { key }, select: { mimeType: true, data: true } })
    if (!row) throw notFound('Photo')
    res.set('Content-Type', row.mimeType)
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    res.send(Buffer.from(row.data))
  })
)

export default router
