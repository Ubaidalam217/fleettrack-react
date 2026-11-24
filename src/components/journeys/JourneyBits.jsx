/**
 * Small pieces the Journey Management pages share. They read the .jms-theme
 * tokens (pages/journeys/jms.css), so they only look right inside it.
 */

import { STATUS_META, TIMING_META } from '../../data/journeys'
import { diffText } from '../../utils/journeySchedule'

export function StatusPill({ journey, display, delayMin }) {
  const key = display ?? journey?.display
  const meta = STATUS_META[key] ?? STATUS_META.Draft
  const late = delayMin ?? journey?.delayMin
  const running = ['InProgress', 'Delayed', 'Started'].includes(key)
  // On the road: say how late or early it is running, the way the mockups do.
  if (running && late != null && Math.abs(late) >= 1) {
    const tone = late > 10 ? 'bad' : late < -10 ? 'info' : 'ok'
    const text = late > 10 ? `Late ${late} min` : late < -10 ? `Early ${-late} min` : 'On time'
    return <span className="j-pill" data-tone={tone}>{text}</span>
  }
  return <span className="j-pill" data-tone={meta.tone}>{meta.label}</span>
}

/** Early / On time / Late with the minutes: the six events' chip. */
export function TimingChip({ timing, diffMin, compact = false }) {
  if (!timing) return null
  const meta = TIMING_META[timing]
  return (
    <span className="j-pill" data-tone={meta.tone} title={`${meta.label} ${diffText(diffMin)}`}>
      {compact ? diffText(diffMin) : `${meta.label}${diffMin ? ` ${diffText(diffMin)}` : ''}`}
    </span>
  )
}

/** The stops as dots on a line: done, current, ahead. */
export function StopDots({ stops = [], tone }) {
  const nowIdx = stops.findIndex(s => s.status === 'PENDING' || s.status === 'ARRIVED')
  return (
    <span className="j-stops" data-tone={tone} aria-label={`${stops.filter(s => s.status !== 'PENDING').length} of ${stops.length} stops`}>
      {stops.map((s, i) => {
        const done = ['DEPARTED', 'PASSED', 'SKIPPED'].includes(s.status) || (i === stops.length - 1 && s.status === 'ARRIVED')
        const st = done ? 'done' : i === nowIdx && nowIdx > 0 ? 'now' : 'todo'
        return (
          <span key={s.seq ?? i} style={{ display: 'contents' }}>
            {i > 0 && <b data-s={done || st === 'now' ? 'done' : 'todo'} />}
            <i data-s={st} title={s.name} />
          </span>
        )
      })}
    </span>
  )
}

/** A thin circular progress ring (the reference's "247 Days" ring). */
export function Ring({ value = 0, size = 96, stroke = 6, children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--j-line2)" strokeWidth={stroke} strokeDasharray="3 4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--j-text1)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}

/** The half gauge of the prototype: "Distance driven X km from Y km planned". */
export function HalfGauge({ value = 0, label, sub, tag }) {
  const v = Math.max(0, Math.min(1, value))
  const W = 240, H = 130, r = 100, cx = W / 2, cy = 118
  const arc = t => {
    const a = Math.PI * (1 - t)
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)]
  }
  const [x1, y1] = arc(0), [x2, y2] = arc(1), [xv, yv] = arc(v)
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: W, margin: '0 auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`} fill="none" stroke="var(--j-line2)" strokeWidth="22" strokeDasharray="2 5" />
        {v > 0 && <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${xv} ${yv}`} fill="none" stroke="var(--j-text1)" strokeWidth="22" strokeLinecap="butt" />}
      </svg>
      {tag && <span className="j-pill j-pill--plain" style={{ position: 'absolute', top: -6, left: 0, fontSize: 10, letterSpacing: '.08em' }}>{tag}</span>}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 4, textAlign: 'center' }}>
        <div className="j-num" style={{ fontSize: 34 }}>{label}</div>
        <div className="j-label">{sub}</div>
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, disabled, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="j-switch" onClick={() => onChange(!checked)} />
}

export function ErrorNote({ error }) {
  if (!error) return null
  return <div className="j-card" style={{ borderColor: 'rgba(255,143,128,.5)', marginBottom: 14, padding: '12px 16px', fontSize: 13 }}>{error}</div>
}

/** "No approval needed": a journey created without the approval step (client 2026-11-24). */
export function NoApprovalChip({ journey }) {
  if (journey?.approvalStatus !== 'NOT_REQUIRED') return null
  return <span className="j-pill j-pill--plain" data-tone="muted" title="This journey was created without needing approval">No approval needed</span>
}
