import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import HeatLayer from '../reports/HeatLayer'

/**
 * The Live Map's heat map layer: the cells hooks/useLiveHeat.js worked out,
 * drawn as the Heat Map report draws them — blue (little) to red (most).
 *
 * fitTick: each bump frames the map on the heat ("Zoom to heat" in the legend).
 */
export default function LiveHeatLayer({ points, fitTick = 0 }) {
  const map = useMap()
  const latest = useRef(points)
  useEffect(() => { latest.current = points }, [points])

  useEffect(() => {
    const pts = latest.current
    if (!fitTick || !pts?.length) return
    map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15 })
  }, [fitTick, map])

  return <HeatLayer points={points} />
}
