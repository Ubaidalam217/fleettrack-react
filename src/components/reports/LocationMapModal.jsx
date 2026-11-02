import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { X, ExternalLink, MapPin } from 'lucide-react'

/**
 * A Movement Report location on FleetmaxX's own map (the same OpenStreetMap the
 * Live Map uses), opened from the report's Location column.
 *
 * Client, 2026-11-02: a location click must show the place on OUR map first,
 * not jump to another site. Google Maps is still offered, as a secondary link,
 * for directions.
 */

const pinIcon = L.divIcon({
  className: '',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  html: `<svg width="34" height="34" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">
    <path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" fill="#ef4444" stroke="#fff" stroke-width="1.6"/>
    <circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>`,
})

export default function LocationMapModal({ point, onClose }) {
  // Esc closes, like every other dialog in the app.
  useEffect(() => {
    if (!point) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [point, onClose])

  if (!point) return null
  const { lat, lng } = point
  const when = point.ts ? new Date(point.ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : point.time

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Location on the map"
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(860px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'var(--c-card)', border: '1px solid var(--c-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
            <MapPin size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--c-text1)' }}>
              {point.vehicleId}{point.status ? ` · ${point.status}` : ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>{when}</div>
            <div style={{ fontSize: 13, color: 'var(--c-text2)', marginTop: 4, wordBreak: 'break-word' }}>{point.location}</div>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)"
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ height: 'min(460px, 60vh)' }}>
          <MapContainer key={`${lat},${lng}`} center={[lat, lng]} zoom={16} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[lat, lng]} icon={pinIcon} />
          </MapContainer>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--c-border)' }}>
          <span style={{ fontSize: 12, color: 'var(--c-text3)', fontFamily: 'ui-monospace, Consolas, monospace' }}>{lat.toFixed(5)}, {lng.toFixed(5)}</span>
          <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--c-text2)', textDecoration: 'none' }}>
            Open in Google Maps <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>,
    document.body,
  )
}
