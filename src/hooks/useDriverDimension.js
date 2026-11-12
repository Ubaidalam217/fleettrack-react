import { useMemo } from 'react'
import { useDrivers, driverForIbutton, driverForVehicleImei } from '../data/settings'
import { driverIdentity, driverTimeline, NO_DRIVER } from '../utils/driverAtTime'

/**
 * The Settings side of the reports' driver dimension (utils/driverAtTime.js):
 * the filter's options and, per vehicle, a "driver at this moment" lookup.
 * Re-renders when the driver list changes.
 */
export function useDriverDimension() {
  const drivers = useDrivers()
  return useMemo(() => {
    const options = [
      ...[...drivers].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(d => ({ key: `d:${d.id}`, label: d.name || 'Driver' })),
      { key: 'u:*', label: 'Unregistered cards' },
      NO_DRIVER,
    ]
    /** The vehicle's assigned driver today (Settings > Driver, then the old Flespi metadata). */
    const assignedFor = vehicle =>
      driverIdentity(driverForVehicleImei(vehicle?.ident)) ?? driverIdentity(vehicle?.master?.driver?.name) ?? null
    /** One vehicle's "driver at ts" lookup over its messages. */
    const timelineFor = (vehicle, messages) =>
      driverTimeline(messages, { driverForTag: driverForIbutton, assigned: assignedFor(vehicle) })
    return { options, assignedFor, timelineFor }
    // `drivers` is the store snapshot: a new array whenever a driver changes.
  }, [drivers])
}
