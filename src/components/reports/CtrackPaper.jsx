import { PaperSheet } from './PaperTable'
import { AccountLogo } from './ReportLogo'
import { CTRACK_LINE_COLORS, niceAxis } from '../../utils/ctrackExport'

/**
 * The on-screen sheet of the four Ctrack-sample reports (Trip Details, Trip
 * Locations, Trip Summary, Distance Driven), drawn like their PDF
 * (utils/ctrackExport.js): the account's logo left (utils/reportLogo.js), a
 * centred serif title and FleetmaxX right, the From / To / Grouped By block
 * between black rules, dark-red group headings, bold headers on a black rule,
 * lavender zebra rows, dark-red summary lines, and the Report Summary at the end.
 *
 * tables: [{ key, heading?, headingItalic?, columns, rows }] — a column with
 * `icon: 'map'` shows the sample's map pin and opens the row on the map
 * (onLocate). A row's `cellAlign: { [key]: align }` aligns its own cells.
 */
const RED = '#8b0000'
const ZEBRA = '#e4e4f7'
const INK = '#111'
const SERIF = '"Times New Roman", Times, serif'

const th = { fontFamily: SERIF, padding: '3px 6px', fontSize: 11.5, fontWeight: 700, color: INK, verticalAlign: 'bottom', borderBottom: `2px solid ${INK}`, whiteSpace: 'normal' }
const td = { fontFamily: SERIF, padding: '3px 6px', fontSize: 11.5, color: INK, verticalAlign: 'middle', lineHeight: 1.25, wordBreak: 'break-word' }

function MapPin() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 21 L9 15 L12 21 Z" fill="#4caf50" />
      <path d="M12 21 L9 15 L22 21 Z" fill="#2196f3" />
      <path d="M12 2a6 6 0 0 0-6 6c0 4.5 6 10 6 10s6-5.5 6-10a6 6 0 0 0-6-6z" fill="#e53935" />
      <circle cx="12" cy="8" r="2.2" fill="#fff" />
    </svg>
  )
}

/** A green share (0..1) on a grey track: Utilization Details' "Driving vs Standing". */
function Bar({ value }) {
  const f = Math.max(0, Math.min(1, Number(value) || 0))
  return (
    <div style={{ width: 64, maxWidth: '100%', height: 7, background: '#d6d6d6' }} title={`${Math.round(f * 100)}%`}>
      <div style={{ width: `${f * 100}%`, minWidth: f > 0 ? 1 : 0, height: '100%', background: '#1fa01f' }} />
    </div>
  )
}

