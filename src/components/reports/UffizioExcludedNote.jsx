import { Info } from 'lucide-react'
import { useVehicles } from '../../data/settings'

/**
 * Said on every report that reads Flespi telemetry (client, 2026-11-25: the
 * Uffizio vehicles are in FleetmaxX now). Their trips, distance and
 * violations are not worked out from Uffizio's ~2-minute samples yet, so
 * these reports leave them out — and say so, rather than show them empty.
 * Nothing when the account has no Uffizio vehicle.
 */
export default function UffizioExcludedNote({ style }) {
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
        {n} Uffizio vehicle{n === 1 ? ' is' : 's are'} not in this report: it is worked out from Flespi tracker data, and their
        data comes from Uffizio (about every 2 minutes). See them on the Live Map, and their fuel in the Fuel Report.
      </span>
    </div>
  )
}
