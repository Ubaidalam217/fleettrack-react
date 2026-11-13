/**
 * Logos of GGBs, Groups, Business Groups and Branches (lib/nodeLogos.js).
 *
 * GET /api/node-logos/:key — the image, by its random key. Public for the
 * same reason as /api/driver-photos: an <img src> cannot send the login
 * token. The key is 128 random bits and changes on every upload.
 *
 * PUT/DELETE /api/{ggbs,groups,bgs,branches}/:id/logo — mounted inside each
 * of those routers by logoRoutes(), so they get the router's own screen
 * permission and the same write and scope rules as editing the node.
 */

import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, HttpError, notFound } from '../lib/http.js'
import { fromBase64, sniffImage } from '../lib/files.js'
import { LOGO_KINDS, MAX_LOGO_BYTES } from '../lib/nodeLogos.js'
import { assertCanWrite, findScopedOrThrow } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()
const KEY = /^[a-f0-9]{32}$/

router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const { key } = req.params
    if (!KEY.test(key)) throw notFound('Logo')
    const row = await prisma.nodeLogo.findUnique({ where: { key }, select: { mimeType: true, data: true } })
    if (!row) throw notFound('Logo')
    res.set('Content-Type', row.mimeType)
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    res.send(Buffer.from(row.data))
  })
)

export default router

const logoSchema = z.object({ image: z.string().min(16).max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 64) })

/** PUT { image: base64 } and DELETE on /:id/logo, for one of the four node kinds. */
export function logoRoutes(kind) {
  const { delegate, fk } = LOGO_KINDS[kind]
  const logos = Router()

  logos.put(
    '/:id/logo',
    validate(logoSchema),
    asyncHandler(async (req, res) => {
      assertCanWrite(req.scope, kind)
      const existing = await findScopedOrThrow(kind, req.params.id, req.scope)
      const data = fromBase64(req.body.image)
      const mimeType = sniffImage(data)
      if (!mimeType) throw badRequest('The logo must be a JPEG, PNG or WebP image')
      if (data.length > MAX_LOGO_BYTES) throw new HttpError(413, 'The logo is too large (max 5 MB)')
      const key = randomBytes(16).toString('hex')
      const [, row] = await prisma.$transaction([
        prisma.nodeLogo.upsert({
          where: { [fk]: existing.id },
          create: { [fk]: existing.id, key, mimeType, data },
          update: { key, mimeType, data },
        }),
        prisma[delegate].update({ where: { id: existing.id }, data: { logoKey: key } }),
      ])
      res.json({ data: row })
    })
  )

  logos.delete(
    '/:id/logo',
    asyncHandler(async (req, res) => {
      assertCanWrite(req.scope, kind)
      const existing = await findScopedOrThrow(kind, req.params.id, req.scope)
      const [, row] = await prisma.$transaction([
        prisma.nodeLogo.deleteMany({ where: { [fk]: existing.id } }),
        prisma[delegate].update({ where: { id: existing.id }, data: { logoKey: null } }),
      ])
      res.json({ data: row })
    })
  )

  return logos
}
