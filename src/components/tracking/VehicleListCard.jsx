import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { useAddress } from '../../hooks/useAddress'

// The open/close animation uses grid-template-rows 0fr -> 1fr, which is the one
// way to transition to a content-determined height without measuring it or
// hard-coding a max-height that clips long cards.
export const LIST_CARD_CSS = `
  .vl-card {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .vl-card[data-open="true"] { grid-template-rows: 1fr; }
  .vl-card > .vl-card-inner { overflow: hidden; min-height: 0; }
`

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

// 0-360 -> the nearest compass point, which is far easier to read at a glance
// than a bare bearing.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
function headingLabel(deg) {
  if (!Number.isFinite(deg)) return '—'
  return `${Math.round(deg)}° ${COMPASS[Math.round(deg / 45) % 8]}`
}

function Cell({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
        textTransform: 'uppercase', color: 'var(--c-text3)',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11.5, fontWeight: 600, color: color || 'var(--c-text1)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

/**
 * The in-place expanded card shown under a vehicle's row in the list.
 *
 * Always mounted so it can animate both ways; `open` drives the transition and
 * also gates the reverse-geocode, so only the expanded vehicle looks up an
 * address.
 */
export default function VehicleListCard({ v, open, onReplay, onCenter }) {
  const address = useAddress(v.lat, v.lng, open)
  const hasCoords = v.lat != null && v.lng != null

  return (
    <div className="vl-card" data-open={open ? 'true' : 'false'}>
      {/* Collapsed cards are clipped to zero height but their buttons stay in
          the tab order and still answer hit-tests, so a keyboard user would
          land on nine invisible Replay buttons on the way down the list.
          `inert` takes the whole subtree out of play while it's closed. */}
      <div className="vl-card-inner" inert={!open}>
        <div style={{
          margin: '2px 10px 10px 17px',
          padding: '11px 12px',
          borderRadius: 10,
          border: '1px solid var(--c-border2)',
          backgroundColor: 'var(--c-card)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '9px 12px',
            marginBottom: 10,
          }}>
            <Cell label="Status"  value={statusLabel(v.status)} color={statusColor(v.status)} />
            <Cell label="Speed"   value={v.speed != null ? `${v.speed} km/h` : null} />
            <Cell label="Fleet No" value={v.master?.fleetNo || null} />
            <Cell label="Driver"  value={v.master?.driver?.name || 'Unassigned'} />
            <Cell label="Heading" value={headingLabel(v.heading)} />
            <Cell label="Last Update" value={fmt(v.lastTs)} />
          </div>

          <div style={{ marginBottom: 11 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: 'var(--c-text3)',
              display: 'block', marginBottom: 2,
            }}>
              Location
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text2)', lineHeight: 1.5 }}>
              {!hasCoords
                ? 'No position reported'
                : address ?? `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 7 }}>
            <button
              onClick={e => { e.stopPropagation(); onReplay(v) }}
              style={{
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: 8, padding: '8px 10px',
                fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="6 4 20 12 6 20" />
              </svg>
              Replay
            </button>
            <button
              onClick={e => { e.stopPropagation(); onCenter(v) }}
              disabled={!hasCoords}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: 'var(--c-hover)', color: 'var(--c-text2)',
                border: '1px solid var(--c-border)',
                borderRadius: 8, padding: '8px 12px',
                fontSize: 11.5, fontWeight: 700,
                cursor: hasCoords ? 'pointer' : 'default',
                opacity: hasCoords ? 1 : 0.5,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
              </svg>
              Center
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
