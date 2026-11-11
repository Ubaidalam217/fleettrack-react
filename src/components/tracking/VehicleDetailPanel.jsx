import { useState, useMemo, useEffect, useRef } from 'react'
import { Truck, Cpu, Building2, MapPin, ListChecks, Pencil, Plus, Copy, Check } from 'lucide-react'
import { validityState } from '../../utils/liveMapFilters'
import { valueParts } from '../../utils/customFields'
import { useNavigate } from 'react-router-dom'
import DeviceSettingsTab from './DeviceSettingsTab'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { hasDriver } from '../../services/vehicleMaster'
import VehicleDocumentsTab from './VehicleDocumentsTab'
import { useVehicleDocuments } from '../../data/vehicleDocuments'
import { useVehicleUsage, fmtOdometer } from '../../hooks/useVehicleUsage'
import { computeSensors } from '../../utils/sensorsData'
import {
  computeAlerts, ALERT_TYPES, SEVERITY, SEVERITY_FILTERS, UNAVAILABLE_NOTES,
  getThresholds, saveThresholds, resetThresholds,
} from '../../utils/alertsData'
import { useAddress } from '../../hooks/useAddress'
import { useVisible } from '../../hooks/useVisible'
import { shortenAddress } from '../../utils/geocode'
import { useSettingsProfile, useDriverForDevice, useDrivers, driverForIbutton, ibuttonKey, updateDriver, driverDisplayForDevice } from '../../data/settings'
import UnregisteredDriverDialog from './UnregisteredDriverDialog'
import VehiclesDrivenToday from './VehiclesDrivenToday'
import { licenceExpiryState, formatExpiryDate } from '../../utils/licenceExpiry'
import { BASE_URL, HEADERS } from '../../hooks/flespiConfig'

// Replay used to be a tab here. It now lives in its own dock over the map and
// is started from the vehicle's card in the list or from its marker popup.
const DETAIL_TABS = [
  'Vehicle Info',
  'Driver Info',
  'Usage',
  'Sensors',
  'Alerts',
  'Documents',
  // Client, 2026-11-06: what the tracker reports is "data"; its settings are the parameters.
  'Live Data',
  'Parameters',
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

// `caption` names where a section's values come from. Worth the room on the
// mixed-source sections: Plate No appears twice on this tab — once from the
// device's own metadata and once from the Settings record — and without the
// caption that reads as a duplicated field rather than two sources.
function Section({ title, caption, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
        marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--c-border)',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text2)' }}>
          {title}
        </span>
        {caption && (
          <span style={{ fontSize: 10, color: 'var(--c-text3)' }}>{caption}</span>
        )}
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

// ── Tabs ───────────────────────────────────────────────────────────────────

// ── Vehicle Info ───────────────────────────────────────────────────────────
//
// Client, 2026-11-09: one clean card per subject, every value once. Document
// Expiry and Costs are gone from here — the Documents tab and the expense
// pages own them. Plate and Fleet No used to appear twice (the device's own
// metadata and the Settings record); the Settings value wins, the device's is
// the fallback for a tracker not registered yet.

