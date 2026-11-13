/**
 * The on-screen "paper" every list-style report renders: the same document
 * look as the Movement Report (title block, blue filter band, blue header row,
 * silver group bars, zebra rows, END OF REPORT) driven by a column config.
 *
 * columns: [{ key, label, width ('12%'), align?, locate? }]
 *   Pass only the columns to show (utils/reportColumns.js); the percentages
 *   are rescaled so the ones left still fill the page.
 *   `locate` makes the cell a button that calls onLocate(row) when the row has
 *   lat/lng — the same "show it on our map" as the Movement Report.
 *   `clickable` makes a cell with a value (not 0 or —) a button that calls
 *   onCellClick(row, column) — the Violation Overview's counts open their events.
 * groups:  [{ key, label, rows, total? }]
 *   A row `{ kind: 'band', label }` is a yellow sub-heading (a date, say);
 *   `row.zebra` shades a data row. Groups with no `zebra` set alternate by index.
 *   `row.strong` is a column-aligned total line: bold, on the total yellow.
 *   `total: false` leaves out the group's own total line.
 * summary: [{ label, value }] — the "Report Summary" block after the table,
 *   the way the client's Ctrack MaXx reports end.
 */

import { AccountLogo, ReportLogoPicker } from './ReportLogo'

export const BAND_BLUE  = '#b0c4de'
export const GROUP_GRAY = '#c0c0c0'
export const TOTAL_YEL  = '#ffffc0'
export const ZEBRA_GRAY = '#e6e6e6'
export const INK        = '#111827'
export const RULE       = '#9ca3af'

/**
 * The paper's title block and blue filter band — exported so a report whose
 * table is not a PaperTable (the daywise grid) still opens the same way.
 */
