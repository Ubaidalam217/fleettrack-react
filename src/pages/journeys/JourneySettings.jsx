import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, User, Bell, Smartphone, Globe, Send, ShieldCheck, Check, Clock } from 'lucide-react'
import JourneyShell from './JourneyShell'
import { Toggle, ErrorNote } from '../../components/journeys/JourneyBits'
import { getJourneySettings, saveJourneySettings, journeyOptions, duration } from '../../data/journeys'
import { errorMessage } from '../../data/http'

/**
 * Journey Settings (design §A.3, mockup journey-settings-simple + the voice
 * note of 2026-11-17): the limits, the on-time tolerance and planned speed,
 * which of the six arrival/departure events alert, who is told and how.
 * Per Business Group. WhatsApp shows "Setup needed" until the client's
 * account exists (server lib/whatsapp.js).
 */

const LIMITS = [
  ['lateDepartureMin', 'Not departed', 'The vehicle has not left this long after the planned time', 'min'],
  ['lateArrivalMin', 'Running late', 'It will arrive this much later than planned (status Delayed)', 'min'],
  ['unplannedStopMin', 'Unplanned stop', 'It stands still away from every planned stop for longer than', 'min'],
  ['noSignalMin', 'No signal', 'The tracker has sent nothing for', 'min'],
]
const STOPS = [
  ['arriveAfterMin', 'Stop reached after', 'Time inside a stop before it counts as arrived', 'min'],
  ['departAfterSec', 'Stop left after', 'Time outside a stop before it counts as left', 's'],
  ['defaultRadiusM', 'Default stop radius', 'Used when a stop is a point with a radius', 'm'],
  ['plannedSpeedKmh', 'Planned speed', 'Leg drive time = leg km ÷ this, unless it came from a past trip', 'km/h'],
]
const EVENTS = [
  ['departEarly', 'Early departure'], ['departOnTime', 'On-time departure'], ['departLate', 'Late departure'],
  ['arriveEarly', 'Early arrival'], ['arriveOnTime', 'On-time arrival'], ['arriveLate', 'Late arrival'],
]

function NumRow({ label, help, unit, value, onChange, disabled, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="j-strong" style={{ fontSize: 14 }}>{label}</div>
        <div className="j-label" style={{ fontSize: 12 }}>{help}</div>
      </div>
      {children}
      <input className="j-input j-input--num" type="number" value={value} disabled={disabled} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} aria-label={label} />
      <span className="j-label" style={{ width: 34 }}>{unit}</span>
    </div>
  )
}