const VI_CSS = `
.vinfo-wrap{container-type:inline-size}
.vinfo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.vinfo-card{border:1px solid var(--c-border);border-radius:14px;padding:14px 16px 16px;min-width:0;
  background:color-mix(in srgb,var(--c-input) 40%,var(--c-card))}
.vinfo-card.wide{grid-column:1/-1}
.vinfo-head{display:flex;align-items:center;gap:9px;margin-bottom:14px}
.vinfo-ico{width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  color:var(--ft-accent);background:color-mix(in srgb,var(--ft-accent) 13%,transparent)}
.vinfo-title{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:800;color:var(--c-text1);flex:1;min-width:0}
.vinfo-count{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--c-hover);color:var(--c-text2)}
.vinfo-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}
.vinfo-fields.four{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.vinfo-f{min-width:0}
.vinfo-f.span{grid-column:1/-1}
.vinfo-l{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text3);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vinfo-v{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:13px;font-weight:650;color:var(--c-text1);min-width:0;line-height:1.45}
.vinfo-v > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vinfo-v.wrap > span{white-space:normal;overflow:visible;word-break:break-word}
.vinfo-v .muted{color:var(--c-text3);font-weight:500}
.vinfo-v a{color:var(--ft-accent);text-decoration:none}
.vinfo-v a:hover{text-decoration:underline}
.vinfo-btn{height:30px;padding:0 11px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text1);
  font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0}
.vinfo-btn:hover{background:var(--c-hover)}
.vinfo-mini{width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:var(--c-text3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.vinfo-mini:hover{background:var(--c-hover);color:var(--c-text1)}
.vinfo-pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;flex-shrink:0}
.vinfo-pill i{width:6px;height:6px;border-radius:50%;background:currentColor}
.vinfo-note,.vinfo-empty{font-size:12px;color:var(--c-text3);line-height:1.55}
/* Sized by the panel, not the window: the sheet can be narrow on a wide screen. */
@container (max-width:640px){.vinfo{grid-template-columns:minmax(0,1fr)}}
@container (max-width:380px){.vinfo-fields{grid-template-columns:minmax(0,1fr)}}
`

const VALIDITY_TONE = { valid: ['#16a34a', 'valid'], expiring: ['#d97706', 'expires soon'], expired: ['#ef4444', 'expired'] }

function InfoCard({ icon: Icon, title, aside, wide, children }) {
  return (
    <section className={`vinfo-card${wide ? ' wide' : ''}`}>
      <div className="vinfo-head">
        <span className="vinfo-ico"><Icon size={15} /></span>
        <span className="vinfo-title">{title}</span>
        {aside}
      </div>
      {children}
    </section>
  )
}

