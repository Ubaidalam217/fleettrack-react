import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { requestPermission, dismissPrompt } from '../services/pushNotifications'

export default function PushPermissionModal({ onClose }) {
  const panelRef = useRef(null)

  // Close on Escape — backdrop click intentionally does NOT close
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') { dismissPrompt(); onClose() } }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const handleEnable = async () => {
    await requestPermission()
    onClose()
  }

  const handleDismiss = () => {
    dismissPrompt()
    onClose()
  }

  return createPortal(
    <>
      <style>{`
        @keyframes push-modal-fade {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 10px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        .push-modal-panel {
          animation: push-modal-fade 0.2s ease-out both;
        }
      `}</style>

      {/* Backdrop — no onClick so user must make explicit choice */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9990,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)',
      }} />

      {/* Modal panel */}
      <div
        ref={panelRef}
        className="push-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-modal-title"
        style={{
          position: 'fixed', zIndex: 9991,
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(420px, calc(100vw - 32px))',
          background: 'var(--c-card)',
          border: '1px solid var(--c-border)',
          borderRadius: 16,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Close X */}
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            position: 'absolute', top: 12, right: 12,
            width: 28, height: 28, borderRadius: 8,
            border: '1px solid var(--c-border2)',
            background: 'var(--c-input)', cursor: 'pointer',
            color: 'var(--c-text3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--c-input)'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* Body */}
        <div style={{ padding: '32px 28px 28px', textAlign: 'center' }}>
          {/* Bell icon */}
          <div style={{
            width: 64, height: 64, borderRadius: 18,
            background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path
                fillRule="evenodd" clipRule="evenodd"
                d="M10.75 2.29a.75.75 0 00-1.5 0v.54A6.92 6.92 0 003.62 9.17v5.29H3.33a.75.75 0 000 1.5h17.34a.75.75 0 000-1.5h-.29V9.17A6.92 6.92 0 0014.75 2.83v-.54a.75.75 0 00-1.5 0v.28c-.41-.07-.83-.11-1.25-.11-.42 0-.84.04-1.25.11v-.28zM5.12 9.17a5.38 5.38 0 0113.76 0v5.29H5.12V9.17zM8 18.46a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 018 18.46z"
                fill="#3b82f6"
              />
            </svg>
          </div>

          <h2 id="push-modal-title" style={{
            fontSize: 18, fontWeight: 800, color: 'var(--c-text1)',
            margin: '0 0 10px', lineHeight: 1.3,
          }}>
            Stay updated on your fleet
          </h2>

          <p style={{
            fontSize: 13, color: 'var(--c-text2)', lineHeight: 1.65,
            margin: '0 0 24px', maxWidth: 320, marginLeft: 'auto', marginRight: 'auto',
          }}>
            Get instant alerts when your vehicles trigger overspeed warnings, geofence
            breaches, or maintenance reminders. Notifications appear even when this tab
            is in the background.
          </p>

          {/* Privacy note */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            background: 'var(--c-thead)', borderRadius: 8,
            padding: '10px 12px', marginBottom: 22, textAlign: 'left',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span style={{ fontSize: 11, color: 'var(--c-text3)', lineHeight: 1.5 }}>
              Alerts stay on-device only. No data leaves FleetTrack.
            </span>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={handleEnable}
              style={{
                width: '100%', padding: '11px 20px',
                borderRadius: 10, border: 'none',
                background: '#3b82f6', color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                transition: 'opacity 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 8h1a4 4 0 010 8h-1"/>
                <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/>
                <line x1="6" y1="1" x2="6" y2="4"/>
                <line x1="10" y1="1" x2="10" y2="4"/>
                <line x1="14" y1="1" x2="14" y2="4"/>
              </svg>
              Enable Notifications
            </button>

            <button
              onClick={handleDismiss}
              style={{
                width: '100%', padding: '10px 20px',
                borderRadius: 10, border: '1px solid var(--c-border2)',
                background: 'var(--c-input)', color: 'var(--c-text2)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--c-input)'}
            >
              Maybe later
            </button>
          </div>

          <p style={{ fontSize: 11, color: 'var(--c-text3)', margin: '14px 0 0', opacity: 0.8 }}>
            You can change this any time in browser settings
          </p>
        </div>
      </div>
    </>,
    document.body
  )
}
