import { useMemo } from 'react'
import { Info } from 'lucide-react'
import { vehicleLabel } from '../../utils/vehicleLabel'
import { estimatedUffizioIds, hasUffizio, uffizioNotes } from '../../utils/uffizioReports'

/**
 * The footnote of a report that has Uffizio vehicles in it (client,
 * 2026-11-26): their positions come every ~2 minutes and their distance from
 * the odometer — said once, under the report, and printed with it. Nothing
 * when no Uffizio vehicle is in the report.
 */
export default function UffizioFootnote({ notes, style }) {
  if (!notes?.length) return null
  return (
    <div
      role="note"
      className="uffizio-footnote"
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11.5, lineHeight: 1.5,
        color: 'var(--c-text3)', margin: '10px 2px 0', ...style,
      }}
    >
      <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--c-text3)' }} />
      <div>{notes.map(n => <div key={n}>{n}</div>)}</div>
    </div>
  )
}

/**
 * The notes for a fetched report: [] without an Uffizio vehicle; else the
 * footnote, the vehicles whose distance is estimated, and `extra`.
 * @param {Map} byDevice   the report's fetched messages per device id
 * @param {object[]} vehicles  live vehicles (id + label)
 */
export function useUffizioNotes(byDevice, vehicles, fromTs, toTs, extra = []) {
  const extraKey = extra.join('|')
  return useMemo(() => {
    if (!byDevice || !hasUffizio(byDevice)) return []
    const ids = estimatedUffizioIds(byDevice, fromTs, toTs)
    const names = [...ids].map(id => {
      const v = (vehicles ?? []).find(x => x.id === id)
      return (v && (v.label || vehicleLabel(v))) || id
    })
    return uffizioNotes({ present: true, estimated: names, extra })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDevice, vehicles, fromTs, toTs, extraKey])
}