function InfoField({ label, value, span, wrap, mono, after, color }) {
  const empty = value === '' || value == null
  return (
    <div className={`vinfo-f${span ? ' span' : ''}`}>
      <div className="vinfo-l" title={label}>{label}</div>
      <div className={`vinfo-v${wrap ? ' wrap' : ''}`} style={color ? { color } : undefined}>
        {empty
          ? <span className="muted">—</span>
          : <span style={mono ? { fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' } : undefined}>{value}</span>}
        {!empty && after}
      </div>
    </div>
  )
}

function CopyMini({ text, label }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1400)
    } catch { /* clipboard blocked: the value is still selectable */ }
  }
  return (
    <button type="button" className="vinfo-mini" title={done ? 'Copied' : `Copy ${label}`} aria-label={`Copy ${label}`} onClick={copy}>
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

const fmtDay = ymd => {
  if (!ymd) return ''
  const [y, mo, d] = ymd.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
const capitalise = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function VehicleInfo({ v, onOpenInfo, onOpenConsole }) {
  const m = v.master
  const profile = useSettingsProfile(v.ident)
  const row = profile.linked ? profile.vehicle : null
  const { loading: usageLoading, usage } = useVehicleUsage(v.id)
  const address = useAddress(v.lat, v.lng)

  const validity = row?.validUntil ? validityState(row.validUntil) : null
  const [vColor, vNote] = VALIDITY_TONE[validity] ?? []
  const groupName = profile.linked && profile.groupName !== 'Business Group is its own group' && profile.groupName !== '—' ? profile.groupName : ''
  const branchName = profile.linked && profile.branchName !== '—' ? profile.branchName : ''  // the client's name when it has no branch
  const fields = row?.customFields ?? []
  const color = statusColor(v.status)
  const position = address ?? (v.lat != null && v.lng != null ? `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}` : null)

  return (
    <>
      <style>{VI_CSS}</style>
      <div className="vinfo-wrap">
      <div className="vinfo">
        <InfoCard icon={Truck} title="Vehicle">
          <div className="vinfo-fields">
            <InfoField label="Plate No" value={profile.plateNo || m.plateNo} />
            <InfoField label="Fleet No" value={profile.fleetNo || m.fleetNo} />
            <InfoField label="Vehicle Type" value={capitalise(m.vehicleType || row?.vehicleType)} />
            <InfoField label="Make & Model" value={profile.makeModel} />
            <InfoField label="Asset Group" value={profile.subGroup} />
            <InfoField label="Validity" value={row?.validUntil ? `${fmtDay(row.validUntil)} · ${vNote}` : ''} color={vColor} />
          </div>
        </InfoCard>

        <InfoCard icon={Cpu} title="Tracker">
          <div className="vinfo-fields">
            <InfoField label="Unique ID (IMEI)" value={v.ident} mono after={v.ident && <CopyMini text={v.ident} label="IMEI" />} />
            <InfoField label="Device Type" value={profile.deviceType} />
            <InfoField label="SIM / Mobile No" value={profile.mobileNo} />
            <InfoField label="ODO Reading" value={usageLoading ? '…' : fmtOdometer(usage?.odometerKm)} />
          </div>
        </InfoCard>

        <InfoCard
          icon={Building2}
          title="Organisation"
          wide
          aside={!profile.linked && onOpenConsole && (
            <button type="button" className="vinfo-btn" onClick={onOpenConsole}><Pencil size={12} />Register</button>
          )}
        >
          {profile.linked ? (
            <div className="vinfo-fields four">
              <InfoField label="Group" value={groupName} />
              <InfoField label="Business Group" value={profile.bgName} />
              <InfoField label="Branch" value={branchName} />
            </div>
          ) : (
            <div className="vinfo-note">
              This tracker is not registered under Settings › Object › Vehicle yet, so it has no Group, Business Group or Branch. Register it with Parameters.
            </div>
          )}
        </InfoCard>

        <InfoCard
          icon={MapPin}
          title="Live position"
          wide
          aside={(
            <span className="vinfo-pill" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
              <i />{statusLabel(v.status)}
            </span>
          )}
        >
          <div className="vinfo-fields four">
            <InfoField label="Location" value={position} span wrap />
            <InfoField label="Speed" value={v.speed != null ? `${v.speed} km/h` : null} />
            <InfoField label="Last Update" value={fmtTs(v.lastTs)} />
            <InfoField label="Max Speed Today" value={usageLoading ? '…' : usage ? `${usage.maxSpeed} km/h` : null} />
            <InfoField label="Avg Speed Today" value={usageLoading ? '…' : usage?.avgSpeed != null ? `${usage.avgSpeed.toFixed(0)} km/h` : null} />
          </div>
        </InfoCard>

        <InfoCard
          icon={ListChecks}
          title={<>Custom fields <span className="vinfo-count">{fields.length}</span></>}
          wide
          aside={row && onOpenInfo && (
            <button type="button" className="vinfo-btn" onClick={onOpenInfo}>
              {fields.length ? <><Pencil size={12} />Manage</> : <><Plus size={13} />Add</>}
            </button>
          )}
        >
          {fields.length ? (
            <div className="vinfo-fields four">
              {fields.map(f => (
                <InfoField
                  key={f.name}
                  label={f.name}
                  wrap
                  value={valueParts(f.value, f.name).map((p, i) => (p.type === 'text'
                    ? <span key={i}>{p.text}</span>
                    : <a key={i} href={p.href} target={p.type === 'url' ? '_blank' : undefined} rel={p.type === 'url' ? 'noreferrer' : undefined}>{p.text}</a>))}
                />
              ))}
            </div>
          ) : (
            <div className="vinfo-empty">
              {row
                ? 'No custom fields yet — keep contract numbers, dates, contacts or anything else for this vehicle.'
                : 'Register the tracker first to keep custom fields for it.'}
            </div>
          )}
        </InfoCard>
      </div>
      </div>
    </>
  )
}

const EXPIRY_COLOR = { valid: '#16a34a', expiring: '#d97706', expired: '#ef4444' }

/** A phone number as a tap-to-call link, or null when there is none. */
function telLink(mobile) {
  if (!mobile) return null
  return (
    <a href={`tel:${mobile.replace(/[^\d+]/g, '')}`} style={{ color: 'var(--ft-accent)', textDecoration: 'none' }}>
      {mobile}
    </a>
  )
}

/**
 * The driver from Settings > Driver, joined to this device by IMEI → vehicle.
 *
 * The device's own Flespi metadata (`master.driver`) is the fallback: it is
 * where a driver was typed before the Driver page existed, and a vehicle that
 * still has one there should not go blank. The caption says which is shown.
 */
function DriverInfo({ v }) {
  const found = useDriverForDevice(v)
  const driver = found?.driver ?? null
  const d = v.master.driver
  const profile = useSettingsProfile(v.ident)
  const [registering, setRegistering] = useState(false)
  // An ID the tracker reads that no driver holds (client, 2026-11-09).
  const shown = driverDisplayForDevice(v)
  const unregistered = shown && !shown.registered ? shown.code : ''

  if (unregistered) {
    return (
      <>
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 18px', borderRadius: 14,
          border: '1px solid color-mix(in srgb, #f59e0b 40%, transparent)', background: 'color-mix(in srgb, #f59e0b 9%, var(--c-card))',
        }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706', background: 'color-mix(in srgb, #f59e0b 18%, transparent)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--c-text1)' }}>Unregistered Driver</div>
            <div style={{ fontSize: 12.5, color: 'var(--c-text2)', marginTop: 3 }}>
              Driver ID <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, color: 'var(--c-text1)' }}>{unregistered}</code>
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.6, marginTop: 6 }}>
              The tracker reads this Driver ID, but no driver holds it. Register it to see who is driving.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRegistering(true)}
            style={{
              flexShrink: 0, height: 38, padding: '0 16px', borderRadius: 10, border: 0, cursor: 'pointer',
              background: 'var(--ft-accent)', color: '#fff', fontSize: 12.5, fontWeight: 700,
            }}
          >
            Register or assign
          </button>
        </div>
        {registering && (
          <UnregisteredDriverDialog
            code={unregistered}
            vehicleName={v.master?.plateNo || v.name}
            bgId={profile.linked ? profile.bgId : ''}
            onClose={() => setRegistering(false)}
          />
        )}
      </>
    )
  }

  if (!driver && !hasDriver(v.master)) {
    return (
      <div style={{ padding: '28px 4px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text1)', marginBottom: 8 }}>
          No Driver Assigned
        </div>
        <div style={{ fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.7, maxWidth: 420, margin: '0 auto' }}>
          Assign a driver to this vehicle under Settings &gt; Driver.
        </div>
      </div>
    )
  }

  const expiry = driver ? licenceExpiryState(driver.licenseExpiry) : null

  return (
    <>
      {driver ? (
        <Section title="Driver" caption={found.viaTag ? `identified by iButton ${v.ibutton}` : 'from Settings > Driver'}>
          <Grid>
            <Field label="Name"       value={driver.name} />
            {/* The Driver ID always shows with the driver (client, 2026-11-09). */}
            <Field label="Driver ID"  value={(found.viaTag ? ibuttonKey(v.ibutton) : ibuttonKey(driver.ibuttonCode)) || null} />
            <Field label="Mobile"     value={telLink(driver.mobile)} />
            <Field label="Licence No" value={driver.licenseNo} />
            <Field
              label="Licence Expiry"
              value={expiry.state === 'none' ? null : `${formatExpiryDate(driver.licenseExpiry)} · ${expiry.label}`}
              color={EXPIRY_COLOR[expiry.state]}
            />
            <Field label="Status"     value={driver.status} />
          </Grid>
          {driver.notes && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--c-text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {driver.notes}
            </div>
          )}
        </Section>
      ) : (
        <Section title="Driver" caption="from the device's Flespi metadata">
          <Grid>
            <Field label="Name"           value={d.name} />
            <Field label="Mobile"         value={telLink(d.mobile)} />
            <Field label="Nationality"    value={d.nationality} />
            <Field label="License Expiry" value={d.licenseExpiry} />
          </Grid>
        </Section>
      )}
      <Section title="Vehicles Driven Today" caption={driver ? 'from today’s trips' : undefined}>
        {driver
          ? <VehiclesDrivenToday driver={driver} />
          : <Pending note="Add this driver under Settings > Driver to see the vehicles they drove today." />}
      </Section>
    </>
  )
}

