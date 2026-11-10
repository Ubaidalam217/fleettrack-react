import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ListOrdered, MapPinned } from 'lucide-react'
import { alertTypeLabel } from '../../data/settings'
import { alertTypeIcon, severityTone } from '../alerts/alertStyle'

/**
 * The alert events behind a Violation Overview count, newest first. Each opens
 * on the map from where it began to where it ended (EventTrackModal).
 *
 * list: { title, events: [{ id, deviceId, vehicle, driver, type, ts, severity, message }] }
 */
const fmt = ts => new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function EventListModal({ list, onPick, onClose }) {
  useEffect(() => {
    if (!list) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list, onClose])

  if (!list) return null
  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={list.title}
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(760px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'var(--c-card)', border: '1px solid var(--c-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
            <ListOrdered size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--c-text1)' }}>{list.title}</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2 }}>
              {list.events.length} event{list.events.length === 1 ? '' : 's'} · choose one to see it on the map from start to end
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)"
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 8 }}>
          {list.events.map(e => {
            const Icon = alertTypeIcon(e.type)
            const tone = severityTone(e.severity)
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onPick(e)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', marginBottom: 4,
                  border: '1px solid var(--c-border)', borderRadius: 10, background: 'var(--c-card)', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}>
                  <Icon size={15} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13, color: 'var(--c-text1)' }}>{alertTypeLabel(e.type)}</strong>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: tone.color }}>{e.severity}</span>
                    <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>{fmt(e.ts)}</span>
                  </span>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--c-text2)', marginTop: 3, wordBreak: 'break-word' }}>{e.message}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c-text3)', marginTop: 2 }}>
                    {e.vehicle}{e.driver ? ` · ${e.driver}` : ''}
                  </span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--ft-accent)', flexShrink: 0, alignSelf: 'center' }}>
                  <MapPinned size={14} /> Map
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
