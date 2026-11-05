/**
 * Keeps the Flespi device behind each vehicle in step with the asset register,
 * so a vehicle is added and edited in FleetmaxX alone and nobody opens the
 * Flespi panel.
 *
 *   - Add: the vehicle's IMEI already on a Flespi device links to it (renamed to
 *     the plate); otherwise a device of the chosen type is created. Either way
 *     it is subscribed to the webhook stream so its data reaches us.
 *   - Edit: the linked device — found by the new IMEI, else the old one — takes
 *     the new name, IMEI and type. With no device and a type chosen, one is
 *     created, which is how an existing record gets its device.
 *   - Delete: the Flespi device is left alone, by the client's choice. Its
 *     history stays in Flespi and the vehicle can be re-added onto it.
 *
 * Flespi is written before our database, and every step is "find, then create"
 * so a save that fails half way is safe to repeat: the retry links to the device
 * the first attempt made instead of making a second one.
 *
 * `deviceType` is the vehicle's existing free-text field, holding the Flespi
 * device type's title ("Teltonika FMC130"). A value that is not a Flespi title —
 * older records typed by hand — is simply not synced.
 */

import { HttpError } from './http.js'
import * as flespi from './flespi.js'

// Teltonika and Concox (Jimi IoT): the two channels the account receives on.
const PROTOCOLS = [14, 13]
const STREAM_NAME = 'FleetmaxX webhook'
const TYPES_TTL_MS = 24 * 60 * 60 * 1000

let typesCache = { at: 0, list: null }
let streamCache = { at: 0, id: undefined }

/** Every Flespi device type of our channels: [{ id, title, protocolId }], cached a day. */
export async function deviceTypes() {
  if (typesCache.list && Date.now() - typesCache.at < TYPES_TTL_MS) return typesCache.list
  const payload = await flespi.request(`/gw/channel-protocols/${PROTOCOLS.join(',')}/device-types/all?fields=id,title,protocol_id`)
  const list = (payload?.result ?? [])
    .map(t => ({ id: t.id, title: t.title, protocolId: t.protocol_id }))
    .sort((a, b) => a.title.localeCompare(b.title))
  typesCache = { at: Date.now(), list }
  return list
}

/** The address each protocol's trackers send to, for the installer: { 14: 'host:port' }. */
export async function channelAddresses() {
  const payload = await flespi.request('/gw/channels/all?fields=protocol_id,uri,enabled')
  const out = {}
  for (const c of payload?.result ?? []) if (c.enabled && c.uri && !out[c.protocol_id]) out[c.protocol_id] = c.uri
  return out
}

async function typeByTitle(title) {
  const t = String(title ?? '').trim().toLowerCase()
  if (!t) return null
  return (await deviceTypes()).find(d => d.title.toLowerCase() === t) ?? null
}

/** The webhook stream's id, or null when the webhook is not set up (then polling serves). */
async function streamId() {
  if (streamCache.id !== undefined && Date.now() - streamCache.at < 10 * 60 * 1000) return streamCache.id
  const payload = await flespi.request('/gw/streams/all?fields=id,name')
  const id = (payload?.result ?? []).find(s => s.name === STREAM_NAME)?.id ?? null
  streamCache = { at: Date.now(), id }
  return id
}

async function subscribe(deviceId) {
  const sid = await streamId()
  if (!sid) return
  const subs = await flespi.request(`/gw/streams/${sid}/devices/${deviceId}`)
  if (!subs?.result?.length) await flespi.request(`/gw/streams/${sid}/devices/${deviceId}`, { method: 'POST' })
}

