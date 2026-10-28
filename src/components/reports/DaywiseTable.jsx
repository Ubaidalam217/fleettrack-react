import { useMemo } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'

/**
 * The daywise grid: identity columns, a Total, then one column per day.
 *
 * One component for both reports. Daywise Work Hour and Daywise Distance differ
 * only in their identity columns (Object, vs Company + Vehicle), their cell
 * formatter and their heading — everything that is actually hard here, the
 * sticky-column geometry, the sort, the heat scale and the totals row, is the
 * same table twice. `columns` carries the difference.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────
 *
 * The client's reference is solid corporate blue, including a block of solid
 * blue for the days that have not happened yet. Both are replaced by theme
 * tokens so the grid reads correctly in light and dark:
 *
 *   value cells   a wash of --ft-accent whose alpha tracks the value against
 *                 the busiest cell in the table, so a month's shape is legible
 *                 at a glance without reading 31 numbers per row
 *   zero          --c-text3, no wash: present and measured, just nothing to say
 *   future days   --c-card2 with a dimmed label — the day has not happened, so
 *                 the cell is empty by definition rather than a measured zero
 *
 * Alpha tops out well below solid: these are numbers to be read, and a cell dark
 * enough to fight its own text is a worse table than an unshaded one.
 */

const MAX_WASH = 26 // percent of --ft-accent on the busiest cell

const CSS = `
  .dw-wrap {
    position: relative;
    overflow: auto;
    background: var(--c-card);
    border: 1px solid var(--c-border);
    border-radius: 12px;
  }
  .dw {
    border-collapse: separate;
    border-spacing: 0;
    font-size: 11.5px;
    white-space: nowrap;
    min-width: 100%;
  }
  .dw th, .dw td {
    border-bottom: 1px solid var(--c-border2);
    border-right: 1px solid var(--c-border2);
    padding: 7px 9px;
  }
  .dw thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--c-thead);
    color: var(--c-text2);
    font-weight: 700;
    font-size: 10.5px;
    letter-spacing: .02em;
    text-align: center;
    border-bottom: 1px solid var(--c-border);
  }
  /* Sticky identity columns. Their left offset is set inline — it depends on
     the widths of the columns before them, which only the variant knows. */
  .dw .dw-fix {
    position: sticky;
    z-index: 1;
    background: var(--c-card);
    color: var(--c-text1);
    text-align: left;
    /* The seam where the frozen columns end. A plain border disappears under
       the scrolled cells, so the divider is a shadow that paints over them. */
  }
  .dw thead .dw-fix { z-index: 3; background: var(--c-thead); }
  .dw .dw-fix-last { box-shadow: 1px 0 0 var(--c-border); }

  .dw tbody tr:hover td { background: var(--c-hover); }
  .dw tbody tr:hover td.dw-fix { background: var(--c-hover); }

  .dw td.dw-day { text-align: right; font-variant-numeric: tabular-nums; color: var(--c-text1); }
  .dw td.dw-zero { color: var(--c-text3); }
  .dw td.dw-future { background: var(--c-card2); color: transparent; }
  .dw th.dw-future { color: var(--c-text3); opacity: .55; }

  .dw td.dw-total {
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--c-text1);
    background: color-mix(in srgb, var(--ft-accent) 7%, var(--c-card));
  }
  .dw tbody tr:hover td.dw-total { background: color-mix(in srgb, var(--ft-accent) 12%, var(--c-card)); }

  .dw tfoot td {
    position: sticky;
    bottom: 0;
    z-index: 2;
    background: var(--c-thead);
    font-weight: 700;
    color: var(--c-text1);
    border-top: 1px solid var(--c-border);
    font-variant-numeric: tabular-nums;
  }
  .dw tfoot td.dw-fix { z-index: 4; background: var(--c-thead); }

  .dw-sort {
    display: inline-flex; align-items: center; gap: 4px;
    background: none; border: none; padding: 0; margin: 0;
    font: inherit; color: inherit; cursor: pointer;
  }
  .dw-sort:hover { color: var(--ft-accent); }
  .dw-sort[data-on="true"] { color: var(--ft-accent); }

  .dw-sub { display: block; font-size: 10px; color: var(--c-text3); font-weight: 500; }

  /* Print: the app chrome is dropped by the page, and the grid loses its
     scroller so every day column lands on paper. */
  @media print {
    .dw-wrap { overflow: visible; border: none; }
    .dw { font-size: 7.5px; }
    .dw th, .dw td { padding: 2px 3px; }
    .dw .dw-fix, .dw thead th, .dw tfoot td { position: static; box-shadow: none; }
    .dw td.dw-future { background: #f2f2f2; }
  }
`

