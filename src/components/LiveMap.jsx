import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'

// Forces Leaflet to recalculate its container size after mount.
// Needed when the map initializes inside a CSS display:none parent (lg:hidden / hidden lg:block).
function MapResizer() {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 150)
    return () => clearTimeout(t)
  }, [map])
  return null
}
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ── Custom div-icon markers (no image imports needed) ─────────────────────
function makeIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:22px;height:22px;
      background:${color};
      border-radius:50%;
      border:3px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.30);
      display:flex;align-items:center;justify-content:center;
    ">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
        <path d="M20 8H4L2 14h20L20 8z"/>
        <circle cx="7" cy="18" r="2"/>
        <circle cx="17" cy="18" r="2"/>
      </svg>
    </div>`,
    iconSize:   [22, 22],
    iconAnchor: [11, 11],
    popupAnchor:[0, -14],
  })
}

const STATUS_COLOR = {
  Running:  '#22c55e',
  Idle:     '#f59e0b',
  Stopped:  '#ef4444',
  Inactive: '#6b7280',
  NoData:   '#94a3b8',
}

// Default center (Karachi) shown before any vehicle data arrives
const DEFAULT_CENTER = [24.8607, 67.0099]

// Auto-fit bounds whenever the set of positioned vehicles changes
function AutoFit({ positions }) {
  const map     = useMap()
  const fittedRef = useRef(false)

  useEffect(() => {
    if (!positions || positions.length === 0) return
    fittedRef.current = true
    if (positions.length === 1) {
      map.setView(positions[0], 13)
    } else {
      map.fitBounds(L.latLngBounds(positions), { padding: [32, 32], maxZoom: 14 })
    }
  }, [positions.join(','), map])   // stable string key avoids re-fit on every render

  return null
}

export default function LiveMap({ fleetData, loading }) {
  const located = (fleetData?.vehicles ?? []).filter(v => v.lat != null && v.lng != null)
  const positions = located.map(v => [v.lat, v.lng])
  const showEmpty = !loading && located.length === 0

  return (
    <div className="rounded-xl p-3 md:p-5" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border2)' }}>

      {/* Header */}
      <div className="flex items-start justify-between mb-3 md:mb-4">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>Live Fleet Map</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text3)' }}>
            {located.length > 0
              ? `${located.length} of ${fleetData?.total ?? 0} vehicles positioned`
              : `${fleetData?.total ?? 0} vehicles tracked live`}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full px-2 py-0.5"
          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 live-blink" />
          <span className="text-[10px] font-bold text-emerald-500">LIVE</span>
        </div>
      </div>

      {/* Map — no pointer-events override, no blocking overlay */}
      <div style={{ height: 260, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--c-border2)', position: 'relative' }}>
        {showEmpty && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <span style={{
              background: 'var(--c-card)', border: '1px solid var(--c-border2)',
              borderRadius: 8, padding: '6px 14px', fontSize: 12,
              color: 'var(--c-text3)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}>
              {fleetData?.total > 0 ? 'No vehicles positioned yet' : 'No vehicles reporting'}
            </span>
          </div>
        )}
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={10}
          scrollWheelZoom={true}
          zoomControl={true}
          dragging={true}
          doubleClickZoom={true}
          touchZoom={true}
          keyboard={true}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapResizer />
          {positions.length > 0 && <AutoFit positions={positions} />}

          {located.map(v => (
            <Marker
              key={v.id}
              position={[v.lat, v.lng]}
              icon={makeIcon(STATUS_COLOR[v.status] ?? '#94a3b8')}
            >
              <Popup>
                <div style={{ fontSize: 12, lineHeight: 1.6, minWidth: 130 }}>
                  <strong style={{ fontSize: 13 }}>{v.name}</strong><br />
                  <span style={{ color: STATUS_COLOR[v.status] ?? '#94a3b8' }}>● {v.status}</span>
                  {v.speed != null && <><br />Speed: <strong>{v.speed} km/h</strong></>}
                  {v.ident       && <><br />IMEI: <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.ident}</span></>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3">
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--c-text3)' }}>
          <span className="h-2 w-2 rounded-full bg-emerald-500" />Moving ({fleetData?.running ?? 0})
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--c-text3)' }}>
          <span className="h-2 w-2 rounded-full bg-amber-400" />Idle ({fleetData?.idle ?? 0})
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--c-text3)' }}>
          <span className="h-2 w-2 rounded-full bg-red-500" />Stopped ({fleetData?.stopped ?? 0})
        </span>
      </div>
    </div>
  )
}
