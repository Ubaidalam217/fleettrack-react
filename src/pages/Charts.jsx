import { useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import Header  from '../components/Header'
import { useFlespiData } from '../hooks/useFlespiData'
import {
  settingsProfileForImei, useVehicles, useCompanies, useGroups, alertTypeLabel,
} from '../data/settings'
import {
  PRESETS, MAX_CUSTOM_DAYS, USED_DAY_KM, presetWindows, customWindows, summarize, countAlerts,
  pctChange, uaeIsoDate, uaeMidnight,
} from './charts/chartsData'
import { fmtInt, rangeLabel, durationParts, compareLabel } from './charts/chartsFormat'
import { useChartStats, useChartAlerts } from './charts/useChartsData'
import {
  KpiCard, DistanceCard, FleetStatusCard, HeatmapCard, AlertsCard, TopVehiclesCard, TimeSplitCard, SpeedCard,
} from './charts/ChartWidgets'
import './charts/charts.css'

/**
 * Charts — fleet analytics for a period (approved mock-ups
 * Charts-Design-Light.png / Charts-Design-Dark.png).
 *
 * Every figure is measured, none estimated: the live status comes from the
 * MQTT snapshot, the period charts from the same messages and rules as the
 * Daywise reports (charts/chartsData.js), the alerts from the alert history
 * (charts/useChartsData.js). Scope is the signed-in account's own vehicles —
 * useFlespiData() is already filtered to them.
 */

const NOT_ASSIGNED = 'Not assigned'
const NO_GROUP = 'No group'
/** mockData's groupName for a BG with no group of its own, and for no BG at all. */
const NO_GROUP_NAMES = new Set(['', '—', 'Business Group is its own group'])

/** Labels for the browser notification engine's rules (mock mode's alerts). */
const LOCAL_RULE_LABELS = {
  overspeed: 'Overspeed',
  high_idle: 'High idle',
  gps_lost: 'GPS lost',
  off_hours_engine: 'Off-hours engine',
  long_stop: 'Long stop',
}
const alertLabel = type => LOCAL_RULE_LABELS[type] ?? (alertTypeLabel(type) !== '—' ? alertTypeLabel(type) : type)

/** Now, floored to five minutes, so a period is the same key for that long (see useChartsData). */
const nowRounded = () => Math.floor(Date.now() / 1000 / 300) * 300

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function FilterSelect({ label, value, onChange, allLabel, options }) {
  return (
    <label className="ch-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="all">{allLabel}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Chevron />
    </label>
  )
}

/** The change line under a KPI. `upIsGood` decides the colour; arrow and words say the direction. */
function change(pct, { upIsGood, text, suffix = '' }) {
  if (pct == null) return { dir: null, tone: 'neutral', text: `No earlier data${suffix}` }
  if (Math.abs(pct) < 0.05) return { dir: null, tone: 'neutral', text: `No change${suffix}` }
  const up = pct > 0
  return { dir: up ? 'up' : 'down', tone: up === upIsGood ? 'good' : 'bad', text: text(Math.abs(pct), up) + suffix }
}

export default function Charts({ isDark, toggleTheme, themeMode, setTheme }) {
  const { data, isConnected, noVehicles } = useFlespiData()
  // Subscribed so a renamed BG or group, or a newly registered vehicle, shows
  // without a reload — settingsProfileForImei reads these stores.
  const settingsVehicles = useVehicles()
  const companies = useCompanies()
  const groups = useGroups()

  /** The live fleet joined to its Settings registration, as the reports do it. */
  const fleet = useMemo(() => {
    const list = (data?.vehicles ?? []).map(v => {
      const p = settingsProfileForImei(v.ident)
      const bg = p.linked && p.bgName && p.bgName !== '—' ? p.bgName : NOT_ASSIGNED
      const group = p.linked && !NO_GROUP_NAMES.has(p.groupName ?? '') ? p.groupName : NO_GROUP
      return {
        id: v.id,
        label: p.plateNo || v.master?.plateNo || p.fleetNo || v.name,
        bg,
        group,
        status: v.status,
      }
    })
    return list.sort((a, b) => a.label.localeCompare(b.label))
    // The three stores are what settingsProfileForImei reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, settingsVehicles, companies, groups])

  // ── filters ──
  const [bg, setBg] = useState('all')
  const [group, setGroup] = useState('all')
  const [vehicle, setVehicle] = useState('all')

  const bgOptions = useMemo(
    () => [...new Set(fleet.map(v => v.bg))].sort((a, b) => a.localeCompare(b)).map(x => ({ value: x, label: x })),
    [fleet]
  )
  const groupOptions = useMemo(
    () => [...new Set(fleet.map(v => v.group))].sort((a, b) => a.localeCompare(b)).map(x => ({ value: x, label: x })),
    [fleet]
  )
  const inBgGroup = v => (bg === 'all' || v.bg === bg) && (group === 'all' || v.group === group)
  const vehicleOptions = fleet.filter(inBgGroup).map(v => ({ value: String(v.id), label: v.label }))
  const vehicleValue = vehicleOptions.some(o => o.value === vehicle) ? vehicle : 'all'
  const selected = fleet.filter(v => inBgGroup(v) && (vehicleValue === 'all' || String(v.id) === vehicleValue))

  // ── period ──
  const [period, setPeriod] = useState('30d')
  const [asOf, setAsOf] = useState(nowRounded)
  const [draft, setDraft] = useState({ from: '', to: '' })
  const [applied, setApplied] = useState(null) // last valid custom windows

  const presetWin = useMemo(() => {
    const p = PRESETS.find(x => x.key === period) ?? PRESETS[2]
    return presetWindows(p.days, asOf)
  }, [period, asOf])
  const windows = period === 'custom' ? (applied ?? presetWin) : presetWin
  const draftError = period === 'custom' ? customWindows(draft.from, draft.to, asOf).error : null

  const choosePeriod = key => {
    const now = nowRounded()
    if (key === 'custom' && period !== 'custom') {
      // Start from the range on screen, so Custom changes nothing until edited.
      const from = uaeIsoDate(windows.cur.from)
      const to = uaeIsoDate(uaeMidnight(windows.cur.to - 1))
      setDraft({ from, to })
      setApplied(customWindows(from, to, now).windows ?? null)
    }
    setPeriod(key)
    setAsOf(now)
  }
  const editDraft = patch => {
    const next = { ...draft, ...patch }
    setDraft(next)
    const res = customWindows(next.from, next.to, nowRounded())
    if (res.windows) setApplied(res.windows)
  }

  // ── data ──
  const allIds = useMemo(() => fleet.map(v => v.id).sort((a, b) => a - b), [fleet])
  const statsState = useChartStats(allIds, windows)
  const alertsState = useChartAlerts(allIds, windows)

  const selKey = selected.map(v => `${v.id}\u0001${v.label}\u0001${v.bg}`).join('\u0002')
  const summary = useMemo(
    () => (statsState.stats ? summarize(statsState.stats, selected, windows) : null),
    // `selected` is identified by selKey; it is a new array on every live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statsState.stats, selKey, windows]
  )
  const alerts = useMemo(
    () => (alertsState.items ? countAlerts(alertsState.items, new Set(selected.map(v => v.id)), windows) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alertsState.items, selKey, windows]
  )

  const statusCounts = useMemo(() => {
    const c = { Running: 0, Idle: 0, Stopped: 0, Inactive: 0, NoData: 0 }
    for (const v of selected) c[v.status in c ? v.status : 'NoData'] += 1
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, data])

  // ── KPIs ──
  const fleetLoading = !data
  const loading = fleetLoading || statsState.loading
  const vs = compareLabel(windows.days)
  const t = summary?.totals
  const engineOn = t ? t.cur.driveSec + t.cur.idleSec : 0
  const idleShare = engineOn ? (t.cur.idleSec / engineOn) * 100 : null
  const util = t?.vehicleDays ? (t.cur.usedDays / t.vehicleDays) * 100 : null
  const utilPrev = t?.vehicleDays ? (t.prev.usedDays / t.vehicleDays) * 100 : null
  const drive = durationParts(t?.cur.driveSec)
  const idle = durationParts(t?.cur.idleSec)

  const kpis = [
    {
      label: 'Total distance',
      value: fmtInt(t?.cur.km),
      unit: 'km',
      delta: t && change(pctChange(t.cur.km, t.prev.km), { upIsGood: true, text: p => `${p.toFixed(1)}% vs ${vs}` }),
    },
    {
      label: 'Driving time',
      value: drive.value,
      unit: drive.unit,
      delta: t && change(pctChange(t.cur.driveSec, t.prev.driveSec), { upIsGood: true, text: p => `${p.toFixed(1)}%` }),
    },
    {
      label: 'Idle time',
      value: idle.value,
      unit: idle.unit,
      delta: t && change(pctChange(t.cur.idleSec, t.prev.idleSec), {
        upIsGood: false,
        text: p => `${p.toFixed(1)}%`,
        suffix: idleShare == null ? '' : ` · ${idleShare.toFixed(1)}% of engine-on`,
      }),
    },
    {
      label: 'Fleet utilisation',
      value: util == null ? '—' : String(Math.round(util)),
      unit: util == null ? '' : '%',
      delta: util == null ? null : (() => {
        const pts = Math.round(util) - Math.round(utilPrev)
        if (!t.prev.usedDays && !t.cur.usedDays) return { dir: null, tone: 'neutral', text: 'No driving' }
        if (pts === 0) return { dir: null, tone: 'neutral', text: 'No change' }
        return { dir: pts > 0 ? 'up' : 'down', tone: pts > 0 ? 'good' : 'bad', text: `${Math.abs(pts)} pt${Math.abs(pts) === 1 ? '' : 's'}` }
      })(),
    },
    {
      label: 'Alerts',
      value: alerts ? `${fmtInt(alerts.cur)}${alertsState.truncated ? '+' : ''}` : '—',
      delta: !alerts || alertsState.truncated ? null : change(pctChange(alerts.cur, alerts.prev), {
        upIsGood: false,
        text: (p, up) => `${Math.round(p)}% ${up ? 'more' : 'fewer'}`,
      }),
      loading: fleetLoading || alertsState.loading,
    },
  ]

  const periodAside = windows.days === 1 ? 'Today' : `${windows.days} days`
  const subtitle = [
    'Fleet analytics',
    fleetLoading ? null : `${selected.length} vehicle${selected.length === 1 ? '' : 's'}`,
    rangeLabel(windows),
  ].filter(Boolean).join(' · ')

  return (
    <div className="ch-page flex h-screen overflow-hidden" style={{ background: 'var(--c-page)' }}>
      <div className="ch-noprint contents">
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col min-w-0">
        <div className="ch-noprint contents">
          <Header
            isDark={isDark}
            toggleTheme={toggleTheme}
            themeMode={themeMode}
            setTheme={setTheme}
          />
        </div>
        <main className="ch-main">
          <div className="ch-wrap">
            <div className="ch-head">
              <div>
                <h1 className="ch-title">Charts</h1>
                <p className="ch-sub">{subtitle}</p>
              </div>
              <div className="ch-toolbar ch-noprint">
                <div className="ch-seg" role="group" aria-label="Period">
                  {[...PRESETS, { key: 'custom', label: 'Custom' }].map(p => (
                    <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => choosePeriod(p.key)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <FilterSelect
                  label="Business Group"
                  value={bg}
                  onChange={v => { setBg(v); setVehicle('all') }}
                  allLabel="All BGs"
                  options={bgOptions}
                />
                <FilterSelect
                  label="Group"
                  value={group}
                  onChange={v => { setGroup(v); setVehicle('all') }}
                  allLabel="All groups"
                  options={groupOptions}
                />
                <FilterSelect
                  label="Vehicle"
                  value={vehicleValue}
                  onChange={setVehicle}
                  allLabel="All vehicles"
                  options={vehicleOptions}
                />
                <button
                  type="button"
                  className="ch-btn"
                  onClick={() => window.print()}
                  disabled={loading}
                  title="Opens the print dialog — choose “Save as PDF”"
                >
                  Export PDF
                </button>
                {period === 'custom' && (
                  <div className="ch-custom">
                    <label>
                      From{' '}
                      <input
                        type="date"
                        value={draft.from}
                        max={uaeIsoDate(asOf)}
                        onChange={e => editDraft({ from: e.target.value })}
                      />
                    </label>
                    <label>
                      To{' '}
                      <input
                        type="date"
                        value={draft.to}
                        max={uaeIsoDate(asOf)}
                        onChange={e => editDraft({ to: e.target.value })}
                      />
                    </label>
                    <span className={draftError ? 'ch-custom-error' : undefined} role={draftError ? 'alert' : undefined}>
                      {draftError ?? `Up to ${MAX_CUSTOM_DAYS} days`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {statsState.error && <p className="ch-note ch-note--error" role="alert">{statsState.error}</p>}
            {statsState.capped && (
              <p className="ch-note">
                Some days had more data than one request returns, so a few figures may read slightly low.
              </p>
            )}

            {noVehicles ? (
              <section className="ch-card">
                <p className="ch-empty">No vehicles are assigned to your account, so there is nothing to chart yet.</p>
              </section>
            ) : (
              <>
                <div className="ch-grid ch-kpis">
                  {kpis.map(k => (
                    <KpiCard
                      key={k.label}
                      label={k.label}
                      value={k.value}
                      unit={k.unit}
                      delta={k.delta}
                      loading={k.loading ?? loading}
                    />
                  ))}
                </div>

                <div className="ch-grid ch-row">
                  <DistanceCard
                    summary={summary}
                    loading={loading}
                    title={windows.days === 1 ? 'Hourly distance' : 'Daily distance'}
                  />
                  <FleetStatusCard
                    counts={statusCounts}
                    total={selected.length}
                    live={isConnected}
                    loading={fleetLoading}
                  />
                </div>

                <div className="ch-grid ch-row">
                  <HeatmapCard heat={summary?.heat ?? null} loading={loading} />
                  <AlertsCard
                    types={alerts?.types}
                    labelOf={alertLabel}
                    aside={periodAside}
                    loading={fleetLoading || alertsState.loading}
                    error={alertsState.error}
                    emptyText="No alerts in this period."
                  />
                </div>

                <div className="ch-grid ch-row ch-row--3">
                  <TopVehiclesCard list={summary?.topVehicles} loading={loading} />
                  <TimeSplitCard byBg={summary?.byBg} loading={loading} />
                  <SpeedCard speedSec={summary?.speedSec ?? null} loading={loading} />
                </div>

                <p className="ch-note" style={{ margin: '16px 0 0' }}>
                  Distance and engine hours follow the Daywise reports. Utilisation is the share of vehicle-days
                  with at least {USED_DAY_KM} km driven. Changes compare with the {vs}.
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
