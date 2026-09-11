// Subtle tag for cards whose numbers are not backed by live Flespi telemetry
// (driver scores, trip counts, cost/fuel figures). Flags them as estimates
// so they are never mistaken for live data. See per-card disclaimers for detail.
export default function EstimatedBadge({ dark = false }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
      textTransform: 'uppercase', borderRadius: 20, padding: '2px 7px',
      flexShrink: 0,
      color:      dark ? 'rgba(255,255,255,0.75)' : '#b45309',
      background: dark ? 'rgba(255,255,255,0.12)' : 'rgba(245,158,11,0.12)',
      border:     `1px solid ${dark ? 'rgba(255,255,255,0.18)' : 'rgba(245,158,11,0.25)'}`,
    }}>
      Estimated
    </span>
  )
}
