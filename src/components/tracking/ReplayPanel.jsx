import { useState, useEffect, useRef } from 'react'
import { fmtDuration, localDay, isZeroTrip } from '../../utils/replayTrips'
import { REPLAY_FIELDS } from './replayFields'
import ShareReplayDialog from './ShareReplayDialog'
import ReplayTripsList from './ReplayTripsList'
import ReplayExportMenu from './ReplayExportMenu'

// replay.js issues one request per calendar day of range, sequentially. Past
// roughly a week that is slow enough — and rate-limit-prone enough — to be
// worth warning about before anyone presses Load.
const CHUNK_SECONDS = 86400
const WARN_ABOVE_CHUNKS = 7

const PRESETS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek',  label: 'This Week' },
  { key: 'lastWeek',  label: 'Last Week' },
  { key: 'h24',       label: 'Last 24 hours' },
  { key: 'd3',        label: 'Last 3 days' },
  { key: 'd7',        label: 'Last 7 days' },
  { key: 'd30',       label: 'Last 30 days' },
  { key: 'm3',        label: 'Last 3 months' },
  { key: 'custom',    label: 'Custom' },
]

function pad(n) {
  return String(n).padStart(2, '0')
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time, no timezone suffix.
function toInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Weeks run Monday to Sunday.
function startOfWeek(d) {
  const s = startOfDay(d)
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}

const DAY_MS = 86400000

function presetRange(key, now = new Date()) {
  const daysAgo = n => new Date(now.getTime() - n * DAY_MS)

  switch (key) {
    case 'today':     return [startOfDay(now), now]
    case 'yesterday': {
      const end = startOfDay(now)
      return [new Date(end.getTime() - DAY_MS), end]
    }
    case 'thisWeek':  return [startOfWeek(now), now]
    case 'lastWeek': {
      const end = startOfWeek(now)
      return [new Date(end.getTime() - 7 * DAY_MS), end]
    }
    case 'h24': return [new Date(now.getTime() - DAY_MS), now]
    case 'd3':  return [daysAgo(3), now]
    case 'd7':  return [daysAgo(7), now]
    case 'd30': return [daysAgo(30), now]
    case 'm3': {
      const s = new Date(now)
      s.setMonth(s.getMonth() - 3)
      return [s, now]
    }
    default: return [startOfDay(now), now]
  }
}

const sec = d => Math.floor(d.getTime() / 1000)

// Mirrors replay.js's chunking exactly, so the count shown is the count sent.
function chunkCount(fromTs, toTs) {
  return Math.max(1, Math.ceil((toTs - fromTs) / CHUNK_SECONDS))
}

const CSS = `
  .rp-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--c-card); color: var(--c-text1); }
  .rp-head { padding: 12px 14px; border-bottom: 1px solid var(--c-border); flex-shrink: 0; }
  .rp-row { display: flex; align-items: center; gap: 8px; }
  .rp-back {
    display: inline-flex; align-items: center; gap: 2px; padding: 2px 4px 2px 0; border: none; background: none;
    font-size: 12px; font-weight: 700; color: var(--ft-accent); cursor: pointer; border-radius: 5px;
  }
  .rp-veh { font-weight: 800; font-size: 15px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rp-date {
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 8px;
    border: 1px solid var(--c-border); background: var(--c-card); color: var(--c-text1);
    font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
  }
  .rp-date:hover, .rp-tool:hover { background: var(--c-hover); }
  .rp-tool {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 25px; padding: 0 8px;
    border-radius: 7px; border: 1px solid var(--c-border); background: var(--c-input); color: var(--c-text2);
    font-size: 11px; font-weight: 700; cursor: pointer;
  }
  .rp-tool[data-on="true"] { background: var(--c-hover); }
  .rp-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
  .rp-stat { background: color-mix(in srgb, var(--ft-accent) 6%, var(--c-card)); border-radius: 9px; padding: 6px 8px; min-width: 0; }
  .rp-stat b { display: block; font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rp-stat span { font-size: 10.5px; color: var(--c-text2); }
  .rp-flt { padding: 10px 14px; border-bottom: 1px solid var(--c-border); flex-shrink: 0; }
  .rp-h5 { margin: 0 0 6px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; color: var(--c-text2); text-transform: uppercase; }
  .rp-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .rp-chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px;
    border: 1px solid var(--c-border); background: transparent; color: var(--c-text1);
    font-size: 11.5px; font-weight: 600; cursor: pointer; transition: opacity 0.15s, background 0.15s;
  }
  .rp-chip[aria-pressed="true"] {
    background: color-mix(in srgb, var(--ft-accent) 9%, var(--c-card));
    border-color: color-mix(in srgb, var(--ft-accent) 45%, transparent);
  }
  .rp-chip[aria-pressed="false"] { opacity: 0.45; }
  .rp-chip .n { color: var(--c-text2); font-weight: 500; font-variant-numeric: tabular-nums; }
  .rp-hl { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11.5px; color: var(--c-text2); }
  .rp-hl input {
    width: 46px; border: 1px solid var(--c-border); border-radius: 6px; padding: 2px 4px;
    font-size: 11.5px; background: var(--c-input); color: var(--c-text1);
  }
  .rp-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
  .rp-scroll::-webkit-scrollbar { width: 6px; }
  .rp-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--c-text3) 38%, transparent); border-radius: 999px; }
  .rp-triphead {
    display: flex; align-items: center; gap: 8px; padding: 8px 14px 6px; border-bottom: 1px solid var(--c-border);
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--c-text2);
  }
  .rp-pill {
    margin-left: auto; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--c-border);
    background: transparent; font-size: 10.5px; font-weight: 700; letter-spacing: 0; text-transform: none;
    color: var(--ft-accent); cursor: pointer; white-space: nowrap;
  }
  .rp-pill[aria-pressed="true"] { background: var(--ft-accent); border-color: var(--ft-accent); color: #fff; cursor: default; }
  .rp-pop {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; width: 236px; padding: 6px;
    border-radius: 10px; border: 1px solid var(--c-border2); background: var(--c-card);
    box-shadow: 0 10px 32px rgba(0,0,0,0.22);
  }
  .rp-opt {
    display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 6px 9px;
    border: none; border-radius: 7px; background: transparent; color: var(--c-text1);
    font-size: 12px; font-weight: 600; text-align: left; cursor: pointer;
  }
  .rp-opt:hover { background: var(--c-hover); }
  .rp-opt[aria-checked="true"] { color: var(--ft-accent); }
  .rp-msg { font-size: 11px; margin-top: 8px; line-height: 1.45; }
  .rp-back:focus-visible, .rp-date:focus-visible, .rp-tool:focus-visible, .rp-chip:focus-visible,
  .rp-pill:focus-visible, .rp-opt:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: 1px; }
`

const Caret = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

/** Closes a popover on a click outside it or Escape. */
function useDismiss(ref, open, onClose) {
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!ref.current?.contains(e.target)) onClose() }
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, open, onClose])
}

