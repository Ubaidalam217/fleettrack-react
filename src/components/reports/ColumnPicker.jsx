import { useEffect, useRef, useState } from 'react'
import { Columns3, ChevronDown } from 'lucide-react'
import { CheckRow } from './controls'

/**
 * The "Columns" button on a generated report: tick the columns the report
 * should show. It sits with the Download buttons because it shapes them too —
 * the table, PDF, Excel and Print all show the same columns.
 *
 * columns: [{ key, label }]   every column the report can show
 * hidden:  Set of keys        from useHiddenColumns()
 * onChange(nextHiddenSet)
 *
 * The last shown column cannot be switched off: a report with no columns is
 * not a report.
 */
export default function ColumnPicker({ columns, hidden, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const keys = columns.map(c => c.key)
  const shownCount = keys.filter(k => !hidden.has(k)).length
  const toggle = key => {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else if (shownCount > 1) next.add(key)
    onChange(next)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        aria-expanded={open}
        title="Choose the columns this report shows"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '8px 12px', borderRadius: 8, border: '1px solid var(--c-border2)',
          background: 'var(--c-card)', color: 'var(--c-text1)', fontSize: 12.5, fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        }}
      >
        <Columns3 size={14} />
        Columns
        <span style={{
          fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
          background: shownCount < keys.length ? 'color-mix(in srgb, var(--ft-accent) 15%, transparent)' : 'var(--c-hover)',
          color: shownCount < keys.length ? 'var(--ft-accent)' : 'var(--c-text3)',
        }}>
          {shownCount}/{keys.length}
        </span>
        <ChevronDown size={13} style={{ color: 'var(--c-text3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div className="no-scrollbar" style={{
          position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', right: 0, width: 260,
          background: 'var(--c-card)', border: '1px solid var(--c-border2)', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: 6,
          maxHeight: 'min(460px, 65vh)', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 8px 6px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Show columns</span>
            <button
              type="button"
              onClick={() => onChange(new Set())}
              disabled={shownCount === keys.length}
              style={{
                border: 0, background: 'none', padding: 0, fontSize: 11.5, fontWeight: 700,
                color: shownCount === keys.length ? 'var(--c-text3)' : 'var(--ft-accent)',
                cursor: shownCount === keys.length ? 'default' : 'pointer',
              }}
            >
              Show all
            </button>
          </div>
          {columns.map(c => {
            const on = !hidden.has(c.key)
            return (
              <CheckRow
                key={c.key}
                checked={on}
                disabled={on && shownCount === 1}
                title={on && shownCount === 1 ? 'At least one column is shown' : undefined}
                onChange={() => toggle(c.key)}
              >
                {c.label}
              </CheckRow>
            )
          })}
          <div style={{ fontSize: 10.5, color: 'var(--c-text3)', padding: '6px 8px 2px', borderTop: '1px solid var(--c-border)', marginTop: 4 }}>
            Applies to the table, PDF, Excel and Print.
          </div>
        </div>
      )}
    </div>
  )
}
