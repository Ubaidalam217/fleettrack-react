import { useState, useMemo, useEffect, useRef } from 'react'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { hasDriver } from '../../services/vehicleMaster'
import { listDocuments, expiryState, daysUntilExpiry, isReadOnly } from '../../services/documentStore'
import { fetchTodayMessages, computeUsage } from '../../utils/usageData'
import { computeSensors } from '../../utils/sensorsData'
import {
  computeAlerts, ALERT_TYPES, SEVERITY, SEVERITY_FILTERS, UNAVAILABLE_NOTES,
  getThresholds, saveThresholds, resetThresholds,
} from '../../utils/alertsData'
import { useAddress } from '../../hooks/useAddress'
import { useVisible } from '../../hooks/useVisible'
import { shortenAddress } from '../../utils/geocode'

// Replay used to be a tab here. It now lives in its own dock over the map and
// is started from the vehicle's card in the list or from its marker popup.
const DETAIL_TABS = [
  'Vehicle Info',
  'Driver Info',
  'Usage',
  'Sensors',
  'Alerts',
  'Documents',
]

function fmtTs(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

// ── Small presentational primitives ────────────────────────────────────────

function Field({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)' }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color || 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value === '' || value == null ? '—' : value}
      </span>
    </div>
  )
}

function Grid({ children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
      gap: '14px 18px',
    }}>
      {children}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--c-text2)',
        marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--c-border)',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// Explicit marker for fields that have no data source wired yet. Better than a
// plausible-looking zero: it says what is missing and where it will come from.
function Pending({ note }) {
  return (
    <div style={{
      fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.7,
      padding: '10px 12px', borderRadius: 8,
      border: '1px dashed var(--c-border2)', backgroundColor: 'var(--c-hover)',
    }}>
      {note}
    </div>
  )
}

function fmtDuration(sec) {
  if (sec == null) return '—'
  const h = Math.floor(sec / 3600)
  const min = Math.round((sec % 3600) / 60)
  return `${h}h ${min}m`
}