function Usage({ v }) {
  const { loading, error, status, usage } = useVehicleUsage(v.id)

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

/** "12 min ago" / "3 h ago" for a reading's time in seconds; '' when unknown. */
function sinceLabel(ts) {
  if (!ts) return 'earlier today'
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  return s < 48 * 3600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`
}

function Sensors({ v }) {
  const { loading, error, status, messages } = useVehicleUsage(v.id)
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
            {fuel.currentLevel == null && fuel.lastLevel != null
              ? <Field label="Last Fuel Level" value={`${fuel.lastLevel.toFixed(0)}% · ${sinceLabel(fuel.lastLevelAt)}`} />
              : <Field label="Current Fuel Level" value={fuel.currentLevel != null ? `${fuel.currentLevel.toFixed(0)}%` : null} />}
            <Field label="Fuel Consumed Today" value={fuel.consumedToday != null ? `${fuel.consumedToday.toFixed(1)} L` : null} />
            <Field label="Fuel Filling Events" value={fuel.fillEvents} />
            <Field label="Fuel Theft Events" value={fuel.theftEvents} color={fuel.theftEvents ? '#ef4444' : undefined} />
          </Grid>
        </Section>
      )}

      {temperature && (
        <Section title="Temperature Monitoring">
          <Grid>
            {temperature.current == null && temperature.last != null
              ? <Field label="Last Temperature" value={`${temperature.last.toFixed(1)}°C · ${sinceLabel(temperature.lastAt)}`} />
              : <Field label="Current Temperature" value={temperature.current != null ? `${temperature.current.toFixed(1)}°C` : null} />}
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
  const { loading, error, status, messages } = useVehicleUsage(v.id)
  const [thresholds, setThresholds] = useState(() => getThresholds(v.id))
  const [severityFilter, setSeverityFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('all')
  const [gearOpen, setGearOpen] = useState(false)

  useEffect(() => { setThresholds(getThresholds(v.id)) }, [v.id])

  const profile = useSettingsProfile(v.ident)
  const { docs } = useVehicleDocuments(profile.linked ? profile.vehicle?.id : null)
  const alerts = useMemo(() => computeAlerts(messages, v, thresholds, docs ?? []), [messages, v, thresholds, docs])
  const navigate = useNavigate()
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
      {/* A rule for this vehicle only, made in Settings > Alerts with it ticked. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: profile.linked ? 'var(--c-text3)' : '#d97706' }}>
          {profile.linked
            ? 'Get notified about this vehicle by email or in-app.'
            : 'This tracker is not registered in Object yet, so it has no Business Group for an alert. Register it first.'}
        </span>
        <button
          type="button"
          onClick={() => navigate(profile.linked ? `/settings/alerts?imei=${encodeURIComponent(v.ident)}` : '/settings/vehicle')}
          style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
            border: profile.linked ? 'none' : '1px solid var(--ft-accent)',
            background: profile.linked ? 'var(--ft-accent)' : 'transparent',
            color: profile.linked ? '#fff' : 'var(--ft-accent)',
          }}
        >
          {profile.linked ? '+ Create alert for this vehicle' : 'Register in Object →'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SEVERITY_FILTERS.map(s => {
            const active = severityFilter === s
            const color = s === 'All' ? 'var(--ft-accent)' : SEVERITY[s].color
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

// Every parameter the tracker last reported, straight from Flespi's telemetry
// (the server proxy forwards `telemetry/all`; our own copy only keeps the few
// fields the app reads). Housekeeping keys of Flespi's own are left out.
const PARAM_REFRESH_MS = 15_000
const HIDDEN_PARAMS = new Set([
  'channel.id', 'codec.id', 'device.id', 'device.type.id', 'peer', 'protocol.id', 'server.timestamp',
])

function fmtParamValue(key, value) {
  if (typeof value === 'boolean') return { text: value ? 'True' : 'False', color: value ? '#22c55e' : 'var(--c-text3)' }
  if (typeof value === 'number') {
    if (key === 'timestamp' || key.endsWith('.timestamp')) return { text: fmtTs(value) }
    return { text: Number.isInteger(value) ? String(value) : String(+value.toFixed(4)) }
  }
  if (value === null || value === undefined) return { text: '—' }
  if (typeof value === 'object') return { text: JSON.stringify(value) }
  return { text: String(value) }
}

function fmtAge(ts, now) {
  if (!ts) return ''
  const s = Math.max(0, Math.round(now / 1000 - ts))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * The iButton row of the Live Data tab: the driver the tag belongs to, or a
 * picker that gives the tag to one of the drivers on file (Settings > Driver
 * stores it; from then on the Live Map and reports show that name).
 */
function IbuttonCell({ code, text }) {
  const drivers = useDrivers()
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const key = ibuttonKey(code)
  const owner = key ? driverForIbutton(key) : null
  // `drivers` keeps owner fresh after an assignment.
  void drivers

  if (!key) return <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text3)' }}>{text} (no tag)</span>
  if (owner && !picking) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)' }}>{owner.name}</span>
        <span style={{ fontSize: 10.5, color: 'var(--c-text3)', fontFamily: 'ui-monospace, monospace' }}>{key}</span>
      </span>
    )
  }
  if (!picking) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text1)', fontFamily: 'ui-monospace, monospace' }}>{text}</span>
        <button
          type="button"
          onClick={() => { setErr(null); setPicking(true) }}
          style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid var(--ft-accent)', background: 'transparent', color: 'var(--ft-accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >
          Assign to driver
        </button>
      </span>
    )
  }
  const choices = drivers.filter(d => !ibuttonKey(d.ibuttonCode) || ibuttonKey(d.ibuttonCode) === key)
  const assign = async id => {
    if (!id) return
    const d = drivers.find(x => x.id === id)
    setBusy(true)
    setErr(null)
    try {
      await updateDriver(id, { ...d, ibuttonCode: key })
      setPicking(false)
    } catch (e) {
      setErr(e?.message || 'Could not assign the tag')
    } finally {
      setBusy(false)
    }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
      <select
        autoFocus
        disabled={busy}
        defaultValue=""
        onChange={e => assign(e.target.value)}
        style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-card)', color: 'var(--c-text1)', maxWidth: 200 }}
      >
        <option value="">{choices.length ? 'Choose the driver…' : 'No drivers without a tag'}</option>
        {choices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button type="button" onClick={() => setPicking(false)} style={{ border: 'none', background: 'none', color: 'var(--c-text3)', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
      {err && <span style={{ fontSize: 10.5, color: '#ef4444' }}>{err}</span>}
    </span>
  )
}

function Parameters({ v }) {
  const [state, setState] = useState({ loading: true, error: null, params: null, at: null })
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    let timer = null
    const ctrl = new AbortController()
    setState({ loading: true, error: null, params: null, at: null })

    async function load() {
      try {
        const res = await fetch(`${BASE_URL}/gw/devices/${v.id}/telemetry/all`, { headers: HEADERS, signal: ctrl.signal })
        if (!res.ok) throw new Error(res.status === 429 ? 'Rate limit — retrying shortly' : `HTTP ${res.status}`)
        const telemetry = (await res.json()).result?.[0]?.telemetry ?? {}
        const params = Object.entries(telemetry)
          .filter(([k]) => !HIDDEN_PARAMS.has(k))
          .map(([key, p]) => ({ key, value: p?.value, ts: p?.ts }))
          .sort((a, b) => a.key.localeCompare(b.key))
        if (alive) setState({ loading: false, error: null, params, at: Date.now() })
      } catch (e) {
        if (alive && e.name !== 'AbortError') setState(s => ({ ...s, loading: false, error: e.message }))
      }
      if (alive) timer = setTimeout(load, PARAM_REFRESH_MS)
    }
    load()
    return () => { alive = false; ctrl.abort(); clearTimeout(timer) }
  }, [v.id])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map = new Map()
    for (const p of state.params ?? []) {
      if (q && !p.key.toLowerCase().includes(q) && !String(p.value).toLowerCase().includes(q)) continue
      const g = p.key.split('.')[0]
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(p)
    }
    return [...map.entries()]
  }, [state.params, query])

  if (state.loading) {
    return (
      <div style={{ padding: '28px 4px', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: 'var(--c-text3)' }}>
        Loading parameters…
      </div>
    )
  }
  if (!state.params) return <Pending note={`Could not load parameters: ${state.error}`} />

  const shown = groups.reduce((n, [, list]) => n + list.length, 0)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search parameters…"
          style={{
            flex: '1 1 200px', minWidth: 0, padding: '7px 10px', fontSize: 12.5, borderRadius: 8,
            border: '1px solid var(--c-border2)', backgroundColor: 'var(--c-card)', color: 'var(--c-text1)', outline: 'none',
          }}
        />
        <span style={{ fontSize: 11, color: state.error ? '#eab308' : 'var(--c-text3)' }}>
          {query ? `${shown} of ${state.params.length}` : state.params.length} parameters
          {' · '}{state.error || `updated ${new Date(state.at).toLocaleTimeString()}`}
        </span>
      </div>

      {groups.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>
          {state.params.length ? 'No parameter matches the search.' : 'This tracker has not reported any parameters yet.'}
        </div>
      )}

      {groups.map(([group, list]) => (
        <Section key={group} title={`${group.charAt(0).toUpperCase()}${group.slice(1)} (${list.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {list.map(p => {
              const { text, color } = fmtParamValue(p.key, p.value)
              return (
                <div key={p.key} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) auto',
                  gap: 12, alignItems: 'baseline', padding: '6px 2px', borderBottom: '1px solid var(--c-border)',
                }}>
                  <span title={p.key} style={{ fontSize: 12, color: 'var(--c-text2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.key}
                  </span>
                  {p.key === 'ibutton.code' ? <IbuttonCell code={p.value} text={text} /> : (
                    <span title={text} style={{ fontSize: 12.5, fontWeight: 600, color: color || 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {text}
                    </span>
                  )}
                  <span style={{ fontSize: 10.5, color: 'var(--c-text3)', whiteSpace: 'nowrap' }} title={p.ts ? fmtTs(p.ts) : undefined}>
                    {fmtAge(p.ts, state.at)}
                  </span>
                </div>
              )
            })}
          </div>
        </Section>
      ))}
    </>
  )
}

