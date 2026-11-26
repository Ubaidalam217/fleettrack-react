import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, ShieldCheck, CalendarClock, Truck, Clock, Flag, X, RefreshCw, FileDown, FileSpreadsheet } from 'lucide-react'
import { exportCtrackPdf, exportCtrackExcel } from '../../utils/ctrackExport'
import { listExport } from '../../utils/journeyReports'
import JourneyShell from './JourneyShell'
import { StatusPill, StopDots, ErrorNote, NoApprovalChip } from '../../components/journeys/JourneyBits'
import { listJourneys, hhmm, uaeDate, dayRange } from '../../data/journeys'
import { errorMessage } from '../../data/http'
import { useScreenLevel, atLeast } from '../../data/screens'

/**
 * Journeys (client 2026-11-17, point 2): every planned and ongoing journey in
 * one list — the day's, everything still on the road, everything waiting for
 * approval — with stops passed, km done of planned, status and ETA. Click a
 * number to filter; click a row for the detail page.
 */

const KPIS = [
  { key: 'Pending', label: 'Pending approval', sub: 'Waiting for approval', icon: ShieldCheck, statuses: ['Pending'] },
  { key: 'Scheduled', label: 'Scheduled', sub: 'Planned, not left yet', icon: CalendarClock, statuses: ['Scheduled'] },
  { key: 'road', label: 'On the road', sub: 'Driving now', icon: Truck, statuses: ['Started', 'InProgress', 'Delayed', 'Interrupted'] },
  { key: 'Delayed', label: 'Late', sub: 'Will arrive after the plan', icon: Clock, statuses: ['Delayed'] },
  { key: 'Completed', label: 'Done', sub: 'Reached the destination', icon: Flag, statuses: ['Completed'] },
  { key: 'Cancelled', label: 'Cancelled', sub: 'Called off or force closed', icon: X, statuses: ['Cancelled', 'ForceClosed'] },
]

const DAYS = [
  { key: -1, label: 'Yesterday' },
  { key: 0, label: 'Today' },
  { key: 1, label: 'Tomorrow' },
]

function progressOf(j) {
  const planned = j.plannedDistanceKm ?? 0
  const done = j.status === 'Completed' ? planned : Math.min(planned, j.progressKm ?? 0)
  return { planned, done, ratio: planned > 0 ? done / planned : 0 }
}

function timesLine(j) {
  if (j.status === 'Completed') return `left ${hhmm(j.actualStart)} · arrived ${hhmm(j.actualArrival)}`
  if (j.actualStart) return `left ${hhmm(j.actualStart)} · ETA ${hhmm(j.etaAt ?? j.expectedArrival)}`
  return null
}

