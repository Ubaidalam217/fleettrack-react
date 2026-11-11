import { useMemo, useRef, useState } from 'react'
import { FileText, Plus, Pencil, Trash2, Eye, Download, Upload, Paperclip, X } from 'lucide-react'
import { IS_REAL } from '../../data/mode'
import { errorMessage } from '../../data/http'
import { useSettingsProfile } from '../../data/settings'
import { usePageAccess } from '../../pages/settings/pageChrome'
import {
  VEHICLE_DOC_TYPES, MAX_DOC_BYTES, ACCEPT, useVehicleDocuments,
  addVehicleDocument, updateVehicleDocument, deleteVehicleDocument,
  openVehicleDocument, downloadVehicleDocument,
} from '../../data/vehicleDocuments'
import { legacyDocuments, clearLegacyDocuments, daysUntilExpiry, expiryState } from '../../services/documentStore'
import { formatExpiryDate } from '../../utils/licenceExpiry'
import { fileToBase64 } from '../../utils/imageUpload'
import ConfirmDialog from './ConfirmDialog'

/**
 * The Documents tab (client spec 7.3 and 12): a vehicle's permit, insurance,
 * registration, certificate… with expiry, the days before it to warn, and a
 * scanned copy to view or download. Kept on the server against the vehicle's
 * Settings record; the Driver Licence & Document Expiry alert reads them too.
 */

const TONE = {
  expired: { color: '#ef4444', label: d => `Expired ${-d}d ago` },
  due:     { color: '#d97706', label: d => (d === 0 ? 'Expires today' : `Expires in ${d}d`) },
  ok:      { color: '#16a34a', label: () => 'Valid' },
}

const CSS = `
.vdoc{container-type:inline-size}
.vdoc-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.vdoc-title{flex:1;min-width:0;display:flex;align-items:center;gap:7px;font-size:13px;font-weight:800;color:var(--c-text1)}
.vdoc-count{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--c-hover);color:var(--c-text2)}
.vdoc-btn{height:30px;padding:0 11px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text1);
  font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0;white-space:nowrap}
.vdoc-btn:hover:not(:disabled){background:var(--c-hover)}
.vdoc-btn:disabled{opacity:.55;cursor:default}
.vdoc-btn.primary{background:var(--ft-accent);border-color:var(--ft-accent);color:#fff}
.vdoc-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--ft-accent) 88%,#000)}
.vdoc-icon{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--c-text3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.vdoc-icon:hover{background:var(--c-hover);color:var(--c-text1)}
.vdoc-icon.danger:hover{color:#ef4444}
.vdoc-list{display:flex;flex-direction:column;gap:8px}
.vdoc-row{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:12px;border:1px solid var(--c-border);
  background:color-mix(in srgb,var(--c-input) 40%,var(--c-card));min-width:0}
.vdoc-ico{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  color:var(--ft-accent);background:color-mix(in srgb,var(--ft-accent) 13%,transparent)}
.vdoc-main{flex:1;min-width:0}
.vdoc-name{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:var(--c-text1);min-width:0}
.vdoc-name > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vdoc-type{font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:6px;
  color:var(--c-text2);background:var(--c-hover);flex-shrink:0}
.vdoc-meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;font-size:11.5px;color:var(--c-text3)}
.vdoc-meta b{font-weight:650;color:var(--c-text2)}
.vdoc-meta .vdoc-att{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.vdoc-note{margin-top:4px;font-size:11.5px;color:var(--c-text3);white-space:pre-wrap;word-break:break-word}
.vdoc-pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;flex-shrink:0;white-space:nowrap}
.vdoc-pill i{width:6px;height:6px;border-radius:50%;background:currentColor}
.vdoc-actions{display:flex;align-items:center;gap:2px;flex-shrink:0}
.vdoc-empty,.vdoc-msg{font-size:12px;color:var(--c-text3);line-height:1.6;padding:14px;border-radius:12px;border:1px dashed var(--c-border2);background:var(--c-hover)}
.vdoc-err{font-size:12px;color:#ef4444;margin:0 0 10px}
.vdoc-ok{font-size:12px;font-weight:650;color:#16a34a;margin:0 0 10px}
.vdoc-banner{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 12px;margin-bottom:12px;border-radius:12px;
  border:1px solid color-mix(in srgb,#d97706 40%,transparent);background:color-mix(in srgb,#d97706 9%,transparent);font-size:12px;color:var(--c-text1)}
.vdoc-banner > span{flex:1;min-width:200px;line-height:1.5}
.vdoc-form{border:1px solid var(--c-border);border-radius:14px;padding:14px 16px 16px;margin-bottom:14px;background:var(--c-card)}
.vdoc-form h4{margin:0 0 12px;font-size:13px;font-weight:800;color:var(--c-text1)}
.vdoc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 14px}
.vdoc-f{display:flex;flex-direction:column;gap:5px;min-width:0}
.vdoc-f.span2{grid-column:span 2}
.vdoc-f.span3{grid-column:1/-1}
.vdoc-f label{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text3)}
.vdoc-f input,.vdoc-f select,.vdoc-f textarea{height:34px;padding:0 10px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-input);
  color:var(--c-text1);font-size:12.5px;font-family:inherit;min-width:0;width:100%;box-sizing:border-box}
.vdoc-f textarea{height:auto;min-height:56px;padding:8px 10px;resize:vertical}
.vdoc-f input:focus,.vdoc-f select:focus,.vdoc-f textarea:focus{outline:2px solid color-mix(in srgb,var(--ft-accent) 45%,transparent);outline-offset:0;border-color:var(--ft-accent)}
.vdoc-f .bad{border-color:#ef4444}
.vdoc-f small{font-size:11px;color:#ef4444}
.vdoc-file{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--c-text2)}
.vdoc-file .name{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:8px;background:var(--c-hover);max-width:100%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vdoc-file .gone{text-decoration:line-through;opacity:.6}
.vdoc-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
@container (max-width:560px){
  .vdoc-grid{grid-template-columns:minmax(0,1fr)}
  .vdoc-f.span2{grid-column:auto}
  .vdoc-row{flex-wrap:wrap}
  .vdoc-main{flex-basis:calc(100% - 50px)}
  .vdoc-actions{margin-left:auto}
}
`

