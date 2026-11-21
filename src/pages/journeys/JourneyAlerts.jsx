import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Search, BellRing } from 'lucide-react'
import JourneyShell from './JourneyShell'
import { ErrorNote } from '../../components/journeys/JourneyBits'
import { journeyEvents, dayTime, EVENT_LABEL, eventTone, STATUS_META, uaeDate, dayRange, duration } from '../../data/journeys'
import { errorMessage } from '../../data/http'

/**
 * Journey Alerts (client 2026-11-13 menu, built 2026-11-21): every journey
 * alert and event in a period — late departures and arrivals, off route,
 * unplanned stops, HSE breaks, convoy, temperature, check-ins, approvals —
 * filtered by kind, severity, vehicle or journey. A row opens its journey.
 */

const KINDS = [
  { key: '', label: 'All kinds' },
  { key: 'DEPART_LATE,DEPART_EARLY,ARRIVE_LATE,ARRIVE_EARLY,NOT_DEPARTED,DELAYED', label: 'Early / late' },
  { key: 'DEPART_ON_TIME,ARRIVE_ON_TIME', label: 'On time' },
  { key: 'OFF_ROUTE', label: 'Off route' },
  { key: 'UNPLANNED_STOP,SKIPPED_STOP,DESTINATION_PASSED', label: 'Stops' },
  { key: 'BREAK_DUE,DAILY_LIMIT', label: 'HSE driving rules' },
  { key: 'NO_SIGNAL,SIGNAL_BACK', label: 'Signal' },
  { key: 'CONVOY_SEPARATED,CONVOY_REJOINED', label: 'Convoy' },
  { key: 'TEMP_OUT_OF_RANGE,TEMP_BACK', label: 'Temperature' },
  { key: 'CHECK_IN,FORM,PHOTO,SIGNATURE', label: 'Check-ins and proof' },
  { key: 'SUBMITTED,APPROVED,REJECTED', label: 'HSE approval' },
  { key: 'FORCE_CLOSED,CANCELLED', label: 'Closed' },
]

export default function JourneyAlerts(props) {
  const navigate = useNavigate()
  const [from, setFrom] = useState(() => uaeDate(-6))
  const [to, setTo] = useState(() => uaeDate(0))
  const [kind, setKind] = useState('')
  const [severity, setSeverity] = useState('')
  const [alertsOnly, setAlertsOnly] = useState(true)
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await journeyEvents({
        from: dayRange(from)[0], to: dayRange(to)[1], ...(kind ? { type: kind } : {}), ...(severity ? { severity } : {}),
        alertsOnly: alertsOnly ? 'true' : 'false', limit: 1000,
      })
      setRows(res.data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'Could not load the journey alerts'))
    }
  }, [from, to, kind, severity, alertsOnly])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (rows ?? []).filter(e => !s || [e.message, e.journey.ref, e.journey.title, e.journey.vehicleLabel, e.journey.driverName].some(v => String(v ?? '').toLowerCase().includes(s)))
  }, [rows, q])
  const counts = useMemo(() => ({
    High: shown.filter(e => e.severity === 'High').length,
    Medium: shown.filter(e => e.severity === 'Medium').length,
    Low: shown.filter(e => e.severity === 'Low').length,
  }), [shown])

  return (
    <JourneyShell {...props} crumb="Alerts" title="Journey alerts" subtitle="What happened on the journeys: alerts and events, newest first. Click one to open its journey."
      actions={<button type="button" className="j-iconbtn" onClick={load} title="Refresh" aria-label="Refresh"><RefreshCw size={15} /></button>}>
      <ErrorNote error={error} />
      <div className="j-card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, padding: 14 }}>
        <input className="j-input" style={{ width: 150 }} type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} aria-label="From" />
        <span className="j-muted">to</span>
        <input className="j-input" style={{ width: 150 }} type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} aria-label="To" />
        <select className="j-select" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">{KINDS.map(k => <option key={k.label} value={k.key}>{k.label}</option>)}</select>
        <select className="j-select" style={{ width: 'auto' }} value={severity} onChange={e => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">Any severity</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
        </select>
        <div className="j-seg">
          <button type="button" aria-pressed={alertsOnly} onClick={() => setAlertsOnly(true)}><BellRing size={13} /> Alerts</button>
          <button type="button" aria-pressed={!alertsOnly} onClick={() => setAlertsOnly(false)}>All events</button>
        </div>
        <label style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--j-text3)' }} />
          <input className="j-input" style={{ paddingLeft: 34 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Vehicle, driver, journey or text" aria-label="Search" />
        </label>
      </div>
      <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginBottom: 14 }}>
        {[['Shown', shown.length, 'muted'], ['High', counts.High, 'bad'], ['Medium', counts.Medium, 'warn'], ['Low', counts.Low, 'info']].map(([l, n, tone]) => (
          <div key={l} className="j-card" style={{ padding: '12px 14px' }}>
            <span className="j-pill" data-tone={tone}>{l}</span>
            <div className="j-big" style={{ fontSize: 34, marginTop: 8 }}>{rows ? n : '–'}</div>
          </div>
        ))}
      </div>
      <div className="j-card j-card--flush">
        {!rows && !error && <div style={{ padding: 16 }}><div className="j-skel" style={{ height: 140 }} /></div>}
        {rows && shown.length === 0 && <div className="j-empty">Nothing in this period{kind || severity || q ? ' for these filters' : ''}.</div>}
        {shown.map(e => (
          <button key={e.id} type="button" onClick={() => navigate(`/journeys/${e.journey.id}`)}
            style={{ display: 'flex', gap: 12, width: '100%', textAlign: 'left', padding: '12px 16px', background: 'none', border: 0, borderTop: '1px solid var(--j-line)', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
            <span className="j-dot" data-tone={eventTone(e.type)} style={{ marginTop: 6 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="j-strong" style={{ fontSize: 13.5 }}>{e.type === 'STATUS' ? STATUS_META[e.toStatus]?.label ?? e.toStatus : EVENT_LABEL[e.type] ?? e.type}</span>
                {e.severity && <span className="j-pill" data-tone={e.severity === 'High' ? 'bad' : e.severity === 'Medium' ? 'warn' : 'info'}>{e.severity}</span>}
                {e.alert && <span className="j-pill j-pill--plain"><BellRing size={11} /> alert</span>}
                <span className="j-label" style={{ marginLeft: 'auto' }}>{dayTime(e.occurredAt)}</span>
              </span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--j-text2)', marginTop: 2 }}>{e.message}{e.durationSec ? ` · lasted ${duration(e.durationSec / 60)}` : ''}</span>
              <span className="j-label" style={{ display: 'block', marginTop: 2 }}>{e.journey.ref} · {e.journey.title} · {e.journey.vehicleLabel}{e.journey.driverName ? ` · ${e.journey.driverName}` : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </JourneyShell>
  )
}
