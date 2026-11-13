import { useCallback, useMemo, useState } from 'react'
import { pointToMessage, tripsFromPoints, visibleReplayTrips, isZeroTrip, tripTotals } from '../utils/replayTrips'
import { DEFAULT_HIDDEN_GROUPS, eventsByTrip, groupCounts, visibleEvents } from '../utils/replayEvents'
import { driverIdentity, driverTimeline, NO_DRIVER } from '../utils/driverAtTime'
import { driverForIbutton, driverForVehicleImei, useDrivers } from '../data/settings'
import { useTripPlaces } from './useTripPlaces'
import { useReplayEvents } from './useReplayEvents'

const HIDDEN_KEY = 'ft-replay-hidden-events'
const HIGHLIGHT_KEY = 'ft-replay-highlight'
export const DEFAULT_HIGHLIGHT_KMH = 80

function loadHidden() {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY))
    if (Array.isArray(v)) return new Set(v.filter(k => typeof k === 'string'))
  } catch { /* private mode, or nothing saved */ }
  return new Set(DEFAULT_HIDDEN_GROUPS)
}

function loadHighlight() {
  try {
    const n = Number(localStorage.getItem(HIGHLIGHT_KEY))
    if (Number.isFinite(n) && n > 0) return n
  } catch { /* private mode */ }
  return DEFAULT_HIGHLIGHT_KMH
}

/**
 * Everything the replay shows around the track itself — computed once here
 * for the panel, the map and the player bar (approved replay "Option C"):
 *
 *   trips      the Trip Report's trips in the loaded range (0 km hidden by default)
 *   places     their start/end addresses
 *   events     alert events + harsh / ignition read off the track; the chips
 *              switch groups off (remembered), `shown` is what stays on
 *   highlight  the "route above N km/h in red" speed (remembered)
 *   driverOf   who drove at a moment: iButton read in the drive, else the
 *              vehicle's assigned driver (utils/driverAtTime.js)
 *
 * Mounted for the whole page, so it is cheap with nothing loaded.
 */
export function useReplayView({ deviceId, vehicle, range, allPoints }) {
  const messages = useMemo(() => (allPoints ?? []).map(pointToMessage), [allPoints])

  // Trips: cut from the points already loaded — no fetch.
  const allTrips = useMemo(() => tripsFromPoints(allPoints), [allPoints])
  const [showZero, setShowZero] = useState(false)
  const zeroCount = useMemo(() => allTrips.filter(isZeroTrip).length, [allTrips])
  const { trips } = useMemo(() => visibleReplayTrips(allTrips, !showZero), [allTrips, showZero])
  const totals = useMemo(() => tripTotals(trips), [trips])
  const places = useTripPlaces(trips)

  // Events.
  const { events, loading: eventsLoading, error: eventsError, truncated: eventsTruncated } =
    useReplayEvents(deviceId, range, messages)
  const [hidden, setHidden] = useState(loadHidden)
  const toggleGroup = useCallback(key => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }, [])
  const groups = useMemo(() => groupCounts(events), [events])
  const shown = useMemo(() => visibleEvents(events, hidden), [events, hidden])
  const { byTrip, outside } = useMemo(() => eventsByTrip(shown, trips), [shown, trips])

  const [highlightKmh, setHighlightState] = useState(loadHighlight)
  const setHighlightKmh = useCallback(n => {
    setHighlightState(n)
    if (Number.isFinite(n) && n > 0) {
      try { localStorage.setItem(HIGHLIGHT_KEY, String(n)) } catch { /* private mode */ }
    }
  }, [])

  // Drivers: re-derived when Settings > Driver loads or changes.
  const drivers = useDrivers()
  const imei = vehicle?.ident
  const metaDriver = vehicle?.master?.driver?.name
  const driverAt = useMemo(() => {
    const assigned = driverIdentity(driverForVehicleImei(imei)) ?? driverIdentity(metaDriver)
    return driverTimeline(messages, { driverForTag: driverForIbutton, assigned })
  }, [messages, imei, metaDriver, drivers]) // eslint-disable-line react-hooks/exhaustive-deps

  /** The driver's name at a moment, or null for none. */
  const driverOf = useCallback(ts => {
    const who = driverAt(ts)
    return who && who.key !== NO_DRIVER.key ? who.label : null
  }, [driverAt])

  /** An event's driver: the one the alert engine recorded, else whoever drove then. */
  const eventDriver = useCallback(e => {
    if (e?.driverId) {
      const d = (Array.isArray(drivers) ? drivers : []).find(x => x.id === e.driverId)
      if (d?.name) return d.name
    }
    return driverOf(e?.fromTs)
  }, [drivers, driverOf])

  return {
    allTrips, trips, totals, zeroCount, showZero, setShowZero, places,
    events, shown, groups, hidden, toggleGroup, byTrip, outside,
    eventsLoading, eventsError, eventsTruncated,
    highlightKmh, setHighlightKmh,
    driverOf, eventDriver,
  }
}