const EMPTY_FORM = { docType: 'Permit', name: '', number: '', issueDate: '', expiryDate: '', notifyBeforeDays: '30', note: '' }
const fmtSize = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function StatusPill({ doc }) {
  const state = expiryState(doc)
  if (!state) return <span className="vdoc-pill" style={{ color: 'var(--c-text3)', background: 'var(--c-hover)' }}>No expiry</span>
  const tone = TONE[state]
  return (
    <span className="vdoc-pill" style={{ color: tone.color, background: `color-mix(in srgb, ${tone.color} 14%, transparent)` }}>
      <i />{tone.label(daysUntilExpiry(doc))}
    </span>
  )
}

function DocumentForm({ vehicleId, doc, onDone }) {
  const [form, setForm] = useState(() => (doc
    ? {
      docType: doc.docType, name: doc.name ?? '', number: doc.number ?? '', issueDate: doc.issueDate ?? '',
      expiryDate: doc.expiryDate ?? '', notifyBeforeDays: String(doc.notifyBeforeDays ?? 30), note: doc.note ?? '',
    }
    : EMPTY_FORM))
  const [file, setFile] = useState(null)
  const [removeFile, setRemoveFile] = useState(false)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined, _: undefined })) }

  const pick = e => {
    const f = e.target.files?.[0] ?? null
    if (f && f.size > MAX_DOC_BYTES) {
      setErrors(er => ({ ...er, data: 'The file is too large (max 5 MB)' }))
      e.target.value = ''
      return
    }
    setErrors(er => ({ ...er, data: undefined }))
    setFile(f)
    if (f) setRemoveFile(false)
  }

  const save = async e => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { ...form, notifyBeforeDays: form.notifyBeforeDays === '' ? 30 : form.notifyBeforeDays }
      if (file) Object.assign(body, { fileName: file.name, data: await fileToBase64(file) })
      if (doc) await updateVehicleDocument(vehicleId, doc.id, { ...body, removeFile })
      else await addVehicleDocument(vehicleId, body)
      onDone(`${form.name.trim() || form.docType} ${doc ? 'saved' : 'added'}`)
    } catch (err) {
      setErrors({ ...(err?.details ?? {}), _: errorMessage(err, 'Could not save the document') })
      setBusy(false)
    }
  }

  const field = (key, label, input, cls = '') => (
    <div className={`vdoc-f ${cls}`}>
      <label htmlFor={`vdoc-${key}`}>{label}</label>
      {input}
      {errors[key] && <small>{errors[key]}</small>}
    </div>
  )
  const bad = k => (errors[k] ? 'bad' : undefined)

  return (
    <form className="vdoc-form" onSubmit={save} noValidate>
      <h4>{doc ? 'Edit document' : 'Add document'}</h4>
      {errors._ && <p className="vdoc-err" role="alert">{errors._}</p>}
      <div className="vdoc-grid">
        {field('docType', 'Type', (
          <select id="vdoc-docType" className={bad('docType')} value={form.docType} onChange={e => set('docType', e.target.value)}>
            {VEHICLE_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ))}
        {field('name', 'Document name', (
          <input id="vdoc-name" className={bad('name')} value={form.name} maxLength={120} placeholder={form.docType} onChange={e => set('name', e.target.value)} />
        ), 'span2')}
        {field('number', 'Document no.', (
          <input id="vdoc-number" className={bad('number')} value={form.number} maxLength={80} placeholder="e.g. policy or permit number" onChange={e => set('number', e.target.value)} />
        ))}
        {field('issueDate', 'Issue date', (
          <input id="vdoc-issueDate" type="date" className={bad('issueDate')} value={form.issueDate} onChange={e => set('issueDate', e.target.value)} />
        ))}
        {field('expiryDate', 'Expiry date', (
          <input id="vdoc-expiryDate" type="date" className={bad('expiryDate')} value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)} />
        ))}
        {field('notifyBeforeDays', 'Notify before (days)', (
          <input id="vdoc-notifyBeforeDays" type="number" min="0" max="365" className={bad('notifyBeforeDays')} value={form.notifyBeforeDays} onChange={e => set('notifyBeforeDays', e.target.value)} />
        ))}
        {field('note', 'Note', (
          <textarea id="vdoc-note" className={bad('note')} value={form.note} maxLength={500} rows={2} onChange={e => set('note', e.target.value)} />
        ), 'span2')}
        <div className="vdoc-f span3">
          <label htmlFor="vdoc-file">Attachment (PDF or image, max 5 MB)</label>
          <div className="vdoc-file">
            {doc?.hasFile && !file && (
              <span className={`name${removeFile ? ' gone' : ''}`}><Paperclip size={12} />{doc.fileName}</span>
            )}
            {file && <span className="name"><Paperclip size={12} />{file.name} · {fmtSize(file.size)}</span>}
            <input ref={fileRef} id="vdoc-file" type="file" accept={ACCEPT} onChange={pick} hidden />
            <button type="button" className="vdoc-btn" onClick={() => fileRef.current?.click()}>
              <Upload size={13} />{file || doc?.hasFile ? 'Replace file' : 'Choose file'}
            </button>
            {file && (
              <button type="button" className="vdoc-btn" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }}>
                <X size={13} />Clear
              </button>
            )}
            {doc?.hasFile && !file && (
              <button type="button" className="vdoc-btn" onClick={() => setRemoveFile(r => !r)}>
                {removeFile ? 'Keep file' : <><Trash2 size={13} />Remove file</>}
              </button>
            )}
          </div>
          {errors.data && <small>{errors.data}</small>}
        </div>
      </div>
      <div className="vdoc-foot">
        <button type="button" className="vdoc-btn" onClick={() => onDone(null)} disabled={busy}>Cancel</button>
        <button type="submit" className="vdoc-btn primary" disabled={busy}>{busy ? 'Saving…' : doc ? 'Save' : 'Add document'}</button>
      </div>
    </form>
  )
}

