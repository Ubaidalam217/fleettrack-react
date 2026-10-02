import { useState, useEffect } from 'react'
import { fetchTodayMessages, computeUsage } from '../utils/usageData'

/**
 * Today's messages for one device, plus the usage figures derived from them.
 *
 * Shared by the Vehicle Info / Usage / Sensors / Alerts tabs and by the vehicle
 * Console. fetchTodayMessages() caches the *promise* per device for its TTL, so
 * every one of those callers reads through the same in-flight or settled
 * request — switching tabs, or opening the Console over a panel that has
 * already loaded, never issues a second fetch.
 *
 * Lives in its own module rather than inside VehicleDetailPanel because the
 * Console needs the same odometer and importing a hook out of a component file
 * is what drops that file out of Fast Refresh.
 */
export function useVehicleUsage(vehicleId) {
  const [state, setState] = useState({ loading: true, error: null, status: null, usage: null, messages: null })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null, status: null, usage: null, messages: null })

    fetchTodayMessages(vehicleId, status => {
      if (!cancelled) setState(s => ({ ...s, status }))
    })
      .then(messages => {
        if (!cancelled) setState({ loading: false, error: null, status: null, usage: computeUsage(messages), messages })
      })
      .catch(err => {
        if (!cancelled) setState({ loading: false, error: err.message, status: null, usage: null, messages: null })
      })

    return () => { cancelled = true }
  }, [vehicleId])

  return state
}

/** The one place the live odometer is turned into a string for display. */
export function fmtOdometer(km) {
  return km != null ? `${km.toFixed(1)} km` : null
}
