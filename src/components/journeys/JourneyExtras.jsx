import { useCallback, useEffect, useRef, useState } from 'react'
import { Link2, Copy, ExternalLink, Ban, QrCode, Receipt, Plus, Unlink, Camera, ClipboardList, LogIn, Truck, Thermometer, MessageCircle, Check } from 'lucide-react'
import {
  journeyLinks, makeJourneyLink, revokeJourneyLink, linkUrl, journeyExpenses, addJourneyExpense, linkJourneyExpense, unlinkJourneyExpense,
  officeCheckIn, fillStopForm, addStopPhoto, photoUrl, dayTime, hhmm,
} from '../../data/journeys'
import { errorMessage } from '../../data/http'
import { downloadQrSheet, downloadStopQr, qrDataUrl } from '../../utils/journeyFiles'
import { answerText } from '../../utils/journeyForms'
import { JModal } from './JourneyDialogs'
import { photoJpegBase64 } from '../../utils/imageUpload'

/**
 * The journey page's parts for the rest of the Uffizio Job module (client
 * 2026-11-21): the public links (tracking for the customer, the driver's
 * page), the QR sheet, expenses, and at each stop the office's check-in, the
 * form and photos; the convoy and temperature as last measured.
 */

const toBase64 = file => photoJpegBase64(file)

/** Tracking link + driver link: make, copy, open, switch off; the QR sheet. */
export function LinksCard({ j, onError }) {
  const [links, setLinks] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(null)
  const [qr, setQr] = useState(null)
  const load = useCallback(() => journeyLinks(j.id).then(setLinks).catch(e => onError(errorMessage(e, 'Could not load the links'))), [j.id, onError])
  useEffect(() => { load() }, [load])

  const live = (links ?? []).filter(l => !l.revokedAt && Date.parse(l.expiresAt) > Date.now())
  const of = kind => live.find(l => l.kind === kind)
  const make = async kind => {
    setBusy(true)
    try { await makeJourneyLink(j.id, { kind }); await load() } catch (e) { onError(errorMessage(e, 'Could not make the link')) } finally { setBusy(false) }
  }
  const copy = async l => {
    try { await navigator.clipboard.writeText(linkUrl(l.kind, l.token)); setCopied(l.id); setTimeout(() => setCopied(null), 1800) } catch { window.prompt('Copy the link', linkUrl(l.kind, l.token)) }
  }
  const showQr = async l => setQr({ url: linkUrl(l.kind, l.token), img: await qrDataUrl(linkUrl(l.kind, l.token), 360), kind: l.kind })
  const qrStops = j.stops.filter((s, i) => i > 0 && s.visitVia === 'QR')

  const Row = ({ kind, title, help }) => {
    const l = of(kind)
    return (
      <div style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="j-strong" style={{ fontSize: 13.5 }}>{title}</div>
            <div className="j-label">{l ? `Open until ${dayTime(l.expiresAt)}${l.lastOpenedAt ? ` · last opened ${dayTime(l.lastOpenedAt)}` : ' · not opened yet'}` : help}</div>
          </div>
          {l ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="j-btn j-btn--sm j-btn--primary" onClick={() => copy(l)}>{copied === l.id ? <Check size={13} /> : <Copy size={13} />} {copied === l.id ? 'Copied' : 'Copy link'}</button>
              <button type="button" className="j-btn j-btn--sm" onClick={() => showQr(l)} title="Show as a QR"><QrCode size={13} /></button>
              <a className="j-btn j-btn--sm" href={linkUrl(l.kind, l.token)} target="_blank" rel="noreferrer" title="Open"><ExternalLink size={13} /></a>
              {j.can.links && <button type="button" className="j-btn j-btn--sm" disabled={busy} onClick={() => revokeJourneyLink(j.id, l.id).then(load).catch(e => onError(errorMessage(e, 'Could not switch it off')))} title="Switch off"><Ban size={13} /></button>}
            </div>
          ) : j.can.links && <button type="button" className="j-btn j-btn--sm" disabled={busy} onClick={() => make(kind)}><Link2 size={13} /> Make the link</button>}
        </div>
      </div>
    )
  }

  return (
    <div className="j-card">
      <div className="j-card-head"><Link2 size={17} /><h2 className="j-card-title">Share</h2><span className="j-card-sub" style={{ marginLeft: 'auto' }}>no login needed; links expire</span></div>
      <Row kind="TRACK" title="Tracking link" help="For the customer: where the vehicle is, the stops and the ETA." />
      <Row kind="DRIVER" title="Driver link" help="For the driver's phone: check in, scan the QR, fill the form, photo, signature." />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <MessageCircle size={14} style={{ opacity: 0.7 }} />
        <span className="j-label" style={{ flex: 1 }}>Send by WhatsApp or e-mail: <span className="j-pill" data-tone="warn" style={{ marginLeft: 4 }}>Setup needed</span> — copy the link for now.</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 12 }}>
        <QrCode size={14} style={{ opacity: 0.7 }} />
        <span className="j-label" style={{ flex: 1 }}>{qrStops.length ? `${qrStops.length} stop${qrStops.length === 1 ? ' is' : 's are'} visited by QR scan.` : 'Stop QR codes (for stops visited by QR, or any stop).'}</span>
        <button type="button" className="j-btn j-btn--sm" onClick={() => downloadQrSheet(j, { all: !qrStops.length }).catch(e => onError(e.message))}><QrCode size={13} /> QR sheet (PDF)</button>
      </div>
      {qr && (
        <JModal title={qr.kind === 'TRACK' ? 'Tracking link' : 'Driver link'} sub="Scan with a phone camera to open." onClose={() => setQr(null)} width={420}>
          <div style={{ textAlign: 'center' }}>
            <img src={qr.img} alt="QR of the link" style={{ width: 280, maxWidth: '100%', borderRadius: 12, background: '#fff', padding: 8 }} />
            <div className="j-label" style={{ marginTop: 10, wordBreak: 'break-all' }}>{qr.url}</div>
          </div>
        </JModal>
      )}
      {qrStops.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {qrStops.map(s => <button key={s.seq} type="button" className="j-btn j-btn--sm" onClick={() => downloadStopQr(j, s)} title={`QR of ${s.name} (PNG)`}>{s.name} · {s.code}</button>)}
        </div>
      )}
    </div>
  )
}