// Shared by the Usage and Vehicle Info tabs — both read today's messages for
// the same device, and fetchTodayMessages() caches the request itself, so
// switching between the two tabs never issues a second fetch within the TTL.
function useUsageData(vehicleId) {
  const [state, setState] = useState({ loading: true, error: null, status: null, usage: null, messages: null })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null, status: null, usage: null, messages: null })

    fetchTodayMessages(vehicleId, status => {
      if (!cancelled) setState(s => ({ ...s, status }))
    })
      .then(messages => {
        if (!cancelled) setState({ loading: false, error: null, status: null, usage: computeUsage(messages), messages })
      })
      .catch(err => {
        if (!cancelled) setState({ loading: false, error: err.message, status: null, usage: null, messages: null })
      })

    return () => { cancelled = true }
  }, [vehicleId])

  return state
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function VehicleInfo({ v }) {
  const m = v.master
  const docs = useMemo(() => listDocuments(v.id), [v.id])
  const { loading: usageLoading, usage } = useUsageData(v.id)

  const address = useAddress(v.lat, v.lng)

  return (
    <>
      <Section title="Identity">
        <Grid>
          <Field label="Plate No"     value={m.plateNo} />
          <Field label="Fleet No"     value={m.fleetNo} />
          <Field label="Vehicle Type" value={m.vehicleType} />
          <Field label="Device Name"  value={v.name} />
          <Field label="IMEI"         value={v.ident} />
          <Field label="Status"       value={statusLabel(v.status)} color={statusColor(v.status)} />
        </Grid>
      </Section>

      <Section title="Position">
        <Grid>
          <Field
            label="Location"
            value={address ?? (v.lat != null && v.lng != null ? `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}` : null)}
          />
          <Field label="Speed"       value={v.speed != null ? `${v.speed} km/h` : null} />
          <Field label="Last Update" value={fmtTs(v.lastTs)} />
          <Field
            label="Odometer"
            value={usageLoading ? '…' : usage?.odometerKm != null ? `${usage.odometerKm.toFixed(1)} km` : null}
          />
          <Field
            label="Max Speed Today"
            value={usageLoading ? '…' : usage ? `${usage.maxSpeed} km/h` : null}
          />
          <Field
            label="Avg Speed Today"
            value={usageLoading ? '…' : usage?.avgSpeed != null ? `${usage.avgSpeed.toFixed(0)} km/h` : null}
          />
        </Grid>
      </Section>

      <Section title="Document Expiry">
        {docs.length === 0 ? (
          <Pending note="No documents on file for this vehicle. Add them in the Documents tab." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {docs.map(d => {
              const state = expiryState(d)
              const days  = daysUntilExpiry(d)
              const color = state === 'expired' ? '#ef4444' : state === 'due' ? '#eab308' : 'var(--c-text2)'
              return (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                  <span style={{ flex: 1, color: 'var(--c-text1)', fontWeight: 600 }}>{d.name}</span>
                  <span style={{ color: 'var(--c-text3)' }}>{d.expiryDate ?? '—'}</span>
                  <span style={{ color, fontWeight: 700, minWidth: 92, textAlign: 'right' }}>
                    {days == null ? '—' : days < 0 ? `expired ${-days}d ago` : `${days}d left`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Costs">
        <Pending note="Month Expenses has no source in Flespi — it requires the ERP backend." />
      </Section>
    </>
  )
}

function DriverInfo({ v }) {
  const d = v.master.driver

  if (!hasDriver(v.master)) {
    return (
      <div style={{ padding: '28px 4px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text1)', marginBottom: 8 }}>
          No Driver Assigned
        </div>
        <div style={{ fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.7, maxWidth: 420, margin: '0 auto' }}>
          Driver details are stored per vehicle in Flespi metadata. Assigning a driver
          and uploading their documents is wired up in Phase 5.
        </div>
      </div>
    )
  }

  return (
    <>
      <Section title="Driver">
        <Grid>
          <Field label="Name"           value={d.name} />
          <Field label="Mobile"         value={d.mobile} />
          <Field label="Nationality"    value={d.nationality} />
          <Field label="License Expiry" value={d.licenseExpiry} />
        </Grid>
      </Section>
      <Section title="Activity">
        <Pending note="Vehicles Driven Today requires scanning every device's driver assignment against today's trips — Phase 5." />
      </Section>
    </>
  )
}

function Usage({ v }) {
  const { loading, error, status, usage } = useUsageData(v.id)

  if (loading) {
    return (
      <div style={{ padding: '28px 4px', textAlign: 'center', fontSize: 12.5, fontWeight: 600 }}>
        <span style={{ color: status?.startsWith('Rate limit') ? '#eab308' : 'var(--c-text3)' }}>
          {status || "Loading today's usage…"}
        </span>
      </div>
    )
  }

  if (error) {
    return <Pending note={`Could not load today's usage: ${error}`} />
  }

  return (
    <Section title="Today">
      <Grid>
        <Field
          label="Distance Today"
          value={usage.distanceKm != null ? `${usage.distanceKm.toFixed(1)} km` : null}
        />
        <Field label="Running Time" value={fmtDuration(usage.runningSec)} color={statusColor('Running')} />
        <Field label="Idle Time"    value={fmtDuration(usage.idleSec)}    color={statusColor('Idle')} />
        <Field label="Stop Time"    value={fmtDuration(usage.stopSec)}    color={statusColor('Stopped')} />
        <Field label="Trip Count"   value={usage.tripCount} />
        <Field
          label="Total Odometer"
          value={usage.odometerKm != null ? `${usage.odometerKm.toFixed(1)} km` : null}
        />
      </Grid>
    </Section>
  )
}

function Sensors({ v }) {
  const { loading, error, status, messages } = useUsageData(v.id)
  const data = useMemo(() => computeSensors(messages, v), [messages, v])

  if (loading) {
    return (
      <div style={{ padding: '28px 4px', textAlign: 'center', fontSize: 12.5, fontWeight: 600 }}>
        <span style={{ color: status?.startsWith('Rate limit') ? '#eab308' : 'var(--c-text3)' }}>
          {status || 'Loading sensor data…'}
        </span>
      </div>
    )
  }

  if (error) {
    return <Pending note={`Could not load sensor data: ${error}`} />
  }

  const { fuel, temperature } = data

  if (!fuel && !temperature) {
    return (
      <div style={{ padding: '28px 4px', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: 'var(--c-text3)' }}>
        No sensor data available for this vehicle.
      </div>
    )
  }

  return (
    <>
      {fuel && (
        <Section title="Fuel Monitoring">
          <Grid>
            <Field label="Current Fuel Level" value={fuel.currentLevel != null ? `${fuel.currentLevel.toFixed(0)}%` : null} />
            <Field label="Fuel Consumed Today" value={fuel.consumedToday != null ? `${fuel.consumedToday.toFixed(1)} L` : null} />
            <Field label="Fuel Filling Events" value={fuel.fillEvents} />
            <Field label="Fuel Theft Events" value={fuel.theftEvents} color={fuel.theftEvents ? '#ef4444' : undefined} />
          </Grid>
        </Section>
      )}

      {temperature && (
        <Section title="Temperature Monitoring">
          <Grid>
            <Field label="Current Temperature" value={temperature.current != null ? `${temperature.current.toFixed(1)}°C` : null} />
            <Field label="Max Temperature Today" value={temperature.max != null ? `${temperature.max.toFixed(1)}°C` : null} />
            <Field label="Average Temperature Today" value={temperature.avg != null ? `${temperature.avg.toFixed(1)}°C` : null} />
            <Field label="Min Temperature Today" value={temperature.min != null ? `${temperature.min.toFixed(1)}°C` : null} />
          </Grid>
        </Section>
      )}
    </>
  )
}

// One shared badge glyph per alert type, coloured by severity rather than
// type — severity is what an operator scans for first.
function AlertIcon({ type, color }) {
  const paths = {
    overSpeed:       <path d="M12 8v4l3 2M12 3a9 9 0 1 0 9 9" />,
    harshBraking:    <path d="M12 2l9 18H3z M12 9v4 M12 16h.01" />,
    harshCornering:  <path d="M12 2l9 18H3z M12 9v4 M12 16h.01" />,
    suddenAccel:     <path d="M12 2l9 18H3z M12 9v4 M12 16h.01" />,
    excessiveIdle:   <path d="M12 7v5l3 3 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />,
    geofenceEntry:   <path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11Z M12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
    geofenceExit:    <path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11Z M12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
    ignitionOn:      <path d="M12 2v10 M18.4 6.6a9 9 0 1 1-12.8 0" />,
    ignitionOff:     <path d="M12 2v10 M18.4 6.6a9 9 0 1 1-12.8 0" />,
    powerDisconnect: <path d="M6 9V5m12 4V5M4 9h16v4a8 8 0 0 1-16 0V9Z m8 12v-4" />,
    fuelTheft:       <path d="M4 22V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v17 M4 11h8 M16 8l2.5 2.5A2 2 0 0 1 19 12v6a1.5 1.5 0 0 1-3 0" />,
    fuelFilling:     <path d="M4 22V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v17 M4 11h8 M16 8l2.5 2.5A2 2 0 0 1 19 12v6a1.5 1.5 0 0 1-3 0" />,
    documentExpiry:  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M9 13h6 M9 17h6" />,
  }
  return (
    <div style={{
      flexShrink: 0, width: 30, height: 30, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: `${color}1f`, color,
    }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {paths[type] || <circle cx="12" cy="12" r="9" />}
      </svg>
    </div>
  )
}

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

const THRESHOLD_FIELDS = [
  { key: 'overSpeedKmh',     label: 'Over Speed (km/h)' },
  { key: 'harshBrakingMs2',  label: 'Harsh Braking (m/s²)' },
  { key: 'suddenAccelMs2',   label: 'Sudden Accel (m/s²)' },
  { key: 'corneringDeg',     label: 'Cornering angle (°)' },
  { key: 'excessiveIdleMin', label: 'Excessive Idle (min)' },
  { key: 'fuelFillPct',      label: 'Fuel Fill Jump (%)' },
  { key: 'fuelTheftPct',     label: 'Fuel Theft Drop (%)' },
]

function ThresholdMenu({ thresholds, onChange, onReset, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const onDown = e => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 20,
        minWidth: 226, padding: '12px 12px 10px',
        borderRadius: 10, border: '1px solid var(--c-border2)',
        background: 'var(--c-card)', boxShadow: '0 10px 32px rgba(0,0,0,0.22)',
        display: 'flex', flexDirection: 'column', gap: 9,
      }}
    >
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-text3)' }}>
        Thresholds (this vehicle)
      </div>
      {THRESHOLD_FIELDS.map(f => (
        <label key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 11.5, color: 'var(--c-text1)' }}>
          {f.label}
          <input
            type="number"
            value={thresholds[f.key]}
            onChange={e => onChange({ [f.key]: Number(e.target.value) })}
            style={{
              width: 62, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--c-border)',
              backgroundColor: 'var(--c-input)', color: 'var(--c-text1)', fontSize: 11.5, textAlign: 'right',
            }}
          />
        </label>
      ))}
      <button
        onClick={onReset}
        style={{
          marginTop: 4, alignSelf: 'flex-start', background: 'none', border: 'none',
          color: 'var(--ft-accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0,
        }}
      >
        Reset to default
      </button>
    </div>
  )
}

// Address resolution is gated on the row actually being scrolled into view
// (see useVisible) so opening a long alert list doesn't fire a lookup for
// every row at once — only what the operator is actually looking at.
function AlertRow({ alert }) {
  const [ref, visible] = useVisible(300)
  const address = useAddress(alert.lat, alert.lng, visible && alert.lat != null)
  const typeLabel = ALERT_TYPES.find(t => t.key === alert.type)?.label ?? alert.type
  const sev = SEVERITY[alert.severity]

  const location = alert.lat == null
    ? '—'
    : address ? shortenAddress(address) : (visible ? 'Resolving…' : '—')

  return (
    <div
      ref={ref}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '10px 12px', borderRadius: 10,
        border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)',
      }}
    >
      <AlertIcon type={alert.type} color={sev.color} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)' }}>{typeLabel}</div>
        <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 2 }}>{fmtTs(alert.ts)}</div>
        <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {location}
        </div>
        {alert.detail && (
          <div style={{ fontSize: 11, color: 'var(--c-text2)', marginTop: 2 }}>{alert.detail}</div>
        )}
      </div>
      <span style={{
        flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
        color: sev.color, backgroundColor: `${sev.color}1f`,
      }}>
        {alert.severity}
      </span>
    </div>
  )
}

