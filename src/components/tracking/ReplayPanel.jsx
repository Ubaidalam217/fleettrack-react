import { useState } from 'react'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'

function pad(n) {
  return String(n).padStart(2, '0')
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time, no timezone suffix.
function toInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultRange() {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return { from: toInputValue(midnight), to: toInputValue(now) }
}

function fmtClock(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

// `replay` is the lifted state/actions object built by Tracking.jsx — this
// component only renders it and forwards input, it holds no track data itself.
export default function ReplayPanel({ vehicleId, replay }) {
  const [range, setRange] = useState(defaultRange)

  const { active, points, index, playing, loading, error, truncated, status,
          onStart, onStop, onLoad, onPlayToggle, onSeek } = replay

  if (!active) {
    return (
      <div style={{ padding: '4px 0 8px' }}>
        <button
          onClick={onStart}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: '#3b82f6', color: '#fff', border: 'none',
            borderRadius: 8, padding: '9px 16px', fontSize: 12.5, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          ▶ Replay Route
        </button>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.6 }}>
          View where this vehicle went for any date/time range, drawn as a route on the map.
        </div>
      </div>
    )
  }

  const current = points[index] ?? null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)' }}>Replay</span>
        <button
          onClick={onStop}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text3)', fontSize: 12, fontWeight: 600 }}
        >
          ✕ Exit
        </button>
      </div>

      {/* Date/time range */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10.5, color: 'var(--c-text3)', fontWeight: 600 }}>
          From
          <input
            type="datetime-local"
            value={range.from}
            onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
            style={{
              padding: '6px 8px', borderRadius: 6, border: '1px solid var(--c-border)',
              backgroundColor: 'var(--c-input)', color: 'var(--c-text1)', fontSize: 12,
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10.5, color: 'var(--c-text3)', fontWeight: 600 }}>
          To
          <input
            type="datetime-local"
            value={range.to}
            onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
            style={{
              padding: '6px 8px', borderRadius: 6, border: '1px solid var(--c-border)',
              backgroundColor: 'var(--c-input)', color: 'var(--c-text1)', fontSize: 12,
            }}
          />
        </label>
        <button
          onClick={() => {
            const fromTs = Math.floor(new Date(range.from).getTime() / 1000)
            const toTs   = Math.floor(new Date(range.to).getTime() / 1000)
            onLoad(fromTs, toTs)
          }}
          disabled={loading}
          style={{
            alignSelf: 'flex-end',
            background: loading ? 'var(--c-hover)' : '#3b82f6', color: loading ? 'var(--c-text3)' : '#fff',
            border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--c-text3)', marginBottom: 10 }}>
        Long ranges may take longer due to Flespi rate limits.
      </div>

      {loading && status && (
        <div style={{ fontSize: 12, color: status.startsWith('Rate limit') ? '#eab308' : 'var(--c-text2)', marginBottom: 10 }}>
          {status}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{error}</div>
      )}

      {!error && !loading && points.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--c-text3)', marginBottom: 10 }}>
          No route loaded yet — pick a range and press Load.
        </div>
      )}

      {truncated && (
        <div style={{ fontSize: 11, color: '#eab308', marginBottom: 10 }}>
          Route truncated — this range has more points than can be loaded at once. Narrow the range for full detail.
        </div>
      )}

      {points.length > 0 && (
        <>
          {/* Playback controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <button
              onClick={onPlayToggle}
              style={{
                width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: '#3b82f6', color: '#fff', fontSize: 13, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {playing ? '❙❙' : '▶'}
            </button>
            <input
              type="range"
              min={0}
              max={points.length - 1}
              value={index}
              onChange={e => onSeek(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 11, color: 'var(--c-text3)', flexShrink: 0, minWidth: 46, textAlign: 'right' }}>
              {index + 1}/{points.length}
            </span>
          </div>

          {/* Current point readout */}
          {current && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '8px 18px',
              padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)',
              fontSize: 12,
            }}>
              <span style={{ color: statusColor(current.status), fontWeight: 700 }}>
                ● {statusLabel(current.status)}
              </span>
              <span style={{ color: 'var(--c-text2)' }}>{current.speed} km/h</span>
              <span style={{ color: 'var(--c-text2)' }}>{fmtClock(current.ts)}</span>
              <span style={{ color: 'var(--c-text3)' }}>{current.lat.toFixed(5)}, {current.lng.toFixed(5)}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