/** Expenses of the journey: the total, add one, link one of the vehicle's, unlink. */
export function ExpensesCard({ j, onError, onChange }) {
  const [data, setData] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ type: 'Fuel', amount: '', vendor: '', description: '' })
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => journeyExpenses(j.id).then(setData).catch(e => onError(errorMessage(e, 'Could not load the expenses'))), [j.id, onError])
  useEffect(() => { load() }, [load])
  const act = async fn => {
    setBusy(true)
    try { await fn(); await load(); onChange?.() } catch (e) { onError(errorMessage(e, 'That did not work')) } finally { setBusy(false) }
  }
  return (
    <div className="j-card">
      <div className="j-card-head"><Receipt size={17} /><h2 className="j-card-title">Expenses</h2><span className="j-num" style={{ marginLeft: 'auto', fontSize: 20 }}>{data ? data.total.toFixed(2) : '—'}</span></div>
      {data?.linked.length === 0 && <div className="j-label" style={{ padding: '6px 0' }}>No costs on this journey yet.</div>}
      {data?.linked.map(e => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid rgba(255,255,255,.06)', fontSize: 13 }}>
          <span style={{ flex: 1, minWidth: 0 }}><b>{e.type}</b>{e.vendor ? ` · ${e.vendor}` : ''} <span className="j-label">{e.expenseDate ?? ''}</span></span>
          <span className="j-strong">{e.amount.toFixed(2)}</span>
          {j.can.expenses && <button type="button" className="j-iconbtn" style={{ width: 28, height: 28 }} disabled={busy} title="Take off this journey" onClick={() => act(() => unlinkJourneyExpense(j.id, e.id))}><Unlink size={13} /></button>}
        </div>
      ))}
      {j.can.expenses && data && (
        <>
          {data.candidates.length > 0 && (
            <select className="j-select" style={{ marginTop: 10 }} value="" disabled={busy} onChange={e => e.target.value && act(() => linkJourneyExpense(j.id, e.target.value))} aria-label="Link an expense of this vehicle">
              <option value="">Link an expense of {j.vehicleLabel}…</option>
              {data.candidates.map(e => <option key={e.id} value={e.id}>{e.expenseDate ?? ''} · {e.type} · {e.amount.toFixed(2)}{e.vendor ? ` · ${e.vendor}` : ''}</option>)}
            </select>
          )}
          {!adding ? (
            <button type="button" className="j-btn j-btn--sm" style={{ marginTop: 10 }} onClick={() => setAdding(true)}><Plus size={13} /> Add an expense</button>
          ) : (
            <div className="j-inset" style={{ marginTop: 10 }}>
              <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 8 }}>
                <select className="j-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} aria-label="Type">{data.types.map(t => <option key={t}>{t}</option>)}</select>
                <input className="j-input" type="number" min="0" step="0.01" placeholder="Amount" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} aria-label="Amount" />
                <input className="j-input" placeholder="Vendor" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} aria-label="Vendor" />
              </div>
              <input className="j-input" style={{ marginTop: 8 }} placeholder="Note" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} aria-label="Note" />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="j-btn j-btn--sm" onClick={() => setAdding(false)}>Cancel</button>
                <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={busy || !(Number(form.amount) > 0)} onClick={() => act(async () => {
                  await addJourneyExpense(j.id, { type: form.type, amount: Number(form.amount), vendor: form.vendor || null, description: form.description || null })
                  setAdding(false); setForm({ type: 'Fuel', amount: '', vendor: '', description: '' })
                })}>Add</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Under a stop on the timeline: state, check-in, its form and photos. */