function CustomizeMenu({ fields, onChange }) {
  return (
    <div className="rp-pop" style={{ width: 186, padding: '9px 6px 7px' }}>
      <div className="rp-h5" style={{ padding: '0 9px 4px', fontSize: 9.5 }}>Show on map card</div>
      {REPLAY_FIELDS.map(f => (
        <label key={f.key} className="rp-opt" style={{ justifyContent: 'flex-start', gap: 9 }}>
          <input
            type="checkbox"
            checked={!!fields[f.key]}
            onChange={e => onChange({ ...fields, [f.key]: e.target.checked })}
            style={{ accentColor: 'var(--ft-accent)', width: 13, height: 13, cursor: 'pointer' }}
          />
          {f.label}
        </label>
      ))}
    </div>
  )
}

// ── panel ──────────────────────────────────────────────────────────────────

/**
 * The replay panel (client-approved "Option C", 2026-11-13). While a replay
 * is open it takes the vehicle list's column: back to the Live Map, the
 * vehicle and its date range, the range's totals, the event filter chips, the
 * "above N km/h in red" setting and the trips with their events.
 *
 * `replay` is the lifted state/actions object built by Tracking.jsx — this
 * component renders it and forwards input, it holds no track data itself.
 * The player (play, timeline, speed chart) is ReplayPlayerBar, over the map.
 */