/** Documents an older version kept in this browser, offered once for upload. */
function LegacyBanner({ deviceId, vehicleId, onMessage }) {
  const [docs, setDocs] = useState(() => legacyDocuments(deviceId))
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  if (!docs.length) return null

  const upload = async () => {
    setBusy(true)
    let done = 0
    try {
      for (const d of docs) {
        await addVehicleDocument(vehicleId, {
          docType: 'Other', name: d.name || 'Document', expiryDate: d.expiryDate, notifyBeforeDays: d.notifyBeforeDays,
        })
        done += 1
      }
      clearLegacyDocuments(deviceId)
      setDocs([])
      onMessage(`${done} document${done === 1 ? '' : 's'} moved to the server`)
    } catch (err) {
      // Keep the ones not yet sent; nothing is cleared until all are on the server.
      if (done) setDocs(docs.slice(done))
      onMessage(errorMessage(err, 'Could not upload the documents'), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vdoc-banner">
      <span>
        <b>{docs.length} document{docs.length === 1 ? '' : 's'}</b> for this vehicle {docs.length === 1 ? 'is' : 'are'} saved only in this browser
        ({docs.map(d => d.name || 'Untitled').join(', ')}). Move {docs.length === 1 ? 'it' : 'them'} to the server so every user sees {docs.length === 1 ? 'it' : 'them'}.
      </span>
      <button type="button" className="vdoc-btn primary" onClick={upload} disabled={busy}><Upload size={13} />{busy ? 'Moving…' : 'Move to server'}</button>
      <button type="button" className="vdoc-btn" onClick={() => setConfirm(true)} disabled={busy}>Discard</button>
      {confirm && (
        <ConfirmDialog
          title="Discard the browser copy?"
          body={`${docs.length} document${docs.length === 1 ? '' : 's'} saved only in this browser will be removed. Nothing on the server changes.`}
          confirmLabel="Discard"
          onConfirm={() => { clearLegacyDocuments(deviceId); setDocs([]); setConfirm(false) }}
          onClose={() => setConfirm(false)}
        />
      )}
    </div>
  )
}

export default function VehicleDocumentsTab({ v }) {
  const profile = useSettingsProfile(v.ident)
  const vehicleId = profile.linked ? profile.vehicle?.id : null
  const { docs, error } = useVehicleDocuments(vehicleId)
  const access = usePageAccess('vehicle')
  const [editing, setEditing] = useState(null) // null | 'new' | doc
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState(null) // { text, bad }

  const say = (text, bad = false) => setMessage(text ? { text, bad } : null)
  const sorted = useMemo(() => docs ?? [], [docs])

  if (!IS_REAL) {
    return <><style>{CSS}</style><div className="vdoc-msg">Vehicle documents are kept on the server. Sign in to the live app to add, view and download them.</div></>
  }
  if (!vehicleId) {
    return <><style>{CSS}</style><div className="vdoc-msg">Register this tracker under Settings › Object › Vehicle first; its documents are kept against that record.</div></>
  }

  const fileAction = (fn, doc) => fn(vehicleId, doc).catch(err => say(errorMessage(err), true))

  const remove = async () => {
    setDeleting(true)
    try {
      await deleteVehicleDocument(vehicleId, pendingDelete.id)
      say(`${pendingDelete.name} deleted`)
      setPendingDelete(null)
    } catch (err) {
      say(errorMessage(err, 'Could not delete the document'), true)
      setPendingDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="vdoc">
      <style>{CSS}</style>
      {access.canAdd && <LegacyBanner deviceId={v.id} vehicleId={vehicleId} onMessage={say} />}

      <div className="vdoc-head">
        <div className="vdoc-title">Documents <span className="vdoc-count">{docs ? docs.length : '…'}</span></div>
        {access.canAdd && editing !== 'new' && (
          <button type="button" className="vdoc-btn primary" onClick={() => { setEditing('new'); say(null) }}><Plus size={13} />Add document</button>
        )}
      </div>

      {message && <p className={message.bad ? 'vdoc-err' : 'vdoc-ok'} role="status">{message.text}</p>}
      {error && <p className="vdoc-err" role="alert">{errorMessage(error, 'Could not load the documents')}</p>}

      {editing === 'new' && (
        <DocumentForm vehicleId={vehicleId} onDone={text => { setEditing(null); if (text) say(text) }} />
      )}

      {docs === null ? (
        <div className="vdoc-empty">Loading documents…</div>
      ) : sorted.length === 0 ? (
        editing !== 'new' && (
          <div className="vdoc-empty">
            No documents on file.{access.canAdd ? ' Add the permit, insurance, registration or certificate with its expiry date and a scanned copy.' : ''}
          </div>
        )
      ) : (
        <div className="vdoc-list">
          {sorted.map(d => (editing?.id === d.id ? (
            <DocumentForm key={d.id} vehicleId={vehicleId} doc={d} onDone={text => { setEditing(null); if (text) say(text) }} />
          ) : (
            <div key={d.id} className="vdoc-row">
              <div className="vdoc-ico"><FileText size={16} /></div>
              <div className="vdoc-main">
                <div className="vdoc-name"><span>{d.name}</span>{d.name !== d.docType && <span className="vdoc-type">{d.docType}</span>}</div>
                <div className="vdoc-meta">
                  {d.number && <span>No. <b>{d.number}</b></span>}
                  {d.issueDate && <span>Issued <b>{formatExpiryDate(d.issueDate)}</b></span>}
                  <span>Expires <b>{d.expiryDate ? formatExpiryDate(d.expiryDate) : '—'}</b></span>
                  {d.expiryDate && <span>Notify {d.notifyBeforeDays}d before</span>}
                  {d.hasFile && <span className="vdoc-att"><Paperclip size={11} />{d.fileName} · {fmtSize(d.size)}</span>}
                </div>
                {d.note && <div className="vdoc-note">{d.note}</div>}
              </div>
              <StatusPill doc={d} />
              <div className="vdoc-actions">
                {d.hasFile && (
                  <>
                    <button type="button" className="vdoc-icon" title="View" aria-label={`View ${d.name}`} onClick={() => fileAction(openVehicleDocument, d)}><Eye size={15} /></button>
                    <button type="button" className="vdoc-icon" title="Download" aria-label={`Download ${d.name}`} onClick={() => fileAction(downloadVehicleDocument, d)}><Download size={15} /></button>
                  </>
                )}
                {access.canWrite && (
                  <button type="button" className="vdoc-icon" title="Edit" aria-label={`Edit ${d.name}`} onClick={() => { setEditing(d); say(null) }}><Pencil size={14} /></button>
                )}
                {access.canDelete && (
                  <button type="button" className="vdoc-icon danger" title="Delete" aria-label={`Delete ${d.name}`} onClick={() => setPendingDelete(d)}><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          )))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete document?"
          body={`${pendingDelete.name}${pendingDelete.hasFile ? ' and its attached file' : ''} will be removed for every user.`}
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={remove}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
