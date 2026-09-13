import { useState, useMemo } from 'react'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { hasDriver, SENSOR_KEYS } from '../../services/vehicleMaster'
import { listDocuments, expiryState, daysUntilExpiry, isReadOnly } from '../../services/documentStore'
import ReplayPanel from './ReplayPanel'

const DETAIL_TABS = [
  'Vehicle Info',
  'Driver Info',
  'Usage',
  'Replay',
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

// ── Tabs ───────────────────────────────────────────────────────────────────

function VehicleInfo({ v }) {
  const m = v.master
  const docs = useMemo(() => listDocuments(v.id), [v.id])

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
            value={v.lat != null && v.lng != null ? `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}` : null}
          />
          <Field label="Speed"       value={v.speed != null ? `${v.speed} km/h` : null} />
          <Field label="Last Update" value={fmtTs(v.lastTs)} />
        </Grid>
        <div style={{ marginTop: 12 }}>
          <Pending note="Street address needs reverse geocoding; odometer and today's max/avg speed come from Flespi message history — both land in Phase 2." />
        </div>
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

function Usage() {
  return (
    <Pending note="Total Odometer, Distance Today, Running/Idle/Stop Time and Trip Count are all derivable from Flespi's gw/devices/{id}/messages history. This is Phase 1 — the next thing to be built." />
  )
}

function Sensors({ v }) {
  const configured = SENSOR_KEYS.filter(k => v.master.sensors[k])

  if (configured.length === 0) {
    return (
      <Pending note="No sensors are configured for this vehicle. The spec shows sensor blocks only when configured, and that flag lives in the vehicle master — set it once the Edit Vehicle form exists (Phase 3)." />
    )
  }

  return (
    <Section title="Configured Sensors">
      <Grid>
        {configured.map(k => (
          <Field key={k} label={k} value="awaiting live values" />
        ))}
      </Grid>
      <div style={{ marginTop: 12 }}>
        <Pending note="Sensor values come from device telemetry keys (fuel.level, external.temperature.*, and so on). Reading them is Phase 3." />
      </div>
    </Section>
  )
}

function Alerts() {
  return (
    <Pending note="Five rules already run live against this fleet — overspeed, GPS lost, off-hours engine, high idle and long stop — but they currently surface only in the notification bell. Routing them here with location and severity, plus the harsh-driving and fuel rules, is Phase 4." />
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
                    color: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)',
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

export default function VehicleDetailPanel({ vehicle, replay }) {
  const [tab, setTab] = useState(DETAIL_TABS[0])

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
            disabled={!vehicle}
            style={{
              padding: '11px 16px',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
              color: !vehicle ? 'var(--c-text3)' : tab === t ? '#3b82f6' : 'var(--c-text2)',
              cursor: vehicle ? 'pointer' : 'default',
              opacity: vehicle ? 1 : 0.5,
              transition: 'color 0.15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', minHeight: 0 }}>
        {!vehicle ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--c-text3)', fontSize: 13, textAlign: 'center', padding: 20,
          }}>
            Select a vehicle to view its details.
          </div>
        ) : (
          <>
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
            {tab === 'Usage'        && <Usage />}
            {tab === 'Replay'       && <ReplayPanel vehicleId={vehicle.id} replay={replay} />}
            {tab === 'Sensors'      && <Sensors     v={vehicle} />}
            {tab === 'Alerts'       && <Alerts />}
            {tab === 'Documents'    && <Documents   v={vehicle} />}
          </>
        )}
      </div>
    </div>
  )
}
