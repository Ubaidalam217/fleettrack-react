import { useCallback, useEffect, useState } from 'react'
import { CloudDownload, PlugZap, RefreshCw, CircleCheck, AlertTriangle, CirclePause } from 'lucide-react'
import { ApiError } from '../../data/http'
import { fetchUffizioStatus, pollUffizio, testUffizio } from '../../data/fuel'

/**
 * Settings › Master › Fuel — "Uffizio (fuel vehicles)" (client, 2026-11-24).
 * The vehicles that report only to the client's Uffizio system come in through
 * its API every ~2 minutes (server/src/lib/uffizio.js). This card shows how
 * that feed stands — set up or not, the last poll, the last error — and lets
 * an admin poll now (Uffizio allows one call every 2 minutes) or check the
 * sign-in. It shows nothing secret: the server never sends the login or token.
 * Hidden for an account the server does not let see the feed (403).
 */

const CSS = `
.uf-card{background:var(--c-card);border:1px solid var(--c-border2);border-radius:var(--ft-radius,14px);box-shadow:var(--ft-shadow);padding:16px 18px;margin-top:16px}
.uf-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.uf-ico{width:38px;height:38px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--ft-accent);background:color-mix(in srgb,var(--ft-accent) 12%,transparent)}
.uf-title{font-size:14.5px;font-weight:800;color:var(--c-text1)}
.uf-sub{font-size:12px;color:var(--c-text3);margin-top:2px;line-height:1.45}
.uf-acts{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.uf-btn{height:34px;padding:0 13px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text1);font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
.uf-btn:hover:not(:disabled){background:var(--c-hover)}
.uf-btn:disabled{opacity:.55;cursor:not-allowed}
.uf-btn.primary{background:var(--ft-accent);border-color:var(--ft-accent);color:#fff}
.uf-btn.primary:hover:not(:disabled){filter:brightness(1.06);background:var(--ft-accent)}
.uf-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 18px;margin:14px 0 0;padding:0}
.uf-grid dt{font-size:10px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text3)}
.uf-grid dd{margin:3px 0 0;font-size:13px;font-weight:650;color:var(--c-text1);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.uf-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:750;padding:3px 9px;border-radius:999px;white-space:nowrap}
.uf-msg{margin-top:12px;padding:9px 12px;border-radius:10px;font-size:12.5px;line-height:1.5;display:flex;gap:8px;align-items:flex-start}
.uf-list{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--c-text2)}
@media (max-width:760px){.uf-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.uf-acts{margin-left:0;width:100%}}
`

const TONES = {
  ok:   { color: '#16a34a', icon: CircleCheck, label: 'Receiving data' },
  warn: { color: '#d97706', icon: AlertTriangle, label: 'Problem' },
  idle: { color: 'var(--c-text3)', icon: CirclePause, label: 'Not set up' },
}

