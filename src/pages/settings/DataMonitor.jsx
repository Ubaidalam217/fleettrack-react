import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, CircleCheck, OctagonAlert, RefreshCw, Server, User, ChevronDown, ChevronRight,
  Save, RotateCcw, Gauge, Info, HardDrive, Repeat,
} from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import { PRIMARY_BTN, SECONDARY_BTN } from './formStyles'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import { IS_REAL } from '../../data/mode'
import { useSession } from '../../data/session'
import { ApiError } from '../../data/http'
import { fetchMonitorDevices, fetchMonitorRequests, fetchMonitorSettings, saveMonitorSettings } from '../../data/dataMonitor'
import {
  fmtBytes, fmtInterval, fmtCount, fmtPct, fmtAgo, statusOf, CAUSE_LABEL, meter, sparkPoints, deviceTitle,
  ROLE_LABEL, SETTING_GROUPS, SETTING_TOGGLES, changedSettings,
} from '../../utils/dataMonitor'

/**
 * Settings › Device Data Monitor (client, 2026-11-16: "If any device sends a
 * lot of data it should report to the app and take some action", and see which
 * device or source makes a lot of requests). Super Admin only.
 *
 *   Devices          every tracker's last hour and day as the webhook received
 *                    it, its status, and — when it is not normal — the likely
 *                    cause and the fix to recommend. Nothing is sent to a device.
 *   Flespi requests  FleetmaxX's own calls to Flespi against the plan's
 *                    per-minute limits, and who / what / which device made them.
 *   Thresholds       the rules' numbers and the three switches.
 *
 * The server does the counting and the alerting (server/src/lib/dataMonitor.js);
 * an overload also rings the bell, as "Device data overload" / "Flespi request
 * overload".
 */

const POLL_MS = 30_000

const TONE = {
  good:     { color: '#16a34a', icon: CircleCheck },
  warning:  { color: '#d97706', icon: AlertTriangle },
  critical: { color: '#dc2626', icon: OctagonAlert },
}