export default function JourneyList(props) {
  const navigate = useNavigate()
  const level = useScreenLevel()('journeys')
  const [day, setDay] = useState(() => uaeDate(0))
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    try {
      const [from, to] = dayRange(day)
      const res = await listJourneys({ from, to })
      setRows(res.data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'Could not load the journeys'))
    }
  }, [day])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const counts = useMemo(() => {
    const out = {}
    for (const k of KPIS) out[k.key] = (rows ?? []).filter(r => k.statuses.includes(r.display)).length
    return out
  }, [rows])

  const shown = useMemo(() => {
    let list = rows ?? []
    if (filter) list = list.filter(r => KPIS.find(k => k.key === filter).statuses.includes(r.display))
    const s = q.trim().toLowerCase()
    if (s) {
      list = list.filter(r => [r.title, r.vehicleLabel, r.driverName, r.customer, r.ref, ...r.stops.map(x => x.name)]
        .some(v => String(v ?? '').toLowerCase().includes(s)))
    }
    return list
  }, [rows, filter, q])

  return (
    <JourneyShell
      {...props}
      crumb="Journeys"
      title="Journeys"
      subtitle="Every planned and ongoing journey. Click a number to filter the list, a row to open the journey."
      actions={(
        <>
          <div className="j-tabs j-daybar" role="group" aria-label="Day">
            {DAYS.map(d => <button key={d.key} type="button" className="j-tab" aria-pressed={day === uaeDate(d.key)} onClick={() => setDay(uaeDate(d.key))}>{d.label}</button>)}
            <input className="j-input j-input--sm" type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} aria-label="Pick a day" />
          </div>
          <button type="button" className="j-iconbtn" onClick={load} title="Refresh" aria-label="Refresh"><RefreshCw size={15} /></button>
          <button type="button" className="j-iconbtn" disabled={!shown.length} onClick={() => exportCtrackPdf(listExport(shown, { dayText: day }), `Journeys_${day}`).catch(e => setError(e.message))} title="Download PDF" aria-label="Download PDF"><FileDown size={15} /></button>
          <button type="button" className="j-iconbtn" disabled={!shown.length} onClick={() => exportCtrackExcel(listExport(shown, { dayText: day }), `Journeys_${day}`).catch(e => setError(e.message))} title="Download Excel" aria-label="Download Excel"><FileSpreadsheet size={15} /></button>
          {atLeast(level, 'modify') && (
            <button type="button" className="j-btn j-btn--primary" onClick={() => navigate('/journeys/new')}><Plus size={16} /> New journey</button>
          )}
        </>
      )}
    >
      <ErrorNote error={error} />

      <div className="j-grid j-kpis">
        {KPIS.map(k => (
          <button
            key={k.key}
            type="button"
            className={`j-card j-card--link j-kpi${filter === k.key ? ' j-card--active' : ''}`}
            onClick={() => setFilter(f => (f === k.key ? null : k.key))}
            aria-pressed={filter === k.key}
          >
            <span className="j-kpi-top">
              <span className="j-kpi-ico"><k.icon size={16} /></span>
              <span className="j-kpi-num">{rows ? counts[k.key] : '–'}</span>
            </span>
            <span className="j-kpi-label">{k.label}</span>
            <span className="j-kpi-sub">{k.sub}</span>
          </button>
        ))}
      </div>

      <div className="j-card j-card--flush">
        <div className="j-toolbar">
          <button type="button" className="j-tab" aria-pressed={!filter} onClick={() => setFilter(null)}>All <span className="j-count">{rows?.length ?? 0}</span></button>
          {filter && <span className="j-pill j-pill--plain">{KPIS.find(k => k.key === filter).label}</span>}
          <div style={{ flex: 1 }} />
          <label className="j-search">
            <Search size={15} />
            <input className="j-input" placeholder="Search vehicle, driver or place" value={q} onChange={e => setQ(e.target.value)} aria-label="Search journeys" />
          </label>
        </div>

        {!rows && !error && <div style={{ padding: '4px 16px 16px' }}>{[0, 1, 2, 3].map(i => <div key={i} className="j-skel" style={{ height: 56, marginBottom: 10 }} />)}</div>}
        {rows && shown.length === 0 && <div className="j-empty">No journeys here{filter || q ? ' for this filter' : ' for this day'}.</div>}

        {rows && shown.length > 0 && (
          <>
            <div className="j-list-table">
              <table className="j-table j-table--list">
                <colgroup>
                  <col style={{ width: '22%' }} /><col style={{ width: '14%' }} /><col style={{ width: '21%' }} /><col style={{ width: '13%' }} />
                  <col className="j-col-stops" style={{ width: '9%' }} /><col className="j-col-dist" style={{ width: '9%' }} /><col style={{ width: '12%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Journey</th><th>Vehicle and driver</th><th>From → To</th><th>Leaves → Arrives</th><th className="j-col-stops">Stops</th><th className="j-col-dist">Distance</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(j => <Row key={j.id} j={j} onOpen={() => navigate(`/journeys/${j.id}`)} />)}
                </tbody>
              </table>
            </div>
            <div className="j-list-cards">
              {shown.map(j => <MobileCard key={j.id} j={j} onOpen={() => navigate(`/journeys/${j.id}`)} />)}
            </div>
          </>
        )}
      </div>
    </JourneyShell>
  )
}

