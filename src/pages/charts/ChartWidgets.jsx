import { useId } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { SPEED_BUCKETS, SPEED_LIMIT_KMH, bucketFrom, WEEKDAYS } from './chartsData'
import { fmtInt, dayLabel, weekdayLabel, hourLabel, durationText } from './chartsFormat'

/**
 * The Charts page's cards. Presentational only: every number arrives computed
 * (chartsData.js summarize / countAlerts) and every colour is a CSS variable
 * from charts.css, so each card follows the theme without knowing it.
 */

// ── Shell ───────────────────────────────────────────────────────────────────

export function Card({ title, aside, children, className = '', labelledBy }) {
  const id = useId()
  return (
    <section className={`ch-card ${className}`} aria-labelledby={labelledBy ?? id}>
      <div className="ch-card-head">
        <h2 className="ch-card-title" id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

const Skeleton = ({ height }) => <div className="ch-skel" style={height ? { minHeight: height } : undefined} aria-hidden="true" />
const Empty = ({ children }) => <p className="ch-empty">{children}</p>
const Loading = ({ height }) => (
  <>
    <span className="sr-only">Loading…</span>
    <Skeleton height={height} />
  </>
)

// ── KPI tile ────────────────────────────────────────────────────────────────

/**
 * `delta` is `{ dir: 'up'|'down'|null, tone: 'good'|'bad'|'neutral', text }`.
 * The arrow and the words both carry the direction, so the colour never has to.
 */
export function KpiCard({ label, value, unit, delta, loading }) {
  return (
    <section className="ch-card ch-kpi" aria-label={label}>
      <p className="ch-kpi-label">{label}</p>
      {loading ? (
        <>
          <span className="sr-only">Loading…</span>
          <div className="ch-skel" style={{ minHeight: 34, maxWidth: 140, marginTop: 4 }} aria-hidden="true" />
          <div className="ch-skel" style={{ minHeight: 12, maxWidth: 110, marginTop: 6 }} aria-hidden="true" />
        </>
      ) : (
        <>
          <p className="ch-kpi-value">
            {value}
            {unit && <span className="ch-kpi-unit">{unit}</span>}
          </p>
          {delta && (
            <p className={`ch-delta ch-delta--${delta.tone}`}>
              {delta.dir && (
                <>
                  <span className="ch-delta-arrow" aria-hidden="true">{delta.dir === 'up' ? '▲' : '▼'}</span>
                  <span className="sr-only">{delta.dir === 'up' ? 'Up' : 'Down'} </span>
                </>
              )}
              {delta.text}
            </p>
          )}
        </>
      )}
    </section>
  )
}

// ── Daily distance ──────────────────────────────────────────────────────────

function DistanceTip({ active, payload, hourly }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const when = hourly ? `${weekdayLabel(p.start)}, ${hourLabel(p.start)}` : weekdayLabel(p.start)
  return (
    <div className="ch-tip">
      <div className="ch-tip-date">{when}</div>
      <div className="ch-tip-main">
        {fmtInt(p.cur)} km · {p.vehicles} vehicle{p.vehicles === 1 ? '' : 's'}
      </div>
      <div className="ch-tip-prev">Previous period: {fmtInt(p.prev)} km</div>
    </div>
  )
}

function axisTicks(series, hourly) {
  if (!series.length) return []
  const n = series.length
  const step = hourly ? 3 : n > 10 ? 7 : n > 7 ? 2 : 1
  const ticks = []
  for (let i = 0; i < n; i += step) ticks.push(series[i].start)
  // The last day closes the axis, as in the mock-up — unless it would crowd the tick before it.
  const last = series[n - 1].start
  if (!hourly && ticks[ticks.length - 1] !== last) {
    if ((n - 1) % step < Math.ceil(step / 2)) ticks.pop()
    ticks.push(last)
  }
  return ticks
}

export function DistanceCard({ summary, loading, title }) {
  const gradientId = `ch-area-${useId().replace(/:/g, '')}`
  const aside = (
    <ul className="ch-legend" aria-label="Legend">
      <li><span className="ch-dot" style={{ background: 'var(--ch-accent)' }} aria-hidden="true" />This period</li>
      <li>
        {/* A dashed stroke, like the line it names, so the two differ by more than colour. */}
        <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
          <line x1="0" y1="5" x2="16" y2="5" stroke="var(--ch-prev)" strokeWidth="2" strokeDasharray="4 3" />
        </svg>
        Previous period
      </li>
    </ul>
  )
  // Distance is a signed odometer sum (distance.js), so an hour with no driving
  // can come out a few metres below zero from odometer jitter. The totals keep
  // the signed figure; the line does not draw "negative kilometres".
  const series = (summary?.series ?? []).map(p => ({ ...p, cur: Math.max(0, p.cur), prev: Math.max(0, p.prev) }))
  const hourly = !!summary?.hourly
  const total = series.reduce((a, p) => a + p.cur, 0)
  return (
    <Card title={title} aside={aside}>
      {loading ? <Loading height={244} /> : !series.length ? <Empty>No days in this period yet.</Empty> : (
        <div
          className="ch-area"
          role="img"
          aria-label={`${title}: ${fmtInt(total)} km in total over ${series.length} ${hourly ? 'hours' : 'days'}. Hover the chart for each ${hourly ? 'hour' : 'day'}.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 10, right: 14, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ch-accent)" stopOpacity={0.34} />
                  <stop offset="100%" stopColor="var(--ch-accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--ch-grid)" />
              <XAxis
                dataKey="start"
                ticks={axisTicks(series, hourly)}
                tickFormatter={ts => (hourly ? hourLabel(ts) : dayLabel(ts))}
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                interval={0}
                padding={{ left: 6, right: 6 }}
              />
              <YAxis
                width={44}
                axisLine={false}
                tickLine={false}
                tickMargin={6}
                allowDecimals={false}
                tickFormatter={fmtInt}
              />
              <Tooltip
                content={<DistanceTip hourly={hourly} />}
                cursor={{ stroke: 'var(--ch-accent)', strokeWidth: 1.5, strokeDasharray: '3 4' }}
                isAnimationActive={false}
              />
              <Area
                type="linear"
                dataKey="cur"
                name="This period"
                stroke="var(--ch-accent)"
                strokeWidth={2.5}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 6, fill: 'var(--c-card)', stroke: 'var(--ch-accent)', strokeWidth: 2.5 }}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="prev"
                name="Previous period"
                stroke="var(--ch-prev)"
                strokeWidth={1.6}
                strokeDasharray="5 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

// ── Fleet status now ────────────────────────────────────────────────────────

const STATUS_ROWS = [
  { key: 'Running', label: 'Driving', color: 'var(--ch-driving)' },
  { key: 'Idle', label: 'Idle', color: 'var(--ch-idle)' },
  { key: 'Stopped', label: 'Off', color: 'var(--ch-off)' },
  { key: 'Inactive', label: 'Inactive', color: 'var(--ch-inactive)' },
  { key: 'NoData', label: 'No data', color: 'var(--ch-nodata)' },
]

function Donut({ counts, total }) {
  const R = 70
  const C = 2 * Math.PI * R
  const parts = STATUS_ROWS.filter(s => counts[s.key] > 0)
  const gap = parts.length > 1 ? 3 : 0
  let offset = 0
  const label = STATUS_ROWS.map(s => `${counts[s.key] ?? 0} ${s.label.toLowerCase()}`).join(', ')
  return (
    <div className="ch-donut" role="img" aria-label={`${total} vehicles: ${label}`}>
      <svg viewBox="0 0 176 176" aria-hidden="true">
        <circle cx="88" cy="88" r={R} fill="none" stroke="var(--ch-track)" strokeWidth="22" />
        {total > 0 && parts.map(s => {
          const len = (counts[s.key] / total) * C
          const dash = Math.max(0.5, len - gap)
          const el = (
            <circle
              key={s.key}
              cx="88" cy="88" r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="22"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
            >
              <title>{`${s.label}: ${counts[s.key]}`}</title>
            </circle>
          )
          offset += len
          return el
        })}
      </svg>
      <div className="ch-donut-center">
        <span className="ch-donut-num">{total}</span>
        <span className="ch-donut-cap">vehicle{total === 1 ? '' : 's'}</span>
      </div>
    </div>
  )
}

export function FleetStatusCard({ counts, total, live, loading }) {
  return (
    <Card
      title="Fleet status now"
      aside={<span className="ch-badge" title={live ? 'Updating live' : 'Showing the last known status'}>{live ? 'LIVE' : 'LAST KNOWN'}</span>}
    >
      {loading ? <Loading height={190} /> : (
        <div className="ch-status">
          <Donut counts={counts} total={total} />
          <ul className="ch-status-list">
            {STATUS_ROWS.map(s => (
              <li key={s.key}>
                <span className="ch-dot" style={{ background: s.color }} aria-hidden="true" />
                {s.label}
                <b>{counts[s.key] ?? 0}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

// ── Utilisation heatmap ─────────────────────────────────────────────────────

const HEAT_STEPS = [0, 22, 40, 58, 78, 100]
const heatColor = level => (level === 0
  ? 'var(--ch-cell0)'
  : `color-mix(in srgb, var(--ch-accent) ${HEAT_STEPS[level]}%, var(--ch-cell0))`)
const pad2 = n => String(n).padStart(2, '0')

export function HeatmapCard({ heat, loading }) {
  const max = heat ? Math.max(...heat) : 0
  let busiest = -1
  if (heat && max > 0) busiest = heat.indexOf(max)
  const summary = busiest >= 0
    ? `Busiest hour: ${WEEKDAYS[Math.floor(busiest / 24)]} ${pad2(busiest % 24)}:00, ${fmtInt(max / 60)} driving minutes.`
    : 'No driving in this period.'
  return (
    <Card title="Utilisation heatmap" aside={<span className="ch-card-aside">Driving minutes by weekday × hour</span>}>
      {loading ? <Loading height={230} /> : !heat ? <Empty>No data for this period.</Empty> : (
        <>
          <div className="ch-heat-scroll">
            <div className="ch-heat" role="img" aria-label={`Driving minutes by weekday and hour. ${summary}`}>
              {WEEKDAYS.map((day, d) => (
                <HeatRow key={day} day={day} cells={heat.slice(d * 24, d * 24 + 24)} max={max} />
              ))}
            </div>
            <div className="ch-heat-hours" aria-hidden="true">
              <span />
              {Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 3 === 0 ? `${pad2(h)}:00` : ''}</span>)}
            </div>
          </div>
          <div className="ch-heat-key" aria-hidden="true">
            Less
            {HEAT_STEPS.map((_, i) => <i key={i} style={{ background: heatColor(i) }} />)}
            More
          </div>
        </>
      )}
    </Card>
  )
}

function HeatRow({ day, cells, max }) {
  return (
    <>
      <span className="ch-heat-day">{day}</span>
      {cells.map((sec, h) => {
        const level = sec > 0 && max > 0 ? Math.max(1, Math.ceil((sec / max) * 5)) : 0
        return (
          <span
            key={h}
            className="ch-heat-cell"
            style={{ background: heatColor(level) }}
            title={`${day} ${pad2(h)}:00–${pad2((h + 1) % 24)}:00 · ${fmtInt(sec / 60)} driving min`}
          />
        )
      })}
    </>
  )
}

// ── Alerts by type ──────────────────────────────────────────────────────────

/** Speeding types share the over-the-limit red of the speed chart. */
const SPEEDING = new Set(['overspeed', 'geofence_speed'])

export function AlertsCard({ types, labelOf, aside, loading, error, emptyText }) {
  const max = types?.length ? types[0].count : 0
  return (
    <Card title="Alerts by type" aside={<span className="ch-card-aside">{aside}</span>}>
      {loading ? <Loading height={220} /> : error ? <Empty>The alerts could not be loaded.</Empty> : !types?.length ? (
        <Empty>{emptyText}</Empty>
      ) : (
        <ul className="ch-bars">
          {types.slice(0, 7).map(t => {
            const ratio = max ? t.count / max : 0
            const fill = SPEEDING.has(t.type)
              ? 'var(--ch-over)'
              : `color-mix(in srgb, var(--ch-accent) ${Math.round(45 + 55 * ratio)}%, var(--c-card))`
            return (
              <li key={t.type} className="ch-bar-row">
                <span className="ch-bar-label" title={labelOf(t.type)}>{labelOf(t.type)}</span>
                <span className="ch-bar-track" aria-hidden="true">
                  <span className="ch-bar-fill" style={{ display: 'block', width: `${ratio * 100}%`, background: fill }} />
                </span>
                <span className="ch-bar-value">{fmtInt(t.count)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ── Top vehicles by distance ────────────────────────────────────────────────

export function TopVehiclesCard({ list, loading }) {
  const top = (list ?? []).slice(0, 8)
  const max = top.length ? top[0].km : 0
  return (
    <Card title="Top vehicles by distance" aside={<span className="ch-card-aside">km</span>}>
      {loading ? <Loading height={240} /> : !top.length ? <Empty>No vehicle drove in this period.</Empty> : (
        <ul className="ch-bars">
          {top.map(v => (
            <li key={v.id} className="ch-top-row">
              <span className="ch-top-label" title={v.label}>{v.label}</span>
              <span className="ch-top-bar">
                <span
                  className="ch-top-fill"
                  style={{ width: `calc((100% - 64px) * ${max ? v.km / max : 0})` }}
                  aria-hidden="true"
                />
                <span className="ch-top-value">{fmtInt(v.km)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ── Time split by BG ────────────────────────────────────────────────────────

const SPLIT = [
  { key: 'driveSec', label: 'Driving', color: 'var(--ch-driving)' },
  { key: 'idleSec', label: 'Idle', color: 'var(--ch-idle)' },
  { key: 'offSec', label: 'Off', color: 'var(--ch-off)' },
]
const MAX_BGS = 5

export function TimeSplitCard({ byBg, loading }) {
  const aside = (
    <ul className="ch-legend" aria-label="Legend">
      {SPLIT.map(s => (
        <li key={s.key}><span className="ch-dot" style={{ background: s.color }} aria-hidden="true" />{s.label}</li>
      ))}
    </ul>
  )
  const rows = (byBg ?? []).slice(0, MAX_BGS)
  const more = (byBg?.length ?? 0) - rows.length
  return (
    <Card title="Time split by BG" aside={aside}>
      {loading ? <Loading height={240} /> : !rows.length ? <Empty>No vehicles selected.</Empty> : (
        <>
          <ul className="ch-split">
            {rows.map(b => {
              const total = b.totalSec || 1
              const parts = SPLIT.map(s => ({ ...s, sec: b[s.key], pct: (b[s.key] / total) * 100 }))
              const said = parts.map(p => `${p.label.toLowerCase()} ${Math.round(p.pct)}%`).join(', ')
              return (
                <li key={b.bg}>
                  <p className="ch-split-name" title={`${b.bg} · ${b.vehicles} vehicle${b.vehicles === 1 ? '' : 's'}`}>{b.bg}</p>
                  <div className="ch-split-bar" role="img" aria-label={`${b.bg}: ${said}`}>
                    {parts.filter(p => p.sec > 0).map(p => (
                      <span
                        key={p.key}
                        className="ch-split-seg"
                        style={{ flex: `${p.pct} 1 0`, background: p.color, padding: p.pct >= 9 ? undefined : 0 }}
                        title={`${p.label}: ${Math.round(p.pct)}% (${durationText(p.sec)})`}
                      >
                        {p.pct >= 9 ? `${Math.round(p.pct)}%` : ''}
                      </span>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
          {more > 0 && <p className="ch-split-more" style={{ marginTop: 12 }}>and {more} more BG{more === 1 ? '' : 's'} — pick one in the BG filter.</p>}
        </>
      )}
    </Card>
  )
}

// ── Speed distribution ──────────────────────────────────────────────────────

const SPEED_PLOT_PX = 150

export function SpeedCard({ speedSec, loading }) {
  const total = speedSec ? speedSec.reduce((a, b) => a + b, 0) : 0
  const shares = (speedSec ?? []).map(s => (total ? (s / total) * 100 : 0))
  const max = Math.max(0, ...shares)
  return (
    <Card title="Speed distribution" aside={<span className="ch-card-aside">share of driving time</span>}>
      {loading ? <Loading height={220} /> : !total ? <Empty>No driving in this period.</Empty> : (
        <>
          <ul className="ch-speed" aria-label="Share of driving time per speed band">
            {SPEED_BUCKETS.map((band, i) => {
              const over = bucketFrom(i) >= SPEED_LIMIT_KMH
              const pct = shares[i]
              const pctText = pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
              return (
                <li key={band} title={`${band} km/h: ${pctText} of driving time (${durationText(speedSec[i])})`}>
                  <span className="ch-speed-pct">{pctText}</span>
                  <span
                    className="ch-speed-bar"
                    style={{
                      height: max ? Math.max(3, (pct / max) * SPEED_PLOT_PX) : 3,
                      background: over ? 'var(--ch-over)' : 'var(--ch-accent)',
                    }}
                    aria-hidden="true"
                  />
                  <span className="ch-speed-band">
                    {band}
                    {over && <span className="sr-only"> km/h, over {SPEED_LIMIT_KMH} km/h</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="ch-speed-cap">km/h · red = above {SPEED_LIMIT_KMH} km/h</p>
        </>
      )}
    </Card>
  )
}
