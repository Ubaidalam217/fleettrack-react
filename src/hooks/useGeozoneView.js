import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { vehicleLabel } from '../utils/vehicleLabel'
import { normalizeGeoOptions, ruleGeofenceIds, shownGeozones, geoTypeCounts, geozoneCaption, geozoneBounds } from '../utils/geozones'

function readStore(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value) } catch { /* private mode */ }
}
function loadOpts(key) {
  try { return normalizeGeoOptions(JSON.parse(readStore(key))) } catch { return normalizeGeoOptions(null) }
}

/**
 * The Live Map's geofence layer and its options (utils/geozones.js), the
 * heat map's pattern (hooks/useLiveHeat.js): on / off and the options are
 * remembered per user.
 *
 * @param {object}   p
 * @param {string}   p.userId
 * @param {object[]} p.geofences  Settings geofences
 * @param {object[]} p.alerts     Settings alert rules
 * @param {{settingsId, bgId, name}|null} p.vehicle  the selected vehicle, for "Vehicle rules"
 */
export function useGeozoneView({ userId, geofences, alerts, vehicle }) {
  const onKey = `fm.liveMap.geo.${userId}`
  const optKey = `fm.liveMap.geoOpts.${userId}`
  const [on, setOnState] = useState(() => readStore(onKey) === '1')
  const [opts, setOpts] = useState(() => loadOpts(optKey))
  // The session can name the user after the first render.
  const loadedFor = useRef(onKey)
  useEffect(() => {
    if (loadedFor.current === onKey) return
    loadedFor.current = onKey
    setOnState(readStore(onKey) === '1')
    setOpts(loadOpts(optKey))
  }, [onKey, optKey])

  const setOn = useCallback(value => {
    setOnState(value)
    writeStore(onKey, value ? '1' : '0')
  }, [onKey])
  const update = useCallback(patch => setOpts(prev => {
    const next = normalizeGeoOptions({ ...prev, ...patch })
    writeStore(optKey, JSON.stringify(next))
    return next
  }), [optKey])

  const settingsId = vehicle?.settingsId ?? null
  const bgId = vehicle?.bgId ?? null
  const ruleIds = useMemo(
    () => (vehicle ? ruleGeofenceIds(alerts, geofences, { settingsId, bgId }) : null),
    [alerts, geofences, settingsId, bgId] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const shown = useMemo(() => shownGeozones(geofences, opts, { ruleIds }), [geofences, opts, ruleIds])
  const typeCounts = useMemo(() => geoTypeCounts(geofences), [geofences])

  // "Zoom to shown": a counter, so asking twice zooms twice.
  const [fitTick, setFitTick] = useState(0)
  const requestFit = useCallback(() => setFitTick(n => n + 1), [])
  const bounds = useMemo(() => geozoneBounds(shown), [shown])

  return {
    on, setOn, opts, update,
    shown, total: (geofences ?? []).length, typeCounts, ruleIds,
    caption: geozoneCaption(shown.length, (geofences ?? []).length),
    bounds, fitTick, requestFit,
    vehicleName: vehicle ? vehicleLabel(vehicle) : null,
  }
}
