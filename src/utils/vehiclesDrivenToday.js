/**
 * Vehicles Driven Today (client requirement 8.3): which vehicles one driver
 * drove today, from today's trips of every vehicle the user can see.
 *
 * A trip's driver is decided as in the Trip reports: the iButton tag read
 * during the trip; an untagged trip belongs to the driver assigned to the
 * vehicle when it started. So a tag held by someone else is never counted for
 * the assigned driver, nor a trip from before the vehicle was handed over.
 */

import { ZERO_KM } from './usageReports.js'

const tagKey = code => String(code ?? '').replace(/[\s:-]/g, '').toUpperCase().replace(/^0+$/, '')

/**
 * @param {object[]} vehicleTrips  tripsByVehicle()'s result
 * @param {object} driver
 * @param {string} driver.code                   the driver's iButton ID, '' for none
 * @param {(vehicle: object, ts: number) => boolean} driver.isAssigned  whether this driver was assigned the vehicle at ts
 * @returns {{ deviceId: number, vehicle: object, name: string, firstTs: number, lastTs: number, km: number, trips: number }[]}
 *          one row per vehicle, the first one driven first
 */
export function vehiclesDrivenBy(vehicleTrips, { code, isAssigned }) {
  const own = tagKey(code)
  const rows = []
  for (const v of vehicleTrips ?? []) {
    const trips = v.trips.filter(t => {
      if ((t.distanceKm ?? 0) < ZERO_KM) return false // started the engine, never moved
      const tag = tagKey(t.ibutton)
      return tag ? tag === own : isAssigned(v.vehicle, t.startTs)
    })
    if (!trips.length) continue
    rows.push({
      deviceId: v.deviceId,
      vehicle: v.vehicle,
      name: v.vehicleId,
      firstTs: Math.min(...trips.map(t => t.startTs)),
      lastTs: Math.max(...trips.map(t => t.endTs)),
      km: trips.reduce((s, t) => s + (t.distanceKm ?? 0), 0),
      trips: trips.length,
    })
  }
  return rows.sort((a, b) => a.firstTs - b.firstTs)
}