const CSS = `
.dm{margin-top:16px;display:flex;flex-direction:column;gap:14px}
.dm-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dm-tabs{display:inline-flex;padding:3px;border-radius:11px;background:var(--c-card);border:1px solid var(--c-border2)}
.dm-tab{border:0;background:transparent;color:var(--c-text2);font-size:12.5px;font-weight:700;padding:7px 14px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.dm-tab:hover{color:var(--c-text1)}
.dm-tab[aria-selected="true"]{background:color-mix(in srgb,var(--ft-accent) 14%,transparent);color:var(--ft-accent)}
.dm-badge{font-size:10.5px;font-weight:800;min-width:18px;height:18px;padding:0 5px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;color:#fff;background:#dc2626}
.dm-upd{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--c-text3)}
.dm-ibtn{height:32px;padding:0 11px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text2);font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.dm-ibtn:hover{background:var(--c-hover);color:var(--c-text1)}
.dm-card{background:var(--c-card);border:1px solid var(--c-border2);border-radius:var(--ft-radius,14px);box-shadow:var(--ft-shadow)}
.dm-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.dm-kpi{padding:14px 16px;display:flex;flex-direction:column;gap:4px;min-width:0}
.dm-kpi-l{font-size:10.5px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text3);display:flex;align-items:center;gap:6px}
.dm-kpi-v{font-size:24px;font-weight:800;color:var(--c-text1);font-variant-numeric:tabular-nums;line-height:1.1}
.dm-kpi-s{font-size:11.5px;color:var(--c-text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-sec{padding:14px 16px 6px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dm-sec h2{margin:0;font-size:14px;font-weight:800;color:var(--c-text1)}
.dm-sec p{margin:0;font-size:11.5px;color:var(--c-text3)}
.dm-scroll{overflow-x:auto}
.dm-t{width:100%;border-collapse:collapse;font-size:12.5px}
.dm-t th{font-size:10px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text3);text-align:left;padding:8px 10px;border-bottom:1px solid var(--c-border);white-space:nowrap;background:var(--c-card2,var(--c-card))}
.dm-t th.n,.dm-t td.n{text-align:right;font-variant-numeric:tabular-nums}
.dm-t td{padding:10px;border-bottom:1px solid var(--c-border);color:var(--c-text1);vertical-align:middle;white-space:nowrap}
.dm-t tr.dm-row{cursor:pointer}
.dm-t tr.dm-row:hover td{background:var(--c-hover)}
.dm-t tr.dm-row:focus-visible{outline:2px solid var(--ft-accent);outline-offset:-2px}
.dm-sub{font-size:11px;color:var(--c-text3);margin-top:2px}
.dm-name{font-weight:750;display:flex;align-items:center;gap:6px}
.dm-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:750;padding:3px 9px;border-radius:999px;white-space:nowrap}
.dm-cause{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:6px;margin:3px 4px 0 0;color:var(--c-text2);background:color-mix(in srgb,var(--c-text3) 12%,transparent)}
.dm-rec td{white-space:normal;padding-top:0;background:transparent}
.dm-recbox{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;font-size:12.5px;line-height:1.5;color:var(--c-text1)}
.dm-det{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 18px;padding:4px 2px 4px}
.dm-det dt{font-size:10px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text3)}
.dm-det dd{margin:2px 0 0;font-size:12.5px;font-weight:650;color:var(--c-text1)}
.dm-empty{padding:28px 16px;text-align:center;color:var(--c-text3);font-size:12.5px}
.dm-note{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;color:var(--c-text3);line-height:1.5;padding:0 4px}
.dm-meters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.dm-meter{height:8px;border-radius:999px;background:color-mix(in srgb,var(--c-text3) 16%,transparent);overflow:hidden;margin-top:8px;position:relative}
.dm-meter i{display:block;height:100%;border-radius:999px}
.dm-meter b{position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--c-text3);opacity:.55}
.dm-chart{padding:6px 16px 14px}
.dm-bars{position:relative;height:120px;display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid var(--c-border)}
.dm-bars span{flex:1 1 0;min-width:2px;border-radius:3px 3px 0 0;background:var(--ft-accent);opacity:.85}
.dm-bars span:hover{opacity:1;filter:brightness(1.1)}
.dm-bars span.thr{background:#dc2626}
.dm-bars span.zero{background:color-mix(in srgb,var(--c-text3) 25%,transparent);height:1px!important}
.dm-limit{position:absolute;left:0;right:0;border-top:1.5px dashed #dc2626;opacity:.7;pointer-events:none}
.dm-limit em{position:absolute;right:0;top:-16px;font-size:10px;font-style:normal;font-weight:700;color:#dc2626}
.dm-axis{display:flex;justify-content:space-between;font-size:10.5px;color:var(--c-text3);margin-top:4px}
.dm-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
.dm-form{padding:6px 16px 16px;display:flex;flex-direction:column;gap:18px}
.dm-group h3{margin:0;font-size:13px;font-weight:800;color:var(--c-text1)}
.dm-group>p{margin:2px 0 10px;font-size:11.5px;color:var(--c-text3)}
.dm-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.dm-field label{display:block;font-size:11px;font-weight:700;color:var(--c-text2);margin-bottom:4px}
.dm-inp{display:flex;align-items:center;border:1px solid var(--c-border);border-radius:8px;background:var(--c-input);overflow:hidden}
.dm-inp input{width:96px;border:0;background:transparent;color:var(--c-text1);font-size:13px;padding:8px 10px;outline:none;font-variant-numeric:tabular-nums}
.dm-inp span{font-size:11.5px;color:var(--c-text3);padding-right:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-inp.bad{border-color:#ef4444}
.dm-inp:focus-within{border-color:var(--ft-accent)}
.dm-field small{display:block;font-size:10.5px;color:var(--c-text3);margin-top:3px}
.dm-field small.err{color:#ef4444}
.dm-tog{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--c-border)}
.dm-tog:first-of-type{border-top:0}
.dm-switch{position:relative;width:38px;height:22px;border-radius:999px;border:0;cursor:pointer;flex-shrink:0;background:color-mix(in srgb,var(--c-text3) 35%,transparent);transition:background .15s}
.dm-switch[aria-checked="true"]{background:var(--ft-accent)}
.dm-switch::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.dm-switch[aria-checked="true"]::after{transform:translateX(16px)}
.dm-switch:disabled{cursor:not-allowed;opacity:.6}
.dm-tog b{display:block;font-size:12.5px;color:var(--c-text1)}
.dm-tog span{display:block;font-size:11.5px;color:var(--c-text3);margin-top:2px;line-height:1.45}
.dm-actions{display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--c-border)}
.dm-msg{margin-top:16px;max-width:560px;padding:20px;display:flex;gap:14px;align-items:flex-start}
@media (max-width:900px){.dm-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.dm-meters{grid-template-columns:1fr}.dm-grid2{grid-template-columns:1fr}.dm-det{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.dm-upd{margin-left:0;width:100%}.dm-kpi-v{font-size:20px}}
`

