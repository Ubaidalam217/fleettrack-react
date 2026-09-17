import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Confirmation gate for anything that leaves the browser and touches a vehicle.
// Every device action routes through here, so no command is ever one click away.

export default function ConfirmDialog({
  title,
  body,
  note,
  confirmLabel = 'Confirm',
  busy = false,
  onConfirm,
  onClose,
}) {
  const panelRef   = useRef(null)
  const confirmRef = useRef(null)
  const returnTo   = useRef(typeof document !== 'undefined' ? document.activeElement : null)

  useEffect(() => {
    confirmRef.current?.focus()
    const el = returnTo.current
    return () => { if (el instanceof HTMLElement) el.focus() }
  }, [])

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onClose(); return }
      if (e.key !== 'Tab') return

      const focusables = panelRef.current?.querySelectorAll('button:not([disabled])')
      if (!focusables?.length) return
      const first = focusables[0]
      const last  = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose, busy])

  return createPortal(
    <>
      <style>{`
        @keyframes ft-confirm-in {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 10px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        .ft-confirm-panel { animation: ft-confirm-in 0.18s ease-out both; }
      `}</style>

      <div
        onClick={() => !busy && onClose()}
        style={{
          position: 'fixed', inset: 0, zIndex: 9850,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
        }}
      />

      <div
        ref={panelRef}
        className="ft-confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ft-confirm-title"
        aria-describedby="ft-confirm-body"
        style={{
          position: 'fixed', zIndex: 9851,
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(400px, calc(100vw - 28px))',
          background: 'var(--c-card)',
          border: '1px solid var(--c-border)',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 20px 16px' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: 'color-mix(in srgb, var(--ft-accent) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--ft-accent) 22%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5ba354" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16v12H5.17L4 17.17V4z" />
                <line x1="8" y1="9" x2="16" y2="9" />
              </svg>
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 id="ft-confirm-title" style={{
                fontSize: 14.5, fontWeight: 800, color: 'var(--c-text1)', margin: '2px 0 6px',
              }}>
                {title}
              </h2>
              <p id="ft-confirm-body" style={{
                fontSize: 12.5, color: 'var(--c-text2)', lineHeight: 1.6, margin: 0,
              }}>
                {body}
              </p>
            </div>
          </div>

          {note && (
            <p style={{
              fontSize: 11, color: 'var(--c-text3)', lineHeight: 1.55,
              background: 'var(--c-thead)', borderRadius: 8,
              padding: '9px 11px', margin: '13px 0 0',
            }}>
              {note}
            </p>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 20px 16px', borderTop: '1px solid var(--c-border2)',
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '9px 16px', borderRadius: 9,
              border: '1px solid var(--c-border2)', background: 'var(--c-input)',
              color: 'var(--c-text2)', fontSize: 12.5, fontWeight: 650,
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '9px 20px', borderRadius: 9, border: 'none',
              background: 'var(--ft-accent)', color: '#fff',
              fontSize: 12.5, fontWeight: 750,
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.65 : 1,
            }}
          >
            {busy ? 'Sending…' : confirmLabel}
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