function Alerts({ v }) {
  const { loading, error, status, messages } = useUsageData(v.id)
  const [thresholds, setThresholds] = useState(() => getThresholds(v.id))
  const [severityFilter, setSeverityFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('all')
  const [gearOpen, setGearOpen] = useState(false)

  useEffect(() => { setThresholds(getThresholds(v.id)) }, [v.id])

  const alerts = useMemo(() => computeAlerts(messages, v, thresholds), [messages, v, thresholds])
  const filtered = alerts.filter(a =>
    (severityFilter === 'All' || a.severity === severityFilter) &&
    (typeFilter === 'all' || a.type === typeFilter)
  )

  if (loading) {
    return (
      <div style={{ padding: '28px 4px', textAlign: 'center', fontSize: 12.5, fontWeight: 600 }}>
        <span style={{ color: status?.startsWith('Rate limit') ? '#eab308' : 'var(--c-text3)' }}>
          {status || "Loading today's alerts…"}
        </span>
      </div>
    )
  }

  if (error) {
    return <Pending note={`Could not load alerts: ${error}`} />
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SEVERITY_FILTERS.map(s => {
            const active = severityFilter === s
            const color = s === 'All' ? '#5ba354' : SEVERITY[s].color
            return (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                style={{
                  padding: '5px 11px', borderRadius: 999,
                  border: `1px solid ${active ? color : 'var(--c-border)'}`,
                  background: active ? `${color}1f` : 'var(--c-input)',
                  color: active ? color : 'var(--c-text2)',
                  fontSize: 11, fontWeight: active ? 700 : 600, cursor: 'pointer',
                }}
              >
                {s}
              </button>
            )
          })}
        </div>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{
            marginLeft: 'auto', padding: '5px 9px', borderRadius: 7,
            border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input)',
            color: 'var(--c-text1)', fontSize: 11.5,
          }}
        >
          <option value="all">All Types</option>
          {ALERT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setGearOpen(o => !o)}
            title="Alert thresholds"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 27, height: 27, borderRadius: 7, cursor: 'pointer',
              border: '1px solid var(--c-border)',
              background: gearOpen ? 'var(--c-hover)' : 'var(--c-input)',
              color: 'var(--c-text2)',
            }}
          >
            <GearIcon />
          </button>
          {gearOpen && (
            <ThresholdMenu
              thresholds={thresholds}
              onChange={patch => setThresholds(saveThresholds(v.id, patch))}
              onReset={() => setThresholds(resetThresholds(v.id))}
              onClose={() => setGearOpen(false)}
            />
          )}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div style={{ padding: '28px 4px', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: 'var(--c-text3)' }}>
          No alerts today.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '28px 4px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.6 }}>
          {UNAVAILABLE_NOTES[typeFilter] || 'No alerts match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto', paddingRight: 2 }}>
          {filtered.map(a => <AlertRow key={a.id} alert={a} />)}
        </div>
      )}
    </>
  )
}

