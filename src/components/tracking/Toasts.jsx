import { createPortal } from 'react-dom'

// Lightweight toast stack. No dependency, no context provider: the tracking
// page owns the state via useToasts() and renders one <ToastStack/>, which is
// all the surface area this build needs.

const TONES = {
  success: { bg: '#10b981', icon: 'check' },
  error:   { bg: '#ef4444', icon: 'alert' },
  // Deliberately distinct from success. A queued command has NOT reached the
  // vehicle, and showing it green would tell the operator something untrue.
  pending: { bg: '#f59e0b', icon: 'clock' },
  info:    { bg: '#5ba354', icon: 'info'  },
}

function Icon({ kind }) {
  const common = {
    width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2.6,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  }
  if (kind === 'check') return <svg {...common}><polyline points="20 6 9 17 4 12" /></svg>
  if (kind === 'alert') return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
  if (kind === 'clock') return <svg {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
  return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
}

export default function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null

  return createPortal(
    <>
      <style>{`
        @keyframes ft-toast-in {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        .ft-toast { animation: ft-toast-in 0.22s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 10000,
          display: 'flex', flexDirection: 'column', gap: 8,
          alignItems: 'flex-end', pointerEvents: 'none',
        }}
      >
        {toasts.map(t => {
          const tone = TONES[t.tone] || TONES.info
          return (
            <div
              key={t.id}
              className="ft-toast"
              // Status rather than alert: these narrate the result of something
              // the user just did, so they should not interrupt a screen reader
              // mid-sentence.
              role="status"
              aria-live="polite"
              onClick={() => onDismiss(t.id)}
              style={{
                pointerEvents: 'auto', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 9,
                background: tone.bg, color: '#fff',
                padding: '10px 15px', borderRadius: 10,
                fontSize: 12.5, fontWeight: 650, lineHeight: 1.45,
                boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
                maxWidth: 380,
              }}
            >
              <span style={{ display: 'flex', flexShrink: 0 }}><Icon kind={tone.icon} /></span>
              <span>{t.message}</span>
            </div>
          )
        })}
      </div>
    </>,
    document.body
  )
}
