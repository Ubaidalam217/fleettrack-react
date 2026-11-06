import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RotateCcw, Send } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import { getDeviceSettings, setDeviceSetting, resetDevice } from '../../data/settings'
import { IS_REAL } from '../../data/mode'

/**
 * The Live Map panel's Parameters tab — the tracker's own settings, as the
 * client means "parameters" (2026-11-06): the over-speed limit, the harsh
 * driving thresholds and the idling timeout, plus a restart. The server
 * (routes/deviceSettings.js) checks who may change them and the device's own
 * limits, and sends them through Flespi.
 *
 * A change is queued by Flespi and reaches the tracker on its next connection,
 * so each setting shows whether its last change is still waiting.
 */

const POLL_MS = 5000
const POLL_FOR_MS = 90_000

const SECTIONS = [
  {
    key: 'overspeed', title: 'Over speed',
    note: 'The tracker raises its own over-speed event above this speed.',
    fields: [{ field: 'max_speed', label: 'Max speed', unit: 'km/h', min: 10, max: 260, step: 1 }],
  },
  {
    key: 'greenDriving', title: 'Harsh driving',
    note: 'Acceleration in m/s² (0.5–10). Lower values report more events.',
    fields: [
      { field: 'max_accel', label: 'Harsh acceleration', unit: 'm/s²', min: 0.5, max: 10, step: 0.1 },
      { field: 'max_brake', label: 'Harsh braking', unit: 'm/s²', min: 0.5, max: 10, step: 0.1 },
      { field: 'max_angle', label: 'Harsh cornering', unit: 'm/s²', min: 0.5, max: 10, step: 0.1 },
    ],
  },
  {
    key: 'idling', title: 'Excess idling',
    note: 'The tracker reports idling once the vehicle has stood with the engine on this long.',
    // Stored in seconds on the device; shown in minutes.
    fields: [{ field: 'stop_time', label: 'Idling after', unit: 'min', min: 0, max: 60, step: 1, scale: 60 }],
  },
]

const fmtTime = ts => (ts ? new Date(ts * 1000).toLocaleString() : '—')

function Status({ setting }) {
  if (!setting) return null
  const waiting = setting.pending != null
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
      color: waiting ? '#b45309' : '#15803d', background: waiting ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
    }}>
      {waiting ? 'Waiting for the tracker to connect' : `On the device · read ${fmtTime(setting.updated)}`}
    </span>
  )
}

