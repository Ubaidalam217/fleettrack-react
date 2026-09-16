import { useMemo } from 'react'
import { computeHealthScore } from '../utils/healthScore'
import { useFlespiMQTT } from './useFlespiMQTT'

// Re-exported for useNotificationEngine.js, which still does its own one-off REST snapshot fetch.
export { BASE_URL, HEADERS } from './flespiConfig'

export function useFlespiData() {
  const { vehicles, isConnected, lastUpdated, error, mqttFatalError, mqttRetryNotice } = useFlespiMQTT()

  // Loading until the MQTT session has connected at least once (or produced vehicles/errored).
  // The two MQTT banners also end the loading state: if the broker is refusing us
  // *and* the REST bootstrap came back empty, a permanent skeleton would hide the
  // very banner that explains why.
  const hasLoaded = isConnected || vehicles.length > 0 || !!error || !!mqttFatalError || !!mqttRetryNotice

  const data = useMemo(() => {
    if (!hasLoaded) return null

    const total    = vehicles.length
    const running  = vehicles.filter(v => v.status === 'Running').length
    const idle     = vehicles.filter(v => v.status === 'Idle').length
    const stopped  = vehicles.filter(v => v.status === 'Stopped').length
    const inactive = vehicles.filter(v => v.status === 'Inactive').length
    const noData   = vehicles.filter(v => v.status === 'NoData').length
    // Active = Running + Idle only (Stopped vehicles are not considered active)
    const active   = running + idle

    const healthScore = computeHealthScore({ total, running, idle, stopped, inactive, noData, active })

    // Trips API not available on free plan — estimate from live status counts
    const totalTrips    = running * 3 + stopped * 1
    const totalDistance = running * 85 + stopped * 12

    return {
      total, active, running, idle, stopped, inactive, noData,
      healthScore, vehicles, totalTrips, totalDistance,
    }
  }, [vehicles, hasLoaded])

  return {
    data,
    loading: !hasLoaded,
    error,
    mqttFatalError,
    mqttRetryNotice,
    lastUpdated,
    isConnected,
    refresh: () => Promise.resolve(), // MQTT streams live — nothing to re-fetch
  }
}
