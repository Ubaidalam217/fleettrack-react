import { Popup } from 'react-leaflet'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { useAddress } from '../../hooks/useAddress'

function fmt(ts) {
  if (!ts) return 'N/A'
  return new Date(ts * 1000).toLocaleString()
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ color: '#6b7280', flexShrink: 0, minWidth: 74 }}>{label}</span>
      <span style={{ color: color || '#1f2937', fontWeight: 600, minWidth: 0 }}>{value}</span>
    </div>
  )
}

/**
 * Marker popup contents. Leaflet popups render on a fixed white surface, so the
 * colours here are literals rather than theme variables.
 *
 * `open` gates the reverse-geocode. react-leaflet mounts popup children whether
 * or not the popup is showing, so without the gate every marker on the map
 * would fire a Nominatim lookup on page load.
 */
export default function VehiclePopup({ v, name, open, onReplay }) {
  const address = useAddress(v.lat, v.lng, open)
  const hasCoords = v.lat != null && v.lng != null

  return (
    <Popup>
      <div style={{ fontSize: 12.5, lineHeight: 1.75, minWidth: 218 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, color: '#111827' }}>
          {name}
        </div>
        <div style={{ color: statusColor(v.status), fontWeight: 700, marginBottom: 6 }}>
          ● {statusLabel(v.status)}
        </div>

        {v.master?.fleetNo && <Row label="Fleet No" value={v.master.fleetNo} />}
        <Row label="Driver"  value={v.master?.driver?.name || 'Unassigned'} />
        <Row label="Speed"   value={v.speed != null ? `${v.speed} km/h` : 'N/A'} />
        <Row label="Last Updated" value={fmt(v.lastTs)} />
        <Row
          label="Location"
          value={
            !hasCoords ? 'No position'
              : address ?? `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`
          }
        />

        {onReplay && (
          <button
            onClick={() => onReplay(v)}
            style={{
              marginTop: 9, width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: '#3b82f6', color: '#fff', border: 'none',
              borderRadius: 7, padding: '7px 10px',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="6 4 20 12 6 20" />
            </svg>
            Replay Route
          </button>
        )}
      </div>
    </Popup>
  )
}