// ── Panel ──────────────────────────────────────────────────────────────────

// Size controls. Stroke glyphs at 13px to sit level with the 12px tab labels.
function SizeIcon({ name }) {
  const paths = {
    minimize: <line x1="5.5" y1="12" x2="18.5" y2="12" />,
    expandUp: <polyline points="18 15 12 9 6 15" />,
    maximize: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
    restore:  <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />,
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

/**
 * The one edit affordance for the whole asset, replacing the old Edit Asset
 * entry in the vehicle's 3-dot menu. It sits with the size controls because
 * that is the panel's own toolbar, but it is labelled rather than icon-only —
 * the size buttons change how the panel looks, this one changes the vehicle.
 *
 * It covers assigning as well as editing: the Console opens into its
 * create-and-link form when the device has no Settings record yet, so an
 * unmatched vehicle needs no call-to-action of its own further down the tab.
 */
function ConsoleButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Open the vehicle Parameters to edit or assign this asset"
      aria-label="Open vehicle Parameters"
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        height: 26, padding: '0 9px', borderRadius: 7,
        background: 'none', border: '1px solid var(--c-border2)',
        color: 'var(--c-text2)', cursor: 'pointer',
        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background   = 'color-mix(in srgb, var(--ft-accent) 10%, transparent)'
        e.currentTarget.style.color        = 'var(--ft-accent)'
        e.currentTarget.style.borderColor  = 'var(--ft-accent)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background  = 'none'
        e.currentTarget.style.color       = 'var(--c-text2)'
        e.currentTarget.style.borderColor = 'var(--c-border2)'
      }}
    >
      <PencilIcon />
      {/* Client 2026-11-06: "Console" is called Parameters. */}
      Parameters
    </button>
  )
}

