/**
 * /api/data-monitor — Settings › Device Data Monitor (client, 2026-11-16).
 * Super Admin only: it shows every tracker in the account and every user's
 * Flespi usage.
 *
 *   GET /api/data-monitor/devices    every tracker: last hour, last 24 h, status,
 *                                    likely cause and the recommended fix
 *   GET /api/data-monitor/requests   our Flespi usage: last 60 s vs the plan's
 *                                    limits, last hour by user / endpoint / device,
 *                                    last 24 h by hour
 *   GET /api/data-monitor/settings   the thresholds (defaults filled in)
 *   PUT /api/data-monitor/settings   change some of them
 *
 * Nothing here writes to Flespi or to a device (lib/dataMonitor.js).
 */

import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, forbidden } from '../lib/http.js'
import { isSuperAdmin } from '../lib/scope.js'
import { validate } from '../middleware/validate.js'
import { SETTINGS_SPEC, DEFAULT_SETTINGS, getSettings, saveSettings } from '../lib/trafficMonitor.js'
import { devicesView, requestsView } from '../lib/dataMonitor.js'

const router = Router()

router.use((req, _res, next) => {
  if (!isSuperAdmin(req.scope)) return next(forbidden('Only a Super Admin can open the Device Data Monitor'))
  next()
})

// Every setting optional; numbers within the spec's range, so a typo is a 400
// on that field rather than silently clamped.
const settingsBody = z.object(Object.fromEntries(Object.entries(SETTINGS_SPEC).map(([k, spec]) => [
  k,
  typeof spec.def === 'boolean'
    ? z.boolean().optional()
    : z.coerce.number().min(spec.min, `At least ${spec.min}`).max(spec.max, `At most ${spec.max}`).optional(),
]))).strict()
  .refine(v => (v.requestShedPct ?? getSettings().requestShedPct) >= (v.requestWarnPct ?? getSettings().requestWarnPct), {
    message: 'Must be at least the warning level', path: ['requestShedPct'],
  })

/** Never cached: the figures move every minute. */
const send = (res, data) => {
  res.set('Cache-Control', 'no-store')
  res.json({ data })
}

router.get('/devices', asyncHandler(async (_req, res) => send(res, await devicesView())))
router.get('/requests', asyncHandler(async (_req, res) => send(res, await requestsView())))
router.get('/settings', (_req, res) => send(res, { settings: getSettings(), defaults: DEFAULT_SETTINGS, spec: SETTINGS_SPEC }))
router.put('/settings', validate(settingsBody), asyncHandler(async (req, res) => {
  const settings = await saveSettings(req.body)
  send(res, { settings, defaults: DEFAULT_SETTINGS, spec: SETTINGS_SPEC })
}))

export default router
