import { Popup } from 'react-leaflet'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { useAddress } from '../../hooks/useAddress'
import { shortenAddress } from '../../utils/geocode'
import { headingLabel } from '../../utils/heading'

// The popup is styled here rather than through inline styles because the
// surface it sits on — the wrapper, the tip and the close button — belongs to
// Leaflet, and Leaflet paints all three white. Include once per map.
//
// autoPan is switched off on the Popup itself; Tracking's PopupFit does the
// panning, because Leaflet only guards the popup's own box and still lets the
// card overhang once the reverse-geocoded address grows it.
export const VEHICLE_POPUP_CSS = `
  .veh-popup .leaflet-popup-content-wrapper {
    background: var(--ft-navy);
    color: #f1f5f9;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.42);
    padding: 0;
  }
  .veh-popup .leaflet-popup-content {
    margin: 0;
    padding: 9px 11px 10px;
    font-size: 11.5px;
    line-height: 1.5;
  }
  .veh-popup .leaflet-popup-tip { background: var(--ft-navy); box-shadow: none; }
  .veh-popup a.leaflet-popup-close-button {
    color: rgba(255,255,255,0.45);
    top: 3px; right: 3px;
    width: 18px; height: 18px;
    font-size: 15px; line-height: 16px;
  }
  .veh-popup a.leaflet-popup-close-button:hover { color: #fff; background: none; }

  /* The address is the only field that can run long. Two lines places the
     vehicle; without the clamp a full Nominatim display_name turns the card
     into a column tall enough to cover the map. */
  .veh-popup-addr {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-weight: 600;
  }
  .veh-popup-replay {
    margin-top: 8px;
    width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 5px;
    background: var(--ft-accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .veh-popup-replay:hover { background: var(--ft-accent-hover); }
`

function fmtClock(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function Line({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
      <span style={{ color: 'rgba(241,245,249,0.5)', flexShrink: 0, minWidth: 46, fontSize: 10.5 }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap' }}>{children}</span>
    </div>
  )
}

/**
 * Marker popup contents — deliberately the same compact card as the replay
 * info tooltip, so a vehicle reads identically whether it is live or being
 * replayed.
 *
 * `open` gates the reverse-geocode. react-leaflet mounts popup children whether
 * or not the popup is showing, so without the gate every marker on the map
 * would fire a Nominatim lookup on page load.
 */
export default function VehiclePopup({ v, name, open, onReplay }) {
  const address = useAddress(v.lat, v.lng, open)
  const hasCoords = v.lat != null && v.lng != null

  return (
    <Popup className="veh-popup" maxWidth={260} minWidth={196} autoPan={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 238 }}>
        <div style={{
          fontWeight: 700, fontSize: 12.5, color: '#fff',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          paddingRight: 14,
        }}>
          {name}
        </div>
        <div style={{ color: statusColor(v.status), fontWeight: 700, marginBottom: 2, fontSize: 11 }}>
          ● {statusLabel(v.status)}
        </div>

        <Line label="Speed">{v.speed != null ? `${v.speed} km/h` : '—'}</Line>
        <Line label="Time">{fmtClock(v.lastTs)}</Line>
        <Line label="Heading">{headingLabel(v.heading)}</Line>

        {/* Full width rather than a label/value row: an address squeezed into
            the value column wraps to one word per line. */}
        <div style={{ marginTop: 2 }}>
          <span style={{ color: 'rgba(241,245,249,0.5)', fontSize: 10.5 }}>Address</span>
          <div className="veh-popup-addr" title={address ?? undefined}>
            {!hasCoords
              ? 'No position'
              : address
                ? shortenAddress(address)
                : `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`}
          </div>
        </div>

        {onReplay && (
          <button className="veh-popup-replay" onClick={() => onReplay(v)}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="6 4 20 12 6 20" />
            </svg>
            Replay Route
          </button>
        )}
      </div>
    </Popup>
  )
}
