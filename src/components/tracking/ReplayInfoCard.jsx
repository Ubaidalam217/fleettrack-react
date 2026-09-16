import { Tooltip } from 'react-leaflet'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { useSettledAddress } from '../../hooks/useAddress'
import { shortenAddress } from '../../utils/geocode'
import { REPLAY_FIELDS } from './replayFields'

// A permanent tooltip rather than a popup: it follows the marker for free as
// the track plays, needs no click to open, and never steals focus.
export const REPLAY_INFO_CSS = `
  .replay-info-tip.leaflet-tooltip {
    background: rgba(17, 24, 39, 0.92);
    border: none;
    border-radius: 9px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    color: #f9fafb;
    padding: 8px 11px;
    font-size: 11.5px;
    line-height: 1.55;
    white-space: normal;
    width: 236px;
  }
  /* The address is the only field that can run long. Two lines is enough to
     place the vehicle; without the clamp a full Nominatim display_name turns
     the card into a column tall enough to cover the map. */
  .replay-info-addr {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .replay-info-tip.leaflet-tooltip-right::before { border-right-color: rgba(17, 24, 39, 0.92); }
  .replay-info-tip.leaflet-tooltip-left::before  { border-left-color:  rgba(17, 24, 39, 0.92); }
`

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
function headingLabel(deg) {
  if (!Number.isFinite(deg)) return '—'
  return `${Math.round(deg)}° ${COMPASS[Math.round(deg / 45) % 8]}`
}

function fmtClock(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function Line({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
      <span style={{ color: 'rgba(249,250,251,0.55)', flexShrink: 0, minWidth: 50, fontSize: 10.5 }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap' }}>{children}</span>
    </div>
  )
}

/**
 * The card that rides alongside the replay marker.
 *
 * The address is looked up only once the point has stopped moving for a beat —
 * at 10x the point advances ~25 times a second, and geocoding each one would
 * both be unreadable and breach Nominatim's ~1 request/second policy.
 */
export default function ReplayInfoCard({ point, fields }) {
  const wantAddress = !!fields.address
  const address = useSettledAddress(point.lat, point.lng, wantAddress)

  const anyOn = REPLAY_FIELDS.some(f => fields[f.key])
  if (!anyOn) return null

  return (
    <Tooltip permanent direction="right" offset={[0, 0]} className="replay-info-tip">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.status && (
          <div style={{ color: statusColor(point.status), fontWeight: 700, marginBottom: 1 }}>
            ● {statusLabel(point.status)}
          </div>
        )}
        {fields.speed     && <Line label="Speed">{point.speed ?? 0} km/h</Line>}
        {fields.timestamp && <Line label="Time">{fmtClock(point.ts)}</Line>}
        {fields.heading   && <Line label="Heading">{headingLabel(point.heading)}</Line>}
        {fields.address   && (
          // Full width rather than a label/value row: an address squeezed into
          // the value column wraps to one word per line.
          <div style={{ marginTop: 2 }}>
            <span style={{ color: 'rgba(249,250,251,0.55)', fontSize: 10.5 }}>Address</span>
            <div className="replay-info-addr" style={{ fontWeight: 600 }} title={address ?? undefined}>
              {address
                ? shortenAddress(address)
                : `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}
            </div>
          </div>
        )}
      </div>
    </Tooltip>
  )
}
