import { useMemo, useRef } from 'react'
import {
  timelineSegments, timeFraction, indexAtFraction, speedSeries, pointState,
} from '../../utils/replayTimeline'
import { eventSummary } from '../../utils/replayEvents'
import { useSettledAddress } from '../../hooks/useAddress'
import { shortenAddress } from '../../utils/geocode'

const SPEEDS = [0.5, 1, 2, 5, 10]

const STATE = {
  driving: { label: 'Driving', color: '#43a047' },
  idle:    { label: 'Idle',    color: '#f2b705' },
  stopped: { label: 'Stopped', color: '#b0bec5' },
}
const GAP_BG = 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--c-text3) 22%, transparent) 0 3px, transparent 3px 6px)'

// The chart's drawing box; the SVG stretches it to the bar's width.
const CW = 1000
const CH = 46

const CSS = `
  .rpb {
    background: var(--c-card); color: var(--c-text1);
    border: 1px solid var(--c-border2); border-radius: 14px;
    padding: 10px 14px 8px; box-shadow: 0 8px 22px rgba(0,0,0,0.16);
  }
  .rpb-row { display: flex; align-items: center; gap: 12px; }
  .rpb-play {
    width: 32px; height: 32px; border-radius: 50%; border: none; flex: none; cursor: pointer;
    background: var(--ft-accent); color: #fff; display: grid; place-items: center;
  }
  .rpb-tl { position: relative; flex: 1; min-width: 80px; height: 12px; cursor: pointer; touch-action: none; }
  .rpb-tl:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: 6px; border-radius: 6px; }
  .rpb-track { position: absolute; inset: 0; border-radius: 6px; overflow: hidden; background: color-mix(in srgb, var(--c-text3) 14%, transparent); }
  .rpb-seg { position: absolute; top: 0; bottom: 0; }
  .rpb-knob {
    position: absolute; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
    background: var(--c-card); border: 3px solid var(--c-text1); z-index: 2; pointer-events: none;
  }
  .rpb-ev {
    position: absolute; top: -9px; width: 10px; height: 10px; margin-left: -5px; padding: 0; border-radius: 50%;
    border: 2px solid var(--c-card); box-shadow: 0 0 0 1px rgba(0,0,0,0.15); z-index: 1; cursor: pointer;
  }
  .rpb-ev[aria-current="true"] { width: 13px; height: 13px; margin-left: -6.5px; top: -11px; box-shadow: 0 0 0 2px var(--c-text1); }
  .rpb-ev:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: 1px; }
  .rpb-speeds { display: flex; gap: 4px; flex-shrink: 0; }
  .rpb-speeds button {
    padding: 3px 7px; border: 1px solid var(--c-border); border-radius: 7px; background: transparent;
    color: var(--c-text2); font-size: 11px; font-weight: 600; cursor: pointer;
  }
  .rpb-speeds button[aria-pressed="true"] { background: var(--ft-accent); color: #fff; border-color: var(--ft-accent); }
  .rpb-speeds button:focus-visible, .rpb-play:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: 2px; }
  .rpb-info {
    display: flex; align-items: center; gap: 4px 16px; margin-top: 7px; padding-left: 44px;
    font-size: 11.5px; color: var(--c-text2); min-width: 0;
  }
  .rpb-info b { color: var(--c-text1); }
  .rpb-addr { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rpb-legend { display: flex; gap: 10px; margin-left: auto; flex-shrink: 0; font-size: 10.5px; color: var(--c-text2); }
  .rpb-legend span { display: flex; align-items: center; gap: 4px; }
  .rpb-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
  .rpb-chart {
    position: relative; margin: 8px 0 0 44px; height: 46px; cursor: pointer; touch-action: none;
    border-top: 1px dashed var(--c-border);
  }
  .rpb-chart svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .rpb-limit { position: absolute; right: 0; top: 2px; font-size: 10px; font-weight: 700; color: #e53935; pointer-events: none; }
  @container (max-width: 640px) {
    .rpb-legend { display: none; }
    .rpb-speeds button { padding: 3px 5px; }
  }
  @container (max-width: 500px) {
    .rpb { padding: 8px 10px 6px; }
    .rpb-row { flex-wrap: wrap; row-gap: 8px; }
    .rpb-speeds { order: 3; width: 100%; justify-content: center; }
    .rpb-info { padding-left: 0; flex-wrap: wrap; gap: 2px 10px; }
    .rpb-chart { margin-left: 0; }
  }
  @container (max-height: 380px) {
    .rpb-chart { display: none; }
  }
`

