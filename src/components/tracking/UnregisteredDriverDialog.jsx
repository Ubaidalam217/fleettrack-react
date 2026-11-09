import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, UserPlus, UserCheck, AlertTriangle, Copy, Check } from 'lucide-react'
import { useDrivers, updateDriver, ibuttonKey } from '../../data/settings'
import { usePageAccess } from '../../pages/settings/pageChrome'

/**
 * A Driver ID (iButton) no driver holds (client, 2026-11-09): "tap on it to
 * register the Driver ID key". Two ways out — register a new driver with the
 * ID filled in, or give the ID to a driver already on file.
 *
 * code        the ID as stored (upper-case hex)
 * vehicleName where it was read, for the explanation
 * bgId        the vehicle's Business Group, to narrow the driver list and
 *             pre-fill the new driver's form; may be empty
 */

const CSS = `
.ud-overlay{position:fixed;inset:0;z-index:3100;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(2,10,12,.55);backdrop-filter:blur(3px);animation:ud-fade .16s ease-out}
.ud-dialog{width:min(560px,100%);max-height:min(88vh,760px);overflow-y:auto;background:var(--c-card);color:var(--c-text1);
  border:1px solid var(--c-border2);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.35);animation:ud-pop .2s cubic-bezier(.2,.9,.3,1.15)}
@keyframes ud-fade{from{opacity:0}to{opacity:1}}
@keyframes ud-pop{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
.ud-head{display:flex;align-items:center;gap:14px;padding:18px 20px 16px;border-bottom:1px solid var(--c-border2)}
.ud-ico{width:46px;height:46px;border-radius:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#d97706;
  background:color-mix(in srgb,#f59e0b 16%,transparent);border:1px solid color-mix(in srgb,#f59e0b 35%,transparent)}
.ud-title{font-size:17px;font-weight:800;letter-spacing:-.01em}
.ud-id{display:inline-flex;align-items:center;gap:6px;margin-top:4px;font-size:12px;color:var(--c-text2)}
.ud-id code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;font-weight:700;color:var(--c-text1);letter-spacing:.03em}
.ud-x{width:36px;height:36px;margin-left:auto;align-self:flex-start;border-radius:10px;border:0;background:transparent;color:var(--c-text3);
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.ud-x:hover{background:var(--c-hover);color:var(--c-text1)}
.ud-mini{width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--c-text3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.ud-mini:hover{background:var(--c-hover);color:var(--c-text1)}
.ud-body{padding:18px 20px 20px;display:flex;flex-direction:column;gap:12px}
.ud-lead{font-size:12.5px;line-height:1.6;color:var(--c-text2)}
.ud-opt{border:1px solid var(--c-border);border-radius:14px;padding:14px 16px;background:color-mix(in srgb,var(--c-input) 40%,var(--c-card))}
.ud-opt-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.ud-opt-ico{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  color:var(--ft-accent);background:color-mix(in srgb,var(--ft-accent) 13%,transparent)}
.ud-opt-title{font-size:13.5px;font-weight:800}
.ud-opt-text{font-size:12px;color:var(--c-text3);line-height:1.55;margin-bottom:12px}
.ud-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ud-select{flex:1;min-width:180px;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--c-border2);background:var(--c-input);
  color:var(--c-text1);font-size:13px;font-family:inherit;outline:none}
.ud-select:focus{border-color:var(--ft-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ft-accent) 18%,transparent)}
.ud-btn{height:40px;padding:0 16px;border-radius:10px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text1);
  font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;white-space:nowrap}
.ud-btn:hover{background:var(--c-hover)}
.ud-btn:disabled{opacity:.5;cursor:not-allowed}
.ud-btn.primary{background:var(--ft-accent);border-color:var(--ft-accent);color:#fff}
.ud-btn.primary:hover{filter:brightness(1.07);background:var(--ft-accent)}
.ud-note{font-size:11.5px;color:var(--c-text3)}
.ud-err{font-size:11.5px;font-weight:600;color:#ef4444}
`

