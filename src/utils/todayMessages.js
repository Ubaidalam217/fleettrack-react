import { fetchFleetMessages } from './replay'

/**
 * Today's messages for a set of vehicles — one fleet-wide Flespi read, eight
 * small fields — shared by everything that cuts today into trips: the Driver
 * Info tab's Vehicles Driven Today and the Dashboard's trip figures.
 *
 * The promise is kept a few minutes per day and vehicle set, then read afresh,
 * because today keeps growing.
 */

export const TODAY_FIELDS = [
  'timestamp', 'position.latitude', 'position.longitude', 'position.speed', 'position.valid',
  'engine.ignition.status', 'vehicle.mileage', 'ibutton.code', 'external.powersource.voltage',
].join(',')

const TTL_MS = 5 * 60 * 1000
const cache = new Map() // `${day}|${ids}` -> { expiresAt, promise }

/** @returns {Promise<Map<number, {messages: object[], truncated: boolean}>>} */
export function fetchTodayMessages(ids) {
  const sorted = [...ids].sort((a, b) => a - b)
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const fromTs = Math.floor(midnight.getTime() / 1000)
  const key = `${fromTs}|${sorted.join(',')}`
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.promise
  for (const k of cache.keys()) if (!k.startsWith(`${fromTs}|`)) cache.delete(k) // yesterday's
  const promise = fetchFleetMessages(sorted, fromTs, Math.floor(Date.now() / 1000), { fields: TODAY_FIELDS })
    .catch(err => { cache.delete(key); throw err })
  cache.set(key, { expiresAt: Date.now() + TTL_MS, promise })
  return promise
}
