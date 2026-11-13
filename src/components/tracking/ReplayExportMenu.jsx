import { useEffect, useRef, useState } from 'react'

const CSS = `
  .rp-export-btn:focus-visible,
  .rp-export-item:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: -2px; }
  .rp-export-item {
    display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
    width: 100%; padding: 6px 9px; border: none; border-radius: 7px;
    background: transparent; color: var(--c-text1); text-align: left; cursor: pointer;
    font-size: 12px; font-weight: 600;
  }
  .rp-export-item:hover, .rp-export-item:focus-visible { background: var(--c-hover); }
  .rp-export-item small { font-size: 10px; font-weight: 500; color: var(--c-text3); }
`

const FORMATS = [
  { key: 'xlsx', label: 'Excel (.xlsx)',       hint: 'Every point, plus a Trips sheet' },
  { key: 'kml',  label: 'Google Earth (.kml)', hint: 'Plays on Google Earth’s time slider' },
  { key: 'gpx',  label: 'GPX (.gpx)',          hint: 'For GPS and mapping apps' },
]

/**
 * The Export button in the replay title row and its format menu.
 *
 * `scopeLabel` says what will be exported ("Trip 2", "Whole range"), so the
 * menu never leaves it to guess. `onExport(format)` does the work and may be
 * async; the button shows it is busy until it settles. `placement` 'down'
 * opens the menu below the button (the replay panel's header row).
 */
export default function ReplayExportMenu({ scopeLabel, onExport, placement = 'up' }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    menuRef.current?.querySelector('.rp-export-item')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => { setOpen(false); btnRef.current?.focus() }

  const run = async format => {
    setOpen(false)
    setBusy(true)
    try {
      await onExport(format)
    } finally {
      setBusy(false)
      btnRef.current?.focus()
    }
  }

  const onMenuKey = e => {
    const items = [...(menuRef.current?.querySelectorAll('.rp-export-item') ?? [])]
    const i = items.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <style>{CSS}</style>
      <button
        ref={btnRef}
        className="rp-export-btn"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Download ${scopeLabel.toLowerCase()} as Excel, KML or GPX`}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: open ? 'var(--c-hover)' : 'var(--c-input)', border: '1px solid var(--c-border)',
          borderRadius: 7, padding: '4px 9px',
          fontSize: 11, fontWeight: 700, color: 'var(--c-text2)',
          cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.7 : 1,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {busy ? 'Exporting…' : 'Export'}
        {!busy && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Export ${scopeLabel.toLowerCase()}`}
          onKeyDown={onMenuKey}
          style={{
            position: 'absolute', right: 0, zIndex: 20,
            ...(placement === 'down' ? { top: 'calc(100% + 6px)' } : { bottom: 'calc(100% + 8px)' }),
            minWidth: 214, padding: '8px 5px 5px',
            borderRadius: 10, border: '1px solid var(--c-border2)',
            background: 'var(--c-card)', boxShadow: '0 10px 32px rgba(0,0,0,0.22)',
          }}
        >
          <div style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            color: 'var(--c-text3)', padding: '0 9px 6px',
          }}>
            Export {scopeLabel}
          </div>
          {FORMATS.map(f => (
            <button key={f.key} role="menuitem" className="rp-export-item" onClick={() => run(f.key)}>
              {f.label}
              <small>{f.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
