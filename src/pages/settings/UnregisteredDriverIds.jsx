import { useState } from 'react'
import { AlertTriangle, UserPlus, UserCheck, Copy, Check, ChevronDown } from 'lucide-react'

/**
 * "Unregistered Driver IDs" on Settings › Driver (client, 2026-11-09): every
 * Driver ID (iButton) the trackers read lately that no driver holds, with the
 * vehicle that read it last — register it as a new driver or give it to one
 * already on file.
 */

const CSS = `
.urd{margin-top:14px;border-radius:14px;border:1px solid color-mix(in srgb,#f59e0b 38%,transparent);
  background:color-mix(in srgb,#f59e0b 6%,var(--c-card));overflow:hidden}
.urd-head{display:flex;align-items:center;gap:12px;padding:14px 16px}
.urd-ico{width:34px;height:34px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  color:#d97706;background:color-mix(in srgb,#f59e0b 18%,transparent)}
.urd-title{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:800;color:var(--c-text1)}
.urd-count{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;color:#b45309;background:color-mix(in srgb,#f59e0b 18%,transparent)}
.urd-sub{font-size:11.5px;color:var(--c-text3);margin-top:2px}
.urd-list{border-top:1px solid color-mix(in srgb,#f59e0b 25%,transparent)}
.urd-row{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(0,1.3fr) minmax(0,.9fr) auto;gap:14px;align-items:center;
  padding:11px 16px;border-bottom:1px solid var(--c-border)}
.urd-row:last-child{border-bottom:0}
.urd-id{display:flex;align-items:center;gap:4px;min-width:0}
.urd-id code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;font-weight:700;color:var(--c-text1);letter-spacing:.03em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.urd-cell{min-width:0}
.urd-main{font-size:12.5px;font-weight:650;color:var(--c-text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.urd-meta{font-size:11px;color:var(--c-text3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.urd-actions{display:flex;gap:6px;justify-content:flex-end}
.urd-btn{height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text1);
  font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
.urd-btn:hover{background:var(--c-hover)}
.urd-btn.primary{background:var(--ft-accent);border-color:var(--ft-accent);color:#fff}
.urd-btn.primary:hover{filter:brightness(1.07)}
.urd-mini{width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--c-text3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.urd-mini:hover{background:var(--c-hover);color:var(--c-text1)}
.urd-more{width:100%;height:38px;border:0;border-top:1px solid var(--c-border);background:transparent;color:var(--ft-accent);font-size:12px;font-weight:700;
  display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}
.urd-more:hover{background:var(--c-hover)}
@media (max-width:760px){
  .urd-row{grid-template-columns:minmax(0,1fr) auto}
  .urd-row .urd-cell.vehicle,.urd-row .urd-cell.seen{grid-column:1/2}
  .urd-actions{grid-column:2/3;grid-row:1/4;flex-direction:column}
}
`

const SHOW = 5

function ago(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86_400)} d ago`
}

function CopyId({ code }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="urd-mini"
      aria-label={`Copy Driver ID ${code}`}
      title={done ? 'Copied' : 'Copy'}
      onClick={async () => { try { await navigator.clipboard.writeText(code); setDone(true); setTimeout(() => setDone(false), 1400) } catch { /* blocked */ } }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

export default function UnregisteredDriverIds({ rows, canAdd, canWrite, onRegister, onAssign }) {
  const [all, setAll] = useState(false)
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, SHOW)

  return (
    <section className="urd" aria-labelledby="urd-title">
      <style>{CSS}</style>
      <div className="urd-head">
        <span className="urd-ico"><AlertTriangle size={17} /></span>
        <div style={{ minWidth: 0 }}>
          <div id="urd-title" className="urd-title">Unregistered Driver IDs <span className="urd-count">{rows.length}</span></div>
          <div className="urd-sub">Read by your trackers in the last 30 days, but not linked to any driver yet.</div>
        </div>
      </div>
      <div className="urd-list">
        {shown.map(r => (
          <div key={r.code} className="urd-row">
            <div className="urd-cell urd-id"><code title={r.code}>{r.code}</code><CopyId code={r.code} /></div>
            <div className="urd-cell vehicle">
              <div className="urd-main">{r.vehicle?.plateNo || r.vehicle?.fleetNo || (r.deviceId ? `Device ${r.deviceId}` : '—')}</div>
              <div className="urd-meta">{r.vehicle?.bgName || 'Vehicle not registered in Settings'}</div>
            </div>
            <div className="urd-cell seen">
              <div className="urd-main" title={new Date(r.lastSeen * 1000).toLocaleString()}>{ago(r.lastSeen)}</div>
              <div className="urd-meta">{r.reads.toLocaleString()} read{r.reads === 1 ? '' : 's'}</div>
            </div>
            <div className="urd-actions">
              {canAdd && <button type="button" className="urd-btn primary" onClick={() => onRegister(r)}><UserPlus size={14} />Register</button>}
              {canWrite && <button type="button" className="urd-btn" onClick={() => onAssign(r)}><UserCheck size={14} />Assign</button>}
            </div>
          </div>
        ))}
      </div>
      {rows.length > SHOW && (
        <button type="button" className="urd-more" onClick={() => setAll(a => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
          <ChevronDown size={14} style={{ transform: all ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
      )}
    </section>
  )
}