export function PaperHead({ title, company, filters = [] }) {
  return (
    <>
      <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        {/* The account's logo at the left, FleetmaxX at the right (client, 2026-11-13). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <AccountLogo height={36} maxWidth={140} />
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, color: INK, lineHeight: 1.2 }}>{title}</div>
            {company && <div style={{ fontSize: 11, color: INK, marginTop: 3 }}>{company}</div>}
          </div>
        </div>
        <img src="/logo/fleetmax-logo-sea.png" alt="FleetmaxX" style={{ height: 26, width: 'auto' }} />
      </div>

      {filters.length > 0 && (
        <div style={{
          background: BAND_BLUE, borderTop: `1px solid ${INK}`, borderBottom: `1px solid ${INK}`,
          padding: '6px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '2px 16px',
          fontSize: 11, color: INK,
        }}>
          {filters.map(([k, v]) => (
            <div key={k} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${k} : ${v}`}>
              {k}&nbsp;&nbsp;:&nbsp;&nbsp;{v}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** The paper's footer: print date, system name, END OF REPORT. */
export function PaperFoot({ printDate }) {
  return (
    <div style={{
      borderTop: `1px solid ${RULE}`, padding: '7px 16px', display: 'flex',
      justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: INK,
    }}>
      <span>Print Date : {printDate}</span>
      <span>FleetmaxX</span>
      <span style={{ fontWeight: 700 }}>END OF REPORT</span>
    </div>
  )
}

/**
 * The white sheet itself; `#report-paper` is what ReportFrame prints. The
 * report's Logo option sits above it, on screen only.
 */
export function PaperSheet({ id = 'report-paper', children }) {
  return (
    <>
      <ReportLogoPicker />
      <div id={id} style={{ background: '#fff', borderRadius: 10, border: '1px solid var(--c-border)', overflow: 'hidden' }}>{children}</div>
    </>
  )
}

const cell = { padding: '3px 6px', fontSize: 11, color: INK, verticalAlign: 'top', lineHeight: 1.35 }

/** Rescale percentage widths to add up to 100% once some columns are hidden. */
function fillWidths(columns) {
  const pct = columns.map(c => (typeof c.width === 'string' && c.width.endsWith('%') ? parseFloat(c.width) : NaN))
  if (pct.some(n => !Number.isFinite(n))) return columns
  const sum = pct.reduce((a, b) => a + b, 0)
  if (!sum || Math.abs(sum - 100) < 0.5) return columns
  return columns.map((c, i) => ({ ...c, width: `${((pct[i] / sum) * 100).toFixed(3)}%` }))
}

export default function PaperTable({ title, company, filters = [], columns: given, groups, printDate, onLocate, onCellClick, emptyText, summary }) {
  const columns = fillWidths(given)
  const total = groups.reduce((s, g) => s + g.rows.filter(r => r.kind !== 'band').length, 0)
  // Zebra restarts under every band, the way the Movement Report shades.
  const shaded = groups.map(g => {
    let z = false
    return { ...g, rows: g.rows.map(r => {
      if (r.kind === 'band' || r.strong) { z = false; return r }
      const row = r.zebra === undefined ? { ...r, zebra: z } : r
      z = !z
      return row
    }) }
  })

  return (
    <PaperSheet>
      <PaperHead title={title} company={company} filters={filters} />

      <div className="no-scrollbar" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 980 }}>
          <colgroup>{columns.map(c => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} style={{
                  ...cell, fontWeight: 700, textAlign: c.align || 'left', background: BAND_BLUE,
                  borderTop: `1px solid ${INK}`, borderBottom: `1px solid ${INK}`, position: 'sticky', top: 0, zIndex: 1,
                }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {total === 0 && (
              <tr><td colSpan={columns.length} style={{ ...cell, padding: '28px 16px', textAlign: 'center', color: '#6b7280' }}>
                {emptyText || 'Nothing matches this selection.'}
              </td></tr>
            )}
            {shaded.filter(g => g.rows.length).map(g => [
              <tr key={`g-${g.key}`} style={{ background: GROUP_GRAY }}>
                <td colSpan={columns.length} style={{ ...cell, fontWeight: 700, borderTop: `1px solid ${RULE}` }}>{g.label}</td>
              </tr>,
              ...g.rows.map((row, i) => row.kind === 'band' ? (
                <tr key={`b-${g.key}-${row.key ?? i}`} style={{ background: TOTAL_YEL }}>
                  <td colSpan={columns.length} style={{ ...cell, fontWeight: 700 }}>{row.label}</td>
                </tr>
              ) : (
                <tr key={`r-${g.key}-${row.key ?? i}`} style={{ background: row.strong ? TOTAL_YEL : row.zebra ? ZEBRA_GRAY : '#fff' }}>
                  {columns.map(c => (
                    <td key={c.key} style={{ ...cell, textAlign: c.align || 'left', wordBreak: 'break-word', ...(row.strong ? { fontWeight: 700 } : {}), ...(row.cellStyle?.[c.key] ?? {}) }}>
                      {c.locate && onLocate && row.lat != null && row.lng != null ? (
                        <button
                          type="button"
                          onClick={() => onLocate(row)}
                          title="Show this location on the map"
                          style={{ padding: 0, border: 0, background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer', color: '#0a7e9c', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }}
                        >
                          {row[c.key]}
                        </button>
                      ) : c.clickable && onCellClick && row[c.key] && row[c.key] !== '—' ? (
                        <button
                          type="button"
                          onClick={() => onCellClick(row, c)}
                          title="Show these events"
                          style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 700, cursor: 'pointer', color: '#0a7e9c', textDecoration: 'underline', textUnderlineOffset: 2 }}
                        >
                          {row[c.key]}
                        </button>
                      ) : row[c.key]}
                    </td>
                  ))}
                </tr>
              )),
              g.total !== false && (
                <tr key={`t-${g.key}`} style={{ background: TOTAL_YEL }}>
                  <td colSpan={columns.length} style={{ ...cell, fontWeight: 700 }}>{g.total ?? `Total : ${g.rows.length}`}</td>
                </tr>
              ),
            ])}
          </tbody>
        </table>
      </div>

      {summary?.length > 0 && total > 0 && (
        <div style={{ borderTop: `1px solid ${INK}`, padding: '10px 16px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 6 }}>Report Summary:</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content max-content', gap: '3px 28px', fontSize: 11.5, color: INK }}>
            {summary.map(({ label, value }) => [
              <span key={`l-${label}`} style={{ fontWeight: 700 }}>{label}:</span>,
              <span key={`v-${label}`}>{value}</span>,
            ])}
          </div>
        </div>
      )}

      <PaperFoot printDate={printDate} />
    </PaperSheet>
  )
}
