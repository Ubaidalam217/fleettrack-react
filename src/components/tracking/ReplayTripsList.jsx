import { useId, useRef } from 'react'
import { fmtDuration, tripTotals, localDay } from '../../utils/replayTrips'
import { shortenAddress } from '../../utils/geocode'
import { placeOf } from '../../hooks/useTripPlaces'

// Hover, keyboard focus and the selected row can't be inline styles.
const CSS = `
  .rp-trips-toggle:focus-visible,
  .rp-trip-row:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: -2px; }
  .rp-trip-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) 46px 60px 58px;
    align-items: center;
    column-gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--c-text1);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s;
  }
  .rp-trip-row:hover { background: var(--c-hover); }
  .rp-trip-row[aria-current="true"] {
    background: color-mix(in srgb, var(--ft-accent) 13%, transparent);
    box-shadow: inset 3px 0 0 var(--ft-accent);
  }
  .rp-trip-row[aria-current="true"] .rp-trip-no { color: var(--ft-accent); }
  .rp-trip-no { font-weight: 800; color: var(--c-text3); text-align: center; font-variant-numeric: tabular-nums; }
  .rp-trip-main { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
  .rp-trip-time { font-weight: 600; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rp-trip-place { font-size: 10px; color: var(--c-text3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rp-trip-num { font-size: 10.5px; color: var(--c-text2); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rp-trip-head {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) 46px 60px 58px;
    column-gap: 8px;
    padding: 0 8px 3px;
    font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
    color: var(--c-text3);
  }
  .rp-trip-head > span:nth-child(n+3) { text-align: right; }
  @media (max-width: 480px) {
    .rp-trip-row, .rp-trip-head { grid-template-columns: 20px minmax(0, 1fr) 42px 54px; }
    .rp-trip-row > :nth-child(5), .rp-trip-head > :nth-child(5) { display: none; }
  }
`

const pad = n => String(n).padStart(2, '0')

