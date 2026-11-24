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
          <div className="j-tabs" role="group" aria-label="Day">
            {DAYS.map(d => <button key={d.key} type="button" className="j-tab" aria-pressed={day === uaeDate(d.key)} onClick={() => setDay(uaeDate(d.key))}>{d.label}</button>)}
            <input className="j-input j-input--sm" type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} aria-label="Pick a day" style={{ width: 150, minHeight: 34, border: 'none', background: 'transparent' }} />
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

      <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 16 }}>
        {KPIS.map(k => (
          <button
            key={k.key}
            type="button"
            className={`j-card j-card--link${filter === k.key ? ' j-card--active' : ''}`}
            style={{ textAlign: 'left', color: 'inherit', font: 'inherit' }}
            onClick={() => setFilter(f => (f === k.key ? null : k.key))}
            aria-pressed={filter === k.key}
          >
            <span className="j-iconbtn" style={{ width: 34, height: 34, pointerEvents: 'none' }}><k.icon size={16} /></span>
            <div className="j-big" style={{ fontSize: 40, marginTop: 12 }}>{rows ? counts[k.key] : '–'}</div>
            <div className="j-strong" style={{ fontSize: 13.5, marginTop: 4 }}>{k.label}</div>
            <div className="j-label">{k.sub}</div>
          </button>
        ))}
      </div>

      <div className="j-card j-card--flush">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', flexWrap: 'wrap' }}>
          <button type="button" className="j-tab" aria-pressed={!filter} onClick={() => setFilter(null)}>All <span className="j-count">{rows?.length ?? 0}</span></button>
          {filter && <span className="j-pill j-pill--plain">{KPIS.find(k => k.key === filter).label}</span>}
          <div style={{ flex: 1 }} />
          <label style={{ position: 'relative', minWidth: 220, flex: '0 1 320px' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--j-text3)' }} />
            <input className="j-input" style={{ paddingLeft: 34 }} placeholder="Search vehicle, driver or place" value={q} onChange={e => setQ(e.target.value)} aria-label="Search journeys" />
          </label>
        </div>

        {!rows && !error && <div style={{ padding: 16 }}>{[0, 1, 2].map(i => <div key={i} className="j-skel" style={{ height: 54, marginBottom: 10 }} />)}</div>}
        {rows && shown.length === 0 && <div className="j-empty">No journeys here{filter || q ? ' for this filter' : ' for this day'}.</div>}

        {rows && shown.length > 0 && (
          <>
            <div className="j-hide-sm" style={{ overflowX: 'auto' }}>
              <table className="j-table">
                <thead>
                  <tr>
                    <th>Journey</th><th>Vehicle and driver</th><th>From → To</th><th>Leaves → Arrives</th><th>Stops</th><th>Distance</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(j => <Row key={j.id} j={j} onOpen={() => navigate(`/journeys/${j.id}`)} />)}
                </tbody>
              </table>
            </div>
            <div className="j-only-sm" style={{ padding: '0 12px 12px' }}>
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
      <td style={{ maxWidth: 240 }}>
        <div className="j-strong">{j.title}</div>
        <div className="j-label">{j.ref}{j.customer ? ` · ${j.customer}` : ''} <NoApprovalChip journey={j} /></div>
        {j.display === 'Rejected' && j.rejectReason && <div className="j-err" style={{ marginTop: 3 }}>Rejected: {j.rejectReason}</div>}
        {j.display === 'Pending' && j.submittedAt && <div className="j-label">Sent for approval at {hhmm(j.submittedAt)}</div>}
      </td>
      <td>
        <div className="j-strong">{j.vehicleLabel}</div>
        <div className="j-label">{j.driverName || 'No driver'}</div>
      </td>
      <td style={{ maxWidth: 230 }}>
        <span>{first?.name}</span> <span className="j-muted">→</span> <span>{last?.name}</span>
        {j.stops.length > 2 && <div className="j-label">{j.stops.length - 2} stop{j.stops.length > 3 ? 's' : ''} in between</div>}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <div className="j-strong">{hhmm(j.plannedStart)} <span className="j-muted">→</span> {hhmm(j.expectedArrival)}</div>
        {sub && <div className="j-label">{sub}</div>}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <StopDots stops={j.stops} />
        <div className="j-label" style={{ marginTop: 4 }}>{j.stopsDone} of {j.stops.length - 1} reached</div>
      </td>
      <td style={{ minWidth: 130 }}>
        <div style={{ fontSize: 12.5 }}><span className="j-strong">{Math.round(p.done)}</span> <span className="j-muted">/ {Math.round(p.planned)} km</span></div>
        <div className="j-bar" style={{ marginTop: 6 }}><i style={{ width: `${p.ratio * 100}%` }} /></div>
      </td>
      <td><StatusPill journey={j} /></td>
    </tr>
  )
}

function MobileCard({ j, onOpen }) {
  const first = j.stops[0], last = j.stops[j.stops.length - 1]
  const p = progressOf(j)
  return (
    <button type="button" className="j-card j-card--link" onClick={onOpen} style={{ width: '100%', textAlign: 'left', color: 'inherit', font: 'inherit', marginTop: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="j-strong">{j.vehicleLabel}</div>
          <div className="j-label">{j.driverName || 'No driver'}</div>
        </div>
        <StatusPill journey={j} />
      </div>
      <div style={{ marginTop: 10, fontSize: 13.5 }}>{first?.name} <span className="j-muted">→</span> {last?.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 10 }}>
        <StopDots stops={j.stops} />
        <span className="j-label">{j.actualStart ? 'Arrives' : 'Leaves'} <span className="j-strong">{hhmm(j.actualStart ? j.etaAt ?? j.expectedArrival : j.plannedStart)}</span></span>
      </div>
      <div className="j-bar" style={{ marginTop: 10 }}><i style={{ width: `${p.ratio * 100}%` }} /></div>
      <div className="j-label" style={{ marginTop: 4 }}>{Math.round(p.done)} / {Math.round(p.planned)} km</div>
    </button>
  )
}