function Documents({ v }) {
  const docs = useMemo(() => listDocuments(v.id), [v.id])

  return (
    <>
      <Section title={`Documents (${docs.length})`}>
        {docs.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>No documents on file.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {docs.map(d => (
              <div
                key={d.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 11px', borderRadius: 8,
                  border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text1)' }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 2 }}>
                    Expires {d.expiryDate ?? '—'} · notify {d.notifyBeforeDays}d before
                  </div>
                </div>
                {isReadOnly(d) && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                    padding: '3px 7px', borderRadius: 5,
                    color: 'var(--ft-accent)', backgroundColor: 'color-mix(in srgb, var(--ft-accent) 12%, transparent)',
                  }}>
                    PERMIT MGMT
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
      <Pending note="Add / Edit / Delete are backed by documentStore.js and persist in this browser. The forms, and download of the read-only Permit Management records, are Phase 5. Attachment upload needs a backend and stays disabled." />
    </>
  )
}

// ── Panel ──────────────────────────────────────────────────────────────────

// The sheet is only mounted while a vehicle is selected, so there is no empty
// state to render any more — Tracking.jsx slides the whole sheet away instead.
export default function VehicleDetailPanel({ vehicle }) {
  const [tab, setTab] = useState(DETAIL_TABS[0])

  if (!vehicle) return null

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      backgroundColor: 'var(--c-card)', borderTop: '1px solid var(--c-border2)',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', flexShrink: 0, overflowX: 'auto',
        borderBottom: '1px solid var(--c-border2)',
      }}>
        {DETAIL_TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '11px 16px',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--ft-accent)' : '2px solid transparent',
              color: tab === t ? 'var(--ft-accent)' : 'var(--c-text2)',
              cursor: 'pointer',
              transition: 'color 0.15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', minHeight: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text1)', marginBottom: 14 }}>
          {vehicle.master.plateNo || vehicle.name}
          {vehicle.master.fleetNo && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text3)', marginLeft: 8 }}>
              Fleet {vehicle.master.fleetNo}
            </span>
          )}
        </div>

        {tab === 'Vehicle Info' && <VehicleInfo v={vehicle} />}
        {tab === 'Driver Info'  && <DriverInfo  v={vehicle} />}
        {tab === 'Usage'        && <Usage       v={vehicle} />}
        {tab === 'Sensors'      && <Sensors     v={vehicle} />}
        {tab === 'Alerts'       && <Alerts     v={vehicle} />}
        {tab === 'Documents'    && <Documents   v={vehicle} />}
      </div>
    </div>
  )
}
