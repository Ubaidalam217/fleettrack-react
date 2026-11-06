// On-screen render of the Movement Report, deliberately mirroring the PDF the
// client's Ctrack sample produces: the same seven columns, the same blue header
// band, silver vehicle group rows, yellow date sub-headers and grey zebra data
// rows. Rendered on a white "paper" surface in both themes — it is a preview of
// a document, and it is also what the Print button sends to the printer.
import { memo, useMemo } from 'react'
import { rowLocation, MOVEMENT_COLUMNS } from '../../utils/movementReport'

const BAND_BLUE   = '#b0c4de'
const GROUP_GRAY  = '#c0c0c0'
const DATE_YELLOW = '#ffffc0'
const ZEBRA_GRAY  = '#e6e6e6'
const INK         = '#111827'
const RULE        = '#9ca3af'

// Proportional to the PDF's column stops (23.1 / 119.9 / 183.6 / 288.6 / 418.9
// / 464.8 / 526.4 across an 816pt table).
const COL_WIDTHS = { vehicle: 12, time: 8, driver: 13, status: 16, speed: 6, odo: 8, location: 37 }
const NUMERIC = new Set(['speed', 'odo'])

/** The shown columns, their widths rescaled to fill the table. */
function layoutColumns(hidden) {
  const shown = MOVEMENT_COLUMNS.filter(c => !hidden?.has(c.key))
  const cols = shown.length ? shown : MOVEMENT_COLUMNS
  const sum = cols.reduce((a, c) => a + COL_WIDTHS[c.key], 0)
  return cols.map(c => ({ ...c, width: `${(COL_WIDTHS[c.key] / sum) * 100}%`, align: NUMERIC.has(c.key) ? 'right' : 'left' }))
}

/**
 * The cells of a vehicle or date band. Its text goes in `textKey`'s column (or
 * the first text column shown) and runs on over the empty cells after it, the
 * way the PDF's band label does; `values` fill the number columns.
 */
function bandCells(cols, textKey, text, values) {
  const at = cols.some(c => c.key === textKey) ? textKey : (cols.find(c => !NUMERIC.has(c.key)) ?? cols[0]).key
  const cells = []
  for (const c of cols) {
    const value = c.key === at ? text : values[c.key]
    const last = cells[cells.length - 1]
    if (value === undefined && last?.isText) { last.span += 1; continue }
    cells.push({ key: c.key, value, span: 1, isText: c.key === at, align: c.align })
  }
  return cells
}

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
function MovementTable({ report, filters, limit, onShowMore, onLocate, hidden }) {
  const cols = useMemo(() => layoutColumns(hidden), [hidden])
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
            <div style={{ fontSize: 11, color: INK, marginTop: 3 }}>{filters.company || 'FleetmaxX'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* The paper is white in both themes, so the light-theme logo. */}
            <img src="/logo/fleetmax-logo-sea.png" alt="FleetmaxX" style={{ height: 26, width: 'auto' }} />
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
        <div>
          Tolerance (m)&nbsp;:&nbsp;&nbsp;{filters.toleranceMeters}
          {filters.intervalSec > 0 && <>&nbsp;&nbsp;&nbsp;Interval&nbsp;:&nbsp;&nbsp;{filters.intervalLabel}</>}
        </div>
        <div>From Date&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;{filters.fromLabel}</div>
        <div>To Date&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;{filters.toLabel}</div>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={filters.statusesLabel}>
          Statuses&nbsp;:&nbsp;&nbsp;{filters.statusesLabel}
        </div>
      </div>

      {/* Scrolls sideways on a narrow screen, with the bar hidden as the client asked. */}
      <div className="no-scrollbar" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900 }}>
          <colgroup>
            {cols.map(c => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr style={{ background: BAND_BLUE }}>
              {cols.map(h => (
                <th
                  key={h.key}
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
                const cells = bandCells(cols, 'vehicle', item.vehicle.vehicleId, { speed: item.vehicle.maxSpeed, odo: item.vehicle.totalDistanceKm.toFixed(3) })
                return (
                  <tr key={item.key} style={{ background: GROUP_GRAY }}>
                    {cells.map(c => (
                      <td key={c.key} colSpan={c.span} style={{ ...cellBase, fontWeight: 700, textAlign: c.align, borderTop: `1px solid ${RULE}` }}>{c.value}</td>
                    ))}
                  </tr>
                )
              }

              if (item.kind === 'date') {
                zebra = false
                const cells = bandCells(cols, 'time', item.date.label, { speed: item.date.maxSpeed })
                return (
                  <tr key={item.key} style={{ background: DATE_YELLOW }}>
                    {cells.map(c => (
                      <td key={c.key} colSpan={c.span} style={{ ...cellBase, fontWeight: 700, textAlign: c.align }}>{c.value}</td>
                    ))}
                  </tr>
                )
              }

              const { row } = item
              const bg = zebra ? ZEBRA_GRAY : '#fff'
              zebra = !zebra
              return (
                <tr key={item.key} style={{ background: bg }}>
                  {cols.map(c => c.key !== 'location' && (
                    <td key={c.key} style={{ ...cellBase, textAlign: c.align }}>
                      {{ vehicle: item.vehicleId, time: row.time, driver: row.driverId, status: row.status, speed: row.speed, odo: row.odoKm.toFixed(3) }[c.key]}
                    </td>
                  ))}
                  {cols.some(c => c.key === 'location') && (
                  <td style={{ ...cellBase, wordBreak: 'break-word' }}>
                    {/* Client 2026-11-02: clicking a location shows it on our own map. */}
                    {onLocate && row.lat != null && row.lng != null ? (
                      <button
                        type="button"
                        onClick={() => onLocate({ lat: row.lat, lng: row.lng, ts: row.ts, time: row.time, status: row.status, vehicleId: item.vehicleId, location: rowLocation(row) })}
                        title="Show this location on the map"
                        style={{ padding: 0, border: 0, background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer', color: '#0a7e9c', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }}
                      >
                        {rowLocation(row)}
                      </button>
                    ) : rowLocation(row)}
                  </td>
                  )}
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
        <span>FleetmaxX</span>
        <span style={{ fontWeight: 700 }}>END OF REPORT</span>
      </div>
    </div>
  )
}

export default memo(MovementTable)
