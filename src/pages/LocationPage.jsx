import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ExternalLink, MapPin } from 'lucide-react'

/**
 * Public "one point on the map" page — where a location link in an exported
 * report lands (utils/mapLink.js). No sign-in: the page shows only what its own
 * link already carries (coordinates, and optionally vehicle, time and address).
 */

const pinIcon = L.divIcon({
  className: '',
  iconSize: [38, 38],
  iconAnchor: [19, 38],
  html: `<svg width="38" height="38" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">
    <path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" fill="#ef4444" stroke="#fff" stroke-width="1.6"/>
    <circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>`,
})

const num = v => {
  const n = Number(v)
  return v !== null && v !== '' && Number.isFinite(n) ? n : null
}

export default function LocationPage() {
  const [params] = useSearchParams()
  const lat = num(params.get('lat'))
  const lng = num(params.get('lng'))
  const valid = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  const vehicle = params.get('v')
  const time = params.get('t')
  const address = params.get('a')

  useEffect(() => {
    document.title = vehicle ? `${vehicle} — Location · FleetmaxX` : 'Location · FleetmaxX'
  }, [vehicle])

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--c-page)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px',
        background: 'var(--c-sb-bg)', color: '#fff', flexWrap: 'wrap',
      }}>
        <img className="ft-logo-light" src="/logo/fleetmax-logo-sea-white.png" alt="FleetmaxX" style={{ height: 30, width: 'auto' }} />
        <img className="ft-logo-dark" src="/logo/fleetmax-logo-aqua-white.png" alt="FleetmaxX" style={{ height: 30, width: 'auto' }} />
        <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <MapPin size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--c-sb-active-text)' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {vehicle || 'Location'}{time ? <span style={{ fontWeight: 500, opacity: 0.75 }}> · {time}</span> : null}
            </div>
            {address && <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2, wordBreak: 'break-word' }}>{address}</div>}
          </div>
        </div>
        {valid && (
          <a
            href={`https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)' }}
          >
            Open in Google Maps <ExternalLink size={13} />
          </a>
        )}
      </header>

      {valid ? (
        <>
          <div style={{ flex: 1, minHeight: 0 }}>
            <MapContainer center={[lat, lng]} zoom={16} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={[lat, lng]} icon={pinIcon} />
            </MapContainer>
          </div>
          <footer style={{ padding: '7px 16px', fontSize: 12, color: 'var(--c-text3)', fontFamily: 'ui-monospace, Consolas, monospace', borderTop: '1px solid var(--c-border)', background: 'var(--c-card)' }}>
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </footer>
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text3)', fontSize: 14, padding: 24, textAlign: 'center' }}>
          This link does not contain a valid location.
        </div>
      )}
    </div>
  )
}
