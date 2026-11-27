import { useEffect, useMemo, useState } from 'react'
import { IS_REAL } from '../data/mode'
import { fetchFuelSeries } from '../data/fuel'
import { useSettingsProfile } from '../data/settings'
import { fuelFromServer, fuelFromPoints } from '../utils/replayFuel'

const MAX_SPAN_SEC = 31 * 86400

/**
 * The replayed vehicle's fuel, or null (nothing is drawn): the fuel pipeline's
 * series for the period when the vehicle has a calibration or readings (one small
 * GET /api/fuel/series, asked once per vehicle and period — never per tick), else
 * the CAN fuel volume of the replay's own points. A vehicle with no fuel at all
 * costs that one empty answer; nothing is asked in demo mode or with no tracker
 * registered.
 *
 * @param {string|null} ident  the tracker's IMEI (the live device's ident)
 * @param {object[]} points    the replay's loaded points (utils/replay.js)
 */
export default function useReplayFuel(ident, points) {
  const profile = useSettingsProfile(ident)
  const registerId = IS_REAL && profile?.linked ? profile.vehicle?.id ?? null : null
  const t0 = points?.[0]?.ts ?? null
  const t1 = points?.length ? points[points.length - 1].ts : null
  const [server, setServer] = useState({ key: null, info: null })
  const key = registerId && t0 != null && t1 != null ? `${registerId}|${t0}|${t1}` : null

  useEffect(() => {
    if (!key) return undefined
    let alive = true
    const from = Math.max(t0, t1 - MAX_SPAN_SEC)
    fetchFuelSeries({ vehicleId: registerId, from: new Date(from * 1000).toISOString(), to: new Date((t1 + 1) * 1000).toISOString() })
      .then(info => { if (alive) setServer({ key, info }) })
      .catch(() => { if (alive) setServer({ key, info: null }) })
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const fromServer = useMemo(() => (server.key === key ? fuelFromServer(server.info) : null), [server, key])
  // Only the first and last point and the count decide a re-read: the points array is replaced per trip pick.
  const fromCan = useMemo(() => (fromServer ? null : fuelFromPoints(points)), [fromServer, points])
  return fromServer ?? fromCan
}
