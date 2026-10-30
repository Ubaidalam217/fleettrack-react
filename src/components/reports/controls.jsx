import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * The form controls every Reports page shares.
 *
 * Lifted out of pages/Reports.jsx verbatim when the two Daywise reports needed
 * the same filter chips, dropdowns and toolbar buttons. Movement Report now
 * imports them from here, so there is one copy to restyle rather than three
 * that drift.
 */

// LABEL and FIELD live in reportStyles.js — a module exporting both components
// and constants breaks Fast Refresh — and are re-exported here so a page needs
// one import for the whole control set.
import { LABEL, FIELD } from './reportStyles'

export { LABEL, FIELD }

export function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0, padding: '5px 12px', borderRadius: 999,
        border: `1px solid ${active ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
        background: active ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'var(--c-input)',
        color: active ? 'var(--ft-accent)' : 'var(--c-text2)',
        fontSize: 11.5, fontWeight: active ? 700 : 600,
        cursor: 'pointer', whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  )
}

/** Dropdown with checkboxes. Closes on outside click and on Escape. */
export function MultiSelect({ label, summary, children, disabled }) {
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

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={LABEL}>{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        style={{
          ...FIELD, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--c-text3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        // Tall enough for a ten-vehicle fleet without scrolling, and the bar is
        // hidden when a longer list does scroll — the client asked for no
        // visible scrollbar on the report pages (2026-10-31).
        <div className="no-scrollbar" style={{
          position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--c-card)', border: '1px solid var(--c-border2)', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: 6,
          maxHeight: 'min(460px, 65vh)', overflowY: 'auto',
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

export function CheckRow({ checked, onChange, disabled, title, children, note }) {
  return (
    <label
      title={title}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 7,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
        fontSize: 12.5, color: 'var(--c-text1)',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--c-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{ marginTop: 2, accentColor: 'var(--ft-accent)', cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block' }}>{children}</span>
        {note && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--c-text3)', marginTop: 1 }}>{note}</span>}
      </span>
    </label>
  )
}

export function ToolbarButton({ onClick, icon: Icon, children, disabled, primary, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '8px 14px', borderRadius: 8,
        border: primary ? 'none' : '1px solid var(--c-border2)',
        background: primary ? 'var(--ft-accent)' : 'var(--c-card)',
        color: primary ? '#fff' : 'var(--c-text1)',
        fontSize: 12.5, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={14} />
      {children}
    </button>
  )
}

/**
 * A "?" that explains how a report's numbers are produced.
 *
 * Hover and focus, not click: the reference puts a help affordance in the
 * toolbar, and the thing it has to explain — what counts as an hour, which field
 * the kilometres come from — is a paragraph nobody should have to open a dialog
 * for.
 */
export function HelpTip({ title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={title}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        style={{
          width: 28, height: 28, borderRadius: 8, cursor: 'help',
          border: '1px solid var(--c-border2)', background: 'var(--c-card)',
          color: 'var(--c-text2)', fontSize: 13, fontWeight: 700, lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', zIndex: 40, top: 'calc(100% + 6px)', right: 0,
            width: 320, padding: '12px 14px',
            background: 'var(--c-card)', border: '1px solid var(--c-border)',
            borderRadius: 10, boxShadow: '0 14px 36px rgba(0,0,0,0.22)',
            fontSize: 11.5, lineHeight: 1.65, color: 'var(--c-text2)',
            whiteSpace: 'normal', textAlign: 'left', fontWeight: 400,
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--c-text1)', marginBottom: 6 }}>{title}</div>
          {children}
        </div>
      )}
    </span>
  )
}
