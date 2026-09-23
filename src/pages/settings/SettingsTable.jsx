import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { CARD_SURFACE } from './formStyles'

/**
 * List table for the Settings module.
 *
 * Same table recipe the dashboard uses (see components/VehicleStatus.jsx): a
 * card frame the table runs edge to edge inside, a --c-thead header band with
 * 10px uppercase labels, --c-border2 row rules and a --c-hover row highlight.
 * Kept generic over columns because BG and Branch differ only in which
 * fields they show.
 *
 * Column spec: { key, label, bold?, muted?, render?(row) }
 *
 * `labelKey` is which field names a row in the Edit/Delete accessible labels.
 * It defaults to `name`, so BG and Branch are unaffected; the User table
 * points it at `email`, whose rows are identified by their login rather than
 * by a name they do not have.
 */
export default function SettingsTable({ columns, rows, onEdit, onDelete, emptyLabel, labelKey = 'name' }) {
  const [hovered, setHovered] = useState(null)

  return (
    <div style={{ ...CARD_SURFACE, overflow: 'hidden' }}>
      <div className="overflow-x-auto">
        <table style={{ width: '100%', fontSize: 12, minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border2)', background: 'var(--c-thead)' }}>
              {columns.map(c => (
                <th
                  key={c.key}
                  className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--c-text3)', whiteSpace: 'nowrap' }}
                >
                  {c.label}
                </th>
              ))}
              <th
                className="text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--c-text3)', whiteSpace: 'nowrap' }}
              >
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  style={{ padding: '38px 12px', textAlign: 'center', color: 'var(--c-text3)', fontSize: 12 }}
                >
                  {emptyLabel}
                </td>
              </tr>
            ) : rows.map(row => (
              <tr
                key={row.id}
                style={{
                  borderBottom: '1px solid var(--c-border2)',
                  background: hovered === row.id ? 'var(--c-hover)' : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={() => setHovered(row.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {columns.map(c => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5${c.bold ? ' font-bold' : ''}`}
                    style={{
                      color: c.bold ? 'var(--c-text1)' : c.muted ? 'var(--c-text3)' : 'var(--c-text2)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.render ? c.render(row) : (row[c.key] || '—')}
                  </td>
                ))}

                <td className="px-3 py-2.5" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <IconButton
                      label={`Edit ${row[labelKey]}`}
                      tone="var(--ft-accent)"
                      onClick={() => onEdit(row)}
                    >
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton
                      label={`Delete ${row[labelKey]}`}
                      tone="#ef4444"
                      onClick={() => onDelete(row)}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Square icon button that borrows .ft-btn's border/hover behaviour but colours
// its hover per action, so Delete reads as destructive without being red at
// rest and shouting from every row.
function IconButton({ label, tone, onClick, children }) {
  const [hot, setHot] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      style={{
        width: 27, height: 27, borderRadius: 7,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${hot ? tone : 'var(--c-border2)'}`,
        background: hot ? `color-mix(in srgb, ${tone} 10%, transparent)` : 'var(--c-card)',
        color: hot ? tone : 'var(--c-text3)',
        cursor: 'pointer',
        transition: 'border-color .16s ease, color .16s ease, background .16s ease',
      }}
    >
      {children}
    </button>
  )
}

/**
 * Page toolbar: row count on the left, actions on the right. Sits above the
 * table on both pages. `plural` is explicit because the two nouns this module
 * needs do not share one rule — "branches" but "companies".
 */
export function TableToolbar({ count, noun, plural, children }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center',
      justifyContent: 'space-between', gap: 10,
      margin: '14px 0 14px',
    }}>
      <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>
        {count} {count === 1 ? noun : plural}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}
