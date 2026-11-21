/**
 * /api/journey-settings — the Journey settings panel, per Business Group
 * (client 2026-11-16: "all limits configurable").
 *
 *   GET /?bgId=   the effective settings (defaults under what is saved), the
 *                 HSE driving rules (the fatigue setting, read-only here) and
 *                 whether WhatsApp is set up
 *   PUT /         { bgId?, value }   — "Journey settings" Edit; not a sub-user
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, forbidden } from '../lib/http.js'
import { bgWhere, findScopedOrThrow, ROLES } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'
import { getJourneySettings, hseRules, JOURNEY_DEFAULTS, setJourneySettings } from '../lib/journeySettings.js'
import * as whatsapp from '../lib/whatsapp.js'
import { providerStatus } from '../lib/distanceProvider.js'
import { levelOf, atLeast } from '../lib/permissions.js'

const router = Router()

async function bgIdOf(req, given) {
  const id = req.scope.bgId ?? given
  if (!id) {
    const first = await prisma.businessGroup.findFirst({ where: bgWhere(req.scope), select: { id: true }, orderBy: { name: 'asc' } })
    if (!first) throw badRequest('Pick a Business Group')
    return first.id
  }
  await findScopedOrThrow('bg', id, req.scope)
  return id
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const bgId = await bgIdOf(req, typeof req.query.bgId === 'string' ? req.query.bgId : null)
    const [value, row, hse] = await Promise.all([
      getJourneySettings(bgId, { fresh: true }),
      prisma.journeySetting.findUnique({ where: { bgId }, select: { updatedAt: true, updatedByName: true } }),
      hseRules(),
    ])
    const canEdit = req.scope.role === ROLES.SUPER_ADMIN
      || (req.scope.role !== ROLES.SUB_USER && atLeast(levelOf(req.user.screenAccess, '/settings/journey'), 'modify'))
    res.set('Cache-Control', 'no-store')
    res.json({
      data: {
        bgId, value, defaults: JOURNEY_DEFAULTS, hse, whatsappConfigured: whatsapp.isConfigured(),
        routingProviders: providerStatus(value.routing),
        updatedAt: row?.updatedAt ?? null, updatedByName: row?.updatedByName ?? null, canEdit,
      },
    })
  })
)

router.put(
  '/',
  validate(z.object({ bgId: z.union([z.string().trim().min(1), z.null()]).optional(), value: z.record(z.string(), z.any()) })),
  asyncHandler(async (req, res) => {
    if (req.scope.role === ROLES.SUB_USER) throw forbidden('Sub-users have read-only access')
    const bgId = await bgIdOf(req, req.body.bgId)
    const value = await setJourneySettings(bgId, req.body.value, req.user.shortName || req.user.email)
    res.json({ data: { bgId, value } })
  })
)

export default router
