import { useEffect } from 'react'
import { Circle, Polygon, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'

// Names on the map: a small pill at the shape's middle, readable on any tile.
export const GEOZONE_LAYER_CSS = `
  .gz-name.leaflet-tooltip {
    background: color-mix(in srgb, var(--c-card) 88%, transparent);
    color: var(--c-text1);
    border: 1px solid var(--c-border2);
    border-radius: 6px;
    padding: 1px 6px;
    font-size: 10.5px;
    font-weight: 700;
    box-shadow: 0 1px 4px rgba(0,0,0,0.18);
    white-space: nowrap;
  }
  .gz-name.leaflet-tooltip::before { display: none; }
`

/** Zooms to the geofences shown when asked (`tick` is a counter). */
function GeozoneFit({ bounds, tick }) {
  const map = useMap()
  useEffect(() => {
    if (!tick || !bounds) return
    map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 16, animate: true })
  }, [tick]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/**
 * The geofences the options leave on (hooks/useGeozoneView.js), with their
 * names when asked. Hovering a shape still shows its name.
 */
export default function GeozoneLayer({ geo }) {
  if (!geo.on) return null
  return (
    <>
      <GeozoneFit bounds={geo.bounds} tick={geo.fitTick} />
      {geo.shown.map(g => {
        const pathOptions = { color: g.color || '#2563eb', weight: 2, fillOpacity: 0.12 }
        const name = g.name || 'Geofence'
        const label = geo.opts.labels
          // Leaflet centres a bound tooltip on the shape itself.
          ? <Tooltip permanent direction="center" className="gz-name">{name}</Tooltip>
          : <Tooltip sticky>{name}</Tooltip>
        if (g.shape === 'POLYGON' && Array.isArray(g.points) && g.points.length >= 3) {
          return (
            <Polygon key={`${g.id}-${geo.opts.labels}`} positions={g.points.map(p => [p.lat, p.lng])} pathOptions={pathOptions}>
              {label}
            </Polygon>
          )
        }
        if (g.shape === 'CIRCLE' && g.centerLat != null && g.centerLng != null && g.radius) {
          return (
            <Circle key={`${g.id}-${geo.opts.labels}`} center={[g.centerLat, g.centerLng]} radius={Number(g.radius)} pathOptions={pathOptions}>
              {label}
            </Circle>
          )
        }
        return null
      })}
    </>
  )
}
