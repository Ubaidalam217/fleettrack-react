import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts'
import { ChevronLeft, ChevronRight, ZoomOut, Printer, FileSpreadsheet } from 'lucide-react'
import { chartPoints, summarize, stepTrip, tripWindow, timeTicks } from '../../utils/tacho'
import { formatTime, formatDateTime, formatDateLabel, formatDateNum } from '../../utils/movementReport'
import { hms, km } from '../../utils/usageReports'

/**
 * The Tacho Graph (after Ctrack's Tacho Analysis, Ctrack-Reports-Catalog.md
 * §3.10): stacked lanes on one time axis — Speed, RPM, Distance and Trips —
 * with one cursor across all of them and a read-out of the moment under it.
 *
 * Every lane draws the same thinned series (utils/tacho.js chartPoints), so
 * recharts' syncId lines the cursor up by index. A drag across any lane zooms
 * to that stretch; ‹ Trip / Trip › zoom to the trips in turn. The summary
 * chips follow the zoom: they total what is on screen.
 *
 * Colours are CSS variables set per theme below; print switches them to the
 * light set so a dark-theme print is not white ink on white paper.
 */

const Y_W = 52
// Printable width of the A4 landscape page ReportFrame sets (297 mm less two
// 8 mm margins is ~1062 px), with a little room.
const PRINT_W = 1040
const MIN_ZOOM_SEC = 30
const SYNC_ID = 'tacho-graph'

const round = v => (Number.isFinite(v) ? Math.round(v) : '—')
const axisNum = v => (Number.isInteger(v) ? v : v.toFixed(1))
const ignText = v => (v === true ? 'On' : v === false ? 'Off' : '—')
const pad = n => String(n).padStart(2, '0')
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function tickText(ts, span) {
  const d = new Date(ts * 1000)
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (span < 86400 * 1.5 || d.getHours() !== 0 || d.getMinutes() !== 0) return hhmm
  return `${WEEKDAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`
}

/** "8:12:05AM – 9:40:31AM", with the dates when the window spans days. */
function windowText([a, b]) {
  const da = new Date(a * 1000), db = new Date(b * 1000)
  const sameDay = da.toDateString() === db.toDateString()
  return sameDay
    ? `${formatDateNum(da)} ${formatTime(a)} – ${formatTime(b)}`
    : `${formatDateTime(a)} – ${formatDateTime(b)}`
}

function NavButton({ onClick, disabled, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '7px 11px', borderRadius: 8, border: '1px solid var(--c-border2)',
        background: 'var(--c-card)', color: 'var(--c-text1)', fontSize: 12.5, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

function Stat({ label, value, unit }) {
  return (
    <div style={{ background: 'var(--c-input)', borderRadius: 10, padding: '9px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--c-text3)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--c-text1)', marginTop: 2, whiteSpace: 'nowrap' }}>
        {value}
        {unit && <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c-text3)', marginLeft: 4 }}>{unit}</span>}
      </div>
    </div>
  )
}

function LaneTitle({ children, aside }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: `10px 16px 2px ${Y_W + 4}px` }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--c-text2)', textTransform: 'uppercase' }}>{children}</span>
      {aside && <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>{aside}</span>}
    </div>
  )
}

// Rendered by the Tooltip of every lane: no box, just the shared cursor line —
// the read-out strip above the lanes carries the numbers.
const NoTip = () => null
const CURSOR = { stroke: 'var(--c-text2)', strokeWidth: 1, strokeDasharray: '3 3' }
const half = () => 0.5
// The top of a lane's scale: the first of these at or above its highest value,
// so the five default ticks land on round numbers (0-15-30-45-60, not 45 and 50
// crowding the top) and a parked stretch reads 0-20 km/h rather than 0-4.
const niceTop = steps => max => steps.find(s => s >= max) ?? Math.ceil(max / steps[steps.length - 1]) * steps[steps.length - 1]
const SPEED_DOMAIN = [0, niceTop([20, 40, 60, 80, 100, 120, 160, 200, 240])]
const RPM_DOMAIN = [0, niceTop([1000, 2000, 4000, 6000, 8000])]

