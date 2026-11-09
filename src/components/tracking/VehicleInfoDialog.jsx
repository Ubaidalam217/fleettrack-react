import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Pencil, Plus, Trash2, Copy, Check, Truck, Fingerprint, Hash, Cpu, CalendarClock,
  Mail, Phone, Link2, ListPlus, Info,
} from 'lucide-react'
import { useSettingsProfile, useVehicles, updateVehicleCustomFields } from '../../data/settings'
import { usePageAccess } from '../../pages/settings/pageChrome'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { validityState } from '../../utils/liveMapFilters'
import {
  validateCustomFields, cleanCustomFields, fieldNameSuggestions, valueParts, MAX_CUSTOM_FIELDS,
} from '../../utils/customFields'

/**
 * "Vehicle information" from a vehicle's ⋮ menu on the Live Map (client,
 * 2026-11-09): the vehicle's identity plus whatever custom fields the client
 * keeps against it — contract numbers, dates, contacts — in the client's own
 * words. Users who may edit vehicles get an Edit mode to add, change or remove
 * fields; names already used on other vehicles are offered while typing.
 */

const CSS = `
.vi-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(2,10,12,.55);backdrop-filter:blur(3px);animation:vi-fade .16s ease-out}
.vi-dialog{width:min(800px,100%);max-height:min(88vh,880px);display:flex;flex-direction:column;overflow:hidden;
  background:var(--c-card);color:var(--c-text1);border:1px solid var(--c-border2);border-radius:18px;
  box-shadow:0 30px 80px rgba(0,0,0,.35),0 2px 0 rgba(255,255,255,.02) inset;animation:vi-pop .2s cubic-bezier(.2,.9,.3,1.15)}
@keyframes vi-fade{from{opacity:0}to{opacity:1}}
@keyframes vi-pop{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}

.vi-head{display:flex;align-items:center;gap:14px;padding:18px 20px 16px;border-bottom:1px solid var(--c-border2)}
.vi-avatar{width:46px;height:46px;border-radius:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--ft-accent);
  background:linear-gradient(135deg,color-mix(in srgb,var(--ft-accent) 24%,transparent),color-mix(in srgb,var(--ft-accent) 7%,transparent));
  border:1px solid color-mix(in srgb,var(--ft-accent) 32%,transparent)}
.vi-titlerow{display:flex;align-items:center;gap:10px;min-width:0}
.vi-title{font-size:17px;font-weight:800;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vi-pill{flex-shrink:0;display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px}
.vi-pill i{width:6px;height:6px;border-radius:50%;background:currentColor}
.vi-sub{font-size:12px;color:var(--c-text3);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vi-sub b{color:var(--c-text2);font-weight:600}

.vi-btn{height:36px;padding:0 14px;border-radius:10px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text1);
  font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:7px;cursor:pointer;white-space:nowrap;
  transition:background .15s,border-color .15s,color .15s,filter .15s}
.vi-btn:hover{background:var(--c-hover)}
.vi-btn:disabled{opacity:.5;cursor:not-allowed}
.vi-btn.primary{background:var(--ft-accent);border-color:var(--ft-accent);color:#fff}
.vi-btn.primary:hover{filter:brightness(1.07);background:var(--ft-accent)}
.vi-iconbtn{width:36px;height:36px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--c-text3);
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background .15s,color .15s}
.vi-iconbtn:hover{background:var(--c-hover);color:var(--c-text1)}

.vi-body{flex:1;overflow-y:auto;padding:18px 20px 22px;scrollbar-width:thin}
.vi-meta{display:grid;grid-template-columns:minmax(0,1.45fr) repeat(3,minmax(0,1fr));gap:10px}
.vi-tile{padding:11px 13px;border-radius:12px;background:var(--c-input);border:1px solid var(--c-border);min-width:0}
.vi-label{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--c-text3)}
.vi-tileval{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;font-weight:700;min-width:0}
.vi-tileval span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vi-mono{font-variant-numeric:tabular-nums;letter-spacing:.02em}
.vi-mini{width:24px;height:24px;border-radius:7px;border:0;background:transparent;color:var(--c-text3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.vi-mini:hover{background:var(--c-hover);color:var(--c-text1)}

.vi-sechead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 10px}
.vi-sectitle{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:800}
.vi-count{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--c-hover);color:var(--c-text2)}
.vi-edited{font-size:11.5px;color:var(--c-text3);text-align:right}

.vi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.vi-cell{position:relative;padding:12px 40px 12px 14px;border-radius:12px;border:1px solid var(--c-border);
  background:color-mix(in srgb,var(--c-input) 55%,var(--c-card));min-height:64px;transition:border-color .15s}
.vi-cell:hover{border-color:var(--c-border2)}
.vi-cell .vi-label{letter-spacing:.05em;text-transform:none;font-size:11px;font-weight:700}
.vi-value{margin-top:5px;font-size:13.5px;font-weight:600;line-height:1.45;word-break:break-word;white-space:pre-wrap}
.vi-value a{color:var(--ft-accent);text-decoration:none;border-bottom:1px dashed color-mix(in srgb,var(--ft-accent) 50%,transparent)}
.vi-value a:hover{border-bottom-style:solid}
.vi-value .vi-ico{display:inline-flex;vertical-align:-2px;margin-right:4px;color:var(--ft-accent)}
.vi-cell .vi-copy{position:absolute;top:9px;right:9px;opacity:0;transition:opacity .15s}
.vi-cell:hover .vi-copy,.vi-cell .vi-copy:focus-visible{opacity:1}
.vi-muted{color:var(--c-text3);font-weight:500}

.vi-empty{border:1.5px dashed var(--c-border2);border-radius:14px;padding:32px 20px;text-align:center}
.vi-empty-ico{width:44px;height:44px;margin:0 auto 10px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  color:var(--ft-accent);background:color-mix(in srgb,var(--ft-accent) 12%,transparent)}
.vi-empty h4{margin:0;font-size:14px;font-weight:800}
.vi-empty p{margin:6px auto 14px;max-width:380px;font-size:12.5px;color:var(--c-text3);line-height:1.55}
.vi-notice{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:12px;font-size:12.5px;line-height:1.55;
  background:color-mix(in srgb,#f59e0b 10%,transparent);border:1px solid color-mix(in srgb,#f59e0b 35%,transparent);color:var(--c-text1)}

.vi-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) 40px;gap:10px;align-items:start}
.vi-colhead{padding:0 2px 8px;font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--c-text3)}
.vi-row{margin-bottom:10px}
.vi-input{width:100%;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--c-border2);background:var(--c-input);
  color:var(--c-text1);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
.vi-input::placeholder{color:var(--c-text3)}
.vi-input:focus{border-color:var(--ft-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ft-accent) 18%,transparent)}
.vi-input.err{border-color:#ef4444}
.vi-input.err:focus{box-shadow:0 0 0 3px rgba(239,68,68,.18)}
.vi-errtxt{margin-top:5px;font-size:11px;font-weight:600;color:#ef4444}
.vi-del{width:40px;height:40px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--c-text3);
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,color .15s}
.vi-del:hover{background:rgba(239,68,68,.1);color:#ef4444}
.vi-add{width:100%;height:42px;margin-top:2px;border-radius:10px;border:1.5px dashed color-mix(in srgb,var(--ft-accent) 50%,transparent);
  background:color-mix(in srgb,var(--ft-accent) 5%,transparent);color:var(--ft-accent);font-size:12.5px;font-weight:800;
  display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;transition:background .15s}
.vi-add:hover{background:color-mix(in srgb,var(--ft-accent) 11%,transparent)}
.vi-add:disabled{opacity:.5;cursor:not-allowed}
.vi-chips{margin-top:16px;padding-top:14px;border-top:1px solid var(--c-border)}
.vi-chipwrap{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
.vi-chip{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--c-border2);background:var(--c-input);color:var(--c-text2);
  font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;cursor:pointer;transition:border-color .15s,color .15s}
.vi-chip:hover{border-color:var(--ft-accent);color:var(--ft-accent)}

.vi-sugwrap{position:relative}
.vi-sug{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:5;padding:6px;border-radius:12px;background:var(--c-card);
  border:1px solid var(--c-border2);box-shadow:0 16px 40px rgba(0,0,0,.28)}
.vi-sughead{padding:4px 8px 6px;font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--c-text3)}
.vi-sugitem{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;font-size:12.5px;cursor:pointer}
.vi-sugitem.on{background:var(--c-hover)}
.vi-sugitem mark{background:transparent;color:var(--ft-accent);font-weight:800}
.vi-sugitem small{font-size:10.5px;color:var(--c-text3);flex-shrink:0}

.vi-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-top:1px solid var(--c-border2);
  background:color-mix(in srgb,var(--c-input) 45%,var(--c-card))}
.vi-foot .vi-note{font-size:11.5px;color:var(--c-text3)}

@media (max-width:640px){
  .vi-meta{grid-template-columns:repeat(2,minmax(0,1fr))}
  .vi-grid{grid-template-columns:minmax(0,1fr)}
  .vi-cols{grid-template-columns:minmax(0,1fr) 40px}
  .vi-cols>.vi-valcol{grid-column:1/2}
  .vi-cols>.vi-delcol{grid-row:1/3;grid-column:2/3;align-self:center}
  .vi-colhead.vi-valcol,.vi-colhead.vi-delcol{display:none}
  .vi-head{flex-wrap:wrap}
}
`

