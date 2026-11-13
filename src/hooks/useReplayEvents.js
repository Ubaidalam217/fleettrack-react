import { useEffect, useMemo, useState } from 'react'
import { fetchAlertEventsInRange } from '../data/alertEvents'
import { buildReplayEvents } from '../utils/replayEvents'

const IDLE = { key: null, raw: [], loading: false, error: null, truncated: false }

/**
 * The events of a loaded replay (utils/replayEvents.js): the server's alert
 * events for the vehicle and range — one request per loaded range, nothing to
 * Flespi — plus what the track itself shows.
 *
 * @param {number|null} deviceId  the Flespi device the replay is of
 * @param {{fromTs: number, toTs: number}|null} range  the loaded range
 * @param {object[]} messages  the loaded points as Flespi messages (pointToMessage)
 * @returns {{ events: object[], loading: boolean, error: string|null, truncated: boolean }}
 */
export function useReplayEvents(deviceId, range, messages) {
  const [state, setState] = useState(IDLE)
  const key = deviceId != null && range ? `${deviceId}:${range.fromTs}:${range.toTs}` : null

  useEffect(() => {
    if (!key) { setState(IDLE); return }
    let cancelled = false
    setState({ ...IDLE, key, loading: true })
    fetchAlertEventsInRange({ fromTs: range.fromTs, toTs: range.toTs, deviceIds: [deviceId] })
      .then(({ events, truncated }) => {
        if (!cancelled) setState({ key, raw: events, loading: false, error: null, truncated })
      })
      .catch(err => {
        // The track's own events still show; the panel says the alerts did not load.
        if (!cancelled) setState({ key, raw: [], loading: false, error: err?.message || 'Could not load the alert events.', truncated: false })
      })
    return () => { cancelled = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const events = useMemo(() => buildReplayEvents(state.raw, messages), [state.raw, messages])
  return { events, loading: state.loading, error: state.error, truncated: state.truncated }
}
