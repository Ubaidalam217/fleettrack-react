import { severityTone } from './alertStyle'

/** A rule's or an event's severity as a small coloured pill. */
export default function SeverityChip({ severity }) {
  const tone = severityTone(severity)
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`, whiteSpace: 'nowrap' }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
      {severity || 'Medium'}
    </span>
  )
}