const pad = n => String(n).padStart(2, '0')

function fmtStamp(ts) {
  if (!Number.isFinite(ts)) return '—'
  const d = new Date(ts * 1000)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** "M x,y L x,y …" per unbroken run of the series, and the same runs closed to the floor for the fill. */
function chartPaths(series, yOf) {
  let line = ''
  let area = ''
  let run = []
  const flush = () => {
    if (run.length) {
      const pts = run.length === 1 ? [run[0], [run[0][0] + 1, run[0][1]]] : run
      line += `M${pts.map(p => p.join(',')).join('L')}`
      area += `M${pts[0][0]},${CH}L${pts.map(p => p.join(',')).join('L')}L${pts[pts.length - 1][0]},${CH}Z`
    }
    run = []
  }
  for (const s of series) {
    if (s.v === null) { flush(); continue }
    run.push([Math.round(s.f * CW * 10) / 10, Math.round(yOf(s.v) * 10) / 10])
  }
  flush()
  return { line, area }
}

/**
 * The replay player over the bottom of the map (approved replay "Option C"):
 * play / pause, a timeline coloured by what the vehicle was doing — driving,
 * idle, stopped, and gaps with no data — with the events above it, the speed
 * buttons, a status line for the moment under the knob, and a small speed
 * chart with the limit dashed in red.
 *
 * Everything is laid out by time. Dragging the timeline or the chart seeks.
 */
export default function ReplayPlayerBar({
  points, index, playing, speed, limitKmh,
  events, activeEventId,
  onPlayToggle, onSeek, onSpeedChange, onEventClick,
}) {
  const trackRef = useRef(null)
  const chartRef = useRef(null)

  const segments = useMemo(() => timelineSegments(points), [points])
  const series = useMemo(() => speedSeries(points), [points])
  const t0 = points[0]?.ts
  const t1 = points[points.length - 1]?.ts
  const onTimeline = useMemo(
    () => (events ?? []).filter(e => e.fromTs >= t0 && e.fromTs <= t1),
    [events, t0, t1]
  )

  const current = points[index] ?? null
  const knob = current ? timeFraction(points, current.ts) : 0
  const state = STATE[pointState(current)] ?? STATE.stopped
  const address = useSettledAddress(current?.lat, current?.lng, !!current, playing ? 1500 : 500)

  // Speed axis: room for the limit line and the fastest reading.
  const top = Math.max(20, (limitKmh || 0) * 1.25, ...series.map(s => s.v ?? 0)) * 1.08
  const yOf = v => CH - 1 - (Math.max(0, v) / top) * (CH - 3)
  const { line, area } = useMemo(() => chartPaths(series, yOf), [series, top]) // eslint-disable-line react-hooks/exhaustive-deps
  const limitY = limitKmh > 0 ? yOf(limitKmh) : null

  // Pointer seeking, shared by the timeline and the chart.
  const seekFrom = (el, clientX) => {
    const r = el.getBoundingClientRect()
    if (!r.width) return
    onSeek(indexAtFraction(points, (clientX - r.left) / r.width))
  }
  const dragHandlers = ref => ({
    onPointerDown: e => {
      if (e.button != null && e.button !== 0) return
      e.currentTarget.setPointerCapture?.(e.pointerId)
      seekFrom(ref.current, e.clientX)
    },
    onPointerMove: e => {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) seekFrom(ref.current, e.clientX)
    },
  })

  const step = Math.max(1, Math.round(points.length / 200))
  const onKeyDown = e => {
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = index + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = index - step
    else if (e.key === 'PageUp') next = index + step * 10
    else if (e.key === 'PageDown') next = index - step * 10
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = points.length - 1
    else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); onPlayToggle(); return }
    if (next === null) return
    e.preventDefault()
    onSeek(Math.max(0, Math.min(points.length - 1, next)))
  }

  return (
    <div className="rpb">
      <style>{CSS}</style>

      <div className="rpb-row">
        <button className="rpb-play" onClick={onPlayToggle} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="5" y="4" width="5" height="16" rx="1" /><rect x="14" y="4" width="5" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="7 4 20 12 7 20" />
            </svg>
          )}
        </button>

        <div
          ref={trackRef}
          className="rpb-tl"
          role="slider"
          tabIndex={0}
          aria-label="Replay position"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, points.length - 1)}
          aria-valuenow={index}
          aria-valuetext={current ? `${state.label}, ${Math.round(current.speed ?? 0)} km/h, ${fmtStamp(current.ts)}` : undefined}
          onKeyDown={onKeyDown}
          {...dragHandlers(trackRef)}
        >
          <div className="rpb-track">
            {segments.map(s => (
              <div
                key={s.fromIdx}
                className="rpb-seg"
                style={{
                  left: `${s.start * 100}%`,
                  width: `${Math.max(0.15, (s.end - s.start) * 100)}%`,
                  background: s.state === 'gap' ? GAP_BG : STATE[s.state].color,
                }}
                title={s.state === 'gap' ? 'No data' : STATE[s.state].label}
              />
            ))}
          </div>
          {onTimeline.map(e => (
            <button
              key={e.id}
              className="rpb-ev"
              aria-current={activeEventId === e.id ? 'true' : undefined}
              style={{ left: `${timeFraction(points, e.fromTs) * 100}%`, background: e.color }}
              title={`${fmtStamp(e.fromTs).slice(11)} · ${eventSummary(e)}`}
              aria-label={`${eventSummary(e)} at ${fmtStamp(e.fromTs)}`}
              onPointerDown={ev => ev.stopPropagation()}
              onClick={() => onEventClick(e)}
            />
          ))}
          <div className="rpb-knob" style={{ left: `${knob * 100}%` }} />
        </div>

        <div className="rpb-speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map(s => (
            <button key={s} aria-pressed={speed === s} onClick={() => onSpeedChange(s)}>{s}x</button>
          ))}
        </div>
      </div>

      <div className="rpb-info" aria-live="off">
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span className="rpb-dot" style={{ background: state.color }} aria-hidden="true" />
          <b>{state.label}</b>
        </span>
        <b style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{Math.round(current?.speed ?? 0)} km/h</b>
        <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtStamp(current?.ts)}</span>
        <span className="rpb-addr" title={address ?? undefined}>{address ? shortenAddress(address, 3) : ''}</span>
        <span className="rpb-legend" aria-hidden="true">
          <span><span className="rpb-dot" style={{ background: STATE.driving.color }} />Driving</span>
          <span><span className="rpb-dot" style={{ background: STATE.idle.color }} />Idle</span>
          <span><span className="rpb-dot" style={{ background: STATE.stopped.color }} />Stopped</span>
          <span><span className="rpb-dot" style={{ background: 'var(--c-card)', boxShadow: '0 0 0 1.5px var(--c-text2)' }} />events</span>
        </span>
      </div>

      <div ref={chartRef} className="rpb-chart" {...dragHandlers(chartRef)} aria-hidden="true">
        {limitY !== null && <span className="rpb-limit">limit {Math.round(limitKmh)}</span>}
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none">
          {limitY !== null && (
            <line x1="0" y1={limitY} x2={CW} y2={limitY} stroke="#e53935" strokeDasharray="6 5" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          )}
          <path d={area} style={{ fill: 'color-mix(in srgb, var(--ft-accent) 13%, transparent)', stroke: 'none' }} />
          <path d={line} style={{ fill: 'none', stroke: 'var(--ft-accent)' }} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <line x1={knob * CW} y1="0" x2={knob * CW} y2={CH} style={{ stroke: 'var(--c-text1)' }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  )
}
