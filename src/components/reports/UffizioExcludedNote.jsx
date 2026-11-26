import { Info } from 'lucide-react'
import { useVehicles } from '../../data/settings'

/** Why the violation reports leave the Uffizio vehicles out. */
export const VIOLATION_EXCLUDED_REASON = 'violations (over speed, harsh braking and acceleration, cornering, idling, tamper) are raised from tracker data second by second, and Uffizio sends one position about every 2 minutes and no such events. Their fuel alerts are in the Event Occurrence Report; their trips, speeds and distance in the Trip and Daywise reports.'
/** Why the tacho reports leave the Uffizio vehicles out. */
export const TACHO_EXCLUDED_REASON = 'a tacho graph needs the speed second by second, and Uffizio sends one position about every 2 minutes. Their trips, speeds and distance are in the Trip, Movement and Daywise reports.'

/**
 * Said on a report that cannot include the Uffizio vehicles (client,
 * 2026-11-26: every other standard report includes them), with the precise
 * reason. Nothing when the account has no Uffizio vehicle.
 */
export default function UffizioExcludedNote({ reason, style }) {
  const rows = useVehicles()
  const n = (rows ?? []).filter(v => v?.dataSource === 'UFFIZIO').length
  if (!n) return null
  return (
    <div
      className="report-screen-only"
      role="note"
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.5,
        color: 'var(--c-text2)', padding: '8px 12px', borderRadius: 10, marginBottom: 14,
        background: 'color-mix(in srgb, #0ea5e9 9%, transparent)', border: '1px solid color-mix(in srgb, #0ea5e9 25%, transparent)',
        ...style,
      }}
    >
      <Info size={14} aria-hidden="true" style={{ color: '#0ea5e9', flexShrink: 0, marginTop: 2 }} />
      <span>
        {n} Uffizio vehicle{n === 1 ? ' is' : 's are'} not in this report: {reason || 'it is worked out from second-by-second tracker data, and Uffizio sends one position about every 2 minutes.'}
      </span>
    </div>
  )
}
