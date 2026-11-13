import { useMemo } from 'react'
import { useDrivers, driverForIbutton, driverForVehicleImei, vehicleByImei } from '../data/settings'
import { useDriverHistory } from '../data/driverHistory'
import { driverIdentity, driverTimeline, NO_DRIVER } from '../utils/driverAtTime'

/**
 * The Settings side of the reports' driver dimension (utils/driverAtTime.js):
 * the filter's options and, per vehicle, a "driver at this moment" lookup.
 *
 * Past moments are read from the recorded history (data/driverHistory.js,
 * utils/driverHistory.js — client, 2026-11-13: "All the drivers names will
 * stay as it is"): a tag names whoever held it then, an untagged moment the
 * driver assigned then, so swapping, re-tagging or removing a driver never
 * renames an old trip. Without a history (mock mode, an older server) today's
 * assignment and tag holders answer, as before. A vehicle with no assignment
 * ever recorded keeps the old Flespi-metadata driver name as its fallback.
 *
 * Re-renders when the driver list or the history changes.
 *
 * Returns:
 *   options                     the driver filter's choices (removed drivers with history last)
 *   timelineFor(vehicle, msgs)  one vehicle's (ts) => {key,label}
 *   assignedFor(vehicle, ts?)   the driver assigned at ts ({key,label} or null); today's without ts
 *   assignedDuring(vehicle, fromTs, toTs)  every driver assigned in the period ([{key,label}])
 *   tagHolderAt(code, ts)       the driver record holding a tag at ts, or null
 *   driverById(id)              a driver record by id, removed ones included, or null
 *   allDrivers                  the Settings drivers, then the removed ones the history names
 * `vehicle` is a live (Flespi) vehicle: { ident, master }.
 */
export function useDriverDimension() {
  const drivers = useDrivers()
  const history = useDriverHistory()
  return useMemo(() => {
    const live = new Map(drivers.map(d => [d.id, d]))
    /** A driver by id: the Settings record, else the history's (a removed driver). */
    const driverById = id => (id ? live.get(id) ?? history?.driver(id) ?? null : null)

    const removed = (history?.drivers() ?? []).filter(d => d.removed && !live.has(d.id))
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
    const options = [
      ...[...drivers].sort(byName).map(d => ({ key: `d:${d.id}`, label: d.name || 'Driver' })),
      ...removed.sort(byName).map(d => ({ key: `d:${d.id}`, label: `${d.name || 'Driver'} (removed)` })),
      { key: 'u:*', label: 'Unregistered cards' },
      NO_DRIVER,
    ]

    /** The vehicle's assigned driver today (Settings > Driver, then the old Flespi metadata). */
    const todayFor = vehicle =>
      driverIdentity(driverForVehicleImei(vehicle?.ident)) ?? driverIdentity(vehicle?.master?.driver?.name) ?? null
    const settingsId = vehicle => vehicleByImei(vehicle?.ident)?.id ?? null
    /** Whether the history decides this vehicle's untagged moments. */
    const historyCovers = vehicle => !!history && history.hasVehicle(settingsId(vehicle))

    /** The driver assigned at ts by the history; today's without one, or with no ts. */
    const assignedFor = (vehicle, ts) => {
      if (ts === undefined || ts === null || !historyCovers(vehicle)) return todayFor(vehicle)
      return driverIdentity(driverById(history.assignedAt(settingsId(vehicle), ts)))
    }

    const assignedDuring = (vehicle, fromTs, toTs) => {
      if (!historyCovers(vehicle)) {
        const today = todayFor(vehicle)
        return today ? [today] : []
      }
      return history.assignedDuring(settingsId(vehicle), fromTs, toTs).map(id => driverIdentity(driverById(id))).filter(Boolean)
    }

    /** Who held the tag at ts; today's holder without a history. */
    const tagHolderAt = (code, ts) => {
      if (!history) return driverForIbutton(code)
      return driverById(history.tagHolderAt(code, ts))
    }

    /** One vehicle's "driver at ts" lookup over its messages. */
    const timelineFor = (vehicle, messages) =>
      driverTimeline(messages, {
        driverForTag: tagHolderAt,
        assigned: todayFor(vehicle),
        assignedAt: historyCovers(vehicle) ? ts => assignedFor(vehicle, ts) : null,
      })

    const allDrivers = [...drivers, ...removed]
    return { options, timelineFor, assignedFor, assignedDuring, tagHolderAt, driverById, allDrivers }
    // `drivers` and `history` are store snapshots: new values whenever they change.
  }, [drivers, history])
}
