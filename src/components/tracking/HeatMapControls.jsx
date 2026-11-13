import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Search, X } from 'lucide-react'
import { Chip, CheckRow } from '../reports/controls'
import { ALERT_TYPES, alertTypeLabel } from '../../data/settings'
import { IS_REAL } from '../../data/mode'
import { OIL_GAS_VIOLATION_TYPES } from '../../utils/oilGasViolations'
import { HEAT_STOPS, HEAT_SUBMODES, HEAT_HISTORY_DAYS } from '../../utils/heatmap'
import { dateStr } from '../../utils/reportRange'
import { vehicleLabel } from '../../hooks/useLiveHeat'

/**
 * The Live Map's "Heat map" button, its options and its legend
 * (hooks/useLiveHeat.js holds the state and the data).
 *
 *   Vehicles  All listed · Selected · Custom (a searchable pick)
 *   Period    Today · Yesterday · 7 days · Custom (capped, see utils/heatmap.js)
 *   Show      Presence (engine on / moving) · Stops & idle (all / idling) ·
 *             Events (alert events with a place, by kind; Oil & Gas preset)
 *
 * Selecting a vehicle narrows the heat to it and hides the others; "Show all"
 * (legend) or "All listed" (options) clears the selection.
 */

// Events with a place: not the paperwork ones.
const PLACED_TYPES = ALERT_TYPES.map(t => t.value).filter(t => t !== 'license_expiry')
const OIL_GAS = OIL_GAS_VIOLATION_TYPES.filter(t => PLACED_TYPES.includes(t))
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x))

const SHOWS = [['presence', 'Presence'], ['stops', 'Stops & idle'], ['events', 'Events']]
const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['d7', '7 days'], ['custom', 'Custom']]

const CSS = `
  .track-geofence-toggle.lh-split { padding: 0; gap: 0; cursor: default; }
  .lh-split button {
    display: flex; align-items: center; gap: 6px; border: 0; background: none; color: inherit;
    font: inherit; cursor: pointer; padding: 7px 8px 7px 11px; border-radius: 10px 0 0 10px;
  }
  .lh-split button.lh-caret { padding: 7px 8px 7px 6px; border-radius: 0 10px 10px 0; border-left: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
  .lh-split button:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: -2px; }
  .lh-pop {
    /* Over Leaflet's own controls (1000), which share this stacking context. */
    position: absolute; top: 202px; right: 10px; z-index: 1001;
    width: min(300px, calc(100% - 20px)); max-height: max(240px, calc(100% - 214px)); overflow-y: auto;
    background: var(--c-card); color: var(--c-text1); border: 1px solid var(--c-border2); border-radius: 12px;
    box-shadow: 0 14px 36px rgba(0,0,0,0.24); padding: 12px; font-size: 12px;
  }
  .lh-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .lh-title { font-size: 13px; font-weight: 800; }
  .lh-label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--c-text3); margin: 10px 0 5px; }
  .lh-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 3px; padding: 3px; border-radius: 9px; background: var(--c-input); border: 1px solid var(--c-border); }
  .lh-seg button {
    border: 0; border-radius: 6px; padding: 5px 4px; background: transparent; color: var(--c-text2);
    font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; white-space: nowrap; min-width: 0;
  }
  .lh-seg button[aria-checked="true"] { background: var(--ft-accent); color: #fff; }
  .lh-seg button:disabled { opacity: 0.45; cursor: not-allowed; }
  .lh-sub { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
  .lh-note { font-size: 11px; color: var(--c-text3); margin-top: 6px; line-height: 1.45; }
  .lh-warn { font-size: 11px; color: #f97316; margin-top: 6px; line-height: 1.45; font-weight: 600; }
  .lh-link { border: 0; background: none; padding: 0; font: inherit; font-size: 11.5px; font-weight: 700; color: var(--ft-accent); cursor: pointer; }
  .lh-link:disabled { color: var(--c-text3); cursor: default; }
  .lh-search { display: flex; align-items: center; gap: 6px; margin-top: 7px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--c-border); background: var(--c-input); color: var(--c-text3); }
  .lh-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--c-text1); font: inherit; font-size: 12px; padding: 6px 0; }
  .lh-list { max-height: 168px; overflow-y: auto; margin-top: 4px; }
  .lh-dates { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 7px; }
  .lh-dates input { width: 100%; min-width: 0; padding: 5px 6px; border-radius: 7px; border: 1px solid var(--c-border); background: var(--c-input); color: var(--c-text1); font: inherit; font-size: 11.5px; color-scheme: light dark; }
  .lh-switch { position: relative; width: 34px; height: 19px; border-radius: 999px; border: 0; cursor: pointer; background: var(--c-border2); transition: background 0.15s; flex-shrink: 0; }
  .lh-switch[aria-checked="true"] { background: var(--ft-accent); }
  .lh-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; transition: transform 0.15s; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
  .lh-switch[aria-checked="true"]::after { transform: translateX(15px); }
  .lh-legend {
    position: absolute; left: 12px; bottom: 14px; z-index: 900; width: min(270px, calc(100% - 24px));
    background: var(--c-card); color: var(--c-text1); border: 1px solid var(--c-border2); border-radius: 11px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.18); padding: 9px 11px; font-size: 11.5px;
    transition: bottom 0.2s ease;
  }
  .lh-legend[data-raised="true"] { bottom: 112px; }
  .lh-legend-top { display: flex; align-items: flex-start; gap: 8px; }
  .lh-caption { flex: 1; min-width: 0; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
  .lh-bar { height: 8px; border-radius: 5px; margin-top: 7px; }
  .lh-ends { display: flex; justify-content: space-between; font-size: 10px; color: var(--c-text3); margin-top: 2px; }
  .lh-total { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 5px; color: var(--c-text2); }
  .lh-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 7px; border: 1px solid var(--c-border2); background: var(--c-card); color: var(--c-text2); cursor: pointer; flex-shrink: 0; }
  .lh-icon:disabled { opacity: 0.45; cursor: default; }
`