/** A Flespi refusal (bad IMEI, device limit…) is the user's to fix: 400 with Flespi's reason. */
function friendly(err, what) {
  if (err instanceof flespi.FlespiError && err.upstreamStatus >= 400 && err.upstreamStatus < 500 && err.upstreamStatus !== 429) {
    const reason = String(err.message).replace(/^Flespi \S+ \S+ failed: /, '')
    if (/limit on maximum quantity/i.test(reason)) {
      return new HttpError(400, 'Flespi device limit reached — upgrade the Flespi plan to add more vehicles. Nothing was saved.')
    }
    return new HttpError(400, `Flespi did not ${what}: ${reason}`)
  }
  return err
}

/**
 * Make Flespi match a vehicle being saved. Returns { deviceId, created } or null
 * when nothing was synced (Flespi not configured, or no device and no type).
 *
 * @param imei      the vehicle's IMEI (digits)
 * @param oldImei   its IMEI before this edit; null on add
 * @param name      the device name to show in Flespi (plate, else fleet no, else IMEI)
 * @param deviceType the vehicle's device type text
 * @param requireType true on add: no device and no known type is an error
 */
export async function syncVehicleDevice({ imei, oldImei = null, name, deviceType, requireType = false }) {
  if (!flespi.isConfigured() || !imei) return null
  try {
    const byImei = await flespi.deviceMap({ force: true })
    const type = await typeByTitle(deviceType)
    const deviceId = byImei.get(imei) ?? (oldImei ? byImei.get(oldImei) : undefined)

    if (deviceId) {
      const [cur] = (await flespi.request(`/gw/devices/${deviceId}?fields=name,device_type_id,configuration`))?.result ?? []
      const change = {}
      if (cur && name && cur.name !== name) change.name = name
      if (cur && String(cur.configuration?.ident ?? '') !== imei) change.configuration = { ...cur.configuration, ident: imei }
      if (cur && type && cur.device_type_id !== type.id) change.device_type_id = type.id
      if (Object.keys(change).length) await flespi.request(`/gw/devices/${deviceId}`, { method: 'PUT', body: change })
      await subscribe(deviceId)
      flespi.clearDeviceCache()
      return { deviceId, created: false }
    }

    if (!type) {
      if (!requireType) return null
      throw new HttpError(400, 'Choose the device type so the tracker can be added to Flespi', { deviceType: 'Choose the device type' })
    }
    const made = await flespi.request('/gw/devices?fields=id', {
      method: 'POST',
      body: [{ name: name || imei, device_type_id: type.id, configuration: { ident: imei } }],
    })
    const newId = made?.result?.[0]?.id
    if (!newId) throw new HttpError(502, 'Flespi did not return the new device')
    await subscribe(newId)
    flespi.clearDeviceCache()
    return { deviceId: newId, created: true }
  } catch (err) {
    throw friendly(err, 'accept this tracker')
  }
}

/**
 * Flespi devices with no vehicle in the register — trackers added in the Flespi
 * panel before FleetmaxX managed them. The Object page offers each for a
 * one-click Add with its IMEI, name and type filled in.
 */
export async function unregisteredDevices(registeredImeis) {
  const known = new Set(registeredImeis.map(i => String(i ?? '').replace(/\D/g, '')))
  const [payload, types] = await Promise.all([
    flespi.request('/gw/devices/all?fields=id,name,device_type_id,configuration'),
    deviceTypes(),
  ])
  const titleOf = new Map(types.map(t => [t.id, t]))
  return (payload?.result ?? [])
    .map(d => ({ d, imei: String(d.configuration?.ident ?? '').replace(/\D/g, '') }))
    .filter(({ imei }) => imei && !known.has(imei))
    .map(({ d, imei }) => ({
      deviceId: d.id,
      name: d.name ?? '',
      imei,
      deviceType: titleOf.get(d.device_type_id)?.title ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The Flespi name for a vehicle: what the live map shows when nothing else is set. */
export const deviceName = v => (v.plateNo || v.fleetNo || v.imei || '').trim()

/** Test seam. */
export function __resetFlespiDevices() {
  typesCache = { at: 0, list: null }
  streamCache = { at: 0, id: undefined }
}