/** The Violation Overview's "By Occurrence" line chart, as the PDF draws it. */
function LineChart({ chart }) {
  const labels = chart.labels ?? []
  const series = chart.series ?? []
  const W = 900, H = 300, L = 64, R = 16, T = 30, B = 52
  const w = W - L - R, h = H - T - B
  const { top, step } = niceAxis(Math.max(0, ...series.flatMap(s => s.values)))
  const slot = w / Math.max(1, labels.length)
  const px = i => L + slot * i + slot / 2
  const py = v => T + h - (h * v) / top
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const every = labels.length <= 16 ? 1 : Math.ceil(labels.length / 16)
  return (
    <div style={{ margin: '16px 4px 12px', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 700, display: 'block' }} role="img" aria-label={chart.title}>
        <text x={L + w / 2} y={14} textAnchor="middle" fontSize="12" fontWeight="700" fill="#787878">{chart.title}</text>
        <rect x={L} y={T} width={w} height={h} fill="none" stroke="#c8c8c8" />
        {ticks.map(v => (
          <g key={v}>
            <line x1={L} x2={L + w} y1={py(v)} y2={py(v)} stroke="#d8d8d8" />
            <text x={L - 6} y={py(v) + 3.5} textAnchor="end" fontSize="10" fill="#3c3c3c">{v}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % every === 0 && (
          <text key={l} x={px(i)} y={T + h + 15} textAnchor="middle" fontSize="10" fill="#3c3c3c">{l}</text>
        )))}
        {series.map((s, k) => {
          const c = `rgb(${CTRACK_LINE_COLORS[k % CTRACK_LINE_COLORS.length].join(',')})`
          return (
            <g key={s.name}>
              <polyline fill="none" stroke={c} strokeWidth="1.6" points={s.values.map((v, i) => `${px(i)},${py(v)}`).join(' ')} />
              {s.values.map((v, i) => <circle key={i} cx={px(i)} cy={py(v)} r="2.6" fill={c}><title>{`${s.name} · ${labels[i]}: ${v}`}</title></circle>)}
            </g>
          )
        })}
        <text x={L + w / 2} y={T + h + 34} textAnchor="middle" fontSize="11" fontWeight="700" fill="#111">{chart.xLabel ?? 'Date'}</text>
        <text transform={`translate(16 ${T + h / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fontWeight="700" fill="#111">{chart.yLabel}</text>
      </svg>
      {series.length > 0 && (
        <div style={{ margin: '4px auto 0', maxWidth: 820, border: '1px solid #d0d0d0', padding: '6px 10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '4px 12px', fontSize: 11, color: '#282828' }}>
          {series.map((s, k) => (
            <span key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ width: 14, height: 3, background: `rgb(${CTRACK_LINE_COLORS[k % CTRACK_LINE_COLORS.length].join(',')})`, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const rgb = c => (Array.isArray(c) ? `rgb(${c.join(',')})` : c)

/**
 * Optional, as in buildCtrackPdf (Violation Overview, Utilization Details,
 * Power Failure): pairsPerLine; per table newPage (a gap here), fit / indent,
 * headingColor, headColor, zebra false, zebraStart, ruleAbove, valign, minWidth,
 * or kind 'lineChart'; per column headColor, bold, color, type 'bar', and
 * clickable (a count that opens its rows: onCellClick(row, column, table));
 * summaryTable under the summary title.
 */
export default function CtrackPaper({ title, pairs = [], tables, summaryTitle = 'Report Summary', summary, summaryTable, printDate, onLocate, onCellClick, emptyText, zebraStart = true, zebraContinue = false, pairsPerLine = 2 }) {
  const total = tables.reduce((s, t) => s + (t.rows ?? []).filter(r => r.kind !== 'band').length, 0)
  const lines = []
  for (let i = 0; i < pairs.length; i += pairsPerLine) lines.push(pairs.slice(i, i + pairsPerLine))
  const pairGrid = pairsPerLine === 2 ? '220px 1fr' : pairsPerLine === 1 ? '1fr' : `repeat(${pairsPerLine - 1}, 200px) 1fr`
  // zebraContinue: the stripes run on from one table to the next (the violation samples).
  let zebra

  const renderTable = t => {
    if (!zebraContinue || zebra === undefined) zebra = t.zebraStart ?? zebraStart
    const wrap = {
      marginBottom: 10,
      ...(t.newPage ? { marginTop: 22 } : {}),
      ...(t.fit ? { width: `${t.fit * 100}%` } : {}),
      ...(t.indent ? { marginLeft: `${t.indent * 100}%` } : {}),
    }
    return (
      <div key={t.key} style={wrap}>
        {t.heading && <div style={{ color: t.headingColor ? rgb(t.headingColor) : RED, fontWeight: 700, fontSize: 12.5, margin: '8px 4px 4px', fontStyle: t.headingItalic ? 'italic' : 'normal' }}>{t.heading}</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: t.minWidth ?? 900, ...(t.ruleAbove ? { borderTop: `1px solid ${INK}` } : {}) }}>
          <colgroup>{t.columns.map(c => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
          <thead>
            <tr>{t.columns.map(c => {
              const hc = c.headColor ?? t.headColor
              return <th key={c.key} style={{ ...th, textAlign: c.align || 'left', ...(hc ? { color: rgb(hc) } : {}) }}>{c.label}</th>
            })}</tr>
          </thead>
          <tbody>
            {t.rows.filter(r => r.kind !== 'band').map((row, i) => {
              const bg = row.strong || t.zebra === false ? '#fff' : zebra ? ZEBRA : '#fff'
              if (!row.strong) zebra = !zebra
              return (
                <tr key={row.key ?? i} style={{ background: bg }}>
                  {t.columns.map(c => (
                    <td key={c.key} style={{
                      ...td,
                      textAlign: c.icon ? 'center' : row.cellAlign?.[c.key] || c.align || 'left',
                      ...(t.valign === 'top' ? { verticalAlign: 'top' } : {}),
                      ...(c.bold ? { fontWeight: 700 } : {}),
                      ...(c.color ? { color: rgb(c.color) } : {}),
                      ...(row.strong ? { color: RED, fontWeight: 700 } : {}),
                    }}>
                      {c.icon === 'map'
                        ? (onLocate && (row.route || (row.lat != null && row.lng != null)) && (
                          <button type="button" onClick={() => onLocate(row)} title="Show this trip on the map"
                            style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer', lineHeight: 0 }}>
                            <MapPin />
                          </button>
                        ))
                        : c.type === 'bar'
                          ? (row[c.key] != null && <Bar value={row[c.key]} />)
                          : c.clickable && onCellClick && Number(row[c.key]) > 0
                            ? (
                              <button type="button" onClick={() => onCellClick(row, c, t)} title="Show these events"
                                style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>
                                {row[c.key]}
                              </button>
                            )
                            : row[c.key]}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <PaperSheet>
      <div style={{ fontFamily: SERIF, color: INK }}>
        {/* The account's logo at the left, FleetmaxX back at the right (client, 2026-11-13). */}
        <div style={{ position: 'relative', padding: '14px 16px 10px', minHeight: 54 }}>
          <AccountLogo height={34} maxWidth={150} style={{ position: 'absolute', left: 16, top: 10 }} />
          <img src="/logo/fleetmax-logo-sea.png" alt="FleetmaxX" style={{ height: 24, width: 'auto', position: 'absolute', right: 16, top: 14 }} />
          <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, paddingTop: 4 }}>{title}</div>
        </div>
        <div style={{ borderTop: `2px solid ${INK}`, borderBottom: `2px solid ${INK}`, padding: '6px 16px', fontSize: 12 }}>
          {lines.map((pair, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: pairGrid, padding: '2px 0' }}>
              {pair.map((p, j) => p ? (
                <span key={j}><b>{p[0]}:</b>&nbsp;&nbsp;&nbsp;{p[1]}</span>
              ) : <span key={j} />)}
            </div>
          ))}
        </div>

        <div className="no-scrollbar" style={{ overflowX: 'auto', padding: '6px 10px 4px' }}>
          {total === 0 && (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>{emptyText || 'Nothing matches this selection.'}</div>
          )}
          {total > 0 && tables.filter(t => t.kind === 'lineChart' || t.rows.length).map(t => (
            t.kind === 'lineChart' ? <LineChart key={t.key} chart={t} /> : renderTable(t)
          ))}

          {(summary?.length > 0 || summaryTable) && total > 0 && (
            <div style={{ padding: '14px 6px 8px', borderTop: `1px solid #ccc`, marginTop: 6 }}>
              <div style={{ color: RED, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{summaryTitle}</div>
              {summary?.length > 0 && (
                <div style={{ color: RED, fontWeight: 700, display: 'grid', gridTemplateColumns: '170px max-content', rowGap: 6, fontSize: 12.5 }}>
                  {summary.map(({ label, value }) => [<span key={`l-${label}`}>{label}</span>, <span key={`v-${label}`}>{value}</span>])}
                </div>
              )}
              {summaryTable && renderTable({ key: 'summary-table', ...summaryTable })}
            </div>
          )}
        </div>

        <div style={{ borderTop: `1.5px solid ${INK}`, padding: '6px 16px', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#787878' }}>
          <span>FleetmaxX</span>
          <span>{printDate}</span>
        </div>
      </div>
    </PaperSheet>
  )
}
