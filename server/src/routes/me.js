/**
 * /api/me — what the logged-in account may see, from its own point of view.
 *
 * GET /api/me/vehicles is the endpoint the Live Map will call in Phase 3. It
 * exists separately from GET /api/vehicles because the map wants one flat list of
 * IMEIs to subscribe to in Flespi and does not care which BG or branch each one
 * is filed under — and because "the fleet I am allowed to watch" is a question
 * every role answers differently, which is exactly what the scope helper is for.
 */

import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, HttpError } from '../lib/http.js'
import { optionalText } from '../lib/fields.js'
import { scopedWhere } from '../lib/scope.js'
import { publicUser } from '../lib/serialize.js'
import { validate } from '../middleware/validate.js'

const router = Router()

/**
 * Every vehicle in scope, with its IMEI.
 *
 * No pagination. The whole point is that the client holds the complete set so it
 * can match an incoming Flespi message to a vehicle without a round trip, and a
 * partial set would silently drop devices off the map. The largest tenant in this
 * deployment is in the low hundreds of vehicles.
 */
router.get(
  '/vehicles',
  asyncHandler(async (req, res) => {
    const rows = await prisma.vehicle.findMany({
      where: scopedWhere('vehicle', req.scope),
      orderBy: [{ plateNo: 'asc' }, { imei: 'asc' }],
      select: {
        id: true,
        imei: true,
        plateNo: true,
        fleetNo: true,
        subGroup: true,
        make: true,
        model: true,
        deviceType: true,
        mobileNo: true,
        vehicleType: true,
        bgId: true,
        branchId: true,
        bg: { select: { id: true, name: true, groupId: true } },
        branch: { select: { id: true, name: true } },
      },
    })

    res.json({
      data: rows,
      // Saves the client a length check to decide whether to open the MQTT
      // subscription at all, and makes an empty result legible in a log.
      count: rows.length,
      role: req.scope.role,
    })
  })
)

/**
 * PATCH /api/me — the signed-in account's own display name and mobile, from
 * Account Settings. Any role, itself only: PUT /api/users/:id is the admin
 * path and needs a higher role than the account being edited, which would
 * leave a BG user unable to fix their own name. Role, scope, email and
 * password are deliberately not editable here.
 */
const profileSchema = z.object({
  shortName: optionalText(120),
  mobile: optionalText(40),
})

router.patch(
  '/',
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    const row = await prisma.user.update({
      where: { id: req.scope.userId },
      data: { shortName: req.body.shortName, mobile: req.body.mobile },
    })
    res.json({ data: publicUser(row) })
  })
)

/**
 * PUT /api/me/avatar    { image: "<base64>" }  — set the own profile photo
 * DELETE /api/me/avatar                          — remove it
 *
 * The client resizes before uploading (the app sends ~320 px JPEGs of a few
 * tens of KB), so the cap here is about refusing junk, not about storage. The
 * format is taken from the file's own first bytes, never from anything the
 * client says, and only JPEG, PNG and WebP are accepted. Every upload gets a new
 * random key, so the photo URL changes and no cache can show the old one.
 */
const MAX_AVATAR_BYTES = 512 * 1024

const avatarSchema = z.object({
  image: z.string().min(16).max(Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 64),
})

function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

router.put(
  '/avatar',
  validate(avatarSchema),
  asyncHandler(async (req, res) => {
    // Accept a bare base64 string or a data: URL.
    const b64 = req.body.image.replace(/^data:[^,]*,/, '')
    const data = Buffer.from(b64, 'base64')
    const mimeType = sniffImage(data)
    if (!mimeType) throw new HttpError(400, 'The photo must be a JPEG, PNG or WebP image')
    if (data.length > MAX_AVATAR_BYTES) throw new HttpError(413, 'The photo is too large (max 512 KB)')

    const key = randomBytes(16).toString('hex')
    const userId = req.scope.userId
    const [, row] = await prisma.$transaction([
      prisma.userAvatar.upsert({
        where: { userId },
        create: { userId, key, mimeType, data },
        update: { key, mimeType, data },
      }),
      prisma.user.update({ where: { id: userId }, data: { avatarKey: key } }),
    ])
    res.json({ data: publicUser(row) })
  })
)

router.delete(
  '/avatar',
  asyncHandler(async (req, res) => {
    const userId = req.scope.userId
    const [, row] = await prisma.$transaction([
      prisma.userAvatar.deleteMany({ where: { userId } }),
      prisma.user.update({ where: { id: userId }, data: { avatarKey: null } }),
    ])
    res.json({ data: publicUser(row) })
  })
)

export default router