/** The reading a chart event points at, by its index in the drawn series. */
function tsAt(state, data) {
  const i = Number(state?.activeTooltipIndex)
  return Number.isInteger(i) ? data[i]?.ts ?? null : null
}

/**
 * The four lanes. Memoised apart from the read-out so that moving the cursor
 * (which updates the read-out on every reading) does not redraw the charts.
 */
const Lanes = memo(function Lanes({ data, view, ticks, trips, tripIdx, hasRpm, sel, onDown, onMove, onLeave }) {
  const span = view[1] - view[0]
  const common = {
    data, syncId: SYNC_ID, margin: { top: 8, right: 16, bottom: 6, left: 0 },
    onMouseDown: onDown, onMouseMove: onMove, onMouseLeave: onLeave,
  }
  const xAxis = last => (
    <XAxis
      dataKey="ts" type="number" domain={view} allowDataOverflow ticks={ticks} hide={!last}
      tickFormatter={ts => tickText(ts, span)} axisLine={false} tickLine={false} tickMargin={8} height={last ? 26 : 0}
    />
  )
  const grid = <CartesianGrid vertical={false} stroke="var(--tg-grid)" />
  const tip = <Tooltip content={NoTip} cursor={CURSOR} isAnimationActive={false} />
  const selection = sel && sel.a !== sel.b && (
    <ReferenceArea x1={Math.min(sel.a, sel.b)} x2={Math.max(sel.a, sel.b)} fill="var(--tg-sel)" fillOpacity={1} ifOverflow="hidden" />
  )
  // A trip of a few seconds in a week-wide view would be thinner than a pixel.
  const minW = span / 500
  const tripAreas = trips
    .filter(({ t }) => t.endTs >= view[0] && t.startTs <= view[1])
    .map(({ t, i }) => {
      const x1 = Math.max(t.startTs, view[0])
      const x2 = Math.min(Math.max(t.endTs, x1 + minW), view[1])
      return (
        <ReferenceArea key={i} x1={x1} x2={x2} y1={0} y2={1} ifOverflow="hidden" fillOpacity={1}
          fill={i === tripIdx ? 'var(--tg-trip-on)' : 'var(--tg-trip)'} />
      )
    })
  // interval 0: every tick, the 0 at the foot of the lane included.
  const yAxis = props => <YAxis width={Y_W} interval={0} axisLine={false} tickLine={false} tickMargin={6} allowDecimals={false} tickFormatter={axisNum} {...props} />

  return (
    <div className="tg-lanes" style={{ userSelect: 'none', cursor: 'crosshair' }}>
      <LaneTitle aside="km/h">Speed</LaneTitle>
      <div style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart {...common}>
            {grid}
            {xAxis(false)}
            {yAxis({ domain: SPEED_DOMAIN })}
            {tip}
            <Area type="linear" dataKey="speed" stroke="var(--tg-speed)" strokeWidth={1.6} fill="var(--tg-speed)" fillOpacity={0.14}
              dot={false} activeDot={{ r: 4, fill: 'var(--c-card)', stroke: 'var(--tg-speed)', strokeWidth: 2 }} isAnimationActive={false} />
            {selection}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <LaneTitle aside={hasRpm ? 'rpm' : null}>Engine RPM</LaneTitle>
      {hasRpm ? (
        <div style={{ height: 110 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart {...common}>
              {grid}
              {xAxis(false)}
              {yAxis({ domain: RPM_DOMAIN })}
              {tip}
              <Line type="linear" dataKey="rpm" stroke="var(--tg-rpm)" strokeWidth={1.6} dot={false}
                activeDot={{ r: 4, fill: 'var(--c-card)', stroke: 'var(--tg-rpm)', strokeWidth: 2 }} isAnimationActive={false} />
              {selection}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{
          margin: `4px 16px 4px ${Y_W}px`, padding: '10px 12px', borderRadius: 8, border: '1px dashed var(--c-border)',
          fontSize: 12, color: 'var(--c-text3)',
        }}>
          This tracker does not send engine RPM.
        </div>
      )}

      <LaneTitle aside="km since the start of the period">Distance</LaneTitle>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart {...common}>
            {grid}
            {xAxis(false)}
            {yAxis({ domain: ['auto', 'auto'], allowDecimals: true })}
            {tip}
            <Line type="linear" dataKey="km" stroke="var(--tg-dist)" strokeWidth={2} dot={false}
              activeDot={{ r: 4, fill: 'var(--c-card)', stroke: 'var(--tg-dist)', strokeWidth: 2 }} isAnimationActive={false} />
            {selection}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <LaneTitle aside={<><Swatch color="var(--tg-trip)" />Trip (ignition on)<Swatch color="var(--tg-off)" style={{ marginLeft: 10 }} />Off / parked</>}>Trips</LaneTitle>
      <div style={{ height: 76 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart {...common}>
            {xAxis(true)}
            <YAxis width={Y_W} domain={[0, 1]} tick={false} axisLine={false} tickLine={false} />
            {tip}
            <ReferenceArea x1={view[0]} x2={view[1]} y1={0} y2={1} fill="var(--tg-off)" fillOpacity={1} ifOverflow="hidden" />
            {tripAreas}
            <Line dataKey={half} stroke="none" dot={false} activeDot={false} isAnimationActive={false} />
            {selection}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})

function Swatch({ color, style }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: color, marginRight: 5, verticalAlign: '-1px', ...style }} />
}

/**
 * @param {object}   props.tacho        buildTacho() of the vehicle
 * @param {number}   props.fromTs       the period shown when not zoomed
 * @param {number}   props.toTs
 * @param {string}   props.vehicleName
 * @param {string}   props.printDate
 * @param {function} props.onDay        (-1 | 1) → load the day before / after
 * @param {boolean}  props.canNextDay
 * @param {boolean}  props.busy         a load is running: the day buttons wait
 * @param {function} props.onExport    (window [x0, x1]) → Excel of its readings
 */
export default function TachoGraph({ tacho, fromTs, toTs, vehicleName, printDate, onDay, canNextDay, busy, onExport }) {
  const [zoom, setZoom] = useState(null)       // [x0, x1] or null for the whole period
  const [tripIdx, setTripIdx] = useState(null) // the trip ‹ Trip / Trip › moved to
  const [sel, setSel] = useState(null)         // { a, b } while a drag is under way
  const [hover, setHover] = useState(null)     // index into `data` under the cursor

  const full = useMemo(() => [fromTs, toTs], [fromTs, toTs])
  const view = zoom ?? full
  const data = useMemo(() => chartPoints(tacho.points, view[0], view[1]), [tacho, view])
  const ticks = useMemo(() => timeTicks(view[0], view[1]), [view])
  const trips = useMemo(() => tacho.trips.map((t, i) => ({ t, i })), [tacho])
  const stats = useMemo(() => summarize(tacho, view[0], view[1]), [tacho, view])

  // Before printing, the zoom that fits the lanes on the page (print CSS below).
  const paperRef = useRef(null)
  useEffect(() => {
    const fit = () => {
      const el = paperRef.current
      const w = el?.querySelector('.tg-lanes')?.getBoundingClientRect().width
      el?.style.setProperty('--tg-print-zoom', w ? String(Math.min(1, PRINT_W / w)) : '1')
    }
    window.addEventListener('beforeprint', fit)
    return () => window.removeEventListener('beforeprint', fit)
  }, [])

  // Handlers stay the same functions for the life of the graph (Lanes is
  // memoised on them), so they read the latest data and drag through refs.
  const dataRef = useRef(data)
  const selRef = useRef(null)
  useEffect(() => { dataRef.current = data }, [data])

  const onDown = useCallback(s => {
    const ts = tsAt(s, dataRef.current)
    if (ts === null) return
    selRef.current = { a: ts, b: ts }
    setSel(selRef.current)
  }, [])
  const onMove = useCallback(s => {
    const i = Number(s?.activeTooltipIndex)
    setHover(s?.isTooltipActive && Number.isInteger(i) ? i : null)
    if (!selRef.current) return
    const ts = tsAt(s, dataRef.current)
    if (ts !== null && ts !== selRef.current.b) {
      selRef.current = { ...selRef.current, b: ts }
      setSel(selRef.current)
    }
  }, [])
  const onLeave = useCallback(() => setHover(null), [])

  // The drag ends wherever the button is let go, inside a lane or not.
  const dragging = sel !== null
  useEffect(() => {
    if (!dragging) return
    const up = () => {
      const s = selRef.current
      selRef.current = null
      setSel(null)
      if (s && Math.abs(s.b - s.a) >= MIN_ZOOM_SEC) {
        setZoom([Math.min(s.a, s.b), Math.max(s.a, s.b)])
        setTripIdx(null)
      }
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [dragging])

  const prevTrip = stepTrip(tacho.trips, tripIdx, view, -1)
  const nextTrip = stepTrip(tacho.trips, tripIdx, view, 1)
  const goTrip = i => {
    if (i === null) return
    setTripIdx(i)
    setZoom(tripWindow(tacho.trips[i]))
  }
  const resetZoom = () => { setZoom(null); setTripIdx(null) }

  // The index is into the drawn series; after a zoom it may point past the end until the cursor moves.
  const p = hover !== null ? data[hover] ?? null : null
  const reading = [
    ['Time', p ? `${formatDateLabel(new Date(p.ts * 1000))}  ${formatTime(p.ts)}` : '—'],
    ['Speed', p && !p.gap ? `${round(p.speed)} km/h` : '—'],
    ['RPM', !tacho.hasRpm ? 'Not sent' : p && !p.gap && p.rpm !== null ? round(p.rpm) : '—'],
    ['Odo', p ? `${km(p.km)} km` : '—'],
    ['Ignition', p && !p.gap ? ignText(p.ign) : '—'],
  ]
  const trip = tripIdx !== null ? tacho.trips[tripIdx] : null
  const viewNote = trip
    ? `Trip ${tripIdx + 1} of ${tacho.trips.length}   ·   ${windowText([trip.startTs, trip.endTs])}   ·   ${km(trip.distanceKm)} km`
    : zoom ? `Zoomed to ${windowText(zoom)}` : null

  return (
    <>
      <style>{`
        .tg-paper {
          --tg-speed: var(--ft-accent);
          --tg-rpm: #c2410c;
          --tg-dist: #6d28d9;
          --tg-trip: #22a35a;
          --tg-trip-on: #116b3a;
          --tg-off: color-mix(in srgb, var(--c-text3) 16%, transparent);
          --tg-grid: color-mix(in srgb, var(--c-border) 75%, transparent);
          --tg-sel: color-mix(in srgb, var(--ft-accent) 20%, transparent);
        }
        .dark .tg-paper {
          --tg-rpm: #fb923c;
          --tg-dist: #b49cfb;
          --tg-trip: #2fbf6c;
          --tg-trip-on: #86efac;
          --tg-grid: color-mix(in srgb, var(--c-border) 70%, transparent);
        }
        .tg-paper .recharts-cartesian-axis-tick-value { fill: var(--c-text3); font-size: 11px; }
        .tg-paper .recharts-surface:focus, .tg-paper .recharts-wrapper:focus { outline: none; }
        @media print {
          .tg-paper, .dark .tg-paper {
            --c-card: #fff; --c-input: #f1f5f9; --c-border: #cbd5e1;
            --c-text1: #111827; --c-text2: #374151; --c-text3: #4b5563;
            --tg-speed: #0a7e9c; --tg-rpm: #c2410c; --tg-dist: #6d28d9; --tg-trip: #22a35a; --tg-trip-on: #116b3a;
            --tg-off: #e5e7eb; --tg-grid: #e5e7eb;
            background: #fff !important; color: #111827;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          /* The page is narrower than the screen, and the charts keep the pixel
             width they were drawn at (recharts sizes them from a 0 x 0 box, so a
             percentage width cannot shrink them). The lanes are zoomed down to
             the page instead; the factor is measured on beforeprint. */
          .tg-paper .tg-lanes { zoom: var(--tg-print-zoom, 1); }
          .tg-paper .recharts-tooltip-cursor, .tg-paper .recharts-active-dot { display: none; }
        }
      `}</style>

      <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <NavButton onClick={() => onDay(-1)} disabled={busy} title="Show the day before"><ChevronLeft size={14} />Day</NavButton>
          <NavButton onClick={() => goTrip(prevTrip)} disabled={prevTrip === null} title="Zoom to the trip before"><ChevronLeft size={14} />Trip</NavButton>
          <NavButton onClick={() => goTrip(nextTrip)} disabled={nextTrip === null} title="Zoom to the next trip">Trip<ChevronRight size={14} /></NavButton>
          <NavButton onClick={() => onDay(1)} disabled={busy || !canNextDay} title="Show the day after">Day<ChevronRight size={14} /></NavButton>
          <NavButton onClick={resetZoom} disabled={!zoom} title="Show the whole period again"><ZoomOut size={14} />Reset zoom</NavButton>
          <span style={{ fontSize: 11.5, color: 'var(--c-text3)', marginLeft: 4 }}>Drag across the graph to zoom in.</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <NavButton onClick={() => window.print()} title="Print the graph"><Printer size={14} />Print</NavButton>
          <NavButton onClick={() => onExport(view)} disabled={!stats.readings} title="The readings on screen, one row each">
            <FileSpreadsheet size={14} />Export Excel
          </NavButton>
        </div>
      </div>

      <div id="report-paper" ref={paperRef} className="tg-paper" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 4px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text1)' }}>{vehicleName}</div>
            <div style={{ fontSize: 12, color: 'var(--c-text2)', marginTop: 2 }}>{windowText(full)}</div>
            {viewNote && <div style={{ fontSize: 12, color: 'var(--ft-accent)', fontWeight: 600, marginTop: 2 }}>{viewNote}</div>}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--c-text3)', textAlign: 'right' }}>
            Tacho Graph<br />Printed {printDate}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, padding: '10px 16px 4px' }}>
          <Stat label="Distance" value={km(stats.distanceKm)} unit="km" />
          <Stat label="Drive time" value={hms(stats.driveSec)} />
          <Stat label="Max speed" value={round(stats.maxSpeed)} unit="km/h" />
          <Stat label="Trips" value={stats.trips} />
          <Stat label="Max RPM" value={tacho.hasRpm ? round(stats.maxRpm) : 'Not sent'} />
        </div>

        <div className="report-screen-only" aria-live="off" style={{
          margin: '10px 16px 0', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--c-border)',
          display: 'flex', gap: '6px 22px', flexWrap: 'wrap', alignItems: 'baseline', minHeight: 34,
        }}>
          {reading.map(([k, v]) => (
            <span key={k} style={{ fontSize: 12.5, color: 'var(--c-text1)', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--c-text3)', textTransform: 'uppercase', marginRight: 6 }}>{k}</span>
              {v}
            </span>
          ))}
          {!p && <span style={{ fontSize: 11.5, color: 'var(--c-text3)' }}>Point at the graph to read any moment.</span>}
        </div>

        {tacho.points.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', fontSize: 13, color: 'var(--c-text3)' }}>
            No messages from this vehicle in this period.
          </div>
        ) : (
          <Lanes data={data} view={view} ticks={ticks} trips={trips} tripIdx={tripIdx} hasRpm={tacho.hasRpm}
            sel={sel} onDown={onDown} onMove={onMove} onLeave={onLeave} />
        )}
        <div style={{ height: 10 }} />
      </div>
    </>
  )
}
