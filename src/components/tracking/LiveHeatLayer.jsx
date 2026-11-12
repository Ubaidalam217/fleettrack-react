import { useEffect, useMemo, useState } from 'react'
import HeatLayer from '../reports/HeatLayer'
import { fetchTodayMessages } from '../../utils/todayMessages'
import { presenceCells } from '../../utils/heatmap'

/**
 * The Live Map's "Heat map" toggle (client, 2026-11-12): where the vehicles in
 * the list have been today, as the Heat Map report draws it — engine-on time
 * per place, blue (little) to red (most).
 *
 * Reads the shared today messages (utils/todayMessages.js — one fleet-wide read,
 * cached five minutes), so turning it on adds no Flespi request of its own
 * beyond that, and re-reads only when the cache runs out.
 */
const REFRESH_MS = 5 * 60 * 1000

export default function LiveHeatLayer({ ids, onStatus }) {
  const key = [...ids].sort((a, b) => a - b).join(',')
  const [byVehicle, setByVehicle] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!key) { setByVehicle(new Map()); return }
    let live = true
    onStatus?.('loading')
    fetchTodayMessages(key.split(',').map(Number))
      .then(byDevice => {
        if (!live) return
        setByVehicle(new Map([...byDevice].map(([id, e]) => [id, e.messages ?? []])))
        onStatus?.('ready')
      })
      .catch(() => { if (live) onStatus?.('error') })
    return () => { live = false }
  // onStatus is a state setter from the page; tick re-reads after the cache expires.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  const points = useMemo(() => {
    if (!byVehicle) return []
    return presenceCells(byVehicle, { mode: 'engine' }).cells.map(c => ({ lat: c.lat, lng: c.lng, weight: c.weight }))
  }, [byVehicle])

  return <HeatLayer points={points} />
}
