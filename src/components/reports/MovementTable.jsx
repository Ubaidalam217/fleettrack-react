// On-screen render of the Movement Report, deliberately mirroring the PDF the
// client's Ctrack sample produces: the same seven columns, the same blue header
// band, silver vehicle group rows, yellow date sub-headers and grey zebra data
// rows. Rendered on a white "paper" surface in both themes — it is a preview of
// a document, and it is also what the Print button sends to the printer.
import { memo, useMemo } from 'react'
import { rowLocation } from '../../utils/movementReport'

const BAND_BLUE   = '#b0c4de'
const GROUP_GRAY  = '#c0c0c0'
const DATE_YELLOW = '#ffffc0'
const ZEBRA_GRAY  = '#e6e6e6'
const INK         = '#111827'
const RULE        = '#9ca3af'

// Proportional to the PDF's column stops (23.1 / 119.9 / 183.6 / 288.6 / 418.9
// / 464.8 / 526.4 across an 816pt table).
const COL_WIDTHS = ['12%', '8%', '13%', '16%', '6%', '8%', '37%']

const HEADERS = [
  { label: 'Vehicle ID',          align: 'left'  },
  { label: 'Time',                align: 'left'  },
  { label: 'Driver ID',           align: 'left'  },
  { label: 'Status',              align: 'left'  },
  { label: 'Speed (km/h)',        align: 'right' },
  { label: 'Cumulative Odo (km)', align: 'right' },
  { label: 'Location',            align: 'left'  },
]

const cellBase = {
  padding: '3px 6px',
  fontSize: 11,
  color: INK,
  verticalAlign: 'top',
  lineHeight: 1.35,
}

/**
 * Flatten the grouped report into one render list so the table can be windowed
 * without losing its grouping — a group header is just another item.
 */
function toItems(report) {
  const items = []
  for (const vehicle of report.vehicles) {
    items.push({ kind: 'vehicle', key: `v-${vehicle.deviceId}`, vehicle })
    for (const date of vehicle.dates) {
      items.push({ kind: 'date', key: `d-${vehicle.deviceId}-${date.dateKey}`, date })
      let stamp = true
      for (const row of date.rows) {
        items.push({
          kind: 'row',
          key: `r-${vehicle.deviceId}-${row.ts}-${items.length}`,
          row,
          vehicleId: stamp ? vehicle.vehicleId : '',
        })
        stamp = false
      }
    }
  }
  return items
}