const fmtWhen = iso => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const fmtDay = ymd => {
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
const VALIDITY_STYLE = {
  valid: { color: '#16a34a', note: 'valid' },
  expiring: { color: '#d97706', note: 'expires soon' },
  expired: { color: '#ef4444', note: 'expired' },
}

let rowSeq = 0
const toRows = list => (list.length ? list : [{ name: '', value: '' }]).map(f => ({ id: ++rowSeq, name: f.name, value: f.value }))

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false)
  const copy = async e => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1400)
    } catch { /* clipboard blocked: the text is still selectable */ }
  }
  return (
    <button type="button" className="vi-mini vi-copy" onClick={copy} title={done ? 'Copied' : `Copy ${label}`} aria-label={`Copy ${label}`}>
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function FieldValue({ value, name }) {
  if (!value) return <span className="vi-muted">—</span>
  return valueParts(value, name).map((p, i) => {
    if (p.type === 'text') return <span key={i}>{p.text}</span>
    const Ico = p.type === 'email' ? Mail : p.type === 'phone' ? Phone : Link2
    return (
      <a key={i} href={p.href} target={p.type === 'url' ? '_blank' : undefined} rel={p.type === 'url' ? 'noreferrer' : undefined}>
        <span className="vi-ico"><Ico size={12} /></span>{p.text}
      </a>
    )
  })
}

/** A field-name input that offers the names used on other vehicles. */
function NameInput({ value, onChange, options, error, inputRef, onDone }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const q = value.trim().toLowerCase()
  const list = options.filter(o => o.name.toLowerCase() !== q && (!q || o.name.toLowerCase().includes(q))).slice(0, 6)
  const show = open && list.length > 0

  const pick = name => { onChange(name); setOpen(false); onDone?.() }
  const onKeyDown = e => {
    if (!show) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % list.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + list.length) % list.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(list[active].name) }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
  }
  const mark = name => {
    const i = q ? name.toLowerCase().indexOf(q) : -1
    if (i < 0) return name
    return <>{name.slice(0, i)}<mark>{name.slice(i, i + q.length)}</mark>{name.slice(i + q.length)}</>
  }

  return (
    <div className="vi-sugwrap">
      <input
        ref={inputRef}
        className={`vi-input${error ? ' err' : ''}`}
        value={value}
        placeholder="Field name, e.g. Contract End Date"
        maxLength={80}
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        aria-invalid={!!error || undefined}
        aria-autocomplete="list"
      />
      {show && (
        <div className="vi-sug" role="listbox">
          <div className="vi-sughead">Used on other vehicles</div>
          {list.map((o, i) => (
            <div
              key={o.name}
              role="option"
              aria-selected={i === active}
              className={`vi-sugitem${i === active ? ' on' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(o.name) }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{mark(o.name)}</span>
              <small>{o.count} vehicle{o.count === 1 ? '' : 's'}</small>
            </div>
          ))}
        </div>
      )}
      {error && <div className="vi-errtxt">{error}</div>}
    </div>
  )
}

export default function VehicleInfoDialog({ vehicle, title, onClose, onSaved, onRegister }) {
  const profile = useSettingsProfile(vehicle.ident)
  const allVehicles = useVehicles()
  const access = usePageAccess('vehicle')
  const row = profile.linked ? profile.vehicle : null
  const saved = useMemo(() => row?.customFields ?? [], [row])
  const canEdit = !!row && access.canWrite

  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState(() => toRows(saved))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const nameRefs = useRef(new Map())
  const focusId = useRef(null)

  const suggestions = useMemo(() => fieldNameSuggestions(allVehicles), [allVehicles])
  const usedHere = new Set(rows.map(r => r.name.trim().toLowerCase()).filter(Boolean))
  const nameOptions = suggestions.filter(s => !usedHere.has(s.name.toLowerCase()))
  const dirty = JSON.stringify(cleanCustomFields(rows)) !== JSON.stringify(cleanCustomFields(saved))

  // Esc closes the dialog when reading; while editing it only closes a
  // suggestion list, so a stray key cannot throw away typed fields.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !editing) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  // Focus a row asked for (a new one, or the first in Edit) once it is on screen.
  useEffect(() => {
    if (focusId.current == null) return
    nameRefs.current.get(focusId.current)?.focus()
    focusId.current = null
  })

  const startEdit = () => {
    const next = toRows(saved)
    setRows(next)
    setErrors({})
    setSaveError(null)
    setEditing(true)
    focusId.current = next[0].id
  }
  const cancelEdit = () => { setEditing(false); setErrors({}); setSaveError(null) }
  const setRow = (id, key, value) => {
    setRows(list => list.map(r => (r.id === id ? { ...r, [key]: value } : r)))
    setErrors({})
  }
  const addRow = (name = '') => {
    if (rows.length >= MAX_CUSTOM_FIELDS) return
    const r = { id: ++rowSeq, name, value: '' }
    setRows(list => [...list, r])
    focusId.current = r.id
  }
  const removeRow = id => setRows(list => (list.length === 1 ? [{ id: ++rowSeq, name: '', value: '' }] : list.filter(r => r.id !== id)))

  const save = async () => {
    const errs = validateCustomFields(rows)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    setSaveError(null)
    try {
      await updateVehicleCustomFields(row.id, rows.map(r => ({ name: r.name, value: r.value })))
      setEditing(false)
      onSaved?.(`${vehicleTitle} · vehicle information saved`)
    } catch (err) {
      const details = err?.details ?? {}
      const mapped = {}
      for (const [k, v] of Object.entries(details)) {
        const m = /^fields\.(\d+)\.(name|value)$/.exec(k)
        if (m) mapped[`${m[1]}.${m[2]}`] = v
      }
      setErrors(mapped)
      setSaveError(err?.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  // The same name the Live Map list shows for this vehicle.
  const vehicleTitle = title || profile.plateNo || vehicle.master?.plateNo || vehicle.name || `Device ${vehicle.id}`
  const place = [profile.linked && profile.bgName, profile.linked && profile.groupName !== 'BG is its own group' && profile.groupName, profile.linked && profile.branchName]
    .filter(v => v && v !== '—')
  const validity = row?.validUntil ? validityState(row.validUntil) : null
  const vStyle = VALIDITY_STYLE[validity]
  const color = statusColor(vehicle.status)
  const chipNames = nameOptions.slice(0, 8)

  const tiles = [
    { key: 'imei', icon: Fingerprint, label: 'Unique ID (IMEI)', value: vehicle.ident || '—', mono: true, copy: vehicle.ident },
    { key: 'fleet', icon: Hash, label: 'Fleet No', value: profile.fleetNo || vehicle.master?.fleetNo || '—' },
    { key: 'device', icon: Cpu, label: 'Device Type', value: profile.deviceType || '—' },
    {
      key: 'valid', icon: CalendarClock, label: 'Validity',
      value: row?.validUntil ? fmtDay(row.validUntil) : '—',
      dot: vStyle?.color, title: vStyle ? `${fmtDay(row.validUntil)} · ${vStyle.note}` : undefined,
    },
  ]

  return createPortal(
    <div className="vi-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !editing) onClose() }}>
      <style>{CSS}</style>
      <div className="vi-dialog" role="dialog" aria-modal="true" aria-labelledby="vi-title">
        <div className="vi-head">
          <div className="vi-avatar"><Truck size={22} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="vi-titlerow">
              <span id="vi-title" className="vi-title">{vehicleTitle}</span>
              <span className="vi-pill" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
                <i />{statusLabel(vehicle.status)}
              </span>
            </div>
            <div className="vi-sub">
              {editing ? 'Edit vehicle information' : place.length ? place.map((p, i) => <span key={p}>{i > 0 && '  ·  '}<b>{p}</b></span>) : 'Vehicle information'}
            </div>
          </div>
          {/* With no fields yet, the empty state's "Add fields" is the one way in. */}
          {!editing && canEdit && saved.length > 0 && (
            <button type="button" className="vi-btn" onClick={startEdit}><Pencil size={14} />Edit</button>
          )}
          <button type="button" className="vi-iconbtn" onClick={editing ? cancelEdit : onClose} aria-label={editing ? 'Stop editing' : 'Close'} title={editing ? 'Stop editing' : 'Close'}>
            <X size={18} />
          </button>
        </div>

        <div className="vi-body">
          {!editing && (
            <div className="vi-meta">
              {tiles.map(t => (
                <div key={t.key} className="vi-tile" title={t.title}>
                  <div className="vi-label"><t.icon size={12} />{t.label}</div>
                  <div className="vi-tileval">
                    {t.dot && <i style={{ width: 7, height: 7, borderRadius: '50%', background: t.dot, flexShrink: 0 }} />}
                    <span className={t.mono ? 'vi-mono' : undefined}>{t.value}</span>
                    {t.copy && <CopyButton text={t.copy} label="IMEI" />}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!row ? (
            <div className="vi-notice" style={{ marginTop: 18 }}>
              <Info size={18} style={{ flexShrink: 0, color: '#d97706', marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <strong>This tracker is not registered in Settings yet.</strong><br />
                Custom fields are kept on the Settings vehicle, so register it first — Parameters on the vehicle panel, or Settings › Object › Vehicle.
                {onRegister && access.canWrite && (
                  <div style={{ marginTop: 10 }}>
                    <button type="button" className="vi-btn" onClick={onRegister}><Pencil size={14} />Register in Parameters</button>
                  </div>
                )}
              </div>
            </div>
          ) : !editing ? (
            <>
              <div className="vi-sechead">
                <div className="vi-sectitle">Custom fields <span className="vi-count">{saved.length}</span></div>
                {row.customFieldsUpdatedAt && (
                  <div className="vi-edited">Last edited {fmtWhen(row.customFieldsUpdatedAt)}{row.customFieldsUpdatedBy ? ` · ${row.customFieldsUpdatedBy}` : ''}</div>
                )}
              </div>
              {saved.length ? (
                <div className="vi-grid">
                  {saved.map(f => (
                    <div key={f.name} className="vi-cell">
                      <div className="vi-label">{f.name}</div>
                      <div className="vi-value"><FieldValue value={f.value} name={f.name} /></div>
                      {f.value && <CopyButton text={f.value} label={f.name} />}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="vi-empty">
                  <div className="vi-empty-ico"><ListPlus size={22} /></div>
                  <h4>No custom fields yet</h4>
                  <p>Keep anything you need against this vehicle — contract numbers, dates, contact names, e-mails, phones.</p>
                  {canEdit && <button type="button" className="vi-btn primary" onClick={startEdit}><Plus size={15} />Add fields</button>}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="vi-cols">
                <div className="vi-colhead">Field name</div>
                <div className="vi-colhead vi-valcol">Value</div>
                <div className="vi-colhead vi-delcol" />
              </div>
              {rows.map((r, i) => (
                <div key={r.id} className="vi-cols vi-row">
                  <NameInput
                    value={r.name}
                    onChange={v => setRow(r.id, 'name', v)}
                    options={nameOptions}
                    error={errors[`${i}.name`]}
                    inputRef={el => { if (el) nameRefs.current.set(r.id, el); else nameRefs.current.delete(r.id) }}
                  />
                  <div className="vi-valcol">
                    <input
                      className={`vi-input${errors[`${i}.value`] ? ' err' : ''}`}
                      value={r.value}
                      placeholder="Value"
                      maxLength={1000}
                      onChange={e => setRow(r.id, 'value', e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && i === rows.length - 1) { e.preventDefault(); addRow() } }}
                    />
                    {errors[`${i}.value`] && <div className="vi-errtxt">{errors[`${i}.value`]}</div>}
                  </div>
                  <div className="vi-delcol">
                    <button type="button" className="vi-del" onClick={() => removeRow(r.id)} aria-label={`Remove ${r.name || 'this field'}`} title="Remove field">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" className="vi-add" onClick={() => addRow()} disabled={rows.length >= MAX_CUSTOM_FIELDS}>
                <Plus size={15} />Add field
              </button>
              {chipNames.length > 0 && (
                <div className="vi-chips">
                  <div className="vi-label">Used on other vehicles</div>
                  <div className="vi-chipwrap">
                    {chipNames.map(c => (
                      <button key={c.name} type="button" className="vi-chip" onClick={() => {
                        const blank = rows.find(r => !r.name.trim() && !r.value.trim())
                        if (blank) { setRow(blank.id, 'name', c.name); focusId.current = null } else addRow(c.name)
                      }}>
                        <Plus size={12} />{c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {editing && (
          <div className="vi-foot">
            <span className="vi-note" style={{ color: saveError ? '#ef4444' : undefined }}>
              {saveError || `${cleanCustomFields(rows).length} field${cleanCustomFields(rows).length === 1 ? '' : 's'} · empty rows are skipped`}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="vi-btn" onClick={cancelEdit} disabled={saving}>Cancel</button>
              <button type="button" className="vi-btn primary" onClick={save} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
