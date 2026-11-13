import { useEffect, useRef, useState } from 'react'
import { fmtDuration, localDay } from '../../utils/replayTrips'
import { eventBadges, eventSummary } from '../../utils/replayEvents'
import { shortenAddress } from '../../utils/geocode'
import { placeOf } from '../../hooks/useTripPlaces'

// Hover, keyboard focus and the selected card can't be inline styles.
const CSS = `
  .rp-trip { border-bottom: 1px solid var(--c-border); }
  .rp-trip[data-selected="true"] {
    background: color-mix(in srgb, var(--ft-accent) 9%, var(--c-card));
    box-shadow: inset 3px 0 0 var(--ft-accent);
  }
  .rp-trip-btn {
    display: block; width: 100%; padding: 10px 14px 9px; border: none; background: transparent;
    color: var(--c-text1); font-size: 12px; text-align: left; cursor: pointer; transition: background 0.12s;
  }
  .rp-trip:not([data-selected="true"]) .rp-trip-btn:hover { background: var(--c-hover); }
  .rp-trip-btn:focus-visible, .rp-ev:focus-visible, .rp-link:focus-visible {
    outline: 2px solid var(--ft-accent); outline-offset: -2px;
  }
  .rp-trip-tt {
    display: flex; justify-content: space-between; gap: 8px;
    font-weight: 800; font-size: 12.5px; font-variant-numeric: tabular-nums;
  }
  .rp-trip-tt > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rp-trip-tt > span:last-child { flex-shrink: 0; }
  .rp-trip-addr { color: var(--c-text2); margin-top: 2px; line-height: 1.35; font-size: 11.5px; }
  .rp-trip-meta { display: flex; flex-wrap: wrap; gap: 3px 10px; margin-top: 4px; color: var(--c-text2); font-size: 11.5px; }
  .rp-trip-meta b { color: var(--c-text1); }
  .rp-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .rp-badge { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; color: #fff; font-weight: 700; }
  .rp-evlist {
    margin: -2px 14px 10px 14px; padding-left: 8px;
    border-left: 2px solid color-mix(in srgb, var(--ft-accent) 30%, transparent);
    list-style: none;
  }
  .rp-ev {
    display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 4px; border: none; border-radius: 5px;
    background: transparent; color: var(--c-text1); font-size: 11.5px; text-align: left; cursor: pointer;
  }
  .rp-ev:hover { background: var(--c-hover); }
  .rp-ev[aria-current="true"] { font-weight: 700; }
  .rp-ev-t { color: var(--c-text2); width: 46px; flex-shrink: 0; font-variant-numeric: tabular-nums; font-weight: 500; }
  .rp-ev-s { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rp-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
  .rp-link {
    background: none; border: none; padding: 1px 3px; border-radius: 5px;
    font-size: 11px; font-weight: 700; color: var(--ft-accent); cursor: pointer;
  }
  .rp-empty { padding: 14px; font-size: 11.5px; color: var(--c-text3); line-height: 1.5; }
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

function Badges({ events }) {
  const badges = eventBadges(events)
  if (!badges.length) return null
  return (
    <div className="rp-badges">
      {badges.map(b => (
        <span key={b.key} className="rp-badge" style={{ background: b.color, color: b.key === 'idle' ? '#4a3c00' : '#fff' }}>
          {b.text}
        </span>
      ))}
    </div>
  )
}

function EventList({ events, activeEventId, onEventClick, multiDay, label }) {
  if (!events.length) return null
  return (
    <ul className="rp-evlist" aria-label={label}>
      {events.map(e => (
        <li key={e.id}>
          <button
            className="rp-ev"
            aria-current={activeEventId === e.id ? 'true' : undefined}
            onClick={() => onEventClick(e)}
            title="Show on the map"
          >
            <span className="rp-ev-t">{clock(e.fromTs, multiDay)}</span>
            <span className="rp-dot" style={{ background: e.color }} aria-hidden="true" />
            <span className="rp-ev-s">{eventSummary(e)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * The replay panel's trip cards (approved replay "Option C"): every trip in
 * the loaded range, "n · 07:35 → 09:01", its distance and from → to. The trip
 * playing opens to its driver, top speed, length and its events; the others
 * show a coloured badge per kind of event. Picking a card plays that trip —
 * the selection itself lives in Tracking.jsx, which owns the map.
 */
export default function ReplayTripsList({
  trips, selectedTrip, byTrip, outside, places, driverOf, multiDay,
  activeEventId, onSelectTrip, onEventClick,
  zeroCount = 0, showZero = false, onToggleZero,
}) {
  const listRef = useRef(null)
  const [outsideOpen, setOutsideOpen] = useState(false)

  // A trip picked from the map or the timeline may be far down the list.
  const selectedStart = selectedTrip?.startTs
  useEffect(() => {
    if (selectedStart == null) return
    listRef.current?.querySelector('.rp-trip[data-selected="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedStart])

  // Up/Down walk the cards, so a keyboard user is not tabbing through 40 trips.
  const onKeyDown = e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...(listRef.current?.querySelectorAll('.rp-trip-btn') ?? [])]
    const i = rows.indexOf(document.activeElement)
    if (i < 0) return
    e.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  return (
    <div ref={listRef} onKeyDown={onKeyDown}>
      <style>{CSS}</style>

      {trips.length === 0 && (
        <div className="rp-empty">
          {zeroCount > 0 && !showZero
            ? 'No trips over 0 km in this range.'
            : 'No trips in this range — the ignition never came on.'}
        </div>
      )}

      <ul role="list" aria-label="Trips in the loaded range" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {trips.map(t => {
          const selected = selectedTrip?.startTs === t.startTs
          const events = byTrip.get(t.startTs) ?? []
          const from = shortPlace(places, t.startLat, t.startLng)
          const to = shortPlace(places, t.endLat, t.endLng)
          const where = from || to ? `${from ?? '…'} → ${to ?? '…'}` : null
          const driver = selected ? driverOf(t.startTs) : null
          return (
            <li key={t.startTs} className="rp-trip" data-selected={selected ? 'true' : 'false'}>
              <button
                className="rp-trip-btn"
                aria-current={selected ? 'true' : undefined}
                aria-label={`Trip ${t.no}, ${span(t.startTs, t.endTs, multiDay)}, ${t.distanceKm.toFixed(1)} kilometres${where ? `, ${where}` : ''}${events.length ? `, ${events.length} events` : ''}`}
                onClick={() => onSelectTrip(t)}
                title={selected ? 'Play this trip again from its start' : 'Play this trip'}
              >
                <div className="rp-trip-tt">
                  <span>
                    {t.no} · {span(t.startTs, t.endTs, multiDay)}
                    {t.open && (
                      <span style={{ fontWeight: 600, color: '#d97706' }} title="The ignition was still on when the range ended"> · still on</span>
                    )}
                  </span>
                  <span>{t.distanceKm.toFixed(1)} km</span>
                </div>
                {where && <div className="rp-trip-addr">{where}</div>}
                {selected ? (
                  <div className="rp-trip-meta">
                    <span>Driver <b>{driver ?? '—'}</b></span>
                    <span>Max <b>{Math.round(t.maxSpeed)} km/h</b></span>
                    <span>{fmtDuration(t.durationSec)}</span>
                  </div>
                ) : (
                  <Badges events={events} />
                )}
              </button>
              {selected && (
                <EventList
                  events={events}
                  activeEventId={activeEventId}
                  onEventClick={onEventClick}
                  multiDay={multiDay}
                  label={`Events in trip ${t.no}`}
                />
              )}
            </li>
          )
        })}

        {/* A tamper while parked, an ignition flicker in the yard: events no trip covers. */}
        {outside.length > 0 && (
          <li className="rp-trip" data-selected="false">
            <button
              className="rp-trip-btn"
              aria-expanded={outsideOpen}
              onClick={() => setOutsideOpen(o => !o)}
            >
              <div className="rp-trip-tt">
                <span style={{ color: 'var(--c-text2)' }}>Outside trips</span>
                <span style={{ color: 'var(--c-text2)', fontWeight: 600 }}>{outside.length} event{outside.length === 1 ? '' : 's'}</span>
              </div>
              {!outsideOpen && <Badges events={outside} />}
            </button>
            {outsideOpen && (
              <EventList
                events={outside}
                activeEventId={activeEventId}
                onEventClick={onEventClick}
                multiDay={multiDay}
                label="Events outside trips"
              />
            )}
          </li>
        )}
      </ul>

      {/* The Trip Report hides 0 km trips by default; so does this list. */}
      {zeroCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px 12px', fontSize: 11, color: 'var(--c-text3)' }}>
          <span>
            {showZero
              ? `Showing ${zeroCount} trip${zeroCount === 1 ? '' : 's'} of 0 km`
              : `${zeroCount} trip${zeroCount === 1 ? '' : 's'} of 0 km hidden`}
          </span>
          <button className="rp-link" onClick={onToggleZero} aria-pressed={showZero}>
            {showZero ? 'Hide' : 'Show'}
          </button>
        </div>
      )}
    </div>
  )
}