function Segmented({ value, options, onChange, label, disabled = {} }) {
  return (
    <div className="lh-seg" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key} type="button" role="radio" aria-checked={value === key}
          disabled={!!disabled[key]} title={typeof disabled[key] === 'string' ? disabled[key] : undefined}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

const FlameIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
)

/**
 * @param {object}   p
 * @param {object}   p.heat       useLiveHeat()'s result
 * @param {object[]} p.fleet      every vehicle on the account, for the custom pick
 * @param {Function} p.onShowAll  clears the selection
 * @param {boolean}  p.raised     the replay bar is up: the legend sits above it
 */
export default function HeatMapControls({ heat, fleet, onShowAll, raised = false }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kindsOpen, setKindsOpen] = useState(false)
  const btnRef = useRef(null)
  const popRef = useRef(null)
  const { on, opts, update, by } = heat

  useEffect(() => {
    if (!open) return
    const onDown = e => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const picks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return fleet
      .map(v => ({ id: v.id, label: vehicleLabel(v), note: v.name && v.name !== vehicleLabel(v) ? v.name : null, ident: v.ident || '' }))
      .filter(v => !q || v.label.toLowerCase().includes(q) || (v.note || '').toLowerCase().includes(q) || v.ident.includes(q))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [fleet, query])

  const toggleOn = () => {
    const next = !on
    heat.setOn(next)
    setOpen(next)
  }
  const openOptions = () => {
    if (!on) heat.setOn(true)
    setOpen(o => !on || !o)
  }

  const scopeValue = by === 'selected' ? 'selected' : opts.scope
  const setScope = key => {
    if (key === 'selected') return
    if (by === 'selected') onShowAll()
    update({ scope: key })
  }
  const toggleCustom = id => {
    const next = opts.customIds.includes(id) ? opts.customIds.filter(x => x !== id) : [...opts.customIds, id]
    update({ customIds: next })
  }

  const today = new Date()
  const setPeriod = key => {
    if (key === 'custom' && (!opts.from || !opts.to)) {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      update({ period: key, from: dateStr(y), to: dateStr(today) })
    } else update({ period: key })
  }
  const oldest = new Date(today)
  oldest.setDate(oldest.getDate() - (HEAT_HISTORY_DAYS - 1))

  const types = opts.types ?? PLACED_TYPES
  const allKinds = opts.types == null || sameSet(types, PLACED_TYPES)
  const ogKinds = !allKinds && sameSet(types, OIL_GAS)
  const toggleKind = t => {
    const next = types.includes(t) ? types.filter(x => x !== t) : [...types, t]
    update({ types: sameSet(next, PLACED_TYPES) ? null : next })
  }

  const label = on && heat.status === 'loading' ? 'Heat map…' : on && heat.status === 'error' ? 'Heat map ⚠' : 'Heat map'
  const r = heat.result

  let totalLine = null
  if (heat.status === 'problem') totalLine = <span style={{ color: '#f97316', fontWeight: 600 }}>{heat.problem}</span>
  else if (heat.status === 'none') totalLine = <span>{by === 'custom' ? 'Pick vehicles in the heat map options.' : 'No vehicles in the list.'}</span>
  else if (heat.status === 'error') totalLine = <span style={{ color: '#ef4444', fontWeight: 600 }}>Could not load: {heat.error}</span>
  else if (heat.status === 'loading') totalLine = <span>{heat.progress || 'Loading…'}</span>
  else if (r) {
    totalLine = (
      <span>
        {r.cells.length
          ? <><strong style={{ color: 'var(--c-text1)' }}>{r.totalText}</strong> in {r.cells.length.toLocaleString()} place{r.cells.length === 1 ? '' : 's'}</>
          : opts.show === 'events' ? 'No events with a place in this period.' : 'Nothing to show in this period.'}
        {r.unplaced > 0 && ` · ${r.unplaced} without a place`}
        {r.truncated && <span style={{ color: '#f97316' }}> · cut short, narrow the period</span>}
        {heat.status === 'refreshing' && ' · updating…'}
      </span>
    )
  }

  return (
    <>
      <style>{CSS}</style>
      <div ref={btnRef} className="track-geofence-toggle is-heat lh-split" data-on={on ? 'true' : 'false'}>
        <button
          type="button" onClick={toggleOn} aria-pressed={on}
          title={on ? 'Hide the heat map' : 'Show where the vehicles have been'}
        >
          <FlameIcon />
          {label}
        </button>
        <button
          type="button" className="lh-caret" onClick={openOptions}
          aria-expanded={open} aria-haspopup="dialog" aria-label="Heat map options" title="Heat map options"
        >
          <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
      </div>

      {open && (
        <div ref={popRef} className="lh-pop ft-pop no-scrollbar" role="dialog" aria-label="Heat map options">
          <div className="lh-head">
            <span className="lh-title">Heat map</span>
            <button type="button" className="lh-switch" role="switch" aria-checked={on} aria-label="Heat map on" onClick={() => heat.setOn(!on)} />
          </div>

          <div className="lh-label">Vehicles</div>
          <Segmented
            label="Vehicles" value={scopeValue} onChange={setScope}
            options={[['all', `All listed (${heat.listedCount})`], ['selected', 'Selected'], ['custom', 'Custom']]}
            disabled={{ selected: by === 'selected' ? false : 'Click a vehicle in the list or on the map' }}
          />
          {by === 'selected' && (
            <div className="lh-note">
              Only <strong style={{ color: 'var(--c-text1)' }}>{heat.labelOf(heat.ids[0])}</strong>, the other vehicles are hidden.{' '}
              <button type="button" className="lh-link" onClick={onShowAll}>Show all</button>
            </div>
          )}
          {by === 'all' && <div className="lh-note">Click a vehicle to see only its heat.</div>}
          {opts.scope === 'custom' && by !== 'selected' && (
            <>
              <label className="lh-search">
                <Search size={13} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search plate, name or IMEI" aria-label="Search vehicles" />
                {query && <button type="button" className="lh-link" onClick={() => setQuery('')} aria-label="Clear search"><X size={12} /></button>}
              </label>
              <div className="lh-list no-scrollbar">
                {picks.map(v => (
                  <CheckRow key={v.id} checked={opts.customIds.includes(v.id)} onChange={() => toggleCustom(v.id)} note={v.note}>
                    {v.label}
                  </CheckRow>
                ))}
                {!picks.length && <div className="lh-note" style={{ padding: '4px 8px' }}>No vehicle matches.</div>}
              </div>
              <div className="lh-note" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{heat.ids.length ? `${heat.ids.length} picked, the others hidden` : 'Tick the vehicles to show'}</span>
                <button type="button" className="lh-link" disabled={!opts.customIds.length} onClick={() => update({ customIds: [] })}>Clear</button>
              </div>
            </>
          )}

          <div className="lh-label">Period</div>
          <Segmented label="Period" value={opts.period} onChange={setPeriod} options={PERIODS} />
          {opts.period === 'custom' && (
            <div className="lh-dates">
              <input type="date" aria-label="First day" value={opts.from} min={dateStr(oldest)} max={opts.to || dateStr(today)} onChange={e => update({ from: e.target.value })} />
              <input type="date" aria-label="Last day" value={opts.to} min={opts.from || dateStr(oldest)} max={dateStr(today)} onChange={e => update({ to: e.target.value })} />
            </div>
          )}

          <div className="lh-label">Show</div>
          <Segmented label="Show" value={opts.show} onChange={key => update({ show: key })} options={SHOWS} />
          {opts.show === 'presence' && (
            <div className="lh-sub">
              {HEAT_SUBMODES.presence.map(m => <Chip key={m.key} active={opts.presenceMode === m.key} onClick={() => update({ presenceMode: m.key })}>{m.label}</Chip>)}
            </div>
          )}
          {opts.show === 'stops' && (
            <div className="lh-sub">
              {HEAT_SUBMODES.stops.map(m => <Chip key={m.key} active={opts.stopMode === m.key} onClick={() => update({ stopMode: m.key })}>{m.label}</Chip>)}
            </div>
          )}
          {opts.show === 'events' && (
            <>
              <div className="lh-sub">
                <Chip active={allKinds} onClick={() => update({ types: null })}>All kinds</Chip>
                <Chip active={ogKinds} onClick={() => update({ types: OIL_GAS })}>Oil &amp; Gas</Chip>
                <Chip active={kindsOpen} onClick={() => setKindsOpen(o => !o)}>
                  {allKinds ? 'Choose…' : `${types.length} kind${types.length === 1 ? '' : 's'}`} {kindsOpen ? '▴' : '▾'}
                </Chip>
              </div>
              {kindsOpen && (
                <div className="lh-list no-scrollbar" style={{ maxHeight: 190 }}>
                  {PLACED_TYPES.map(t => <CheckRow key={t} checked={types.includes(t)} onChange={() => toggleKind(t)}>{alertTypeLabel(t)}</CheckRow>)}
                </div>
              )}
              {!IS_REAL && <div className="lh-note">Events are raised by the server, so this view has data only when signed in to it.</div>}
            </>
          )}

          {heat.problem
            ? <div className="lh-warn">{heat.problem}</div>
            : opts.show !== 'events' && opts.period !== 'today' && (
              <div className="lh-note">
                Past days load only these vehicles: up to {heat.maxDays} day{heat.maxDays === 1 ? '' : 's'} for {heat.ids.length || 1} vehicle{heat.ids.length === 1 ? '' : 's'}.
              </div>
            )}
        </div>
      )}

      {on && (
        <div className="lh-legend" data-raised={raised ? 'true' : 'false'} role="status" aria-live="polite">
          <div className="lh-legend-top">
            <span className="lh-caption" title={heat.caption}>{heat.caption}</span>
            {by === 'selected' && <button type="button" className="lh-link" onClick={onShowAll}>Show all</button>}
            <button type="button" className="lh-icon" onClick={heat.requestFit} disabled={!r?.cells.length} title="Zoom to the heat" aria-label="Zoom to the heat">
              <Maximize2 size={12} />
            </button>
          </div>
          <div className="lh-bar" style={{ background: `linear-gradient(to right, ${HEAT_STOPS.map(([at, c]) => `${c} ${at * 100}%`).join(', ')})` }} />
          <div className="lh-ends">
            <span>Less</span>
            <span>{opts.show === 'events' ? 'Most events' : 'Most time'}</span>
          </div>
          {totalLine && <div className="lh-total">{totalLine}</div>}
        </div>
      )}
    </>
  )
}
