/**
 * /api/device-settings/:deviceId — the tracker's own settings the client asked
 * to manage from FleetmaxX (2026-11-06): the over-speed limit, the harsh
 * acceleration / braking / cornering thresholds, the idling timeout, and a
 * restart. They live on the device and are changed through Flespi:
 *
 *   PUT /gw/devices/{id}/settings/{name}   { address: 'connection', properties }
 *
 * Flespi answers 200 as soon as it has QUEUED the change (also for a device
 * that is off); it reaches the tracker on its next connection. `pending` then
 * clears and `updated` moves on, which is how the page tells delivered from
 * waiting.
 *
 * Who may change them: Super Admin and GGB admins, within their own scope.
 * Everyone who can see the vehicle may read them.
 *
 * Some trackers report first to another platform — the UAE ITC endpoint
 * (iavmep.itc.gov.ae) or Ctrack — with Flespi as the backup server. A setting
 * changed here changes what the tracker sends there too, so on those devices a
 * change needs an explicit confirmation, and the page says which platform.
 * The server and connection settings themselves are never offered.
 */

import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, HttpError, badRequest, forbidden, notFound } from '../lib/http.js'
import { validate } from '../middleware/validate.js'
import { ROLES } from '../lib/scope.js'
import { buildAcl } from '../lib/flespiGrant.js'
import * as flespi from '../lib/flespi.js'

const router = Router()

/** The editable settings: Flespi name pattern, and each field with its device limits. */
export const EDITABLE = {
  overspeed: {
    pattern: /^overspeeding_dout\d+$/,
    fields: { max_speed: { min: 10, max: 260, int: true } },
  },
  greenDriving: {
    pattern: /^green_driving_dout\d+$/,
    fields: {
      max_accel: { min: 0.5, max: 10 },
      max_brake: { min: 0.5, max: 10 },
      max_angle: { min: 0.5, max: 10 },
    },
  },
  idling: {
    pattern: /^idling_dout\d+$/,
    fields: { stop_time: { min: 0, max: 3600, int: true } },
  },
}
const RESET = /^cpureset$/

const canEdit = scope => [ROLES.SUPER_ADMIN, ROLES.GGB_ADMIN].includes(scope.role)

/** Which platform a tracker reports to first, when it is not Flespi. */
export function primaryPlatform(settings) {
  const host = settings.find(s => s.name === 'gprs_server')?.current?.host ?? ''
  if (!host || /flespi/i.test(host)) return null
  return { host, itc: /itc\.gov\.ae$/i.test(host) }
}

async function deviceFor(req) {
  if (!flespi.isConfigured()) throw new HttpError(503, 'Live tracking is not configured on this server')
  const id = Number(req.params.deviceId)
  if (!Number.isInteger(id) || id <= 0) throw notFound('Vehicle')
  const { deviceIds } = await buildAcl(req.scope)
  if (deviceIds !== null && !deviceIds.includes(id)) throw notFound('Vehicle')
  return id
}

const readAll = async id => (await flespi.request(`/gw/devices/${id}/settings/all`, { timeoutMs: 20_000 }))?.result ?? []

function shape(settings) {
  const out = {}
  for (const [key, def] of Object.entries(EDITABLE)) {
    const s = settings.find(x => def.pattern.test(x.name))
    out[key] = s ? { name: s.name, current: s.current ?? null, pending: s.pending ?? null, updated: s.updated ?? 0 } : null
  }
  const reset = settings.find(x => RESET.test(x.name))
  return { settings: out, reset: reset ? { name: reset.name, pending: reset.pending ?? null, updated: reset.updated ?? 0 } : null }
}

router.get(
  '/:deviceId',
  asyncHandler(async (req, res) => {
    const id = await deviceFor(req)
    const all = await readAll(id)
    const { settings, reset } = shape(all)
    res.json({
      data: {
        deviceId: id,
        supported: Object.values(settings).some(Boolean),
        canEdit: canEdit(req.scope),
        primaryPlatform: primaryPlatform(all),
        settings,
        reset,
      },
    })
  })
)

const changeSchema = z.object({
  values: z.record(z.string(), z.coerce.number()),
  confirmPlatform: z.boolean().default(false),
})

function assertMayWrite(req, all) {
  if (!canEdit(req.scope)) throw forbidden('Only an administrator can change device settings')
  const platform = primaryPlatform(all)
  if (platform && !req.body.confirmPlatform) {
    throw new HttpError(409, `This tracker reports first to ${platform.host}${platform.itc ? ' (UAE ITC)' : ''}. Confirm to change it.`, { confirmPlatform: 'Confirmation required' })
  }
}

router.put(
  '/:deviceId/:key',
  validate(changeSchema),
  asyncHandler(async (req, res) => {
    const def = EDITABLE[req.params.key]
    if (!def) throw notFound('Setting')
    const id = await deviceFor(req)
    const all = await readAll(id)
    assertMayWrite(req, all)
    const setting = all.find(s => def.pattern.test(s.name))
    if (!setting) throw badRequest('This tracker does not have that setting')

    const change = {}
    for (const [field, v] of Object.entries(req.body.values)) {
      const rule = def.fields[field]
      if (!rule) throw badRequest(`${field} cannot be changed here`, { [field]: 'Not editable' })
      if (!Number.isFinite(v) || v < rule.min || v > rule.max || (rule.int && !Number.isInteger(v))) {
        throw badRequest(`${field} must be between ${rule.min} and ${rule.max}`, { [field]: `${rule.min}–${rule.max}` })
      }
      change[field] = v
    }
    if (!Object.keys(change).length) throw badRequest('Nothing to change')

    // The whole setting goes back with the new values in it: Flespi checks the
    // full object against the device's schema.
    const properties = { ...(setting.current ?? {}), ...change }
    await flespi.request(`/gw/devices/${id}/settings/${setting.name}`, { method: 'PUT', body: { address: 'connection', properties }, timeoutMs: 20_000 })
    console.log(`[fleetmax] device ${id} ${setting.name} ← ${JSON.stringify(change)} by ${req.scope.userId}`)
    const after = shape(await readAll(id))
    res.json({ data: { setting: after.settings[req.params.key] } })
  })
)

const resetSchema = z.object({ confirmPlatform: z.boolean().default(false) })

router.post(
  '/:deviceId/reset',
  validate(resetSchema),
  asyncHandler(async (req, res) => {
    const id = await deviceFor(req)
    const all = await readAll(id)
    assertMayWrite(req, all)
    const reset = all.find(s => RESET.test(s.name))
    if (!reset) throw badRequest('This tracker cannot be restarted from here')
    await flespi.request(`/gw/devices/${id}/settings/${reset.name}`, { method: 'PUT', body: { address: 'connection' }, timeoutMs: 20_000 })
    console.log(`[fleetmax] device ${id} restart requested by ${req.scope.userId}`)
    res.json({ data: { reset: shape(await readAll(id)).reset } })
  })
)

export default router