export function StopExtras({ j, s, onError, onDone, busy, setBusy }) {
  const [filling, setFilling] = useState(false)
  const [answers, setAnswers] = useState({})
  const [errs, setErrs] = useState({})
  const [imgs, setImgs] = useState({})
  const file = useRef(null)
  useEffect(() => {
    for (const p of s.photos ?? []) if (!imgs[p.id]) photoUrl(j.id, s.seq, p.id).then(u => u && setImgs(m => ({ ...m, [p.id]: u })))
  }, [s.photos, j.id, s.seq, imgs])
  const run = async fn => {
    setBusy(true)
    try { await fn(); onDone() } catch (e) { onError(errorMessage(e, 'That did not work')); if (e.details) setErrs(e.details) } finally { setBusy(false) }
  }
  const fields = Array.isArray(s.formFields) ? s.formFields : []
  const isLast = s.seq === j.stops.length - 1
  return (
    <div style={{ marginTop: 6 }}>
      {(s.purpose || s.loadState || s.visitVia === 'QR' || s.checkInSource === 'DRIVER' || s.checkInSource === 'OFFICE') && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {s.purpose && <span className="j-pill j-pill--plain">{s.purpose.charAt(0) + s.purpose.slice(1).toLowerCase()}</span>}
          {s.loadState && <span className="j-pill j-pill--plain">{s.loadState}</span>}
          {s.visitVia === 'QR' && <span className="j-pill j-pill--plain"><QrCode size={11} /> QR {s.code}</span>}
          {s.checkInSource === 'DRIVER' && <span className="j-pill" data-tone="ok">Checked in by the driver{s.detectedBy === 'QR' ? ' (QR)' : ''}</span>}
          {s.checkInSource === 'OFFICE' && <span className="j-pill" data-tone="info">Checked in by {s.checkedInByName ?? 'the office'}</span>}
        </div>
      )}
      {j.can.checkIn && s.status === 'PENDING' && s.seq > 0 && (
        <button type="button" className="j-btn j-btn--sm" style={{ marginTop: 8 }} disabled={busy}
          onClick={() => window.confirm(`Check in at ${s.name} now${isLast ? ' (this completes the journey)' : ''}?`) && run(() => officeCheckIn(j.id, s.seq))}>
          <LogIn size={13} /> Check in now
        </button>
      )}
      {fields.length > 0 && (
        <div className="j-inset" style={{ marginTop: 8, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={14} />
            <span style={{ flex: 1, fontSize: 12.5 }}>{s.formName}{s.form ? <> · filled by <b>{s.form.submittedByName || '—'}</b> at {hhmm(s.form.submittedAt)}{s.form.source === 'DRIVER_APP' ? ' (driver link)' : ''}</> : ' · not filled yet'}</span>
            {!s.form && j.can.form && <button type="button" className="j-btn j-btn--sm" onClick={() => setFilling(true)}>Fill</button>}
          </div>
          {s.form && (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', marginTop: 8, fontSize: 12.5 }}>
              {(s.form.fields ?? []).map(f => [
                <span key={`l${f.key}`} className="j-label">{f.label}</span>,
                <span key={`v${f.key}`}>{f.type === 'PHOTO' && s.form.answers[f.key] && imgs[s.form.answers[f.key]] ? <img src={imgs[s.form.answers[f.key]]} alt={f.label} style={{ height: 60, borderRadius: 6 }} /> : answerText(f, s.form.answers[f.key])}</span>,
              ])}
            </div>
          )}
        </div>
      )}
      {((s.photos ?? []).length > 0 || (j.can.form && s.seq > 0)) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          {(s.photos ?? []).filter(p => !p.fieldKey).map(p => imgs[p.id] && (
            <a key={p.id} href={imgs[p.id]} target="_blank" rel="noreferrer" title={`${p.caption ?? 'Photo'} · ${dayTime(p.takenAt)}${p.source === 'DRIVER_APP' ? ' · driver' : ''}`}>
              <img src={imgs[p.id]} alt={p.caption ?? 'Stop photo'} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--j-line2)' }} />
            </a>
          ))}
          {j.can.form && s.seq > 0 && j.status !== 'Cancelled' && (
            <>
              <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={e => {
                const f = e.target.files?.[0]
                if (f) run(async () => addStopPhoto(j.id, s.seq, { data: await toBase64(f), caption: null }))
                e.target.value = ''
              }} />
              <button type="button" className="j-btn j-btn--sm j-btn--ghost" disabled={busy} onClick={() => file.current?.click()}><Camera size={13} /> Photo</button>
            </>
          )}
        </div>
      )}
      {filling && (
        <JModal title={`${s.formName} · ${s.name}`} onClose={() => setFilling(false)}
          footer={<><button type="button" className="j-btn" onClick={() => setFilling(false)}>Cancel</button><button type="button" className="j-btn j-btn--primary" disabled={busy} onClick={() => run(async () => { await fillStopForm(j.id, s.seq, answers); setFilling(false) })}>Save</button></>}>
          <FormFields fields={fields} answers={answers} setAnswers={setAnswers} errors={errs}
            onPhoto={async (key, f) => {
              const p = await addStopPhoto(j.id, s.seq, { data: await toBase64(f), fieldKey: key })
              setAnswers(a => ({ ...a, [key]: p.id }))
            }} />
        </JModal>
      )}
    </div>
  )
}

