import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Circle, Polygon, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { splitPath, straightPath } from '../../utils/journeyGeo'
import { stopMark } from '../../data/journeys'

/**
 * A journey on the map, as in the prototype the client liked: the line driven
 * so far solid, the rest dashed, a pill per stop (done stops filled), and the
 * vehicle. Muted tiles come from .jms-theme (jms.css).
 *
 * Also the New Journey map: `onMapClick` adds a stop or a drawn point.
 */

const UAE_CENTER = [24.4, 54.6]

function FitTo({ points, fitKey, padding }) {
  const map = useMap()
  useEffect(() => {
    const pts = points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    if (pts.length === 1) map.setView(pts[0], 12)
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: padding?.[0] ?? [36, 36], paddingBottomRight: padding?.[1] ?? [36, 36], maxZoom: 14 })
    // Only when the journey (fitKey) changes, not on every live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey])
  return null
}

function Clicks({ onClick }) {
  useMapEvents({ click: e => onClick?.([e.latlng.lat, e.latlng.lng]) })
  return null
}

const stopIcon = (mark, name, done, showName) => L.divIcon({
  className: '',
  html: `<div style="display:flex;align-items:center;gap:4px;width:max-content;transform:translate(-13px,-13px)">
    <span class="j-maptag" data-s="${done ? 'done' : ''}" style="width:26px;height:26px;flex-shrink:0;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:50%">${mark}</span>
    ${showName ? `<span class="j-maptag" data-s="${done ? 'done' : ''}">${String(name).replace(/[<>&"]/g, '')}</span>` : ''}
  </div>`,
  iconSize: [0, 0],
})

const vehicleIcon = label => L.divIcon({
  className: '',
  html: `<div style="transform:translate(-17px,-17px);display:flex;align-items:center;gap:8px;width:max-content">
    <div class="j-vehicle-pin"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 9.38a1 1 0 0 0-.78-.38H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg></div>
    ${label ? `<span class="j-maptag" style="background:#f3f7f9;color:#13232b">${String(label).replace(/[<>&"]/g, '')}</span>` : ''}
  </div>`,
  iconSize: [0, 0],
})

export default function JourneyMap({
  path, stops = [], progressKm = 0, vehicle, onMapClick, height = 420, fitKey, showNames = true, showAreas = false, drawing, fitPadding,
}) {
  const line = useMemo(() => (Array.isArray(path) && path.length >= 2 ? path.map(p => [p[0], p[1]]) : straightPath(stops.filter(s => Number.isFinite(s.lat)))), [path, stops])
  const { done, todo } = useMemo(() => splitPath(line, progressKm || 0), [line, progressKm])
  const fitPoints = useMemo(() => [...line, ...stops.map(s => [s.lat, s.lng]), ...(vehicle ? [[vehicle.lat, vehicle.lng]] : [])], [line, stops, vehicle])

  return (
    <div style={{ height, borderRadius: 18, overflow: 'hidden', position: 'relative' }}>
      <MapContainer center={UAE_CENTER} zoom={8} style={{ height: '100%', width: '100%' }} scrollWheelZoom zoomControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitTo points={fitPoints} padding={fitPadding} fitKey={fitKey ?? JSON.stringify(stops.map(s => [s.lat, s.lng]).slice(0, 4)) + line.length} />
        {onMapClick && <Clicks onClick={onMapClick} />}
        {todo.length > 1 && <Polyline positions={todo} pathOptions={{ color: 'var(--j-text1)', weight: 3, opacity: 0.75, dashArray: '6 9' }} />}
        {done.length > 1 && <Polyline positions={done} pathOptions={{ color: 'var(--j-text1)', weight: 5, opacity: 0.95 }} />}
        {drawing?.length > 0 && drawing.map((p, i) => <Circle key={i} center={p} radius={40} pathOptions={{ color: 'var(--j-text1)', weight: 2, fillOpacity: 0.6 }} />)}
        {showAreas && stops.map((s, i) => (Array.isArray(s.polygon) && s.polygon.length >= 3
          ? <Polygon key={`a${i}`} positions={s.polygon.map(p => [p.lat, p.lng])} pathOptions={{ color: 'var(--j-text1)', weight: 1, fillOpacity: 0.08, dashArray: '3 4' }} />
          : Number.isFinite(s.lat) && <Circle key={`a${i}`} center={[s.lat, s.lng]} radius={s.radiusM || 300} pathOptions={{ color: 'var(--j-text1)', weight: 1, fillOpacity: 0.08, dashArray: '3 4' }} />))}
        {stops.map((s, i) => Number.isFinite(s.lat) && (
          <Marker
            key={`s${i}-${s.lat}-${s.lng}`}
            position={[s.lat, s.lng]}
            icon={stopIcon(stopMark(i, stops.length), s.name, ['DEPARTED', 'PASSED', 'ARRIVED'].includes(s.status), showNames)}
            interactive={false}
          />
        ))}
        {vehicle && Number.isFinite(vehicle.lat) && <Marker position={[vehicle.lat, vehicle.lng]} icon={vehicleIcon(vehicle.label)} interactive={false} zIndexOffset={1000} />}
      </MapContainer>
    </div>
  )
}