export default function JourneySettings(props) {
  const [bgs, setBgs] = useState([])
  const [bgId, setBgId] = useState(null)
  const [data, setData] = useState(null)
  const [v, setV] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    journeyOptions().then(o => { setBgs(o.bgs); setBgId(b => b ?? o.bgId) }).catch(() => {})
  }, [])
  useEffect(() => {
    getJourneySettings(bgId ? { bgId } : {}).then(d => { setData(d); setV(d.value) }).catch(e => setError(errorMessage(e, 'Could not load the settings')))
  }, [bgId])

  const set = (k, val) => { setSaved(false); setV(x => ({ ...x, [k]: val })) }
  const setIn = (group, k, val) => { setSaved(false); setV(x => ({ ...x, [group]: { ...x[group], [k]: val } })) }
  const ro = !data?.canEdit

  async function save(value = v) {
    setBusy(true)
    setError(null)
    try {
      const r = await saveJourneySettings({ bgId: data.bgId, value })
      setV(r.value)
      setSaved(true)
    } catch (e) {
      setError(errorMessage(e, 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <JourneyShell
      {...props}
      crumb="Settings"
      title="Journey settings"
      subtitle="The limits and who gets journey alerts. They apply to every journey of this Business Group."
      actions={v && !ro && (
        <>
          {saved && <span className="j-ok-text" style={{ fontSize: 13 }}><Check size={13} style={{ verticalAlign: -2 }} /> Saved</span>}
          <button type="button" className="j-btn" disabled={busy} onClick={() => { setV(data.defaults); setSaved(false) }}>Reset to defaults</button>
          <button type="button" className="j-btn j-btn--primary" disabled={busy} onClick={() => save()}><Check size={15} /> Save</button>
        </>
      )}
    >
      <ErrorNote error={error} />
      {bgs.length > 1 && (
        <label className="j-field" style={{ maxWidth: 360, marginBottom: 14 }}>
          <span>Business Group</span>
          <select className="j-select" value={bgId ?? ''} onChange={e => setBgId(e.target.value)}>{bgs.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
      )}
      {ro && data && <div className="j-card" style={{ marginBottom: 14, padding: '10px 14px', fontSize: 13 }}>Read only: changing these needs Journey settings = Edit.</div>}
      {!v ? <div className="j-skel" style={{ height: 420 }} /> : (
        <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', alignItems: 'start' }}>
          <div className="j-grid">
            <div className="j-card" style={{ padding: 22 }}>
              <div className="j-card-head"><AlertTriangle size={18} /><h2 className="j-card-title" style={{ fontSize: 17 }}>Alert me when</h2></div>
              {LIMITS.map(([k, l, h, u]) => <NumRow key={k} label={l} help={h} unit={u} value={v[k]} disabled={ro} onChange={x => set(k, x)} />)}
              <NumRow label="Off route" help="It is further than this from the planned road" unit="min" value={v.offRouteMin} disabled={ro} onChange={x => set('offRouteMin', x)}>
                <input className="j-input j-input--num" type="number" step="0.5" value={v.offRouteKm} disabled={ro} onChange={e => set('offRouteKm', Number(e.target.value))} aria-label="Off route km" />
                <span className="j-label">km for</span>
              </NumRow>
              <div className="j-caps" style={{ marginTop: 16 }}>Stops</div>
              {STOPS.map(([k, l, h, u]) => <NumRow key={k} label={l} help={h} unit={u} value={v[k]} disabled={ro} onChange={x => set(k, x)} />)}
            </div>

            <div className="j-card" style={{ padding: 22 }}>
              <div className="j-card-head"><Clock size={18} /><h2 className="j-card-title" style={{ fontSize: 17 }}>Departures and arrivals</h2></div>
              <NumRow label="On time means within" help="Earlier is early, later is late — for the start, every stop and the destination" unit="± min" value={v.onTimeMin} disabled={ro} onChange={x => set('onTimeMin', x)} />
              <div className="j-label" style={{ margin: '12px 0 6px' }}>Raise an alert (bell, Notifications, mobile app) for — every event is always shown on the journey:</div>
              <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 4 }}>
                {EVENTS.map(([k, l]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0' }}>
                    <span style={{ fontSize: 13.5 }}>{l}</span>
                    <Toggle label={l} checked={v.eventAlerts[k]} disabled={ro} onChange={x => setIn('eventAlerts', k, x)} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 0 0', borderTop: '1px solid rgba(255,255,255,.06)', marginTop: 8 }}>
                <div><div className="j-strong" style={{ fontSize: 14 }}>Also at the stops in between</div><div className="j-label">Off: only the start and the destination alert</div></div>
                <Toggle label="Also at stops" checked={v.eventAlerts.atStops} disabled={ro} onChange={x => setIn('eventAlerts', 'atStops', x)} />
              </div>
            </div>
          </div>

          <div className="j-grid">
            <div className="j-card" style={{ padding: 22 }}>
              <div className="j-card-head"><User size={18} /><h2 className="j-card-title" style={{ fontSize: 17 }}>Who gets journey alerts</h2></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <span className="j-badge">1</span>
                <div style={{ flex: 1 }}><div className="j-strong">First</div><div className="j-label">The person who created the journey, and the HSE approver</div></div>
                <Toggle label="Creator and approver" checked={v.recipients.creatorAndApprover} disabled={ro} onChange={x => setIn('recipients', 'creatorAndApprover', x)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span className="j-badge">2</span>
                <div style={{ flex: 1 }}>
                  <div className="j-strong" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    Then, if nobody opens it in
                    <input className="j-input j-input--sm j-input--num" type="number" value={v.recipients.bgAdminsAfterMin} disabled={ro} onChange={e => setIn('recipients', 'bgAdminsAfterMin', Number(e.target.value))} aria-label="Minutes before the BG admins are told" /> min
                  </div>
                  <div className="j-label">The Business Group admins</div>
                </div>
                <Toggle label="BG admins" checked={v.recipients.bgAdmins} disabled={ro} onChange={x => setIn('recipients', 'bgAdmins', x)} />
              </div>
            </div>

            <div className="j-card" style={{ padding: 22 }}>
              <div className="j-card-head"><Bell size={18} /><h2 className="j-card-title" style={{ fontSize: 17 }}>How alerts are sent</h2></div>
              {[
                ['push', Smartphone, 'Mobile app', 'Push notification on the FleetmaxX app'],
                ['web', Globe, 'Web app', 'The bell and the Notifications page'],
              ].map(([k, Icon, l, h]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: k === 'web' ? '1px solid rgba(255,255,255,.06)' : 'none' }}>
                  <span className="j-iconbtn" style={{ pointerEvents: 'none' }}><Icon size={16} /></span>
                  <div style={{ flex: 1 }}><div className="j-strong">{l}</div><div className="j-label">{h}</div></div>
                  <Toggle label={l} checked={v.channels[k]} disabled={ro} onChange={x => setIn('channels', k, x)} />
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span className="j-iconbtn" style={{ pointerEvents: 'none' }}><Send size={16} /></span>
                <div style={{ flex: 1 }}>
                  <div className="j-strong" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>WhatsApp {!data.whatsappConfigured && <span className="j-pill" data-tone="warn">Setup needed</span>}</div>
                  <div className="j-label">Needs a WhatsApp Business account from you. Each message has a small charge from Meta.</div>
                </div>
                <Toggle label="WhatsApp" checked={v.channels.whatsapp} disabled={ro || !data.whatsappConfigured} onChange={x => setIn('channels', 'whatsapp', x)} />
              </div>
            </div>

            <div className="j-card" style={{ padding: 22 }}>
              <div className="j-card-head"><ShieldCheck size={18} /><h2 className="j-card-title" style={{ fontSize: 17 }}>Set by HSE</h2></div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div className="j-strong">Driving hours and rest</div>
                <Toggle label="HSE break alerts" checked={v.hseBreaks} disabled={ro} onChange={x => set('hseBreaks', x)} />
              </div>
              <p className="j-label" style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--j-text2)' }}>
                First drive up to {duration(data.hse.firstDriveMin)}, then a {data.hse.breakMin} min break every {duration(data.hse.driveMin)}. At most {duration(data.hse.dailyMaxMin)} of driving a day. Journeys alert when a break is due.
              </p>
              <Link to="/reports/driver-performance" className="j-label" style={{ textDecoration: 'underline' }}>Change in the Driver Performance report › HSE driving rules</Link>
              <div className="j-strong" style={{ marginTop: 16 }}>Night driving and speed limits</div>
              <p className="j-label" style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--j-text2)' }}>Set on the tracking devices by HSE. Journeys show the violations the devices and the alert rules already report.</p>
            </div>
          </div>
        </div>
      )}
    </JourneyShell>
  )
}