export default function DeviceSettingsTab({ v }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState({})
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [askReset, setAskReset] = useState(false)
  const pollUntil = useRef(0)

  const load = async () => {
    try {
      const d = await getDeviceSettings(v.id)
      setData(d)
      setError(null)
      return d
    } catch (err) {
      setError(err.message || String(err))
      return null
    }
  }

  useEffect(() => {
    if (!IS_REAL) return
    let live = true
    let timer = null
    const tick = async () => {
      const d = await load()
      if (!live) return
      const waiting = d && (Object.values(d.settings).some(s => s?.pending != null) || d.reset?.pending != null)
      if (waiting && Date.now() < pollUntil.current) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { live = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.id])

  const startPolling = () => {
    pollUntil.current = Date.now() + POLL_FOR_MS
    const tick = async () => {
      const d = await load()
      const waiting = d && (Object.values(d.settings).some(s => s?.pending != null) || d.reset?.pending != null)
      if (waiting && Date.now() < pollUntil.current) setTimeout(tick, POLL_MS)
    }
    setTimeout(tick, POLL_MS)
  }

  if (!IS_REAL) {
    return <div style={{ padding: '24px 4px', fontSize: 12.5, color: 'var(--c-text3)' }}>Device settings are changed through the server, so they are not available in demo mode.</div>
  }
  if (error && !data) return <div style={{ padding: '24px 4px', fontSize: 12.5, color: '#ef4444' }}>Could not read the device settings: {error}</div>
  if (!data) return <div style={{ padding: '24px 4px', fontSize: 12.5, color: 'var(--c-text3)' }}>Reading the tracker settings…</div>
  if (!data.supported) {
    return <div style={{ padding: '24px 4px', fontSize: 12.5, color: 'var(--c-text3)' }}>This tracker model has no settings FleetmaxX can change from here.</div>
  }

  const platform = data.primaryPlatform
  const mustConfirm = !!platform && data.canEdit
  const blocked = mustConfirm && !confirmed

  const save = async section => {
    const s = data.settings[section.key]
    const values = {}
    for (const f of section.fields) {
      const raw = draft[`${section.key}.${f.field}`]
      if (raw === undefined || raw === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n) || n < f.min || n > f.max) { setMsg({ tone: 'error', text: `${f.label} must be between ${f.min} and ${f.max} ${f.unit}` }); return }
      values[f.field] = f.scale ? Math.round(n * f.scale) : n
    }
    if (!Object.keys(values).length || !s) { setMsg({ tone: 'error', text: 'Change a value first.' }); return }
    setBusy(section.key)
    setMsg(null)
    try {
      await setDeviceSetting(v.id, section.key, values, confirmed)
      setMsg({ tone: 'ok', text: `${section.title} sent. It applies when the tracker next connects.` })
      setDraft(d => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${section.key}.`))))
      await load()
      startPolling()
    } catch (err) {
      setMsg({ tone: 'error', text: err.message || String(err) })
    } finally {
      setBusy(null)
    }
  }

  const doReset = async () => {
    setAskReset(false)
    setBusy('reset')
    setMsg(null)
    try {
      await resetDevice(v.id, confirmed)
      setMsg({ tone: 'ok', text: 'Restart sent. The tracker restarts when it next connects.' })
      await load()
      startPolling()
    } catch (err) {
      setMsg({ tone: 'error', text: err.message || String(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {platform && (
        <div style={{
          display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.5,
          background: platform.itc ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.1)',
          border: `1px solid ${platform.itc ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.35)'}`, color: 'var(--c-text1)',
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, color: platform.itc ? '#ef4444' : '#d97706', marginTop: 2 }} />
          <div>
            <strong>This tracker reports first to {platform.host}{platform.itc ? ' (UAE ITC)' : ''}</strong>; Flespi is its backup server.
            A setting changed here also changes what the tracker sends there.
            {mustConfirm && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer', fontWeight: 600 }}>
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--ft-accent)' }} />
                I understand and want to change this tracker&apos;s settings
              </label>
            )}
          </div>
        </div>
      )}

      {!data.canEdit && (
        <div style={{ fontSize: 11.5, color: 'var(--c-text3)' }}>Only an administrator (Super Admin or GGB Admin) can change the tracker settings.</div>
      )}

      {SECTIONS.map(section => {
        const s = data.settings[section.key]
        if (!s) return null
        return (
          <div key={section.key} style={{ border: '1px solid var(--c-border)', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text1)' }}>{section.title}</span>
              <Status setting={s} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-text3)', marginBottom: 10 }}>{section.note}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}>
              {section.fields.map(f => {
                const cur = s.current?.[f.field]
                const shown = cur == null ? '—' : f.scale ? +(cur / f.scale).toFixed(1) : cur
                const k = `${section.key}.${f.field}`
                return (
                  <label key={f.field} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {f.label} ({f.unit}) · now {shown}
                    </span>
                    <input
                      type="number" min={f.min} max={f.max} step={f.step}
                      disabled={!data.canEdit}
                      value={draft[k] ?? ''}
                      placeholder={String(shown)}
                      onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                      style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text1)', fontSize: 12.5 }}
                    />
                  </label>
                )
              })}
              {data.canEdit && (
                <button type="button" className="ft-btn" onClick={() => save(section)} disabled={blocked || busy !== null}
                  style={{ padding: '8px 12px', fontSize: 12, opacity: blocked || busy !== null ? 0.5 : 1, justifyContent: 'center' }}>
                  <Send size={13} /> {busy === section.key ? 'Sending…' : 'Send to tracker'}
                </button>
              )}
            </div>
          </div>
        )
      })}

      {data.canEdit && data.reset && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', border: '1px solid var(--c-border)', borderRadius: 10, padding: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text1)' }}>Restart tracker</div>
            <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>Reboots the device. It reconnects by itself within a minute or two.</div>
          </div>
          <button type="button" className="ft-btn" onClick={() => setAskReset(true)} disabled={blocked || busy !== null}
            style={{ padding: '8px 12px', fontSize: 12, opacity: blocked || busy !== null ? 0.5 : 1 }}>
            <RotateCcw size={13} /> {busy === 'reset' ? 'Sending…' : 'Restart'}
          </button>
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: msg.tone === 'error' ? '#ef4444' : '#15803d' }}>{msg.text}</div>}

      {askReset && (
        <ConfirmDialog
          title="Restart this tracker?"
          body={`${v.master?.plateNo || v.name} will reboot when it next connects. It stops reporting for a minute or two.`}
          confirmLabel="Restart"
          onConfirm={doReset}
          onClose={() => setAskReset(false)}
        />
      )}
    </div>
  )
}
