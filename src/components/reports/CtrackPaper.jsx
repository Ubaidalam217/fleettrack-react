import { PaperSheet } from './PaperTable'

/**
 * The on-screen sheet of the four Ctrack-sample reports (Trip Details, Trip
 * Locations, Trip Summary, Distance Driven), drawn like their PDF
 * (utils/ctrackExport.js): logo and a centred serif title, the From / To /
 * Grouped By block between black rules, dark-red group headings, bold headers
 * on a black rule, lavender zebra rows, dark-red summary lines, and the Report
 * Summary at the end.
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

export default function CtrackPaper({ title, pairs = [], tables, summaryTitle = 'Report Summary', summary, printDate, onLocate, emptyText, zebraStart = true, zebraContinue = false }) {
  const total = tables.reduce((s, t) => s + t.rows.filter(r => r.kind !== 'band').length, 0)
  const lines = []
  for (let i = 0; i < pairs.length; i += 2) lines.push([pairs[i], pairs[i + 1]])
  // zebraContinue: the stripes run on from one table to the next (the violation samples).
  let zebra

  return (
    <PaperSheet>
      <div style={{ fontFamily: SERIF, color: INK }}>
        <div style={{ position: 'relative', padding: '14px 16px 10px', minHeight: 54 }}>
          <img src="/logo/fleetmax-logo-sea.png" alt="FleetmaxX" style={{ height: 24, width: 'auto', position: 'absolute', left: 16, top: 14 }} />
          <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, paddingTop: 4 }}>{title}</div>
        </div>
        <div style={{ borderTop: `2px solid ${INK}`, borderBottom: `2px solid ${INK}`, padding: '6px 16px', fontSize: 12 }}>
          {lines.map((pair, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', padding: '2px 0' }}>
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
          {total > 0 && tables.filter(t => t.rows.length).map(t => {
            if (!zebraContinue || zebra === undefined) zebra = zebraStart
            return (
              <div key={t.key} style={{ marginBottom: 10 }}>
                {t.heading && <div style={{ color: RED, fontWeight: 700, fontSize: 12.5, margin: '8px 4px 4px', fontStyle: t.headingItalic ? 'italic' : 'normal' }}>{t.heading}</div>}
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900 }}>
                  <colgroup>{t.columns.map(c => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
                  <thead>
                    <tr>{t.columns.map(c => <th key={c.key} style={{ ...th, textAlign: c.align || 'left' }}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {t.rows.filter(r => r.kind !== 'band').map((row, i) => {
                      const bg = row.strong ? '#fff' : zebra ? ZEBRA : '#fff'
                      if (!row.strong) zebra = !zebra
                      return (
                        <tr key={row.key ?? i} style={{ background: bg }}>
                          {t.columns.map(c => (
                            <td key={c.key} style={{ ...td, textAlign: c.icon ? 'center' : row.cellAlign?.[c.key] || c.align || 'left', ...(row.strong ? { color: RED, fontWeight: 700 } : {}) }}>
                              {c.icon === 'map'
                                ? (onLocate && (row.route || (row.lat != null && row.lng != null)) && (
                                  <button type="button" onClick={() => onLocate(row)} title="Show this trip on the map"
                                    style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer', lineHeight: 0 }}>
                                    <MapPin />
                                  </button>
                                ))
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
          })}

          {summary?.length > 0 && total > 0 && (
            <div style={{ color: RED, fontWeight: 700, padding: '14px 6px 8px', borderTop: `1px solid #ccc`, marginTop: 6 }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>{summaryTitle}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '170px max-content', rowGap: 6, fontSize: 12.5 }}>
                {summary.map(({ label, value }) => [<span key={`l-${label}`}>{label}</span>, <span key={`v-${label}`}>{value}</span>])}
              </div>
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