/** "08:02", or "10/11 08:02" when the loaded range spans more than one day. */
function clock(ts, withDate) {
  const d = new Date(ts * 1000)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withDate ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hm}` : hm
}

function span(fromTs, toTs, multiDay) {
  const sameDay = localDay(fromTs) === localDay(toTs)
  return `${clock(fromTs, multiDay)} → ${clock(toTs, multiDay && !sameDay)}`
}

const shortPlace = (places, lat, lng) => {
  const p = placeOf(places, lat, lng)
  return p ? shortenAddress(p, 2) : null
}

/**
 * The "Trips (N)" section of the replay dock: every trip in the loaded range,
 * plus a "whole range" row. Picking a row plays only that trip — the selection
 * itself lives in Tracking.jsx, which owns the map; this only lists and reports.
 */
export default function ReplayTripsList({
  trips, selectedNo, zeroCount = 0, showZero = false, onToggleZero,
  allPoints, places, open, onToggle, onSelect,
}) {
  const listId = useId()
  const listRef = useRef(null)

  const first = allPoints[0]?.ts
  const last = allPoints[allPoints.length - 1]?.ts
  const multiDay = first != null && last != null && localDay(first) !== localDay(last)
  const totals = tripTotals(trips)

  // Up/Down walk the rows, so a keyboard user is not tabbing through 40 trips.
  const onKeyDown = e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...(listRef.current?.querySelectorAll('.rp-trip-row') ?? [])]
    const i = rows.indexOf(document.activeElement)
    if (i < 0) return
    e.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <style>{CSS}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="rp-trips-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={listId}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            background: 'none', border: 'none', padding: '2px 4px 2px 0', borderRadius: 5,
            fontSize: 11, fontWeight: 700, color: 'var(--c-text1)', cursor: 'pointer',
          }}
        >
          <svg
            width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
          Trips ({trips.length})
        </button>
        {trips.length > 0 && (
          <span style={{
            flex: 1, minWidth: 0, fontSize: 10.5, color: 'var(--c-text3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {totals.distanceKm.toFixed(1)} km · {fmtDuration(totals.durationSec)} in trips
          </span>
        )}
        {selectedNo != null && (
          <button
            className="rp-trips-toggle"
            onClick={() => onSelect(null)}
            style={{
              marginLeft: 'auto', flexShrink: 0, background: 'none', border: 'none', padding: '2px 4px', borderRadius: 5,
              fontSize: 10.5, fontWeight: 700, color: 'var(--ft-accent)', cursor: 'pointer',
            }}
          >
            Show whole range
          </button>
        )}
      </div>

      {open && (
        <div id={listId}>
          {trips.length === 0 ? (
            <div style={{ fontSize: 10.5, color: 'var(--c-text3)', padding: '2px 0 4px' }}>
              {zeroCount > 0 && !showZero
                ? 'No trips over 0 km in this range.'
                : 'No trips in this range — the ignition never came on.'}
            </div>
          ) : (
            <div
              ref={listRef}
              onKeyDown={onKeyDown}
              style={{
                // Shorter when the map is short (the detail sheet open), so the
                // dock's title row, Export and Share stay on the map.
                maxHeight: 'clamp(44px, calc(100cqh - 250px), 150px)', overflowY: 'auto', overscrollBehavior: 'contain',
                borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-input)',
                padding: '5px 3px',
              }}
            >
              <div className="rp-trip-head" aria-hidden="true">
                <span>#</span><span>Time</span><span>Length</span><span>Distance</span><span>Max</span>
              </div>
              <ul role="list" aria-label="Trips in the loaded range" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                <li>
                  <button
                    className="rp-trip-row"
                    aria-current={selectedNo == null ? 'true' : undefined}
                    onClick={() => onSelect(null)}
                    title="Play the whole loaded range"
                  >
                    <span className="rp-trip-no" aria-hidden="true">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ verticalAlign: '-1px' }}>
                        <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
                      </svg>
                    </span>
                    <span className="rp-trip-main">
                      <span className="rp-trip-time">Whole range</span>
                      {first != null && last != null && (
                        <span className="rp-trip-place">{span(first, last, multiDay)} · {trips.length} trip{trips.length === 1 ? '' : 's'}</span>
                      )}
                    </span>
                    <span className="rp-trip-num">{fmtDuration(totals.durationSec)}</span>
                    <span className="rp-trip-num">{totals.distanceKm.toFixed(1)} km</span>
                    <span className="rp-trip-num">{Math.round(totals.maxSpeed)} km/h</span>
                  </button>
                </li>
                {trips.map(t => {
                  const from = shortPlace(places, t.startLat, t.startLng)
                  const to = shortPlace(places, t.endLat, t.endLng)
                  const where = from || to ? `${from ?? '…'} → ${to ?? '…'}` : null
                  return (
                    <li key={t.startTs}>
                      <button
                        className="rp-trip-row"
                        aria-current={selectedNo === t.no ? 'true' : undefined}
                        aria-label={`Trip ${t.no}, ${span(t.startTs, t.endTs, multiDay)}, ${fmtDuration(t.durationSec)}, ${t.distanceKm.toFixed(1)} kilometres, max ${Math.round(t.maxSpeed)} km/h`}
                        onClick={() => onSelect(t)}
                        title={where ? `${where}\n${t.pointCount} points` : `${t.pointCount} points`}
                      >
                        <span className="rp-trip-no">{t.no}</span>
                        <span className="rp-trip-main">
                          <span className="rp-trip-time">
                            {span(t.startTs, t.endTs, multiDay)}
                            {t.open && (
                              <span style={{ fontWeight: 600, color: '#d97706' }} title="The ignition was still on when the range ended"> · still on</span>
                            )}
                          </span>
                          {where && <span className="rp-trip-place">{where}</span>}
                        </span>
                        <span className="rp-trip-num">{fmtDuration(t.durationSec)}</span>
                        <span className="rp-trip-num">{t.distanceKm.toFixed(1)} km</span>
                        <span className="rp-trip-num">{Math.round(t.maxSpeed)} km/h</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* The Trip Report hides 0 km trips by default; so does this list. */}
          {zeroCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px 0', fontSize: 10.5, color: 'var(--c-text3)' }}>
              <span>
                {showZero
                  ? `Showing ${zeroCount} trip${zeroCount === 1 ? '' : 's'} of 0 km`
                  : `${zeroCount} trip${zeroCount === 1 ? '' : 's'} of 0 km hidden`}
              </span>
              <button
                className="rp-trips-toggle"
                onClick={onToggleZero}
                aria-pressed={showZero}
                style={{
                  background: 'none', border: 'none', padding: '1px 3px', borderRadius: 5,
                  fontSize: 10.5, fontWeight: 700, color: 'var(--ft-accent)', cursor: 'pointer',
                }}
              >
                {showZero ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
