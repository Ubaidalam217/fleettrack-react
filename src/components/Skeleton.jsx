/**
 * Shimmer placeholders shown while a card, a report or a panel tab loads, in
 * place of a bare "Loading…" line. The text still reaches screen readers.
 * Styles: .ft-skel* in index.css (theme tokens; static under reduced motion).
 */

const WIDTHS = ['92%', '78%', '86%', '64%', '88%', '72%', '80%', '58%']

/** A few text-like bars. */
export default function Skeleton({ lines = 3, label = 'Loading…', style }) {
  return (
    <div className="ft-skel-wrap" role="status" aria-live="polite" style={style}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="ft-skel" style={{ width: WIDTHS[i % WIDTHS.length] }} />
      ))}
    </div>
  )
}

/** A report body: a header strip and table-like rows. */
export function ReportSkeleton({ rows = 8, label = 'Generating the report…' }) {
  return (
    <div className="ft-skel-wrap report-screen-only" role="status" aria-live="polite"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 18, gap: 10 }}>
      <span className="sr-only">{label}</span>
      <div className="ft-skel" style={{ width: '38%', height: 16 }} />
      <div className="ft-skel" style={{ width: '100%', height: 24, marginTop: 6 }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ft-skel" style={{ width: '100%', height: 12, opacity: 1 - i * 0.07 }} />
      ))}
    </div>
  )
}

/** A chart area. */
export function ChartSkeleton({ label = 'Loading…', style }) {
  return (
    <div className="ft-skel-wrap" role="status" aria-live="polite" style={{ height: '100%', justifyContent: 'flex-end', ...style }}>
      <span className="sr-only">{label}</span>
      <div className="ft-skel" style={{ width: '100%', flex: 1, minHeight: 40, borderRadius: 10 }} />
      <div className="ft-skel" style={{ width: '70%' }} />
    </div>
  )
}