export default function UnregisteredDriverDialog({ code, vehicleName, bgId, onClose, onDone }) {
  const navigate = useNavigate()
  const drivers = useDrivers()
  const access = usePageAccess('driver')
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // Drivers of the vehicle's Business Group, those without an ID first.
  const choices = useMemo(() => drivers
    .filter(d => !bgId || d.companyId === bgId)
    .sort((a, b) => (!!ibuttonKey(a.ibuttonCode) - !!ibuttonKey(b.ibuttonCode)) || a.name.localeCompare(b.name)), [drivers, bgId])
  const chosen = choices.find(d => d.id === pick)
  const replacing = chosen && ibuttonKey(chosen.ibuttonCode)

  const register = () => {
    const q = new URLSearchParams({ register: code })
    if (bgId) q.set('bg', bgId)
    onClose()
    navigate(`/settings/driver?${q}`)
  }

  const assign = async () => {
    if (!chosen) return
    setBusy(true)
    setErr(null)
    try {
      await updateDriver(chosen.id, { ...chosen, ibuttonCode: code })
      onDone?.(`Driver ID ${code} is now ${chosen.name}'s`)
      onClose()
    } catch (e) {
      setErr(e?.message || 'Could not assign the Driver ID')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch { /* blocked */ }
  }

  return createPortal(
    <div className="ud-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <style>{CSS}</style>
      <div className="ud-dialog" role="dialog" aria-modal="true" aria-labelledby="ud-title">
        <div className="ud-head">
          <div className="ud-ico"><AlertTriangle size={22} /></div>
          <div style={{ minWidth: 0 }}>
            <div id="ud-title" className="ud-title">Unregistered Driver</div>
            <div className="ud-id">
              Driver ID <code>{code}</code>
              <button type="button" className="ud-mini" onClick={copy} aria-label="Copy the Driver ID" title={copied ? 'Copied' : 'Copy'}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          </div>
          <button type="button" className="ud-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="ud-body">
          <div className="ud-lead">
            {vehicleName ? <><b>{vehicleName}</b> read this Driver ID, but it </> : 'This Driver ID '}
            is not linked to any driver yet. Link it so trips, reports and alerts show who was driving.
          </div>

          {!access.canAdd && !access.canWrite && (
            <div className="ud-note">Ask an administrator to register this Driver ID — your account cannot change drivers.</div>
          )}

          {access.canAdd && (
            <div className="ud-opt">
              <div className="ud-opt-head">
                <span className="ud-opt-ico"><UserPlus size={16} /></span>
                <span className="ud-opt-title">Register a new driver</span>
              </div>
              <div className="ud-opt-text">Opens the driver form with this Driver ID already filled in.</div>
              <button type="button" className="ud-btn primary" onClick={register}><UserPlus size={15} />Register driver</button>
            </div>
          )}

          {access.canWrite && (
            <div className="ud-opt">
              <div className="ud-opt-head">
                <span className="ud-opt-ico"><UserCheck size={16} /></span>
                <span className="ud-opt-title">Give it to a driver on file</span>
              </div>
              <div className="ud-opt-text">For a driver who is already registered but whose card was not recorded yet.</div>
              <div className="ud-row">
                <select className="ud-select" value={pick} onChange={e => { setPick(e.target.value); setErr(null) }} disabled={busy} aria-label="Driver">
                  <option value="">{choices.length ? 'Choose the driver…' : 'No drivers on file'}</option>
                  {choices.map(d => (
                    <option key={d.id} value={d.id}>{d.name}{ibuttonKey(d.ibuttonCode) ? ` — has ID ${ibuttonKey(d.ibuttonCode)}` : ''}</option>
                  ))}
                </select>
                <button type="button" className="ud-btn" onClick={assign} disabled={!chosen || busy}>{busy ? 'Saving…' : 'Assign ID'}</button>
              </div>
              {replacing && <div className="ud-note" style={{ marginTop: 8 }}>This replaces {chosen.name}'s current ID {replacing}.</div>}
              {err && <div className="ud-err" style={{ marginTop: 8 }}>{err}</div>}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
