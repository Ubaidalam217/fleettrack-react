import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Upload, FileSpreadsheet, FileText, Check, AlertTriangle, MapPin } from 'lucide-react'
import { readStopRows, PURPOSE_LABEL } from '../../utils/journeyStopsImport'
import { readSheetFile, downloadStopsSample } from '../../utils/journeyFiles'

/**
 * Dialogs New Journey and Route Optimization share (client 2026-11-21): a
 * modal in the module's own theme, the address-book picker (several at once)
 * and the Excel/CSV stops upload with its per-row errors.
 */

export function JModal({ title, sub, onClose, children, footer, width = 640 }) {
  // A portal: a glass card's backdrop-filter would otherwise trap position: fixed inside it.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(6,14,19,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div className="jms-theme" style={{ minHeight: 0, background: 'transparent', width: `min(${width}px, 100%)`, maxHeight: 'calc(100vh - 24px)', display: 'flex' }}>
        <div className="j-card" style={{ background: 'rgba(33,49,58,.97)', display: 'flex', flexDirection: 'column', width: '100%', maxHeight: 'calc(100vh - 24px)', padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--j-line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 className="j-card-title" style={{ fontSize: 17 }}>{title}</h2>
              {sub && <div className="j-label" style={{ marginTop: 3 }}>{sub}</div>}
            </div>
            <button type="button" className="j-iconbtn" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
          <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>{children}</div>
          {footer && <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', padding: '12px 18px', borderTop: '1px solid var(--j-line)' }}>{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Pick several address-book entries; they are added in the order ticked. */
export function AddressPicker({ addresses, onPick, onClose }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState([])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return addresses.filter(a => !s || [a.name, a.code, a.contactName, PURPOSE_LABEL[a.purpose]].some(v => String(v ?? '').toLowerCase().includes(s)))
  }, [addresses, q])
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  return (
    <JModal title="Pick from the address book" sub="Tick the places in the order the vehicle visits them." onClose={onClose}
      footer={(
        <>
          <button type="button" className="j-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="j-btn j-btn--primary" disabled={!picked.length} onClick={() => onPick(picked.map(id => addresses.find(a => a.id === id)))}>
            <Check size={14} /> Add {picked.length || ''} stop{picked.length === 1 ? '' : 's'}
          </button>
        </>
      )}>
      <label style={{ position: 'relative', display: 'block', marginBottom: 12 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--j-text3)' }} />
        <input className="j-input" style={{ paddingLeft: 34 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, code or state" aria-label="Search addresses" />
      </label>
      {!addresses.length && <div className="j-empty">The address book is empty. Add places in Checkpoints &amp; Routes, or save stops from a bulk upload.</div>}
      {shown.map(a => {
        const n = picked.indexOf(a.id)
        return (
          <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderTop: '1px solid rgba(255,255,255,.06)', cursor: 'pointer' }}>
            <input type="checkbox" checked={n >= 0} onChange={() => toggle(a.id)} />
            <span className="j-badge" style={{ width: 24, height: 24, fontSize: 11 }} data-s={n >= 0 ? 'done' : ''}>{n >= 0 ? n + 1 : <MapPin size={12} />}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="j-strong" style={{ fontSize: 13.5 }}>{a.name}</span>
              <span className="j-label" style={{ display: 'block' }}>{PURPOSE_LABEL[a.purpose] ?? 'Other'} · {a.arrivalType === 'GEOFENCE' ? 'Geofence' : `${a.radiusM} m`}{a.code ? ` · ${a.code}` : ''}</span>
            </span>
          </label>
        )
      })}
    </JModal>
  )
}

/**
 * Upload stops from Excel / CSV: the sample, the rows read, each bad row with
 * its reason; "Add" hands back the good ones (and which to save as addresses).
 */
export function StopsImport({ addresses = [], defaultRadiusM = 300, onImport, onClose, title = 'Upload stops from Excel or CSV', withWeights = false }) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  const byName = useMemo(() => new Map(addresses.map(a => [a.name.trim().toLowerCase(), a])), [addresses])

  async function read(file) {
    setBusy(true)
    setError(null)
    try {
      const rows = await readSheetFile(file)
      setResult({ file: file.name, ...readStopRows(rows, { addressByName: n => byName.get(n.trim().toLowerCase()) ?? null, defaultRadiusM }) })
    } catch (e) {
      setError(e.message || 'Could not read that file')
    } finally {
      setBusy(false)
    }
  }

  const saveCount = result?.stops.filter(s => s.saveAddress).length ?? 0
  return (
    <JModal title={title} sub="One stop per row. Start from the sample file: its columns are the ones read." onClose={onClose} width={720}
      footer={(
        <>
          <button type="button" className="j-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="j-btn j-btn--primary" disabled={!result?.stops.length} onClick={() => onImport(result.stops)}>
            <Check size={14} /> Add {result?.stops.length ?? 0} stop{result?.stops.length === 1 ? '' : 's'}{saveCount ? ` · save ${saveCount} as address${saveCount === 1 ? '' : 'es'}` : ''}
          </button>
        </>
      )}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button type="button" className="j-btn j-btn--sm" onClick={() => downloadStopsSample('xlsx')}><FileSpreadsheet size={13} /> Sample (Excel)</button>
        <button type="button" className="j-btn j-btn--sm" onClick={() => downloadStopsSample('csv')}><FileText size={13} /> Sample (CSV)</button>
        <div style={{ flex: 1 }} />
        <input ref={input} type="file" accept=".xlsx,.csv,text/csv" hidden onChange={e => e.target.files?.[0] && read(e.target.files[0])} />
        <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={busy} onClick={() => input.current?.click()}><Upload size={13} /> {busy ? 'Reading…' : result ? 'Choose another file' : 'Choose a file'}</button>
      </div>
      {error && <div className="j-err" style={{ fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {!result && !error && (
        <div className="j-inset" style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--j-text2)' }}>
          Columns: Name, Latitude, Longitude, Radius (m), Stay (min), State, Visited via (Map/QR), Signature (Yes/No){withWeights ? ', Weight, Window from / to (HH:mm)' : ''}, Save as address (Yes/No).
          A row with no coordinates uses the address-book entry with the same name.
        </div>
      )}
      {result && (
        <>
          <div className="j-label" style={{ marginBottom: 8 }}>{result.file}: <b className="j-strong">{result.stops.length}</b> good row{result.stops.length === 1 ? '' : 's'}{result.errors.length ? `, ${result.errors.length} with a problem (left out)` : ''}</div>
          {result.errors.length > 0 && (
            <div className="j-inset" style={{ borderColor: 'rgba(255,143,128,.45)', marginBottom: 10 }}>
              {result.errors.map(e => (
                <div key={e.row} style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
                  <AlertTriangle size={13} style={{ color: 'var(--j-bad)', marginTop: 2 }} />
                  <span><b>Row {e.row}:</b> {e.message}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="j-table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Row</th><th>Name</th><th>Position</th><th>Stay</th><th>State</th><th>Via</th>{withWeights && <th>Weight</th>}<th>Address</th></tr></thead>
              <tbody>
                {result.stops.map(s => (
                  <tr key={s.row} style={{ cursor: 'default' }}>
                    <td>{s.row}</td><td className="j-strong">{s.name}</td>
                    <td className="j-label">{s.lat.toFixed(4)}, {s.lng.toFixed(4)} · {s.radiusM} m</td>
                    <td>{s.stayMin} min</td><td>{PURPOSE_LABEL[s.purpose]}</td><td>{s.visitVia === 'QR' ? 'QR' : 'Map'}</td>
                    {withWeights && <td>{s.weight ?? '—'}</td>}
                    <td className="j-label">{s.addressId ? 'From the book' : s.saveAddress ? 'Will be saved' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </JModal>
  )
}