// Memoised: the page runs on live MQTT data, so its state updates several times
// a second. Without this the table would re-render every one of its rows on
// every telemetry push. `tick` is the deliberate escape hatch — geocoding fills
// the Location column by mutating rows in place, and bumping tick is what tells
// this component those mutations happened.
function MovementTable({ report, filters, limit, onShowMore }) {
  const items = useMemo(() => toItems(report), [report])
  const shown = limit >= items.length ? items : items.slice(0, limit)

  let zebra = false

  return (
    <div id="movement-report-paper" style={{ background: '#fff', borderRadius: 10, border: `1px solid var(--c-border)`, overflow: 'hidden' }}>

      {/* Document header — the PDF's title block and filter summary band */}
      <div style={{ padding: '14px 16px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, color: INK, lineHeight: 1.2 }}>Movement Report</div>
            <div style={{ fontSize: 11, color: INK, marginTop: 3 }}>AI Revofleet</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--ft-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20 8H4L2 14h20L20 8z" fill="white" />
                <circle cx="7" cy="18" r="2" fill="white" />
                <circle cx="17" cy="18" r="2" fill="white" />
              </svg>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>FleetmaX</span>
          </div>
        </div>
      </div>

      <div style={{
        background: BAND_BLUE, border: `1px solid ${INK}`, borderLeft: 'none', borderRight: 'none',
        padding: '6px 16px', display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', gap: '2px 16px',
        fontSize: 11, color: INK,
      }}>
        <div>Selection&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;{filters.selection}</div>
        <div>Apply Tolerance&nbsp;&nbsp;:&nbsp;&nbsp;{filters.applyTolerance ? 'True' : 'False'}</div>
        <div>Tolerance (m)&nbsp;:&nbsp;&nbsp;{filters.toleranceMeters}</div>
        <div>From Date&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;{filters.fromLabel}</div>
        <div>To Date&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;{filters.toLabel}</div>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={filters.statusesLabel}>
          Statuses&nbsp;:&nbsp;&nbsp;{filters.statusesLabel}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900 }}>
          <colgroup>
            {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr style={{ background: BAND_BLUE }}>
              {HEADERS.map(h => (
                <th
                  key={h.label}
                  style={{
                    ...cellBase,
                    fontWeight: 700,
                    textAlign: h.align,
                    borderTop: `1px solid ${INK}`,
                    borderBottom: `1px solid ${INK}`,
                    position: 'sticky',
                    top: 0,
                    background: BAND_BLUE,
                    zIndex: 1,
                  }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(item => {
              if (item.kind === 'vehicle') {
                zebra = false
                return (
                  <tr key={item.key} style={{ background: GROUP_GRAY }}>
                    <td style={{ ...cellBase, fontWeight: 700, borderTop: `1px solid ${RULE}` }}>{item.vehicle.vehicleId}</td>
                    <td colSpan={3} style={{ ...cellBase, borderTop: `1px solid ${RULE}` }} />
                    <td style={{ ...cellBase, fontWeight: 700, textAlign: 'right', borderTop: `1px solid ${RULE}` }}>{item.vehicle.maxSpeed}</td>
                    <td style={{ ...cellBase, fontWeight: 700, textAlign: 'right', borderTop: `1px solid ${RULE}` }}>{item.vehicle.totalDistanceKm.toFixed(3)}</td>
                    <td style={{ ...cellBase, borderTop: `1px solid ${RULE}` }} />
                  </tr>
                )
              }

              if (item.kind === 'date') {
                zebra = false
                return (
                  <tr key={item.key} style={{ background: DATE_YELLOW }}>
                    <td style={{ ...cellBase }} />
                    <td colSpan={3} style={{ ...cellBase, fontWeight: 700 }}>{item.date.label}</td>
                    <td style={{ ...cellBase, fontWeight: 700, textAlign: 'right' }}>{item.date.maxSpeed}</td>
                    <td style={{ ...cellBase }} />
                    <td style={{ ...cellBase }} />
                  </tr>
                )
              }

              const { row } = item
              const bg = zebra ? ZEBRA_GRAY : '#fff'
              zebra = !zebra
              return (
                <tr key={item.key} style={{ background: bg }}>
                  <td style={cellBase}>{item.vehicleId}</td>
                  <td style={cellBase}>{row.time}</td>
                  <td style={cellBase}>{row.driverId}</td>
                  <td style={cellBase}>{row.status}</td>
                  <td style={{ ...cellBase, textAlign: 'right' }}>{row.speed}</td>
                  <td style={{ ...cellBase, textAlign: 'right' }}>{row.odoKm.toFixed(3)}</td>
                  <td style={{ ...cellBase, wordBreak: 'break-word' }}>{rowLocation(row)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {shown.length < items.length && (
        <div className="report-screen-only" style={{ padding: '10px 16px', textAlign: 'center', borderTop: `1px solid ${RULE}` }}>
          <button
            onClick={onShowMore}
            style={{
              padding: '7px 16px', borderRadius: 8, border: '1px solid var(--ft-accent)',
              background: 'color-mix(in srgb, var(--ft-accent) 8%, transparent)', color: 'var(--ft-accent-hover)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Show more — {items.length - shown.length} rows hidden
          </button>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
            Exports and Print always include every row.
          </div>
        </div>
      )}

      <div style={{
        borderTop: `1px solid ${RULE}`, padding: '7px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10, color: INK,
      }}>
        <span>Print Date : {filters.printDate}</span>
        <span>FleetmaX</span>
        <span style={{ fontWeight: 700 }}>END OF REPORT</span>
      </div>
    </div>
  )
}

export default memo(MovementTable)
