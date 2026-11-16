/**
 * The one name a vehicle is shown under (client, 2026-11-16: "Vehicles numbers
 * should be auto updated everywhere"): our plate number, else our fleet no.,
 * else the Flespi device name (only for a tracker nobody has registered), else
 * the IMEI. The web app has the same rule in src/utils/vehicleLabel.js.
 *
 * Alert messages, e-mails and pushes are written with the name the vehicle had
 * when they went out; what the app shows next to them is read from the vehicle
 * row now, through here, so a rename shows at once.
 */

import prisma from '../prisma.js'
import * as flespi from './flespi.js'

const clean = s => (s == null ? '' : String(s).trim())
const digits = s => String(s ?? '').replace(/\D/g, '')

/**
 * @param {{ plateNo?: string|null, fleetNo?: string|null, imei?: string|null }|null} v
 * @param {string} [flespiName]  the Flespi device's name, the fallback before the IMEI
 * @returns {string} '' when there is nothing to name it by
 */
export function vehicleLabel(v, flespiName = '') {
  return clean(v?.plateNo) || clean(v?.fleetNo) || clean(flespiName) || clean(v?.imei)
}

const LABEL_SELECT = { id: true, plateNo: true, fleetNo: true, imei: true, createdAt: true }

/** The IMEI a Flespi device carries now: Flespi's device list (cached), else our telemetry copy. */
async function identOf(deviceId) {
  if (flespi.isConfigured()) {
    try {
      const map = await flespi.deviceMap()
      for (const [imei, id] of map) if (id === deviceId) return imei
    } catch { /* fall through to our own copy */ }
  }
  const st = await prisma.deviceState.findUnique({ where: { deviceId }, select: { ident: true } })
  return digits(st?.ident) || null
}

/** The register row of the vehicle a Flespi device is fitted to now, or null. */
export async function vehicleForDevice(deviceId) {
  const imei = await identOf(Number(deviceId))
  if (!imei) return null
  return prisma.vehicle.findUnique({ where: { imei }, select: LABEL_SELECT })
}

/**
 * A device's vehicle name now, or `fallback` (the name stored with a share
 * link) when the device has no registered vehicle or the lookup fails.
 *
 * `since` (unix seconds) is for a link about the past, such as a replay: the
 * current vehicle's name is only used when that vehicle already had this
 * tracker then — registered before it and no tracker change recorded since —
 * so a tracker moved to another vehicle never renames an old replay after
 * the new one.
 */
export async function currentLabelForDevice(deviceId, fallback = '', { since = null } = {}) {
  try {
    const v = await vehicleForDevice(deviceId)
    if (!v) return fallback
    if (since != null) {
      const from = new Date(since * 1000)
      if (v.createdAt > from) return fallback
      const swaps = await prisma.vehicleMove.count({ where: { vehicleId: v.id, level: 'device', movedAt: { gt: from } } })
      if (swaps > 0) return fallback
    }
    return vehicleLabel(v) || fallback
  } catch {
    return fallback
  }
}
