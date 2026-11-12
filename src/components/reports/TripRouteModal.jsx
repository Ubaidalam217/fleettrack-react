import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { X, Route } from 'lucide-react'

/**
 * One trip of a trip report on FleetmaxX's own map, opened from the row's Map
 * link (client, 2026-11-12: "draw the trip from start to end, so we can see
 * where it began and ended"). A green START pin, a red END pin and the route
 * between them as a glowing line — a wide translucent stroke under a narrow
 * bright one, like the client's sample image.
 *
 * The route comes from the messages the report already loaded; nothing is
 * fetched here.
 */

const pin = (fill, label) => L.divIcon({
  className: '',
  iconSize: [34, 44],
  iconAnchor: [17, 34],
  html: `<div style="display:flex;flex-direction:column;align-items:center">
    <svg width="34" height="34" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">
      <path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" fill="${fill}" stroke="#fff" stroke-width="1.6"/>
      <circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>
    <span style="margin-top:-2px;padding:1px 6px;border-radius:6px;background:${fill};color:#fff;font:700 9.5px/1.4 Inter,system-ui,sans-serif;letter-spacing:.04em;white-space:nowrap">${label}</span>
  </div>`,
})
const startIcon = pin('#16a34a', 'START')
const endIcon = pin('#dc2626', 'END')

/** Fits the map to the route once it is drawn. */
function FitRoute({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17 })
    else if (points.length === 1) map.setView(points[0], 16)
  }, [map, points])
  return null
}

const when = ts => new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * @param {{ trip: null | { vehicle, driver, startTs, endTs, distance, points: [lat, lng][] }, onClose }} props
 */
export default function TripRouteModal({ trip, onClose }) {
  useEffect(() => {
    if (!trip) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [trip, onClose])

  if (!trip) return null
  const { points } = trip
  const dark = document.documentElement.classList.contains('dark')
  // Bright green on the dark theme's glow, a deeper green on the light tiles.
  const core = dark ? '#4ade80' : '#16a34a'
  const glow = dark ? '#22c55e' : '#4ade80'

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Trip on the map"
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(980px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'var(--c-card)', border: '1px solid var(--c-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
            <Route size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--c-text1)' }}>
              {trip.vehicle}{trip.driver && trip.driver !== '—' ? ` · ${trip.driver}` : ''}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12.5, color: 'var(--c-text2)', marginTop: 4 }}>
              <span><strong style={{ color: '#16a34a' }}>Start</strong> {when(trip.startTs)}</span>
              <span><strong style={{ color: '#dc2626' }}>End</strong> {when(trip.endTs)}</span>
              <span><strong style={{ color: 'var(--c-text1)' }}>Distance</strong> {trip.distance} km</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)"
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ height: 'min(520px, 64vh)', position: 'relative' }}>
          {points.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--c-text3)' }}>
              No recorded positions for this trip.
            </div>
          ) : (
            <MapContainer center={points[0]} zoom={14} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {points.length > 1 && <>
                <Polyline positions={points} pathOptions={{ color: glow, weight: 14, opacity: 0.22, lineCap: 'round', lineJoin: 'round' }} />
                <Polyline positions={points} pathOptions={{ color: glow, weight: 8, opacity: 0.35, lineCap: 'round', lineJoin: 'round' }} />
                <Polyline positions={points} pathOptions={{ color: core, weight: 3.5, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
              </>}
              <Marker position={points[0]} icon={startIcon}>
                <Tooltip direction="top" offset={[0, -30]}>Start · {when(trip.startTs)}</Tooltip>
              </Marker>
              <Marker position={points[points.length - 1]} icon={endIcon}>
                <Tooltip direction="top" offset={[0, -30]}>End · {when(trip.endTs)}</Tooltip>
              </Marker>
              <FitRoute points={points} />
            </MapContainer>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
