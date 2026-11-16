import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Search, X } from 'lucide-react'
import { CheckRow } from '../reports/controls'
import { GEO_TYPES } from '../../utils/geozones'

/**
 * The Live Map's "Geofences" button and its options (client, 2026-11-16:
 * "Geozones like the heat map"; hooks/useGeozoneView.js holds the state).
 *
 *   Show    All · Custom (a searchable pick) · Vehicle rules (the geofences
 *           the selected vehicle's alert rules watch)
 *   Type    All · Zones · Addresses · Speed zones
 *   Labels  names on the map
 *   Zoom to the geofences shown, and how many there are
 *
 * Drawing and editing geofences stay in Settings › Address - Geofence.
 */

const CSS = `
  .track-geofence-toggle.gz-split { padding: 0; gap: 0; cursor: default; }
  .gz-split button {
    display: flex; align-items: center; gap: 6px; border: 0; background: none; color: inherit;
    font: inherit; cursor: pointer; padding: 7px 8px 7px 11px; border-radius: 10px 0 0 10px;
  }
  .gz-split button.gz-caret { padding: 7px 8px 7px 6px; border-radius: 0 10px 10px 0; border-left: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
  .gz-split button:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: -2px; }
  .gz-count { font-weight: 600; opacity: 0.85; font-variant-numeric: tabular-nums; }
  .gz-pop {
    /* Over Leaflet's own controls (1000), which share this stacking context. */
    position: absolute; top: 128px; right: 10px; z-index: 1001;
    width: min(300px, calc(100% - 20px)); max-height: max(240px, calc(100% - 140px)); overflow-y: auto;
    background: var(--c-card); color: var(--c-text1); border: 1px solid var(--c-border2); border-radius: 12px;
    box-shadow: 0 14px 36px rgba(0,0,0,0.24); padding: 12px; font-size: 12px;
  }
  .gz-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  .gz-title { font-size: 13px; font-weight: 800; }
  .gz-label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--c-text3); margin: 10px 0 5px; }
  .gz-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 3px; padding: 3px; border-radius: 9px; background: var(--c-input); border: 1px solid var(--c-border); }
  .gz-seg button {
    border: 0; border-radius: 6px; padding: 5px 3px; background: transparent; color: var(--c-text2);
    font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap; min-width: 0;
    overflow: hidden; text-overflow: ellipsis;
  }
  .gz-seg button[aria-checked="true"] { background: var(--ft-accent); color: #fff; }
  .gz-seg button:disabled { opacity: 0.45; cursor: not-allowed; }
  .gz-seg button:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: 1px; }
  .gz-note { font-size: 11px; color: var(--c-text3); margin-top: 6px; line-height: 1.45; }
  .gz-link { border: 0; background: none; padding: 0; font: inherit; font-size: 11.5px; font-weight: 700; color: var(--ft-accent); cursor: pointer; }
  .gz-link:disabled { color: var(--c-text3); cursor: default; }
  .gz-search { display: flex; align-items: center; gap: 6px; margin-top: 7px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--c-border); background: var(--c-input); color: var(--c-text3); }
  .gz-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--c-text1); font: inherit; font-size: 12px; padding: 6px 0; }
  .gz-list { max-height: 180px; overflow-y: auto; margin-top: 4px; }
  .gz-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
  .gz-switch { position: relative; width: 34px; height: 19px; border-radius: 999px; border: 0; cursor: pointer; background: var(--c-border2); transition: background 0.15s; flex-shrink: 0; }
  .gz-switch[aria-checked="true"] { background: var(--ft-accent); }
  .gz-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; transition: transform 0.15s; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
  .gz-switch[aria-checked="true"]::after { transform: translateX(15px); }
  .gz-switch:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: 2px; }
  .gz-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; padding-top: 9px; border-top: 1px solid var(--c-border); color: var(--c-text2); }
  .gz-icon { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border-radius: 7px; border: 1px solid var(--c-border2); background: var(--c-card); color: var(--c-text2); cursor: pointer; font: inherit; font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .gz-icon:disabled { opacity: 0.45; cursor: default; }
`

const PinIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
)

