import { useEffect } from 'react'
import { useFlespiMQTT } from './useFlespiMQTT'
import { currentUaeMonth, warmDaywiseMonth } from '../utils/daywise'

/** Let the dashboard and live map load first; the warm-up is not urgent. */
const START_DELAY_MS = 8000

/**
 * Fetch this month's Daywise data in the background after sign-in.
 *
 * The client wants a report the moment Generate is pressed. The cost of a Daywise
 * report is the first fetch of the month in a browser, so this pays it while the
 * user is still on the dashboard: by the time they open Reports, the month is in
 * the cache and Generate only renders. Once per fleet per app load.
 */
export function useReportWarmup() {
  const { vehicles } = useFlespiMQTT()
  const fleetKey = vehicles.map(v => v.id).sort((a, b) => a - b).join(',')

  useEffect(() => {
    if (!fleetKey) return
    const timer = setTimeout(() => {
      const { year, month } = currentUaeMonth()
      warmDaywiseMonth(fleetKey.split(',').map(Number), year, month)
    }, START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [fleetKey])
}
