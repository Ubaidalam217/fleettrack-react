import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import { CARD_SURFACE, inputStyle } from '../settings/formStyles'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import { handleApiError } from '../settings/pageChrome'
import { useCompanies } from '../../data/settings'
import { IS_REAL } from '../../data/mode'
import { reminderHistory } from '../../data/reminders'
import { formatExpiryDate } from '../../utils/licenceExpiry'

// Reports › Reminder › Acknowledgement History (client, 2026-11-10): every
// reminder marked done — when, at what odometer, with what note, and by whom.

const CSS = `
.rh-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:900px}
.rh-table th{background:var(--c-thead);text-align:left;padding:10px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  color:var(--c-text3);white-space:nowrap;border-bottom:1px solid var(--c-border2)}
.rh-table td{padding:10px 12px;border-bottom:1px solid var(--c-border2);color:var(--c-text1);vertical-align:middle}
.rh-table tbody tr:hover{background:var(--c-hover)}
`
const monthAgo = () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10) }

export default function ReminderHistoryReport(props) {
  const companies = useCompanies()
  const { toasts, push, dismiss } = useToasts()
  const [filters, setFilters] = useState({ bgId: '', from: monthAgo(), to: '' })
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!IS_REAL) return
    let live = true
    setRows(null)
    reminderHistory(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)))
      .then(d => { if (live) setRows(d ?? []) })
      .catch(err => { if (live) { setRows([]); handleApiError(err, { push }) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(r => !q || [r.vehicleLabel, r.ruleName, r.type, r.note, r.byName].some(s => String(s ?? '').toLowerCase().includes(q)))
  }, [rows, search])

  const box = { ...inputStyle(false), height: 38, width: 'auto' }
  return (
    <ReportFrame title="Acknowledgement History" desc="Every reminder marked done: when, at what odometer, and by whom." {...props}>
      <style>{CSS}</style>
      {!IS_REAL ? (
        <div style={{ ...CARD_SURFACE, padding: 24, fontSize: 13, color: 'var(--c-text2)' }}>Reminders are kept on the server, so they are not available in demo mode.</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
              <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', pointerEvents: 'none' }} />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Vehicle, reminder or note" aria-label="Search"
                style={{ ...inputStyle(false), height: 38, paddingLeft: 30 }} />
            </div>
            {companies.length > 1 && (
              <select value={filters.bgId} onChange={e => setFilters(f => ({ ...f, bgId: e.target.value }))} aria-label="Business Group" style={box}>
                <option value="">All Business Groups</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} aria-label="From" style={box} />
            <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>to</span>
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} aria-label="To" style={box} />
          </div>
          <div style={{ ...CARD_SURFACE, overflow: 'hidden', marginTop: 12 }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="rh-table">
                <thead><tr><th>Done on</th><th>Vehicle</th><th>Reminder</th><th>Type</th><th style={{ textAlign: 'right' }}>Odometer</th><th style={{ textAlign: 'right' }}>Engine h</th><th>Note</th><th>By</th></tr></thead>
                <tbody>
                  {rows === null ? (
                    <tr><td colSpan={8} style={{ padding: 36, textAlign: 'center', color: 'var(--c-text3)' }}>Loading…</td></tr>
                  ) : shown.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: 36, textAlign: 'center', color: 'var(--c-text3)' }}>Nothing marked done in this period.</td></tr>
                  ) : shown.map(r => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 650 }}>{formatExpiryDate(r.doneAt)}</td>
                      <td style={{ fontWeight: 650 }}>{r.vehicleLabel}</td>
                      <td>{r.ruleName}</td>
                      <td>{r.type}</td>
                      <td style={{ textAlign: 'right' }}>{r.odometer != null ? `${Math.round(r.odometer).toLocaleString('en-US')} km` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.engineHours != null ? Math.round(r.engineHours * 10) / 10 : '—'}</td>
                      <td style={{ color: 'var(--c-text2)' }}>{r.note || '—'}</td>
                      <td style={{ color: 'var(--c-text2)' }}>{r.byName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ReportFrame>
  )
}