/** A form's fields as inputs (the office's modal and the driver page share it). */
export function FormFields({ fields, answers, setAnswers, errors = {}, onPhoto }) {
  const set = (k, v) => setAnswers(a => ({ ...a, [k]: v }))
  return fields.map(f => (
    <label key={f.key} className="j-field" style={{ marginBottom: 12 }}>
      <span>{f.label}{f.required ? ' *' : ''}</span>
      {f.type === 'TEXT' && <input className="j-input" value={answers[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />}
      {f.type === 'NUMBER' && <input className="j-input" type="number" inputMode="decimal" value={answers[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />}
      {f.type === 'YESNO' && (
        <div className="j-seg" style={{ width: 'fit-content' }}>
          <button type="button" aria-pressed={answers[f.key] === true} onClick={() => set(f.key, true)}>Yes</button>
          <button type="button" aria-pressed={answers[f.key] === false} onClick={() => set(f.key, false)}>No</button>
        </div>
      )}
      {f.type === 'DROPDOWN' && (
        <select className="j-select" value={answers[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}>
          <option value="">Pick…</option>{(f.options ?? []).map(o => <option key={o}>{o}</option>)}
        </select>
      )}
      {f.type === 'PHOTO' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="file" accept="image/*" capture="environment" onChange={e => e.target.files?.[0] && onPhoto(f.key, e.target.files[0])} />
          {answers[f.key] && <span className="j-ok-text"><Check size={12} /> Photo added</span>}
        </span>
      )}
      {errors[f.key] && <span className="j-err">{errors[f.key]}</span>}
    </label>
  ))
}

/** The convoy and the temperature, as the engine last measured them. */
export function ConvoyTempCard({ j }) {
  const convoy = Array.isArray(j.convoyState) && j.convoyState.length ? j.convoyState : (j.convoy ?? []).map(c => ({ ...c, distanceM: null }))
  const hasTemp = j.tempMin != null || j.tempMax != null || j.lastTemp != null
  if (!convoy.length && !hasTemp && !j.loadState) return null
  return (
    <div className="j-card">
      {convoy.length > 0 && (
        <>
          <div className="j-card-head"><Truck size={17} /><h2 className="j-card-title">Convoy</h2><span className="j-card-sub" style={{ marginLeft: 'auto' }}>within {j.convoyToleranceM} m of {j.vehicleLabel}</span></div>
          {convoy.map(c => (
            <div key={c.vehicleId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,.06)', fontSize: 13 }}>
              <span className="j-dot" data-tone={c.separated ? 'bad' : c.distanceM == null ? 'muted' : 'ok'} />
              <span style={{ flex: 1 }} className="j-strong">{c.vehicleLabel}</span>
              <span className="j-label">{c.distanceM == null ? 'not measured yet' : `${c.distanceM >= 1000 ? `${(c.distanceM / 1000).toFixed(1)} km` : `${c.distanceM} m`} away${c.separated ? ' · separated' : ''}`}</span>
            </div>
          ))}
        </>
      )}
      {hasTemp && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: convoy.length ? 14 : 0 }}>
          <Thermometer size={17} />
          <span className="j-strong" style={{ flex: 1 }}>Temperature</span>
          <span className="j-num" style={{ fontSize: 20 }}>{j.lastTemp != null ? `${j.lastTemp} °C` : '—'}</span>
          <span className="j-label">{j.tempMin != null || j.tempMax != null ? `limits ${j.tempMin ?? '…'} to ${j.tempMax ?? '…'} °C` : 'no limits'}</span>
        </div>
      )}
      {j.loadState && <div className="j-label" style={{ marginTop: 10 }}>Load: <b className="j-strong">{j.loadState}</b></div>}
    </div>
  )
}