function Segmented({ value, options, onChange, label, disabled = {} }) {
  return (
    <div className="gz-seg" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key} type="button" role="radio" aria-checked={value === key}
          disabled={!!disabled[key]} title={typeof disabled[key] === 'string' ? disabled[key] : text}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/**
 * @param {object}   p
 * @param {object}   p.geo        useGeozoneView()'s result
 * @param {object[]} p.geofences  every geofence the user can see, for the custom pick
 */
export default function GeozoneControls({ geo, geofences }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const btnRef = useRef(null)
  const popRef = useRef(null)
  const { on, opts, update } = geo

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
    return (geofences ?? [])
      .filter(g => !q || (g.name || '').toLowerCase().includes(q) || (g.category || '').toLowerCase().includes(q))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [geofences, query])

  const toggleOn = () => {
    const next = !on
    geo.setOn(next)
    if (!next) setOpen(false)
  }
  const openOptions = () => {
    if (!on) geo.setOn(true)
    setOpen(o => !on || !o)
  }
  const togglePick = id => {
    const next = opts.ids.includes(id) ? opts.ids.filter(x => x !== id) : [...opts.ids, id]
    update({ ids: next })
  }

  const showOptions = [
    ['all', `All (${geo.total})`],
    ['custom', 'Custom'],
    ['rules', 'Vehicle rules'],
  ]
  const typeDisabled = Object.fromEntries(GEO_TYPES.map(([k, text]) => [k, k !== 'all' && !geo.typeCounts[k] ? `No ${text.toLowerCase()}` : false]))

  return (
    <>
      <style>{CSS}</style>
      <div ref={btnRef} className="track-geofence-toggle gz-split" data-on={on ? 'true' : 'false'}>
        <button
          type="button" onClick={toggleOn} aria-pressed={on}
          title={on ? `Hide geofences — ${geo.caption}` : 'Show geofences'}
        >
          <PinIcon />
          Geofences
          {on && <span className="gz-count">· {geo.shown.length}</span>}
        </button>
        <button
          type="button" className="gz-caret" onClick={openOptions}
          aria-expanded={open} aria-haspopup="dialog" aria-label="Geofence options" title="Geofence options"
        >
          <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
      </div>

      {open && (
        <div ref={popRef} className="gz-pop ft-pop no-scrollbar" role="dialog" aria-label="Geofence options">
          <div className="gz-head">
            <span className="gz-title">Geofences</span>
            <button type="button" className="gz-switch" role="switch" aria-checked={on} aria-label="Geofences on" onClick={() => geo.setOn(!on)} />
          </div>

          <div className="gz-label">Show</div>
          <Segmented
            label="Show" value={opts.show} onChange={key => update({ show: key })} options={showOptions}
          />
          {opts.show === 'custom' && (
            <>
              <label className="gz-search">
                <Search size={13} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name" aria-label="Search geofences" />
                {query && <button type="button" className="gz-link" onClick={() => setQuery('')} aria-label="Clear search"><X size={12} /></button>}
              </label>
              <div className="gz-list no-scrollbar">
                {picks.map(g => (
                  <CheckRow key={g.id} checked={opts.ids.includes(g.id)} onChange={() => togglePick(g.id)} note={g.category || null}>
                    {g.name || 'Unnamed'}
                  </CheckRow>
                ))}
                {!picks.length && <div className="gz-note" style={{ padding: '4px 8px' }}>{(geofences ?? []).length ? 'No geofence matches.' : 'No geofences yet — add them in Settings › Address - Geofence.'}</div>}
              </div>
              <div className="gz-note" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{opts.ids.length ? `${opts.ids.length} picked` : 'Tick the geofences to show'}</span>
                <button type="button" className="gz-link" disabled={!opts.ids.length} onClick={() => update({ ids: [] })}>Clear</button>
              </div>
            </>
          )}
          {opts.show === 'rules' && (
            <div className="gz-note">
              {!geo.vehicleName
                ? 'Select a vehicle: this shows the geofences its alert rules watch (enter / exit and zone speed).'
                : geo.ruleIds?.size
                  ? <>The geofences in <strong style={{ color: 'var(--c-text1)' }}>{geo.vehicleName}</strong>&rsquo;s alert rules.</>
                  : <><strong style={{ color: 'var(--c-text1)' }}>{geo.vehicleName}</strong> has no active geofence or zone-speed rule.</>}
            </div>
          )}

          <div className="gz-label">Type</div>
          <Segmented label="Type" value={opts.type} onChange={key => update({ type: key })} options={GEO_TYPES} disabled={typeDisabled} />

          <div className="gz-row">
            <span>Names on the map</span>
            <button type="button" className="gz-switch" role="switch" aria-checked={opts.labels} aria-label="Geofence names on the map" onClick={() => update({ labels: !opts.labels })} />
          </div>

          <div className="gz-foot" role="status" aria-live="polite">
            <span>{geo.caption}</span>
            <button type="button" className="gz-icon" onClick={geo.requestFit} disabled={!geo.bounds} title="Zoom to the geofences shown">
              <Maximize2 size={12} /> Zoom to
            </button>
          </div>
        </div>
      )}
    </>
  )
}
