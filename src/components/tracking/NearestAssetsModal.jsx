import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { haversineMeters } from '../../utils/movementReport'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'

// "Find Nearest > Assets" — other vehicles within a radius of the chosen one.
//
// Assets only. The Operators half of the Ctrack menu is deliberately absent:
// driver.name is empty on every device in this account, so it would list
// nothing on every click.

const RADII_KM = [1, 5, 10, 25, 50]
const DEFAULT_RADIUS_KM = 10

function label(v) {
  return v.master?.plateNo || v.name || v.ident || `Device ${v.id}`
}

export default function NearestAssetsModal({ origin, vehicles, onClose, onSelect }) {
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM)
  const panelRef = useRef(null)
  const returnTo = useRef(typeof document !== 'undefined' ? document.activeElement : null)

  useEffect(() => {
    panelRef.current?.querySelector('button')?.focus()
    const el = returnTo.current
    return () => { if (el instanceof HTMLElement) el.focus() }
  }, [])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Ranked by true distance, then cut to the radius — so changing the radius is
  // a filter over an already-sorted list rather than a re-sort.
  const ranked = useMemo(() => {
    if (!origin || origin.lat == null || origin.lng == null) return []
    return vehicles
      .filter(v => v.id !== origin.id && v.lat != null && v.lng != null)
      .map(v => ({
        v,
        km: haversineMeters(origin.lat, origin.lng, v.lat, v.lng) / 1000,
      }))
      .sort((a, b) => a.km - b.km)
  }, [origin, vehicles])

  const within = ranked.filter(r => r.km <= radiusKm)
  const noFix  = !origin || origin.lat == null || origin.lng == null

  return createPortal(
    <>
      <style>{`
        @keyframes ft-near-in {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        .ft-near-panel { animation: ft-near-in 0.2s ease-out both; }
        .ft-near-row:hover { background: var(--c-hover) !important; }
      `}</style>

      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9800,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
        }}
      />

      <div
        ref={panelRef}
        className="ft-near-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ft-near-title"
        style={{
          position: 'fixed', zIndex: 9801,
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(440px, calc(100vw - 28px))',
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--c-card)',
          border: '1px solid var(--c-border)',
          borderRadius: 15,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '15px 18px 12px', borderBottom: '1px solid var(--c-border2)',
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 id="ft-near-title" style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--c-text1)', margin: 0 }}>
              Nearest Assets
            </h2>
            <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>
              Around {label(origin)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 27, height: 27, borderRadius: 7, flexShrink: 0,
              border: '1px solid var(--c-border2)', background: 'var(--c-input)',
              color: 'var(--c-text3)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!noFix && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 18px', borderBottom: '1px solid var(--c-border2)',
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: 2 }}>
              Within
            </span>
            {RADII_KM.map(km => (
              <button
                key={km}
                type="button"
                onClick={() => setRadiusKm(km)}
                aria-pressed={radiusKm === km}
                style={{
                  padding: '4px 9px', borderRadius: 6,
                  border: `1px solid ${radiusKm === km ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
                  background: radiusKm === km ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'transparent',
                  color: radiusKm === km ? 'var(--ft-accent)' : 'var(--c-text2)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {km} km
              </button>
            ))}
          </div>
        )}

        <div style={{ overflowY: 'auto', padding: 7, minHeight: 0 }}>
          {noFix ? (
            <p style={{ padding: '26px 18px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.6, margin: 0 }}>
              This vehicle has no position yet, so there is nothing to measure from.
            </p>
          ) : within.length === 0 ? (
            <p style={{ padding: '26px 18px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.6, margin: 0 }}>
              No other vehicles within {radiusKm} km.
              {ranked.length > 0 && (
                <>
                  <br />
                  Nearest is <strong style={{ color: 'var(--c-text2)' }}>{label(ranked[0].v)}</strong> at {ranked[0].km.toFixed(1)} km.
                </>
              )}
            </p>
          ) : (
            within.map(({ v, km }) => (
              <button
                key={v.id}
                type="button"
                className="ft-near-row"
                onClick={() => { onSelect(v); onClose() }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 11px', borderRadius: 8,
                  border: 'none', background: 'transparent',
                  textAlign: 'left', cursor: 'pointer',
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: statusColor(v.status),
                  boxShadow: `0 0 0 2.5px ${statusColor(v.status)}30`,
                }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {label(v)}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--c-text3)' }}>
                    {statusLabel(v.status)}
                    {v.master?.fleetNo ? ` · ${v.master.fleetNo}` : ''}
                  </span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ft-accent)', flexShrink: 0 }}>
                  {km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}
                </span>
              </button>
            ))
          )}
        </div>

        {!noFix && within.length > 0 && (
          <div style={{
            padding: '9px 18px', borderTop: '1px solid var(--c-border2)',
            fontSize: 10.5, color: 'var(--c-text3)',
          }}>
            {within.length} of {ranked.length} vehicles · straight-line distance
          </div>
        )}
      </div>
    </>,
    document.body
  )
}