// ── small pieces ─────────────────────────────────────────────────────────────

function StatusChip({ status }) {
  const s = statusOf(status)
  const t = TONE[s.tone]
  const Icon = t.icon
  return (
    <span className="dm-chip" title={s.hint} style={{ color: t.color, background: `color-mix(in srgb, ${t.color} 13%, transparent)`, border: `1px solid color-mix(in srgb, ${t.color} 30%, transparent)` }}>
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" />{s.label}
    </span>
  )
}

function Sparkline({ values, label }) {
  const W = 96, H = 26
  const points = sparkPoints(values, W, H)
  const max = Math.max(0, ...(values ?? []))
  if (!points) return <span className="dm-sub">—</span>
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{`${label}: busiest hour ${fmtCount(max)} messages`}</title>
      <polygon points={`0,${H} ${points} ${W},${H}`} fill="color-mix(in srgb, var(--ft-accent) 14%, transparent)" />
      <polyline points={points} fill="none" stroke="var(--ft-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone }) {
  const color = tone ? TONE[tone].color : 'var(--c-text1)'
  return (
    <div className="dm-card dm-kpi">
      <div className="dm-kpi-l"><Icon size={13} aria-hidden="true" />{label}</div>
      <div className="dm-kpi-v" style={{ color }}>{value}</div>
      {sub && <div className="dm-kpi-s" title={sub}>{sub}</div>}
    </div>
  )
}

/** Fetch now and every POLL_MS while the tab is visible; `reload` on demand. */
function usePolled(fetcher, enabled) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled, at: null })
  const seq = useRef(0)
  const load = useCallback(async () => {
    const my = ++seq.current
    setState(s => ({ ...s, loading: true }))
    try {
      const data = await fetcher()
      if (my === seq.current) setState({ data, error: null, loading: false, at: Date.now() })
    } catch (err) {
      if (my === seq.current) setState(s => ({ ...s, error: err, loading: false }))
    }
  }, [fetcher])
  useEffect(() => {
    if (!enabled) return undefined
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [enabled, load])
  return { ...state, reload: load }
}

const errText = err => (err instanceof ApiError ? err.message : err?.message || 'Could not load')

// ── Devices ──────────────────────────────────────────────────────────────────

