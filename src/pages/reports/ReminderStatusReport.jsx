import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileDown, FileSpreadsheet, Printer, Search, Settings2, X } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import { ToolbarButton } from '../../components/reports/controls'
import { PRIMARY_BTN, SECONDARY_BTN, CARD_SURFACE, inputStyle } from '../settings/formStyles'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import { handleApiError } from '../settings/pageChrome'
import { useCompanies } from '../../data/settings'
import { useSession } from '../../data/session'
import { IS_REAL } from '../../data/mode'
import { REMINDER_STATUS, REMINDER_TYPES, isRenewal, reminderStatus, markReminderDone } from '../../data/reminders'
import { formatExpiryDate } from '../../utils/licenceExpiry'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { formatPrintDate } from '../../utils/movementReport'

// Reports › Reminder › Reminder Status (client, 2026-11-10, after the reference
// system): every vehicle on every reminder, worked out now — Overdue, Due,
// Upcoming or Completed — and where a reminder is marked done. The list is on
// the Movement Report's paper (client, 2026-11-11: every report in its theme);
// the status cards and filters stay above it, on screen only.

const CSS = `
.rs-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.rs-card{background:var(--c-card);border:1px solid var(--c-border2);border-radius:var(--ft-radius);box-shadow:var(--ft-shadow);padding:14px 16px;
  text-align:left;cursor:pointer;color:inherit}
.rs-card[aria-pressed="true"]{outline:2px solid var(--ft-accent);outline-offset:-2px}
.rs-k{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:750;text-transform:uppercase;letter-spacing:.05em;color:var(--c-text3)}
.rs-v{font-size:24px;font-weight:800;color:var(--c-text1);margin-top:4px}
.rs-dot{width:8px;height:8px;border-radius:50%}
.rs-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px}
.rs-modal{width:min(460px,100%);background:var(--c-card);border:1px solid var(--c-border2);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:20px}
.rs-done{padding:1px 8px;border:1px solid #0a7e9c;border-radius:4px;background:#fff;color:#0a7e9c;font:inherit;font-size:10.5px;font-weight:700;cursor:pointer;white-space:nowrap}
.rs-done:hover{background:#e0f2f7}
.rs-lbl{display:block;font-size:11.5px;font-weight:650;color:var(--c-text2);margin:12px 0 6px}
@media (max-width: 800px){.rs-sum{grid-template-columns:repeat(2,minmax(0,1fr))}}
`

const today = () => new Date().toLocaleDateString('en-CA')
const n0 = v => Math.round(v).toLocaleString('en-US')

// Paper columns: width is the on-screen share, pdf the export weight.
const COLUMNS = [
  { key: 'status',   label: 'Status',          width: '7%',  pdf: 6 },
  { key: 'vehicle',  label: 'Vehicle',         width: '9%',  pdf: 8 },
  { key: 'branch',   label: 'Branch',          width: '10%', pdf: 9 },
  { key: 'reminder', label: 'Reminder',        width: '13%', pdf: 12 },
  { key: 'type',     label: 'Type',            width: '11%', pdf: 10 },
  { key: 'detail',   label: 'Where it stands', width: '17%', pdf: 17 },
  { key: 'start',    label: 'Start',           width: '7%',  pdf: 7 },
  { key: 'expiry',   label: 'Expiry',          width: '7%',  pdf: 7 },
  { key: 'last',     label: 'Last Done',       width: '7%',  pdf: 7 },
  { key: 'odometer', label: 'Odometer',        width: '8%',  pdf: 8, align: 'right' },
]
const ACTION = { key: 'action', label: 'Action', width: '7%', align: 'right' }

/** One paper row per vehicle on a reminder; `action` is filled in on screen. */
function paperRow(r) {
  const hours = r.engineHours != null && r.parts.some(p => p.basis === 'engineHours') ? ` · ${r.engineHours} engine h` : ''
  return {
    key: `${r.ruleId}|${r.vehicle.id}`,
    status: REMINDER_STATUS[r.status].label,
    vehicle: r.vehicle.plateNo || r.vehicle.fleetNo || r.vehicle.imei,
    branch: r.vehicle.branch?.name || r.bg?.name || '—',
    reminder: `${r.ruleName}${r.active ? '' : ' (paused)'}`,
    type: `${r.type} · ${r.recurring ? 'Recurring' : 'One Time'}`,
    detail: r.status === 'completed' ? 'Done' : r.detail || '—',
    start: formatExpiryDate(r.startDate),
    expiry: r.expiryDate ? formatExpiryDate(r.expiryDate) : '—',
    last: r.lastDoneAt ? formatExpiryDate(r.lastDoneAt) : '—',
    odometer: r.odometer != null ? `${n0(r.odometer)} km${hours}` : '—',
    cellStyle: { status: { color: REMINDER_STATUS[r.status].color, fontWeight: 700 } },
  }
}