function SortHeader({ label, sortKey, sort, onSort, style, className }) {
  const on = sort.key === sortKey
  const Icon = on && sort.dir === 'desc' ? ArrowDown : ArrowUp
  return (
    <th className={className} style={style} scope="col">
      <button
        type="button"
        className="dw-sort"
        data-on={on ? 'true' : 'false'}
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label}`}
      >
        {label}
        <Icon size={10} strokeWidth={3} style={{ opacity: on ? 1 : 0.25 }} />
      </button>
    </th>
  )
}

/**
 * @param {object[]} columns   identity columns: { key, label, width, get(row) }
 * @param {object[]} rows      from buildDaywiseRows, already sorted
 * @param {number} days        days in the month
 * @param {number} lastElapsed last day that has happened in UAE time
 * @param {(row, day) => number} valueOf
 * @param {(row) => number} totalOf
 * @param {(n: number) => string} format
 * @param {boolean} showFooter column totals row
 */
export default function DaywiseTable({
  columns, rows, days, lastElapsed,
  valueOf, totalOf, format,
  sort, onSort, showFooter = true,
  dayLabel = d => String(d),
}) {
  // Left offset of each sticky column, from the widths of the ones before it.
  const offsets = useMemo(() => {
    const out = []
    let x = 0
    for (const c of columns) { out.push(x); x += c.width }
    return out
  }, [columns])

  // One scale for the whole table, not per row: the point of the wash is to
  // compare days across vehicles, and a per-row scale would make every vehicle's
  // best day look identical regardless of size.
  const peak = useMemo(() => {
    let max = 0
    for (const r of rows) {
      for (let d = 1; d <= days; d++) {
        const v = valueOf(r, d)
        if (v > max) max = v
      }
    }
    return max
  }, [rows, days, valueOf])

  const dayTotals = useMemo(() => {
    const out = new Array(days + 1).fill(0)
    for (const r of rows) for (let d = 1; d <= days; d++) out[d] += valueOf(r, d)
    return out
  }, [rows, days, valueOf])

  const grandTotal = useMemo(() => rows.reduce((a, r) => a + totalOf(r), 0), [rows, totalOf])

  const wash = v => {
    if (!peak || v <= 0) return undefined
    // sqrt, not linear: most days cluster low, and a linear ramp leaves all of
    // them indistinguishable from zero.
    const pct = Math.max(2, Math.round(MAX_WASH * Math.sqrt(v / peak)))
    return `color-mix(in srgb, var(--ft-accent) ${pct}%, var(--c-card))`
  }

  return (
    <div className="dw-wrap">
      <style>{CSS}</style>
      <table className="dw">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <SortHeader
                key={c.key}
                label={c.label}
                sortKey={c.key}
                sort={sort}
                onSort={onSort}
                className={`dw-fix${i === columns.length - 1 ? ' dw-fix-last' : ''}`}
                style={{ left: offsets[i], minWidth: c.width, width: c.width, textAlign: c.align ?? 'left' }}
              />
            ))}
            {Array.from({ length: days }, (_, i) => i + 1).map(d => (
              <th key={d} scope="col" className={d > lastElapsed ? 'dw-future' : undefined} style={{ minWidth: 52 }}>
                {dayLabel(d)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map(row => (
            <tr key={row.deviceId}>
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`dw-fix${i === columns.length - 1 ? ' dw-fix-last' : ''}${c.key === 'total' ? ' dw-total' : ''}`}
                  style={{ left: offsets[i], minWidth: c.width, width: c.width, textAlign: c.align ?? 'left' }}
                >
                  {c.get(row)}
                </td>
              ))}
              {Array.from({ length: days }, (_, i) => i + 1).map(d => {
                const future = d > lastElapsed
                const v = valueOf(row, d)
                return (
                  <td
                    key={d}
                    className={`dw-day${future ? ' dw-future' : v > 0 ? '' : ' dw-zero'}`}
                    style={!future && v > 0 ? { background: wash(v) } : undefined}
                  >
                    {future ? '' : format(v)}
                  </td>
                )
              })}
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + days} style={{ padding: 36, textAlign: 'center', color: 'var(--c-text3)' }}>
                No vehicles match the current filter.
              </td>
            </tr>
          )}
        </tbody>

        {showFooter && rows.length > 0 && (
          <tfoot>
            <tr>
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`dw-fix${i === columns.length - 1 ? ' dw-fix-last' : ''}`}
                  style={{ left: offsets[i], minWidth: c.width, width: c.width, textAlign: c.align ?? 'left' }}
                >
                  {c.key === 'total' ? format(grandTotal) : i === 0 ? `Total (${rows.length})` : ''}
                </td>
              ))}
              {Array.from({ length: days }, (_, i) => i + 1).map(d => (
                <td key={d} className={d > lastElapsed ? 'dw-future' : 'dw-day'} style={{ textAlign: 'right' }}>
                  {d > lastElapsed ? '' : format(dayTotals[d])}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
