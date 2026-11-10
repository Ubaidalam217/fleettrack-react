import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Link2, ExternalLink, Radio, Square } from 'lucide-react'
import { IS_REAL } from '../../data/mode'
import { createLocationShare, listLocationShares, revokeLocationShare, locationShareUrl } from '../../data/locationShares'
import { CopyRow } from './ShareReplayDialog'

/**
 * "Share Live Location" from a vehicle's ⋮ menu (client, 2026-11-10): a link
 * anyone can open without signing in that shows where the vehicle is now,
 * updating, until the time chosen — then it stops working. Links already open
 * for this vehicle are listed so they can be stopped early.
 */

const DURATION = [
  { key: 'm15', label: '15 min',   ms: 15 * 60_000 },
  { key: 'h1',  label: '1 hour',   ms: 3_600_000 },
  { key: 'h4',  label: '4 hours',  ms: 4 * 3_600_000 },
  { key: 'h8',  label: '8 hours',  ms: 8 * 3_600_000 },
  { key: 'h24', label: '24 hours', ms: 86_400_000 },
  { key: 'custom', label: 'Until…' },
]
/** As routes/locationShares.js. */
const MAX_MS = 7 * 86_400_000

const pad = n => String(n).padStart(2, '0')
const toInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const fmt = ts => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function ShareLocationDialog({ vehicleId, vehicleName, onClose }) {
  const [durationKey, setDurationKey] = useState('h1')
  const [custom, setCustom] = useState(() => toInput(new Date(Date.now() + 2 * 3_600_000)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [share, setShare] = useState(null)
  const [open, setOpen] = useState([])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const loadOpen = useCallback(() => {
    if (!IS_REAL) return
    listLocationShares(vehicleId).then(rows => setOpen(Array.isArray(rows) ? rows : [])).catch(() => {})
  }, [vehicleId])
  useEffect(() => { loadOpen() }, [loadOpen])

  const expiresAt = durationKey === 'custom'
    ? new Date(custom)
    : new Date(Date.now() + DURATION.find(d => d.key === durationKey).ms)
  const ms = expiresAt.getTime() - Date.now()
  const valid = !Number.isNaN(expiresAt.getTime()) && ms > 0 && ms <= MAX_MS

  const create = async () => {
    if (busy || !valid) return
    setBusy(true)
    setError(null)
    try {
      setShare(await createLocationShare({ deviceId: vehicleId, vehicleName, expiresAt }))
      loadOpen()
    } catch (err) {
      setError(err?.message || 'Could not create the link')
    } finally {
      setBusy(false)
    }
  }

  const stop = async id => {
    try {
      await revokeLocationShare(id)
      if (share?.id === id) setShare(null)
      loadOpen()
    } catch (err) {
      setError(err?.message || 'Could not stop the link')
    }
  }

  const chip = active => ({
    padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: active ? 700 : 600, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
    background: active ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'var(--c-input)',
    color: active ? 'var(--ft-accent)' : 'var(--c-text2)',
  })
  const others = open.filter(s => s.id !== share?.id)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-location-title"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--c-card)', border: '1px solid var(--c-border2)', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px 10px', borderBottom: '1px solid var(--c-border2)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="share-location-title" style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--c-text1)' }}>Share live location</h2>
            <div style={{ fontSize: 11.5, color: 'var(--c-text3)', marginTop: 2 }}>{vehicleName}</div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ background: 'none', border: 0, color: 'var(--c-text3)', cursor: 'pointer', padding: 3, display: 'flex' }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!IS_REAL ? (
            <div style={{ fontSize: 12.5, color: 'var(--c-text3)' }}>Share links are made by the FleetmaxX server, so they are not available in demo mode.</div>
          ) : !share ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--c-text2)', lineHeight: 1.6 }}>
                Anyone with the link can see where this vehicle is, updating every few seconds, without signing in — until the time you choose. Then the link stops working.
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', marginBottom: 6 }}>Share for</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DURATION.map(d => (
                    <button key={d.key} type="button" onClick={() => setDurationKey(d.key)} style={chip(durationKey === d.key)} aria-pressed={durationKey === d.key}>{d.label}</button>
                  ))}
                </div>
                {durationKey === 'custom' && (
                  <input
                    type="datetime-local"
                    aria-label="Share until"
                    value={custom}
                    min={toInput(new Date())}
                    onChange={e => setCustom(e.target.value)}
                    style={{ marginTop: 8, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text1)', fontSize: 12 }}
                  />
                )}
                <div style={{ fontSize: 11.5, marginTop: 8, color: valid ? 'var(--c-text3)' : '#ef4444' }}>
                  {valid ? `Stops at ${fmt(expiresAt)}` : ms > MAX_MS ? 'A live location can be shared for up to 7 days.' : 'Choose a time in the future.'}
                </div>
              </div>
              {error && <div style={{ fontSize: 11.5, color: '#ef4444' }}>{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={onClose} disabled={busy} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-card)', color: 'var(--c-text1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button type="button" onClick={create} disabled={busy || !valid} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 0,
                  background: 'var(--ft-accent)', color: '#fff', fontSize: 12.5, fontWeight: 700,
                  cursor: busy || !valid ? 'not-allowed' : 'pointer', opacity: busy || !valid ? 0.6 : 1,
                }}>
                  <Link2 size={14} /> {busy ? 'Creating link…' : 'Create link'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--c-text2)', lineHeight: 1.6 }}>
                Link ready. It shows {vehicleName} live until <strong>{fmt(share.expiresAt)}</strong> and needs no sign-in.
              </div>
              <CopyRow label="Link" value={locationShareUrl(share.token)} icon={Link2} />
              {error && <div style={{ fontSize: 11.5, color: '#ef4444' }}>{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <a href={locationShareUrl(share.token)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--ft-accent)' }}>
                    <ExternalLink size={13} /> Open link
                  </a>
                  <button type="button" onClick={() => stop(share.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0, border: 0, background: 'none', fontSize: 12, fontWeight: 700, color: '#dc2626', cursor: 'pointer' }}>
                    <Square size={12} /> Stop sharing now
                  </button>
                </div>
                <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: 'var(--ft-accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Done</button>
              </div>
            </>
          )}

          {IS_REAL && others.length > 0 && (
            <div style={{ borderTop: '1px solid var(--c-border2)', paddingTop: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', marginBottom: 6 }}>
                Links already open for this vehicle
              </div>
              {others.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12, color: 'var(--c-text2)' }}>
                  <Radio size={13} style={{ color: '#16a34a', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>Until {fmt(s.expiresAt)}</span>
                  <a href={locationShareUrl(s.token)} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ft-accent)' }}>Open</a>
                  <button type="button" onClick={() => stop(s.id)} style={{ padding: '3px 9px', borderRadius: 999, border: '1px solid rgba(220,38,38,0.4)', background: 'transparent', color: '#dc2626', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Stop</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