function DeviceRow({ d, open, onToggle }) {
  const rec = d.recommendation
  const t = TONE[statusOf(d.status).tone]
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <>
      <tr className="dm-row" tabIndex={0} aria-expanded={open} onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
        <td>
          <div className="dm-name"><Chevron size={14} aria-hidden="true" style={{ color: 'var(--c-text3)' }} />{deviceTitle(d)}</div>
          <div className="dm-sub" style={{ marginLeft: 20 }}>
            {d.vehicle?.bgName ? `${d.vehicle.bgName} · ` : d.vehicle ? '' : 'No vehicle · '}#{d.deviceId}{d.ident ? ` · ${d.ident}` : ''}
          </div>
        </td>
        <td>
          <StatusChip status={d.status} />
          {d.causes?.length > 0 && <div>{d.causes.map(c => <span key={c} className="dm-cause">{CAUSE_LABEL[c] ?? c}</span>)}</div>}
        </td>
        <td className="n">
          {fmtCount(d.lastHour.msgs)}
          <div className="dm-sub">{fmtCount(d.lastHour.perMinuteNow)}/min now</div>
        </td>
        <td className="n">{fmtCount(d.day.msgs)}</td>
        <td className="n">{fmtInterval(d.lastHour.avgIntervalSec ?? d.day.avgIntervalSec)}</td>
        <td className="n">{d.lastHour.msgs ? fmtPct(d.lastHour.duplicatePct) : '—'}</td>
        <td className="n">{fmtBytes(d.day.bytes)}</td>
        <td><Sparkline values={d.spark} label={`${deviceTitle(d)}, messages per hour, last 24 hours`} /></td>
        <td>
          {d.episode
            ? <span style={{ color: t.color, fontWeight: 700 }} title={`Since ${new Date(d.episode.since).toLocaleString()}`}>Now · for {fmtInterval(Math.max(60, (Date.now() - Date.parse(d.episode.since)) / 1000))}</span>
            : fmtAgo(d.lastSpikeAt)}
          {d.spikes > 0 && <div className="dm-sub">{d.spikes} recorded</div>}
        </td>
      </tr>
      {rec && (
        <tr className="dm-rec">
          <td colSpan={9}>
            <div className="dm-recbox" style={{ background: `color-mix(in srgb, ${t.color} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${t.color} 24%, transparent)` }}>
              <Info size={15} aria-hidden="true" style={{ color: t.color, flexShrink: 0, marginTop: 2 }} />
              <div><b>Recommended: </b>{rec.text}</div>
            </div>
          </td>
        </tr>
      )}
      {open && (
        <tr className="dm-rec">
          <td colSpan={9}>
            <dl className="dm-det">
              <div><dt>Usual hour (7-day median)</dt><dd>{d.baselinePerHour === null ? 'Learning (needs a day)' : `${fmtCount(d.baselinePerHour)} msgs`}</dd></div>
              <div><dt>Overload line</dt><dd>{fmtCount(d.thresholdPerHour)} msgs / hour</dd></div>
              <div><dt>Short gaps in a row</dt><dd>{d.lastHour.fastRun} min</dd></div>
              <div><dt>Last message</dt><dd>{fmtAgo(d.lastMessageAt)}</dd></div>
              <div><dt>Sent parked · last hour</dt><dd>{d.lastHour.msgs ? fmtPct((d.lastHour.parked / d.lastHour.msgs) * 100) : '—'}</dd></div>
              <div><dt>Backlog (&gt;10 min old)</dt><dd>{fmtCount(d.lastHour.late)}</dd></div>
              <div><dt>Reconnects · last hour</dt><dd>{fmtCount(d.lastHour.reconnects)}</dd></div>
              <div><dt>Exact copies dropped · 24 h</dt><dd>{fmtCount(d.day.exactDuplicates)}</dd></div>
              <div><dt>Data · last hour</dt><dd>{fmtBytes(d.lastHour.bytes)}</dd></div>
              <div><dt>Repeats · 24 h</dt><dd>{d.day.msgs ? fmtPct(d.day.duplicatePct) : '—'}</dd></div>
              {d.episode && <div><dt>Peak in this overload</dt><dd>{fmtCount(d.episode.peakPerHour)} msgs / hour</dd></div>}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}

function DevicesTab({ q }) {
  const [open, setOpen] = useState(() => new Set())
  const data = q.data
  if (!data) return <div className="dm-card dm-empty">{q.error ? errText(q.error) : 'Loading…'}</div>
  const { totals, devices } = data
  const toggle = id => setOpen(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  return (
    <>
      <div className="dm-kpis">
        <Kpi icon={OctagonAlert} label="Overload now" value={fmtCount(totals.overload)} tone={totals.overload ? 'critical' : undefined} sub={totals.overload ? 'Flagged and notified' : 'No tracker over a threshold'} />
        <Kpi icon={AlertTriangle} label="High" value={fmtCount(totals.high)} tone={totals.high ? 'warning' : undefined} sub="Half way to a threshold" />
        <Kpi icon={Activity} label="Messages · last hour" value={fmtCount(totals.msgsLastHour)} sub={`${fmtBytes(totals.bytesLastHour)} · ${fmtCount(totals.msgsDay)} in 24 h`} />
        <Kpi icon={Repeat} label="Copies dropped · last hour" value={fmtCount(totals.droppedLastHour)} sub={data.settings.dropDuplicates ? 'Exact repeats not stored' : 'Dropping is switched off'} />
      </div>
      <section className="dm-card" aria-labelledby="dm-dev-h">
        <div className="dm-sec">
          <h2 id="dm-dev-h">Trackers</h2>
          <p>{devices.length} tracker{devices.length === 1 ? '' : 's'} · worst first · click a row for details · messages exclude exact copies</p>
        </div>
        {devices.length ? (
          <div className="dm-scroll">
            <table className="dm-t">
              <thead>
                <tr>
                  <th scope="col">Vehicle / tracker</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="n">Msgs · last hour</th>
                  <th scope="col" className="n">Msgs · 24 h</th>
                  <th scope="col" className="n">Avg interval</th>
                  <th scope="col" className="n" title="The tracker sending a timestamp again. Exact copies from a Flespi stream retry are dropped and not counted here.">Repeats</th>
                  <th scope="col" className="n">Data · 24 h</th>
                  <th scope="col">24 h trend</th>
                  <th scope="col">Last overload</th>
                </tr>
              </thead>
              <tbody>
                {devices.map(d => <DeviceRow key={d.deviceId} d={d} open={open.has(d.deviceId)} onToggle={() => toggle(d.deviceId)} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dm-empty">No tracker data yet. Counting starts when the Flespi webhook delivers messages to this server.</div>
        )}
      </section>
      <p className="dm-note"><Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        Counted as the webhook receives each message, since {new Date(data.monitoringSince).toLocaleString()} for the last hour (the 24-hour figures are stored). Data is the size of each message as Flespi delivers it — an estimate, not the SIM’s data use. FleetmaxX never changes a tracker’s settings: a recommended interval needs the client’s approval first.
      </p>
    </>
  )
}

// ── Flespi requests ──────────────────────────────────────────────────────────

function MeterTile({ icon: Icon, label, used, limit, pct, warnPct, shedPct, sub }) {
  const m = meter(pct, warnPct, shedPct)
  const color = TONE[m.tone].color
  return (
    <div className="dm-card dm-kpi">
      <div className="dm-kpi-l"><Icon size={13} aria-hidden="true" />{label}</div>
      <div className="dm-kpi-v">{used}<span style={{ fontSize: 13, fontWeight: 650, color: 'var(--c-text3)' }}> / {limit}</span></div>
      <div className="dm-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`${label}: ${fmtPct(pct)} of the limit`}>
        <i style={{ width: `${m.fill}%`, background: color }} />
        <b style={{ left: `${warnPct}%` }} title={`${warnPct}%: notify and pause history reads`} />
      </div>
      <div className="dm-kpi-s"><span style={{ color, fontWeight: 750 }}>{fmtPct(pct)}</span> {sub}</div>
    </div>
  )
}

function PerMinuteBars({ perMinute, limit, warnPct }) {
  const byAt = new Map((perMinute ?? []).map(p => [Date.parse(p.at), p]))
  const nowMin = Math.floor(Date.now() / 60_000) * 60_000
  const slots = []
  for (let k = 59; k >= 0; k--) {
    const at = nowMin - k * 60_000
    slots.push(byAt.get(at) ?? { at: new Date(at).toISOString(), calls: 0, bytes: 0, throttled: 0, shed: 0, local: 0 })
  }
  const peak = Math.max(0, ...slots.map(s => s.calls))
  // The limit line shows once the busiest minute is at least half way to it.
  const showLimit = peak >= limit * 0.5
  const top = Math.max(showLimit ? limit * 1.05 : peak * 1.15, 1)
  const warnAt = (limit * warnPct) / 100
  return (
    <div className="dm-chart">
      <div className="dm-bars" role="img" aria-label={`Calls to Flespi per minute, last 60 minutes; busiest minute ${peak} calls`}>
        {slots.map(s => {
          const time = new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          const tip = `${time}: ${s.calls} call${s.calls === 1 ? '' : 's'}, ${fmtBytes(s.bytes)}${s.throttled ? `, ${s.throttled} × 429` : ''}${s.shed ? `, ${s.shed} held back` : ''}${s.local ? `, ${s.local} answered locally` : ''}`
          return <span key={s.at} title={tip} className={s.calls ? (s.calls >= warnAt || s.throttled ? 'thr' : '') : 'zero'} style={{ height: `${(s.calls / top) * 100}%` }} />
        })}
        {showLimit && <div className="dm-limit" style={{ bottom: `${(limit / top) * 100}%` }}><em>Limit {limit}/min</em></div>}
      </div>
      <div className="dm-axis"><span>60 min ago</span><span>Busiest minute: {peak} calls{limit ? ` (${fmtPct((peak / limit) * 100)} of the limit)` : ''}</span><span>Now</span></div>
    </div>
  )
}

function SourceCell({ r }) {
  const Icon = r.kind === 'user' ? User : Server
  return (
    <td>
      <div className="dm-name"><Icon size={13} aria-hidden="true" style={{ color: 'var(--c-text3)' }} />{r.label}</div>
      <div className="dm-sub" style={{ marginLeft: 19 }}>{r.kind === 'user' ? (ROLE_LABEL[r.role] ?? 'User') : r.kind === 'job' ? 'Server job' : 'Server'}</div>
    </td>
  )
}

function CountsTable({ title, sub, rows, first, firstHead, showLocal = true }) {
  return (
    <section className="dm-card" aria-label={title}>
      <div className="dm-sec"><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
      {rows.length ? (
        <div className="dm-scroll">
          <table className="dm-t">
            <thead>
              <tr>
                <th scope="col">{firstHead}</th>
                <th scope="col" className="n">Calls</th>
                <th scope="col" className="n">Data</th>
                <th scope="col" className="n">429</th>
                <th scope="col" className="n">Held back</th>
                {showLocal && <th scope="col" className="n">Answered locally</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  {first(r)}
                  <td className="n">{fmtCount(r.calls)}</td>
                  <td className="n">{fmtBytes(r.bytes)}</td>
                  <td className="n" style={r.throttled ? { color: '#dc2626', fontWeight: 750 } : undefined}>{fmtCount(r.throttled)}</td>
                  <td className="n">{fmtCount(r.shed)}</td>
                  {showLocal && <td className="n">{fmtCount(r.local)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="dm-empty">Nothing in this period.</div>}
    </section>
  )
}

function RequestsTab({ q }) {
  const data = q.data
  if (!data) return <div className="dm-card dm-empty">{q.error ? errText(q.error) : 'Loading…'}</div>
  const { limits, now, lastHour } = data
  const mib = now.bytes / 1048576
  const status = now.holdingBack
    ? (now.coolingSec ? `Flespi answered 429 — browser reads held back for ${now.coolingSec} s` : 'Near the limit — browser reads are being held back')
    : null
  return (
    <>
      {status && (
        <div className="dm-card dm-recbox" role="status" style={{ background: 'color-mix(in srgb, #dc2626 8%, var(--c-card))', borderColor: 'color-mix(in srgb, #dc2626 30%, transparent)' }}>
          <OctagonAlert size={16} aria-hidden="true" style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} /><div><b>{status}.</b> The browser retries on its own once usage drops.</div>
        </div>
      )}
      <div className="dm-meters">
        <MeterTile icon={Gauge} label="Calls · last 60 s" used={fmtCount(now.calls)} limit={fmtCount(limits.callsPerMin)} pct={now.pctCalls} warnPct={limits.warnPct} shedPct={limits.shedPct} sub="of the per-minute call limit" />
        <MeterTile icon={HardDrive} label="Traffic · last 60 s" used={`${mib < 10 ? mib.toFixed(2) : mib.toFixed(1)} MiB`} limit={`${limits.mibPerMin} MiB`} pct={now.pctBytes} warnPct={limits.warnPct} shedPct={limits.shedPct} sub="of the per-minute traffic limit" />
        <Kpi icon={OctagonAlert} label="Flespi 429 · last hour" value={fmtCount(lastHour.throttled)} tone={lastHour.throttled ? 'critical' : undefined}
          sub={`${fmtCount(lastHour.shed)} held back · ${fmtCount(lastHour.local)} answered from our copy`} />
      </div>
      <section className="dm-card" aria-labelledby="dm-pm-h">
        <div className="dm-sec"><h2 id="dm-pm-h">Calls to Flespi per minute</h2><p>Last 60 minutes · {fmtCount(lastHour.calls)} calls, {fmtBytes(lastHour.bytes)}</p></div>
        <PerMinuteBars perMinute={data.perMinute} limit={limits.callsPerMin} warnPct={limits.warnPct} />
      </section>
      <CountsTable title="Who makes the calls" sub="Last hour · users and server jobs" rows={data.bySource} firstHead="Source" first={r => <SourceCell r={r} />} />
      <div className="dm-grid2">
        <CountsTable title="Endpoints" sub="Last hour" rows={data.byEndpoint} firstHead="Endpoint" showLocal={false}
          first={r => <td><code style={{ fontSize: 11.5 }}>{r.key}</code></td>} />
        <CountsTable title="Devices asked about" sub="Last hour" rows={data.byDevice} firstHead="Device" showLocal={false}
          first={r => <td>{r.label}</td>} />
      </div>
      <CountsTable title="Last 24 hours by source" sub="Stored hourly" rows={data.day.bySource} firstHead="Source" first={r => <SourceCell r={r} />} />
      <p className="dm-note"><Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        FleetmaxX’s own REST calls to Flespi (every browser request goes through the server). Flespi’s traffic limit also counts MQTT, which is not seen here. “Answered locally” reads cost Flespi nothing; “held back” ones were never sent.
      </p>
    </>
  )
}

// ── Thresholds ───────────────────────────────────────────────────────────────

function ThresholdsTab({ push }) {
  const [saved, setSaved] = useState(null)
  const [meta, setMeta] = useState(null)
  const [form, setForm] = useState({})
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let alive = true
    fetchMonitorSettings()
      .then(r => { if (alive) { setSaved(r.settings); setForm(r.settings); setMeta(r) } })
      .catch(err => { if (alive) setLoadError(err) })
    return () => { alive = false }
  }, [])

  const changed = useMemo(() => (saved ? changedSettings(saved, form) : {}), [saved, form])
  const dirty = Object.keys(changed).length > 0

  if (!saved) return <div className="dm-card dm-empty">{loadError ? errText(loadError) : 'Loading…'}</div>

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })) }
  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const r = await saveMonitorSettings(changed)
      setSaved(r.settings)
      setForm(r.settings)
      setErrors({})
      push('Thresholds saved', { tone: 'success' })
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details)
      push(errText(err), { tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dm-card" aria-label="Thresholds">
      <div className="dm-form">
        {SETTING_GROUPS.map(g => (
          <div key={g.title} className="dm-group">
            <h3>{g.title}</h3>
            <p>{g.hint}</p>
            <div className="dm-fields">
              {g.fields.map(f => {
                const spec = meta?.spec?.[f.key] ?? {}
                const id = `dm-f-${f.key}`
                return (
                  <div key={f.key} className="dm-field">
                    <label htmlFor={id}>{f.label}</label>
                    <div className={`dm-inp${errors[f.key] ? ' bad' : ''}`}>
                      <input id={id} type="number" inputMode="decimal" min={spec.min} max={spec.max} value={form[f.key] ?? ''}
                        onChange={e => set(f.key, e.target.value)} aria-invalid={!!errors[f.key]} aria-describedby={`${id}-h`} />
                      <span>{f.unit}</span>
                    </div>
                    <small id={`${id}-h`} className={errors[f.key] ? 'err' : undefined}>
                      {errors[f.key] ?? f.hint ?? `Default ${meta?.defaults?.[f.key]}`}
                    </small>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <div className="dm-group">
          <h3>Actions</h3>
          <p>What FleetmaxX does on its own. None of them touches a tracker or the Flespi account.</p>
          {SETTING_TOGGLES.map(t => (
            <div key={t.key} className="dm-tog">
              <button type="button" role="switch" className="dm-switch" aria-checked={!!form[t.key]} aria-labelledby={`dm-t-${t.key}`}
                onClick={() => set(t.key, !form[t.key])} />
              <div id={`dm-t-${t.key}`}><b>{t.label}</b><span>{t.hint}</span></div>
            </div>
          ))}
        </div>
      </div>
      <div className="dm-actions">
        <button type="button" style={SECONDARY_BTN} onClick={() => { setForm({ ...saved, ...(meta?.defaults ?? {}) }); setErrors({}) }}>
          <RotateCcw size={14} />Defaults
        </button>
        <button type="button" style={SECONDARY_BTN} disabled={!dirty || saving} onClick={() => { setForm(saved); setErrors({}) }}>Cancel</button>
        <button type="button" style={{ ...PRIMARY_BTN, opacity: dirty && !saving ? 1 : 0.55, cursor: dirty && !saving ? 'pointer' : 'default' }} disabled={!dirty || saving} onClick={save}>
          <Save size={14} />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'devices', label: 'Devices', icon: Activity },
  { id: 'requests', label: 'Flespi requests', icon: Gauge },
  { id: 'thresholds', label: 'Thresholds', icon: AlertTriangle },
]

function Message({ title, text }) {
  return (
    <div className="dm-card dm-msg">
      <Info size={20} aria-hidden="true" style={{ color: 'var(--ft-accent)', flexShrink: 0 }} />
      <div><div style={{ fontSize: 14.5, fontWeight: 750, color: 'var(--c-text1)' }}>{title}</div>
        <p style={{ fontSize: 12.5, color: 'var(--c-text3)', margin: '6px 0 0', lineHeight: 1.5 }}>{text}</p></div>
    </div>
  )
}

export default function DataMonitor(props) {
  const { user } = useSession()
  const allowed = IS_REAL && user?.role === 'SUPER_ADMIN'
  const [tab, setTab] = useState('devices')
  const { toasts, push, dismiss } = useToasts()
  const devices = usePolled(fetchMonitorDevices, allowed && tab === 'devices')
  const requests = usePolled(fetchMonitorRequests, allowed && tab === 'requests')
  const overload = devices.data?.totals?.overload ?? 0
  const active = tab === 'devices' ? devices : tab === 'requests' ? requests : null

  return (
    <SettingsLayout title="Device Data Monitor" subtitle="Which trackers send too much data, and how much FleetmaxX asks of Flespi. Nothing here changes a device." {...props}>
      <style>{CSS}</style>
      {!IS_REAL ? (
        <Message title="Needs the live server" text="The monitor counts what the trackers send to the FleetmaxX server and every call it makes to Flespi, so there is nothing to show in demo mode." />
      ) : !allowed ? (
        <Message title="Super Admin only" text="The Device Data Monitor shows every tracker in the account and every user’s Flespi usage, so only a Super Admin can open it." />
      ) : (
        <div className="dm">
          <div className="dm-bar">
            <div className="dm-tabs" role="tablist" aria-label="Device Data Monitor">
              {TABS.map(t => (
                <button key={t.id} type="button" role="tab" className="dm-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                  <t.icon size={14} aria-hidden="true" />{t.label}
                  {t.id === 'devices' && overload > 0 && <span className="dm-badge" aria-label={`${overload} in overload`}>{overload}</span>}
                </button>
              ))}
            </div>
            {active && (
              <div className="dm-upd">
                {active.error && active.data && <span style={{ color: '#dc2626' }}>{errText(active.error)} · </span>}
                <span>{active.at ? `Updated ${new Date(active.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · every 30 s` : ''}</span>
                <button type="button" className="dm-ibtn" onClick={active.reload} disabled={active.loading} aria-label="Refresh now">
                  <RefreshCw size={13} aria-hidden="true" className={active.loading ? 'animate-spin' : undefined} />Refresh
                </button>
              </div>
            )}
          </div>
          {tab === 'devices' && <DevicesTab q={devices} />}
          {tab === 'requests' && <RequestsTab q={requests} />}
          {tab === 'thresholds' && <ThresholdsTab push={push} />}
        </div>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}