function Row({ j, onOpen }) {
  const first = j.stops[0], last = j.stops[j.stops.length - 1]
  const p = progressOf(j)
  const sub = timesLine(j)
  return (
    <tr onClick={onOpen} onKeyDown={e => e.key === 'Enter' && onOpen()} tabIndex={0}>
      <td>
        <div className="j-strong j-clamp2" title={j.title}>{j.title}</div>
        <div className="j-label j-clip" title={`${j.ref}${j.customer ? ` · ${j.customer}` : ''}`}>{j.ref}{j.customer ? ` · ${j.customer}` : ''}</div>
        <NoApprovalChip journey={j} />
        {j.display === 'Rejected' && j.rejectReason && <div className="j-err j-clip2" title={j.rejectReason}>Rejected: {j.rejectReason}</div>}
        {j.display === 'Pending' && j.submittedAt && <div className="j-label">Sent for approval at {hhmm(j.submittedAt)}</div>}
      </td>
      <td>
        <div className="j-strong j-clip" title={j.vehicleLabel}>{j.vehicleLabel}</div>
        <div className="j-label j-clip" title={j.driverName || ''}>{j.driverName || 'No driver'}</div>
      </td>
      <td>
        <div className="j-route" title={`${first?.name} → ${last?.name}`}><span>{first?.name}</span><span className="j-muted">→</span><span>{last?.name}</span></div>
        {j.stops.length > 2 && <div className="j-label">{j.stops.length - 2} stop{j.stops.length > 3 ? 's' : ''} in between</div>}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <div className="j-strong">{hhmm(j.plannedStart)} <span className="j-muted">→</span> {hhmm(j.expectedArrival)}</div>
        {sub && <div className="j-label">{sub}</div>}
      </td>
      <td className="j-col-stops" style={{ whiteSpace: 'nowrap' }}>
        <StopDots stops={j.stops} />
        <div className="j-label" style={{ marginTop: 4 }}>{j.stopsDone} of {j.stops.length - 1} reached</div>
      </td>
      <td className="j-col-dist">
        <div style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}><span className="j-strong">{Math.round(p.done)}</span> <span className="j-muted">/ {Math.round(p.planned)} km</span></div>
        <div className="j-bar" style={{ marginTop: 6 }}><i style={{ width: `${p.ratio * 100}%` }} /></div>
      </td>
      <td><StatusPill journey={j} /></td>
    </tr>
  )
}

function MobileCard({ j, onOpen }) {
  const first = j.stops[0], last = j.stops[j.stops.length - 1]
  const p = progressOf(j)
  const sub = timesLine(j)
  return (
    <button type="button" className="j-card j-card--link j-mcard" onClick={onOpen}>
      <div className="j-mcard-head">
        <div style={{ minWidth: 0 }}>
          <div className="j-strong j-mcard-title">{j.title}</div>
          <div className="j-label j-clip">{j.ref}{j.customer ? ` · ${j.customer}` : ''}</div>
        </div>
        <StatusPill journey={j} />
      </div>
      <div className="j-mcard-who"><span className="j-strong">{j.vehicleLabel}</span><span className="j-muted"> · {j.driverName || 'No driver'}</span></div>
      <div className="j-route j-route--wrap"><span>{first?.name}</span><span className="j-muted">→</span><span>{last?.name}</span></div>
      <div className="j-mcard-foot">
        <StopDots stops={j.stops} />
        <span className="j-label">{hhmm(j.plannedStart)} → {hhmm(j.expectedArrival)}</span>
      </div>
      {sub && <div className="j-label">{sub}</div>}
      <div className="j-bar"><i style={{ width: `${p.ratio * 100}%` }} /></div>
      <div className="j-label">{Math.round(p.done)} / {Math.round(p.planned)} km</div>
      {j.display === 'Rejected' && j.rejectReason && <div className="j-err j-clip2">Rejected: {j.rejectReason}</div>}
    </button>
  )
}
