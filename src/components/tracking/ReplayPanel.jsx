import { useState, useEffect, useRef } from 'react'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { REPLAY_FIELDS } from './replayFields'

// Playback rates offered by the selector.
const SPEEDS = [0.5, 1, 2, 5, 10]

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

// Mirrors replay.js's chunking exactly, so the count shown is the count sent.
function chunkCount(fromTs, toTs) {
  return Math.max(1, Math.ceil((toTs - fromTs) / CHUNK_SECONDS))
}

function fmtClock(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

// ── bits ───────────────────────────────────────────────────────────────────

function Chip({ active, onClick, children, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        flexShrink: 0,
        padding: '5px 11px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--ft-accent)' : 'var(--c-border)'}`,
        background: active ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'var(--c-input)',
        color: active ? 'var(--ft-accent)' : 'var(--c-text2)',
        fontSize: 11,
        fontWeight: active ? 700 : 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  )
}

function CustomizeMenu({ fields, onChange, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const onDown = e => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 20,
        minWidth: 176, padding: '9px 6px 7px',
        borderRadius: 10, border: '1px solid var(--c-border2)',
        background: 'var(--c-card)', boxShadow: '0 10px 32px rgba(0,0,0,0.22)',
      }}
    >
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
        color: 'var(--c-text3)', padding: '0 9px 7px',
      }}>
        Show on map card
      </div>
      {REPLAY_FIELDS.map(f => (
        <label
          key={f.key}
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '6px 9px', borderRadius: 7, cursor: 'pointer',
            fontSize: 12, color: 'var(--c-text1)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--c-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
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
 * The replay control dock, floated over the bottom of the map.
 *
 * `replay` is the lifted state/actions object built by Tracking.jsx — this
 * component renders it and forwards input, it holds no track data itself.
 */
export default function ReplayPanel({ replay, vehicleName }) {
  const {
    points, index, playing, loading, error, truncated, status,
    speed, fields,
    onStop, onLoad, onPlayToggle, onSeek, onSpeedChange, onFieldsChange,
  } = replay

  const [presetKey, setPresetKey] = useState('today')
  const [custom, setCustom]       = useState(() => {
    const [from, to] = presetRange('today')
    return { from: toInputValue(from), to: toInputValue(to) }
  })
  // Once a route is on the map the range picker folds away, so the dock stays
  // slim while you are actually watching the playback.
  const [rangeOpen, setRangeOpen] = useState(true)
  const [gearOpen, setGearOpen]   = useState(false)

  const hasPoints = points.length > 0
  const current   = points[index] ?? null

  const rangeTs = () => {
    if (presetKey === 'custom') {
      return [
        Math.floor(new Date(custom.from).getTime() / 1000),
        Math.floor(new Date(custom.to).getTime() / 1000),
      ]
    }
    const [from, to] = presetRange(presetKey)
    return [Math.floor(from.getTime() / 1000), Math.floor(to.getTime() / 1000)]
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
    const f = Math.floor(from.getTime() / 1000)
    const t = Math.floor(to.getTime() / 1000)
    if (chunkCount(f, t) <= WARN_ABOVE_CHUNKS) {
      setRangeOpen(false)
      onLoad(f, t)
    }
  }

  const presetLabel = PRESETS.find(p => p.key === presetKey)?.label ?? 'Today'

  return (
    <div style={{
      borderRadius: 14,
      border: '1px solid var(--c-border2)',
      background: 'var(--c-card)',
      boxShadow: '0 10px 34px rgba(0,0,0,0.25)',
      padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text1)', flexShrink: 0 }}>
          Replay
        </span>
        <span style={{
          fontSize: 11.5, color: 'var(--c-text3)', flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {vehicleName}
        </span>

        {!rangeOpen && (
          <button
            onClick={() => setRangeOpen(true)}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
              background: 'var(--c-hover)', border: '1px solid var(--c-border)',
              borderRadius: 7, padding: '4px 9px',
              fontSize: 11, fontWeight: 600, color: 'var(--c-text2)', cursor: 'pointer',
            }}
          >
            {presetLabel}
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}

        <button
          onClick={onStop}
          title="Exit replay"
          style={{
            flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--c-text3)', padding: 3, display: 'flex', borderRadius: 6,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Range picker */}
      {rangeOpen && (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {PRESETS.map(p => (
              <Chip key={p.key} active={presetKey === p.key} onClick={() => pickPreset(p.key)}>
                {p.label}
              </Chip>
            ))}
          </div>

          {presetKey === 'custom' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 1.5, color: expensive ? '#d97706' : 'var(--c-text3)' }}>
              {!validRange
                ? 'Pick a valid range — "to" must be after "from".'
                : expensive
                  ? `⚠ ${chunks} sequential requests. This can take several minutes and may trigger Flespi rate limiting.`
                  : `${chunks} request${chunks > 1 ? 's' : ''} · long ranges may take longer due to Flespi rate limits.`}
            </div>
            <button
              onClick={load}
              disabled={loading || !validRange}
              style={{
                flexShrink: 0,
                background: loading || !validRange ? 'var(--c-hover)' : 'var(--ft-accent)',
                color: loading || !validRange ? 'var(--c-text3)' : '#fff',
                border: 'none', borderRadius: 7, padding: '7px 16px',
                fontSize: 11.5, fontWeight: 700,
                cursor: loading || !validRange ? 'default' : 'pointer',
              }}
            >
              {loading ? 'Loading…' : 'Load'}
            </button>
          </div>
        </>
      )}

      {/* Messages */}
      {loading && status && (
        <div style={{ fontSize: 11, fontWeight: 600, color: status.startsWith('Rate limit') ? '#eab308' : 'var(--c-text2)' }}>
          {status}
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: '#ef4444' }}>{error}</div>}
      {truncated && (
        <div style={{ fontSize: 10.5, color: '#eab308' }}>
          Route truncated — this range has more points than can be loaded at once. Narrow it for full detail.
        </div>
      )}
      {!error && !loading && !hasPoints && !rangeOpen && (
        <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>
          No route loaded yet — pick a range and press Load.
        </div>
      )}

      {/* Playback */}
      {hasPoints && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onPlayToggle}
            title={playing ? 'Pause' : 'Play'}
            style={{
              width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'var(--ft-accent)', color: '#fff', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {playing ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="5" y="4" width="5" height="16" rx="1" /><rect x="14" y="4" width="5" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="6 4 20 12 6 20" />
              </svg>
            )}
          </button>

          <input
            type="range"
            min={0}
            max={points.length - 1}
            value={index}
            onChange={e => onSeek(Number(e.target.value))}
            style={{ flex: 1, minWidth: 60, accentColor: 'var(--ft-accent)' }}
          />

          <span style={{ fontSize: 10.5, color: 'var(--c-text3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {index + 1}/{points.length}
          </span>

          {/* Playback speed */}
          <div style={{
            display: 'flex', flexShrink: 0, borderRadius: 7, overflow: 'hidden',
            border: '1px solid var(--c-border)',
          }}>
            {SPEEDS.map(s => (
              <button
                key={s}
                onClick={() => onSpeedChange(s)}
                style={{
                  padding: '4px 7px', border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 700,
                  background: speed === s ? 'var(--ft-accent)' : 'var(--c-input)',
                  color: speed === s ? '#fff' : 'var(--c-text3)',
                  transition: 'background 0.15s',
                }}
              >
                {s}x
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setGearOpen(o => !o)}
              title="Customize the card shown on the map"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 27, height: 27, borderRadius: 7, cursor: 'pointer',
                border: '1px solid var(--c-border)',
                background: gearOpen ? 'var(--c-hover)' : 'var(--c-input)',
                color: 'var(--c-text2)',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {gearOpen && (
              <CustomizeMenu
                fields={fields}
                onChange={onFieldsChange}
                onClose={() => setGearOpen(false)}
              />
            )}
          </div>
        </div>
      )}

      {/* Current point readout — the same numbers the map card shows, kept here
          so they stay legible when the map card's fields are switched off. */}
      {hasPoints && current && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '4px 14px',
          fontSize: 10.5, color: 'var(--c-text3)',
        }}>
          <span style={{ color: statusColor(current.status), fontWeight: 700 }}>
            ● {statusLabel(current.status)}
          </span>
          <span>{current.speed ?? 0} km/h</span>
          <span>{fmtClock(current.ts)}</span>
        </div>
      )}
    </div>
  )
}