function SizeButton({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 7,
        background: 'none', border: '1px solid var(--c-border2)',
        color: 'var(--c-text2)', cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--c-hover)'; e.currentTarget.style.color = 'var(--c-text1)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none';           e.currentTarget.style.color = 'var(--c-text2)' }}
    >
      <SizeIcon name={icon} />
    </button>
  )
}

/**
 * The sheet is only mounted while a vehicle is selected, so there is no empty
 * state to render any more — Tracking.jsx slides the whole sheet away instead.
 *
 * @param {'normal'|'min'|'max'} [mode]  Which size the sheet is currently at.
 *        Owned by Tracking, which is the component that can actually resize it;
 *        this one only draws the controls and reports the intent back.
 * @param {() => void} [onToggleMin]
 * @param {() => void} [onToggleMax]  Omitted on mobile, where the sheet has no
 *        maximised state to go to.
 * @param {() => void} [onRestore]    Fired when a tab is clicked while
 *        minimised — picking a tab you cannot see would be dead UI.
 * @param {() => void} [onOpenConsole]  Opens the vehicle Console. Owned by
 *        Tracking, which holds the dialog.
 */
export default function VehicleDetailPanel({
  vehicle, mode = 'normal', onToggleMin, onToggleMax, onRestore, onOpenConsole, onOpenInfo,
}) {
  const [tab, setTab] = useState(DETAIL_TABS[0])

  if (!vehicle) return null

  const minimized = mode === 'min'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      backgroundColor: 'var(--c-card)', borderTop: '1px solid var(--c-border2)',
    }}>
      {/* Tab bar — stays visible at every size; it is the whole of the sheet
          while minimised. */}
      <div style={{
        display: 'flex', alignItems: 'center', flexShrink: 0,
        borderBottom: '1px solid var(--c-border2)',
      }}>
        <div style={{ display: 'flex', flex: 1, minWidth: 0, overflowX: 'auto' }}>
          {DETAIL_TABS.map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); if (minimized) onRestore?.() }}
              style={{
                padding: '11px 16px',
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                background: 'none',
                border: 'none',
                borderBottom: tab === t && !minimized ? '2px solid var(--ft-accent)' : '2px solid transparent',
                color: tab === t ? 'var(--ft-accent)' : 'var(--c-text2)',
                cursor: 'pointer',
                transition: 'color 0.15s',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {(onOpenConsole || onToggleMin || onToggleMax) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, padding: '0 10px 0 8px' }}>
            {onOpenConsole && <ConsoleButton onClick={onOpenConsole} />}
            {onToggleMin && (
              <SizeButton
                icon={minimized ? 'expandUp' : 'minimize'}
                label={minimized ? 'Restore panel' : 'Minimize panel'}
                onClick={onToggleMin}
              />
            )}
            {onToggleMax && (
              <SizeButton
                icon={mode === 'max' ? 'restore' : 'maximize'}
                label={mode === 'max' ? 'Restore panel' : 'Maximize panel'}
                onClick={onToggleMax}
              />
            )}
          </div>
        )}
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

        {tab === 'Vehicle Info' && <VehicleInfo v={vehicle} onOpenInfo={onOpenInfo} onOpenConsole={onOpenConsole} />}
        {tab === 'Driver Info'  && <DriverInfo  v={vehicle} />}
        {tab === 'Usage'        && <Usage       v={vehicle} />}
        {tab === 'Sensors'      && <Sensors     v={vehicle} />}
        {tab === 'Alerts'       && <Alerts     v={vehicle} />}
        {tab === 'Documents'    && <VehicleDocumentsTab v={vehicle} />}
        {tab === 'Live Data'    && <Parameters  key={vehicle.id} v={vehicle} />}
        {tab === 'Parameters'   && <DeviceSettingsTab key={vehicle.id} v={vehicle} />}
      </div>
    </div>
  )
}
