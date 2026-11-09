import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Link2, Copy, Check, ExternalLink } from 'lucide-react'
import { IS_REAL } from '../../data/mode'
import { createReplayShare, replayShareUrl } from '../../data/replayShares'

/**
 * "Share replay" (client, 2026-11-09): make a link to the replay on screen that
 * anyone can open without signing in, and that stops working at the chosen time.
 * The link is shown to copy once it is made.
 */

const EXPIRY = [
  { key: 'h1',  label: '1 hour',   ms: 3_600_000 },
  { key: 'h24', label: '24 hours', ms: 86_400_000 },
  { key: 'd7',  label: '7 days',   ms: 7 * 86_400_000 },
  { key: 'd30', label: '30 days',  ms: 30 * 86_400_000 },
  { key: 'custom', label: 'Custom' },
]

const pad = n => String(n).padStart(2, '0')
const toInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const fmt = ts => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function CopyRow({ label, value, icon: Icon }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard blocked: the text stays selectable in the box.
    }
  }
  const box = {
    flex: 1, minWidth: 0, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--c-border2)',
    background: 'var(--c-input)', color: 'var(--c-text1)', fontSize: 11.5,
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', marginBottom: 4 }}>
        <Icon size={12} /> {label}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <input readOnly value={value} onFocus={e => e.target.select()} style={box} />
        <button type="button" onClick={copy} title="Copy" style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 11px', borderRadius: 8,
          border: '1px solid var(--c-border2)', background: copied ? 'var(--ft-accent)' : 'var(--c-card)',
          color: copied ? '#fff' : 'var(--c-text1)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
        }}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export default function ShareReplayDialog({ vehicleId, vehicleName, fromTs, toTs, onClose }) {
  const [expiryKey, setExpiryKey] = useState('h24')
  const [custom, setCustom] = useState(() => toInput(new Date(Date.now() + 86_400_000)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [share, setShare] = useState(null)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const expiresAt = expiryKey === 'custom'
    ? new Date(custom)
    : new Date(Date.now() + EXPIRY.find(e => e.key === expiryKey).ms)
  const expiryValid = !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now()
  const longRange = toTs - fromTs > 31 * 86_400 + 3600

  const create = async () => {
    if (busy || !expiryValid || longRange) return
    setBusy(true)
    setError(null)
    try {
      setShare(await createReplayShare({ deviceId: vehicleId, vehicleName, fromTs, toTs, expiresAt }))
    } catch (err) {
      setError(err?.message || 'Could not create the link')
    } finally {
      setBusy(false)
    }
  }

  const chip = active => ({
    padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: active ? 700 : 600, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
    background: active ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'var(--c-input)',
    color: active ? 'var(--ft-accent)' : 'var(--c-text2)',
  })

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-replay-title"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--c-card)', border: '1px solid var(--c-border2)', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px 10px', borderBottom: '1px solid var(--c-border2)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="share-replay-title" style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--c-text1)' }}>Share replay</h2>
            <div style={{ fontSize: 11.5, color: 'var(--c-text3)', marginTop: 2 }}>
              {vehicleName} · {fmt(fromTs * 1000)} – {fmt(toTs * 1000)}
            </div>
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
                Anyone with the link can watch this replay without signing in, until the time you choose below. After that the link stops working.
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', marginBottom: 6 }}>Link works for</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {EXPIRY.map(e => (
                    <button key={e.key} type="button" onClick={() => setExpiryKey(e.key)} style={chip(expiryKey === e.key)}>{e.label}</button>
                  ))}
                </div>
                {expiryKey === 'custom' && (
                  <input
                    type="datetime-local"
                    value={custom}
                    min={toInput(new Date())}
                    onChange={e => setCustom(e.target.value)}
                    style={{ marginTop: 8, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text1)', fontSize: 12 }}
                  />
                )}
                <div style={{ fontSize: 11.5, marginTop: 8, color: expiryValid ? 'var(--c-text3)' : '#ef4444' }}>
                  {expiryValid ? `Expires ${fmt(expiresAt)}` : 'Choose a time in the future.'}
                </div>
              </div>
              {longRange && <div style={{ fontSize: 11.5, color: '#ef4444' }}>A shared replay can cover up to 31 days. Load a shorter period first.</div>}
              {error && <div style={{ fontSize: 11.5, color: '#ef4444' }}>{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={onClose} disabled={busy} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-card)', color: 'var(--c-text1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button type="button" onClick={create} disabled={busy || !expiryValid || longRange} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 0,
                  background: 'var(--ft-accent)', color: '#fff', fontSize: 12.5, fontWeight: 700,
                  cursor: busy || !expiryValid || longRange ? 'not-allowed' : 'pointer', opacity: busy || !expiryValid || longRange ? 0.6 : 1,
                }}>
                  <Link2 size={14} /> {busy ? 'Creating link…' : 'Create link'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--c-text2)', lineHeight: 1.6 }}>
                Link ready. It works until <strong>{fmt(share.expiresAt)}</strong> and needs no sign-in.
                {share.truncated && ' This period had more points than one link holds, so the route is thinned.'}
              </div>
              <CopyRow label="Link" value={replayShareUrl(share.token)} icon={Link2} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <a href={replayShareUrl(share.token)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--ft-accent)' }}>
                  <ExternalLink size={13} /> Open link
                </a>
                <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: 'var(--ft-accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