const tint = c => ({ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` })
const when = iso => (iso ? new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')

export function uffizioTone(s) {
  if (!s?.configured) return 'idle'
  if (s.lastError && (!s.lastOkAt || s.lastErrorAt >= s.lastOkAt)) return 'warn'
  return s.lastOkAt ? 'ok' : 'idle'
}

export default function UffizioCard({ push }) {
  const [status, setStatus] = useState(null)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(() => fetchUffizioStatus()
    .then(setStatus)
    .catch(err => { if (err instanceof ApiError && err.isForbidden) setHidden(true) }), [])

  useEffect(() => {
    load()
    const t = setInterval(() => { load(); setNow(Date.now()) }, 30_000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(t); clearInterval(tick) }
  }, [load])

  if (hidden) return null

  const nextAt = status?.nextAllowedAt ? Date.parse(status.nextAllowedAt) : 0
  const waitSec = Math.max(0, Math.ceil((nextAt - now) / 1000))
  const tone = TONES[uffizioTone(status)]

  const poll = async () => {
    setBusy('poll')
    try {
      const d = await pollUffizio()
      setStatus(d.status)
      const r = d.result
      if (r?.ok) push?.(`Uffizio: ${r.rows} vehicle${r.rows === 1 ? '' : 's'} read, ${r.inserted} new fuel reading${r.inserted === 1 ? '' : 's'}${r.created ? `, ${r.created} vehicle${r.created === 1 ? '' : 's'} added` : ''}`, { tone: 'success' })
      else push?.(r?.error || 'Uffizio did not answer', { tone: 'error' })
    } catch (err) {
      push?.(err?.message || 'Poll failed', { tone: 'error' })
      load()
    } finally {
      setBusy('')
    }
  }
  const test = async () => {
    setBusy('test')
    try {
      const r = await testUffizio()
      push?.(r.ok ? r.message : r.error, { tone: r.ok ? 'success' : 'error' })
    } catch (err) {
      push?.(err?.message || 'Test failed', { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  const r = status?.lastResult
  return (
    <section className="uf-card" aria-labelledby="uf-title">
      <style>{CSS}</style>
      <div className="uf-head">
        <div className="uf-ico"><CloudDownload size={19} aria-hidden="true" /></div>
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <div id="uf-title" className="uf-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            Uffizio (fuel vehicles)
            {status && <span className="uf-chip" style={tint(tone.color)}><tone.icon size={12} aria-hidden="true" />{tone.label}</span>}
          </div>
          <div className="uf-sub">
            Vehicles that report only to Uffizio come in through its API about every 2 minutes, with their fuel readings.
            They are never added to Flespi.
          </div>
        </div>
        <div className="uf-acts">
          <button type="button" className="uf-btn" onClick={test} disabled={!!busy || !status || status.missing?.some(k => k !== 'UFFIZIO_BG_ID')}>
            <PlugZap size={14} aria-hidden="true" />{busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" className="uf-btn primary" onClick={poll} disabled={!!busy || !status?.configured || waitSec > 0}
            title={waitSec > 0 ? 'Uffizio allows one call every 2 minutes' : undefined}>
            <RefreshCw size={14} aria-hidden="true" className={busy === 'poll' ? 'animate-spin' : undefined} />
            {busy === 'poll' ? 'Polling…' : waitSec > 0 ? `Poll now (${waitSec} s)` : 'Poll now'}
          </button>
        </div>
      </div>

      {!status ? (
        <div className="uf-sub" style={{ marginTop: 12 }}>Loading…</div>
      ) : (
        <>
          <dl className="uf-grid">
            <div><dt>Business Group</dt><dd>{status.bg?.name ?? (status.bgMissing ? 'Not found' : '—')}</dd></div>
            <div><dt>Uffizio company</dt><dd>{status.company ?? '—'}</dd></div>
            <div><dt>Vehicles</dt><dd>{status.vehicles}{status.vehiclesReporting24h ? ` · ${status.vehiclesReporting24h} with fuel today` : ''}</dd></div>
            <div><dt>Fuel readings, 24 h</dt><dd>{status.readings24h.toLocaleString()}</dd></div>
            <div><dt>Last poll</dt><dd>{when(status.lastPollAt)}</dd></div>
            <div><dt>Last good poll</dt><dd>{when(status.lastOkAt)}</dd></div>
            <div><dt>Every</dt><dd>{status.intervalSec} s</dd></div>
            <div><dt>Server</dt><dd>{status.host ?? '—'}{status.projectId ? ` · project ${status.projectId}` : ''}</dd></div>
          </dl>
          {!status.configured && (
            <div className="uf-msg" style={tint('#d97706')}>
              <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ color: 'var(--c-text1)' }}>
                {status.bgMissing
                  ? 'The Business Group set in UFFIZIO_BG_ID does not exist. Set it to the id of “Al Jaber Leasing - Fuel” on the server and restart it.'
                  : `The feed is off until these are set on the server: ${status.missing.join(', ')}.`}
              </div>
            </div>
          )}
          {status.lastError && (
            <div className="uf-msg" style={tint('#dc2626')}>
              <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ color: 'var(--c-text1)' }}><b>Last error</b> ({when(status.lastErrorAt)}): {status.lastError}</div>
            </div>
          )}
          {r?.conflicts?.length > 0 && (
            <div className="uf-msg" style={tint('#d97706')}>
              <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ color: 'var(--c-text1)' }}>
                <b>{r.conflicts.length} vehicle{r.conflicts.length === 1 ? '' : 's'} skipped</b>
                <ul className="uf-list">{r.conflicts.map(c => <li key={c.imei}>{c.message}</li>)}</ul>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