export default function ReplayPanel({ replay, vehicleName }) {
  const {
    points, loading, error, truncated, status, fields, range, vehicleId,
    onStop, onLoad, onFieldsChange,
    // `points` is what plays: the whole loaded range (allPoints), or the trip
    // picked in the list (trip; null = whole range).
    trip: playingTrip = null, allPoints = points, onSelectTrip,
    view, activeEventId, onEventClick,
  } = replay

  const [presetKey, setPresetKey] = useState('today')
  const [custom, setCustom]       = useState(() => {
    const [from, to] = presetRange('today')
    return { from: toInputValue(from), to: toInputValue(to) }
  })
  const [rangeOpen, setRangeOpen] = useState(false)
  const [gearOpen, setGearOpen]   = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [hlDraft, setHlDraft] = useState(() => String(view.highlightKmh))

  const rangeRef = useRef(null)
  const gearRef = useRef(null)
  useDismiss(rangeRef, rangeOpen, () => setRangeOpen(false))
  useDismiss(gearRef, gearOpen, () => setGearOpen(false))

  const hasPoints = points.length > 0
  const { trips, totals } = view
  // The playing trip as the list numbers it (matched by start, since hiding
  // 0 km trips renumbers the rest).
  const selectedTrip = playingTrip ? trips.find(t => t.startTs === playingTrip.startTs) ?? null : null
  const first = allPoints[0]?.ts
  const last = allPoints[allPoints.length - 1]?.ts
  const multiDay = first != null && last != null && localDay(first) !== localDay(last)

  // Opening a replay shows today straight away — one request, as the Today
  // chip always cost. The panel is keyed by vehicle, so this runs once each.
  const autoLoaded = useRef(false)
  useEffect(() => {
    if (autoLoaded.current || vehicleId == null || allPoints.length || loading) return
    autoLoaded.current = true
    const [f, t] = presetRange('today')
    onLoad(sec(f), sec(t))
  }, [vehicleId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hiding 0 km trips while one of them is playing would leave it playing
  // with nothing selected in the list — go back to the whole range instead.
  const toggleZero = () => {
    if (view.showZero && playingTrip && isZeroTrip(playingTrip)) onSelectTrip(null)
    view.setShowZero(s => !s)
  }

  // Exports what is on screen: the picked trip, or the whole loaded range.
  const runExport = async (format) => {
    setExportError(null)
    try {
      const mod  = await import('../../utils/replayExport')
      const opts = { vehicle: vehicleName, points, trips, trip: selectedTrip ?? playingTrip, places: view.places }
      if (format === 'xlsx') await mod.exportReplayExcel(opts)
      else if (format === 'kml') mod.exportReplayKml(opts)
      else mod.exportReplayGpx(opts)
    } catch {
      setExportError('Could not build the export file. Please try again.')
    }
  }

  const rangeTs = () => {
    if (presetKey === 'custom') {
      return [
        Math.floor(new Date(custom.from).getTime() / 1000),
        Math.floor(new Date(custom.to).getTime() / 1000),
      ]
    }
    const [from, to] = presetRange(presetKey)
    return [sec(from), sec(to)]
  }

  const [fromTs, toTs] = rangeTs()
  const validRange = Number.isFinite(fromTs) && Number.isFinite(toTs) && toTs > fromTs
  const chunks     = validRange ? chunkCount(fromTs, toTs) : 0
  const expensive  = chunks > WARN_ABOVE_CHUNKS

  const load = () => {
    if (!validRange || loading) return
    setRangeOpen(false)
    onLoad(fromTs, toTs)
  }

  // Cheap ranges load on the first click. Expensive ones only select, so the
  // request-count warning gets a chance to be read before anything is sent.
  const pickPreset = (key) => {
    setPresetKey(key)
    if (key === 'custom') return
    const [from, to] = presetRange(key)
    const f = sec(from)
    const t = sec(to)
    if (chunkCount(f, t) <= WARN_ABOVE_CHUNKS) {
      setRangeOpen(false)
      onLoad(f, t)
    }
  }

  const presetLabel = PRESETS.find(p => p.key === presetKey)?.label ?? 'Today'

  const onHighlight = e => {
    const v = e.target.value
    setHlDraft(v)
    const n = Number(v)
    if (v !== '' && Number.isFinite(n) && n >= 1 && n <= 400) view.setHighlightKmh(Math.round(n))
  }

  return (
    <div className="rp-panel">
      <style>{CSS}</style>

      {/* ── Header: back, vehicle + range, totals ── */}
      <div className="rp-head">
        <div className="rp-row">
          <button className="rp-back" onClick={onStop} title="Leave the replay and go back to live tracking">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Live Map
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            {hasPoints && (
              <ReplayExportMenu
                scopeLabel={selectedTrip ? `Trip ${selectedTrip.no}` : 'Whole range'}
                onExport={runExport}
                placement="down"
              />
            )}
            {hasPoints && range && (
              <button
                className="rp-tool"
                onClick={() => setShareOpen(true)}
                title="Make a link to this replay that works without signing in"
                style={{ color: 'var(--ft-accent)', borderColor: 'var(--ft-accent)', background: 'color-mix(in srgb, var(--ft-accent) 10%, transparent)' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
                </svg>
                Share
              </button>
            )}
            <div ref={gearRef} style={{ position: 'relative' }}>
              <button
                className="rp-tool"
                data-on={gearOpen ? 'true' : 'false'}
                onClick={() => setGearOpen(o => !o)}
                title="Customize the card shown on the map"
                aria-label="Customize the card shown on the map"
                aria-expanded={gearOpen}
                style={{ width: 27, padding: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              {gearOpen && <CustomizeMenu fields={fields} onChange={onFieldsChange} />}
            </div>
          </div>
        </div>

        <div className="rp-row" style={{ marginTop: 6 }}>
          <span className="rp-veh" title={vehicleName}>{vehicleName}</span>
          <div ref={rangeRef} style={{ position: 'relative', marginLeft: 'auto', flexShrink: 0 }}>
            <button
              className="rp-date"
              onClick={() => setRangeOpen(o => !o)}
              aria-haspopup="dialog"
              aria-expanded={rangeOpen}
              title="Pick the period to replay"
            >
              {loading ? 'Loading…' : presetLabel}
              <Caret />
            </button>
            {rangeOpen && (
              <div className="rp-pop" role="dialog" aria-label="Replay period">
                <div role="radiogroup" aria-label="Period">
                  {PRESETS.map(p => (
                    <button
                      key={p.key}
                      role="radio"
                      aria-checked={presetKey === p.key}
                      className="rp-opt"
                      onClick={() => pickPreset(p.key)}
                    >
                      {p.label}
                      {presetKey === p.key && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>

                {presetKey === 'custom' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 9px 2px' }}>
                    {['from', 'to'].map(which => (
                      <label
                        key={which}
                        style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--c-text3)', fontWeight: 700, textTransform: 'capitalize' }}
                      >
                        {which}
                        <input
                          type="datetime-local"
                          value={custom[which]}
                          onChange={e => setCustom(c => ({ ...c, [which]: e.target.value }))}
                          style={{
                            padding: '5px 8px', borderRadius: 6, border: '1px solid var(--c-border)',
                            backgroundColor: 'var(--c-input)', color: 'var(--c-text1)', fontSize: 11.5,
                          }}
                        />
                      </label>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 9px 4px', borderTop: '1px solid var(--c-border)', marginTop: 6 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 1.45, color: expensive ? '#d97706' : 'var(--c-text3)' }}>
                    {!validRange
                      ? 'Pick a valid range — "to" must be after "from".'
                      : expensive
                        ? `⚠ ${chunks} sequential requests. This can take several minutes and may trigger Flespi rate limiting.`
                        : `${chunks} request${chunks > 1 ? 's' : ''}`}
                  </div>
                  <button
                    onClick={load}
                    disabled={loading || !validRange}
                    style={{
                      flexShrink: 0,
                      background: loading || !validRange ? 'var(--c-hover)' : 'var(--ft-accent)',
                      color: loading || !validRange ? 'var(--c-text3)' : '#fff',
                      border: 'none', borderRadius: 7, padding: '6px 14px',
                      fontSize: 11.5, fontWeight: 700,
                      cursor: loading || !validRange ? 'default' : 'pointer',
                    }}
                  >
                    {loading ? 'Loading…' : 'Load'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rp-stats">
          <div className="rp-stat"><b>{totals.distanceKm.toFixed(1)} km</b><span>Distance</span></div>
          <div className="rp-stat"><b>{fmtDuration(totals.driveSec)}</b><span>Driving</span></div>
          <div className="rp-stat"><b>{trips.length}</b><span>Trips</span></div>
        </div>

        {loading && status && (
          <div className="rp-msg" style={{ fontWeight: 600, color: status.startsWith('Rate limit') ? '#eab308' : 'var(--c-text2)' }}>
            {status}
          </div>
        )}
        {error && <div className="rp-msg" style={{ color: '#ef4444' }}>{error}</div>}
        {truncated && (
          <div className="rp-msg" style={{ color: '#eab308' }}>
            Route truncated — this range has more points than can be loaded at once. Narrow it for full detail.
          </div>
        )}
        {exportError && <div role="alert" className="rp-msg" style={{ color: '#ef4444' }}>{exportError}</div>}
      </div>

      {/* ── Event filters + the red-route speed ── */}
      <div className="rp-flt">
        <h5 className="rp-h5">Events on map (tap to hide)</h5>
        <div className="rp-chips">
          {view.groups.map(g => {
            const on = !view.hidden.has(g.key)
            return (
              <button
                key={g.key}
                className="rp-chip"
                aria-pressed={on}
                onClick={() => view.toggleGroup(g.key)}
                title={on ? `Hide ${g.label.toLowerCase()} events` : `Show ${g.label.toLowerCase()} events`}
              >
                <span className="rp-dot" style={{ width: 9, height: 9, borderRadius: '50%', background: g.color, display: 'inline-block' }} aria-hidden="true" />
                {g.label} <span className="n">{view.eventsLoading ? '…' : g.count}</span>
              </button>
            )
          })}
        </div>
        <label className="rp-hl">
          Highlight route above
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={400}
            value={hlDraft}
            onChange={onHighlight}
            onBlur={() => setHlDraft(String(view.highlightKmh))}
            aria-label="Highlight speed in km/h"
          />
          km/h in red
        </label>
        {view.eventsError && (
          <div className="rp-msg" style={{ color: '#d97706' }}>
            Alert events could not be loaded — only the harsh and ignition events read off the track are shown.
          </div>
        )}
        {view.eventsTruncated && (
          <div className="rp-msg" style={{ color: '#d97706' }}>Too many events in this range — showing the first ones. Narrow the range for all of them.</div>
        )}
      </div>

      {/* ── Trips ── */}
      <div className="rp-scroll">
        {allPoints.length > 0 && onSelectTrip && (
          <>
            <div className="rp-triphead">
              Trips ({trips.length})
              <button
                className="rp-pill"
                aria-pressed={selectedTrip == null && playingTrip == null}
                onClick={() => { if (playingTrip) onSelectTrip(null) }}
                title="Play the whole loaded range"
              >
                Whole range
              </button>
            </div>
            <ReplayTripsList
              trips={trips}
              selectedTrip={selectedTrip}
              byTrip={view.byTrip}
              outside={view.outside}
              places={view.places}
              driverOf={view.driverOf}
              multiDay={multiDay}
              activeEventId={activeEventId}
              onSelectTrip={t => onSelectTrip(t, { play: true })}
              onEventClick={onEventClick}
              zeroCount={view.zeroCount}
              showZero={view.showZero}
              onToggleZero={toggleZero}
            />
          </>
        )}
        {!error && !loading && allPoints.length === 0 && (
          <div style={{ padding: 14, fontSize: 11.5, color: 'var(--c-text3)', lineHeight: 1.5 }}>
            No route loaded yet — pick a period above.
          </div>
        )}
      </div>

      {/* Like Export, Share takes the picked trip, or the whole loaded range. */}
      {shareOpen && range && (
        <ShareReplayDialog
          vehicleId={vehicleId}
          vehicleName={selectedTrip ? `${vehicleName} · Trip ${selectedTrip.no}` : vehicleName}
          fromTs={selectedTrip ? selectedTrip.startTs : range.fromTs}
          toTs={selectedTrip ? selectedTrip.endTs : range.toTs}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  )
}