export default function ReminderStatusReport(props) {
  const companies = useCompanies()
  const session = useSession()
  const canWrite = session.user?.role !== 'SUB_USER'
  const { toasts, push, dismiss } = useToasts()
  const [filters, setFilters] = useState({ bgId: '', type: '', status: '' })
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [done, setDone] = useState(null) // the row being marked done
  const [form, setForm] = useState({ doneAt: today(), odometer: '', note: '', newExpiry: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!IS_REAL) return
    let live = true
    setRows(null)
    reminderStatus(Object.fromEntries(Object.entries({ bgId: filters.bgId, type: filters.type }).filter(([, v]) => v)))
      .then(d => { if (live) setRows(d ?? []) })
      .catch(err => { if (live) { setRows([]); handleApiError(err, { push }) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.bgId, filters.type, reloadKey])

  const counts = useMemo(() => {
    const c = { overdue: 0, due: 0, upcoming: 0, completed: 0 }
    for (const r of rows ?? []) c[r.status] += 1
    return c
  }, [rows])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(r => (!filters.status || r.status === filters.status)
      && (!q || [r.ruleName, r.type, r.vehicle.plateNo, r.vehicle.fleetNo, r.vehicle.branch?.name].some(s => String(s ?? '').toLowerCase().includes(q))))
  }, [rows, filters.status, search])

  const bgName = companies.find(c => String(c.id) === String(filters.bgId))?.name
  const paperFilters = [
    ['Business Group', bgName || 'All'],
    ['Type', filters.type || 'All'],
    ['Status', filters.status ? REMINDER_STATUS[filters.status].label : 'All'],
    ...(search.trim() ? [['Search', search.trim()]] : []),
  ]
  // Worked out "now", so the stamp moves with each reload of the list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const printDate = useMemo(() => formatPrintDate(), [rows])
  const paperRows = useMemo(() => shown.map(paperRow), [shown])
  const totalText = `Reminders ${shown.length}   ·   ${['overdue', 'due', 'upcoming', 'completed'].map(k => `${REMINDER_STATUS[k].label} ${shown.filter(r => r.status === k).length}`).join('   ·   ')}`
  const exportOpts = () => ({
    title: 'Reminder Status Report',
    subtitle: 'FleetmaxX',
    filtersText: paperFilters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate,
    systemName: 'FleetmaxX',
    tables: [{
      heading: `All reminders — ${totalText}`,
      columns: COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })),
      rows: paperRows,
    }],
  })
  const fail = err => push(err.message || String(err), { tone: 'error' })

  const openDone = r => {
    setDone(r)
    setForm({ doneAt: today(), odometer: r.odometer != null ? String(Math.round(r.odometer)) : '', note: '', newExpiry: '' })
  }
  const saveDone = async () => {
    setSaving(true)
    try {
      await markReminderDone({
        ruleId: done.ruleId, vehicleId: done.vehicle.id, doneAt: form.doneAt,
        odometer: form.odometer === '' ? null : Number(form.odometer), note: form.note.trim() || null,
        newExpiry: form.newExpiry || null,
      })
      push(`${done.ruleName} marked done for ${done.vehicle.plateNo || done.vehicle.fleetNo}`, { tone: 'success' })
      setDone(null)
      setReloadKey(k => k + 1)
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setSaving(false)
    }
  }

  const sel = { ...inputStyle(false), height: 38, width: 'auto' }

  return (
    <ReportFrame title="Reminder Status Report" desc="Where every vehicle stands on its maintenance and renewal reminders, worked out now." {...props}>
      <style>{CSS}</style>
      {!IS_REAL ? (
        <div style={{ ...CARD_SURFACE, padding: 24, fontSize: 13, color: 'var(--c-text2)' }}>Reminders are kept on the server, so they are not available in demo mode.</div>
      ) : (
        <>
          <div className="rs-sum report-screen-only">
            {['overdue', 'due', 'upcoming', 'completed'].map(k => (
              <button key={k} type="button" className="rs-card" aria-pressed={filters.status === k}
                onClick={() => setFilters(f => ({ ...f, status: f.status === k ? '' : k }))}>
                <div className="rs-k"><span className="rs-dot" style={{ background: REMINDER_STATUS[k].color }} aria-hidden="true" />{REMINDER_STATUS[k].label}</div>
                <div className="rs-v">{rows === null ? '…' : counts[k]}</div>
              </button>
            ))}
          </div>

          <div className="report-screen-only" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 14, marginBottom: 12 }}>
            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
              <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', pointerEvents: 'none' }} />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Vehicle, reminder or branch" aria-label="Search"
                style={{ ...inputStyle(false), height: 38, paddingLeft: 30 }} />
            </div>
            {companies.length > 1 && (
              <select value={filters.bgId} onChange={e => setFilters(f => ({ ...f, bgId: e.target.value }))} aria-label="Business Group" style={sel}>
                <option value="">All Business Groups</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))} aria-label="Reminder type" style={sel}>
              <option value="">All types</option>
              <optgroup label="Service">{REMINDER_TYPES.Service.map(t => <option key={t} value={t}>{t}</option>)}</optgroup>
              <optgroup label="Renewal">{REMINDER_TYPES.Renewal.map(t => <option key={t} value={t}>{t}</option>)}</optgroup>
            </select>
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} aria-label="Status" style={sel}>
              <option value="">All statuses</option>
              {Object.entries(REMINDER_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Link to="/settings/reminder-rule" style={{ ...SECONDARY_BTN, height: 38, textDecoration: 'none' }}><Settings2 size={14} /> Reminder rules</Link>
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), 'Reminder_Status_Report').catch(fail)} icon={FileDown} primary disabled={!shown.length}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), 'Reminder_Status_Report').catch(fail)} icon={FileSpreadsheet} disabled={!shown.length}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!shown.length}>Print</ToolbarButton>
            </div>
          </div>

          {rows === null ? (
            <div style={{ ...CARD_SURFACE, padding: 36, textAlign: 'center', fontSize: 13, color: 'var(--c-text3)' }}>Working out reminders…</div>
          ) : (
            <PaperTable
              title="Reminder Status Report"
              company="FleetmaxX"
              filters={paperFilters}
              columns={canWrite ? [...COLUMNS, ACTION] : COLUMNS}
              groups={[{
                key: 'all', label: `All reminders (${shown.length})`, total: totalText,
                rows: paperRows.map((row, i) => ({
                  ...row,
                  action: canWrite && shown[i].status !== 'completed' ? (
                    <button type="button" className="rs-done" onClick={() => openDone(shown[i])}>Mark done</button>
                  ) : '',
                })),
              }]}
              printDate={printDate}
              emptyText={rows.length ? 'Nothing matches these filters.' : <>No reminders yet. Set one up under <Link to="/settings/reminder-rule">Settings › Master › Reminder Rule</Link>.</>}
            />
          )}
          <div className="report-screen-only" style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text3)' }}>
            Odometer from the tracker; engine hours counted by FleetmaxX from ignition-on time. History: <Link to="/reports/reminder-history">Acknowledgement History</Link>.
          </div>
        </>
      )}

      {done && (
        <div className="rs-modal-bg" role="presentation" onClick={e => { if (e.target === e.currentTarget && !saving) setDone(null) }}>
          <div className="rs-modal" role="dialog" aria-modal="true" aria-labelledby="rs-done-title">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={20} style={{ color: '#16a34a' }} aria-hidden="true" />
              <h2 id="rs-done-title" style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--c-text1)' }}>Mark done</h2>
              <button type="button" onClick={() => setDone(null)} aria-label="Close" style={{ marginLeft: 'auto', background: 'none', border: 0, color: 'var(--c-text3)', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--c-text2)' }}>
              <strong>{done.ruleName}</strong> on <strong>{done.vehicle.plateNo || done.vehicle.fleetNo}</strong>.{' '}
              {done.recurring ? 'The next cycle starts from this date and odometer.' : 'This One Time reminder will be completed.'}
            </p>
            <label className="rs-lbl" htmlFor="rs-doneAt">Done on</label>
            <input id="rs-doneAt" type="date" value={form.doneAt} max={today()} onChange={e => setForm(f => ({ ...f, doneAt: e.target.value }))} style={{ ...inputStyle(false), height: 40 }} />
            <label className="rs-lbl" htmlFor="rs-odo">Odometer when done (km)</label>
            <input id="rs-odo" type="number" min="0" value={form.odometer} onChange={e => setForm(f => ({ ...f, odometer: e.target.value }))} placeholder="From the tracker"
              style={{ ...inputStyle(false), height: 40 }} />
            {done.recurring && isRenewal(done.type) && (
              <>
                <label className="rs-lbl" htmlFor="rs-exp">New expiry date</label>
                <input id="rs-exp" type="date" value={form.newExpiry} min={form.doneAt} onChange={e => setForm(f => ({ ...f, newExpiry: e.target.value }))} style={{ ...inputStyle(false), height: 40 }} />
              </>
            )}
            <label className="rs-lbl" htmlFor="rs-note">Note</label>
            <input id="rs-note" value={form.note} maxLength={300} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Workshop, oil grade…"
              style={{ ...inputStyle(false), height: 40 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" onClick={() => setDone(null)} disabled={saving} style={{ ...SECONDARY_BTN, height: 38 }}>Cancel</button>
              <button type="button" onClick={saveDone} disabled={saving || !form.doneAt} style={{ ...PRIMARY_BTN, height: 38, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Mark done'}
              </button>
            </div>
          </div>
        </div>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ReportFrame>
  )
}
