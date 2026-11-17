import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { FileDown, FileSpreadsheet, Printer, Search, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import { LABEL, FIELD, Chip, ToolbarButton } from '../../components/reports/controls'
import { useHiddenColumns, useVisibleColumns } from '../../utils/reportColumns'
import { get } from '../../data/http'
import { IS_REAL } from '../../data/mode'
import { formatDateTime, formatPrintDate } from '../../utils/movementReport'
import { PRESETS, presetRange, dateStr, timeStr } from '../../utils/reportRange'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { HISTORY_LEVELS, moveEvent, moveFromTo, moveMatches, moveTone, trackerInstalled } from '../../utils/vehicleHistory'

/**
 * Reallocation History Report (client report list, 2026-11-10): each time a
 * vehicle moved to another branch, group, Group Global Admin or Business
 * Group — when, from where to where, and who did it — and, "device wise",
 * which vehicles each tracker was installed in. The server records them
 * (server/src/lib/vehicleMoves.js) from the day this shipped; earlier moves
 * were never kept, so there is nothing to show before then.
 *
 * Also the vehicle & tracker history (client, 2026-11-17: "keep the history of
 * change and we can search it"): tracker changes made in FleetmaxX with their
 * note, renames, merges of a stale vehicle into another and its archive.
 * Searchable by plate (as it was then), old or new IMEI, place, note and user.
 */

const MAX_RANGE_DAYS = 366
const MOVE_LIMIT = 5000
const LEVELS = HISTORY_LEVELS
const installed = trackerInstalled

// Per tracker (client: "if we select by device wise then where this device installed history").
const DEVICE_COLUMNS = [
  { key: 'when',    label: 'Date / Time',     width: '15%', pdf: 14 },
  { key: 'event',   label: 'Event',           width: '13%', pdf: 13 },
  { key: 'vehicle', label: 'Vehicle',         width: '15%', pdf: 15 },
  { key: 'bg',      label: 'Business Group',  width: '17%', pdf: 17 },
  { key: 'by',      label: 'By',              width: '17%', pdf: 17 },
  { key: 'note',    label: 'Note',            width: '23%', pdf: 24 },
]

const COLUMNS = [
  { key: 'when',  label: 'Date / Time',     width: '13%', pdf: 12 },
  { key: 'imei',  label: 'IMEI',            width: '11%', pdf: 11 },
  { key: 'bg',    label: 'Business Group',  width: '11%', pdf: 11 },
  { key: 'level', label: 'Change',          width: '10%', pdf: 10 },
  { key: 'from',  label: 'From',            width: '13%', pdf: 13 },
  { key: 'to',    label: 'To',              width: '13%', pdf: 13 },
  { key: 'by',    label: 'By',              width: '11%', pdf: 11 },
  { key: 'note',  label: 'Note',            width: '18%', pdf: 19 },
]

const YEAR_DAYS = 365

export default function ReallocationHistoryReport(props) {
  const now = useRef(new Date()).current
  const { state: linkState } = useLocation()
  const fromLink = !!linkState?.search
  const [preset, setPreset] = useState(fromLink ? 'custom' : 'd30')
  const [fromDate, setFromDate] = useState(() => dateStr(fromLink ? new Date(now.getTime() - YEAR_DAYS * 86400000) : presetRange('d30', now).from))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))
  const [level, setLevel] = useState('all')
  // Under its Oil & Gas name ("Device Installation History") when opened from there.
  const title = useReportTitle('Reallocation History Report')
  // Oil & Gas's Device Installation History opens straight on the tracker view.
  const [per, setPer] = useState(linkState?.per === 'device' ? 'device' : 'vehicle') // 'vehicle' | 'device'
  // "Open full history" in the Vehicle information dialog opens on one vehicle's name, over a year.
  const [search, setSearch] = useState(() => linkState?.search ?? '')
  const [user, setUser] = useState('')
  const [hiddenCols, setHiddenCols] = useHiddenColumns(`reallocation-history-${per}`)
  const columns = per === 'device' ? DEVICE_COLUMNS : COLUMNS
  const shownCols = useVisibleColumns(columns, hiddenCols)

  const [raw, setRaw] = useState(null) // { moves, applied }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000), [toDate, toTime])
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const rangeTooLong = rangeValid && (toTs - fromTs) / 86400 > MAX_RANGE_DAYS

  const applyPreset = key => {
    setPreset(key)
    const range = presetRange(key)
    if (!range) return
    setFromDate(dateStr(range.from))
    setToDate(dateStr(range.to))
    setFromTime('00:00')
    setToTime(range.toEndOfDay ? '23:59' : timeStr(range.to))
  }

  const generate = useCallback(async () => {
    if (!rangeValid || rangeTooLong) return
    setError(null)
    setRaw(null)
    setBusy(true)
    try {
      const moves = IS_REAL
        ? await get('/api/vehicle-moves', { from: new Date(fromTs * 1000).toISOString(), to: new Date(toTs * 1000).toISOString() })
        : []
      setRaw({ moves: Array.isArray(moves) ? moves : [], applied: { fromTs, toTs, printDate: formatPrintDate() } })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }, [rangeValid, rangeTooLong, fromTs, toTs])

  // Opened from a vehicle's History: run it straight away.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!fromLink || autoRan.current) return
    autoRan.current = true
    generate()
  }, [fromLink, generate])

  // Level and search filter what was fetched; one vehicle (or tracker) per group, oldest first.
  const groups = useMemo(() => {
    if (!raw) return []
    const who = user.trim().toLowerCase()
    const kept = raw.moves.filter(m =>
      (per === 'device' ? m.level === 'device' : level === 'all' || m.level === level) &&
      moveMatches(m, search) &&
      (!who || String(m.movedByName ?? '').toLowerCase().includes(who)))
    if (per === 'device') {
      const byImei = new Map()
      for (const m of kept) {
        const key = m.imei || '—'
        if (!byImei.has(key)) byImei.set(key, [])
        byImei.get(key).push(m)
      }
      return [...byImei.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([imei, list]) => {
        const rows = list.sort((a, b) => Date.parse(a.movedAt) - Date.parse(b.movedAt)).map(m => ({
          key: m.id,
          when: formatDateTime(Math.floor(Date.parse(m.movedAt) / 1000)),
          event: moveEvent(m),
          vehicle: (installed(m) ? m.toName : m.fromName) || m.vehicleLabel,
          bg: m.bg?.name || '—',
          by: m.movedByName || '—',
          note: m.note || '—',
          cellStyle: { event: { fontWeight: 700, color: moveTone(m) } },
        }))
        const last = list[list.length - 1]
        return {
          key: imei, label: `Tracker ${imei}`, rows,
          total: installed(last) ? `Now in ${last.toName}` : `Not in a vehicle since ${rows[rows.length - 1].when}`,
        }
      })
    }
    // The server sends newest first, so a vehicle's group takes the name it
    // has now (a merged vehicle's rows read under the vehicle it went into).
    const byVehicle = new Map()
    for (const m of kept) {
      const key = m.vehicleId || `${m.vehicleLabel}|${m.imei}`
      if (!byVehicle.has(key)) byVehicle.set(key, { key, label: m.vehicleLabel, deleted: !m.vehicleId, archived: false, moves: [] })
      const g = byVehicle.get(key)
      if (m.level === 'archive') g.archived = true
      g.moves.push(m)
    }
    return [...byVehicle.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(v => ({
        key: v.key,
        label: v.deleted ? `${v.label} (deleted)` : v.archived ? `${v.label} (archived)` : v.label,
        rows: v.moves
          .sort((a, b) => Date.parse(a.movedAt) - Date.parse(b.movedAt))
          .map(m => {
            const tone = moveTone(m)
            // A tracker row names the tracker; the vehicle is the group.
            const { from, to } = moveFromTo(m)
            return {
              key: m.id,
              when: formatDateTime(Math.floor(Date.parse(m.movedAt) / 1000)),
              imei: m.imei || '—',
              bg: m.bg?.name || '—',
              level: moveEvent(m),
              from,
              to,
              by: m.movedByName || '—',
              note: m.note || '—',
              cellStyle: { ...(tone ? { level: { fontWeight: 700, color: tone } } : {}), to: { fontWeight: 700 } },
            }
          }),
        total: `Changes : ${v.moves.length}`,
      }))
  }, [raw, level, search, user, per])

  const applied = raw?.applied
  const dataRows = groups.reduce((n, g) => n + g.rows.length, 0)
  const filters = applied ? [
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs)],
    ['Per', per === 'device' ? 'Tracker' : 'Vehicle'],
    ...(per === 'vehicle' ? [['Change', LEVELS.find(l => l.key === level)?.label ?? 'All']] : []),
    ...(search.trim() ? [['Search', search.trim()]] : []),
    ...(user.trim() ? [['User', user.trim()]] : []),
  ] : []

  const exportOpts = () => ({
    title,
    subtitle: 'FleetmaxX',
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate: applied?.printDate,
    systemName: 'FleetmaxX',
    tables: groups.map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: shownCols.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })),
      rows: g.rows,
    })),
  })

  return (
    <ReportFrame
      title={title}
      desc="Each time a vehicle moved to another Business Group, branch, group or Group Global Admin, was renamed, had its tracker changed or removed, or was merged into another vehicle, and where each tracker has been installed: when, from what to what, by whom, and the note."
      {...props}
    >
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <div>
            <label style={LABEL}>FROM DATE</label>
            <input type="date" style={FIELD} value={fromDate} onChange={e => { setFromDate(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL}>FROM TIME</label>
            <input type="time" style={FIELD} value={fromTime} onChange={e => { setFromTime(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL}>TO DATE</label>
            <input type="date" style={FIELD} value={toDate} onChange={e => { setToDate(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL}>TO TIME</label>
            <input type="time" style={FIELD} value={toTime} onChange={e => { setToTime(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL} htmlFor="realloc-search">SEARCH</label>
            <div style={{ position: 'relative' }}>
              <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)' }} />
              <input
                id="realloc-search" type="search" placeholder="Plate, old or new IMEI, place, note…" value={search}
                onChange={e => setSearch(e.target.value)} style={{ ...FIELD, paddingLeft: 30 }}
              />
            </div>
          </div>
          <div>
            <label style={LABEL} htmlFor="realloc-user">USER</label>
            <input
              id="realloc-user" type="search" placeholder="Who made the change" value={user}
              onChange={e => setUser(e.target.value)} style={FIELD}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ ...LABEL, marginBottom: 0, marginRight: 4 }}>ONE GROUP PER</span>
              <Chip active={per === 'vehicle'} onClick={() => setPer('vehicle')}>Vehicle</Chip>
              <Chip active={per === 'device'} onClick={() => setPer('device')}>Tracker</Chip>
            </div>
            {per === 'vehicle' && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...LABEL, marginBottom: 0, marginRight: 4 }}>CHANGE</span>
                {LEVELS.map(l => <Chip key={l.key} active={level === l.key} onClick={() => setLevel(l.key)}>{l.label}</Chip>)}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {rangeTooLong && <span style={{ fontSize: 11.5, color: '#ef4444' }}>Choose {MAX_RANGE_DAYS} days or fewer.</span>}
            <button
              type="button"
              onClick={generate}
              disabled={busy || !rangeValid || rangeTooLong}
              style={{
                padding: '9px 20px', borderRadius: 8, border: 'none',
                background: busy || !rangeValid || rangeTooLong ? 'color-mix(in srgb, var(--ft-accent) 45%, #fff)' : 'var(--ft-accent)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: busy || !rangeValid || rangeTooLong ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? 'Generating report...' : 'Generate Report'}
            </button>
          </div>
        </div>
      </div>

      <div className="report-screen-only" style={{ fontSize: 12, color: 'var(--c-text3)', marginBottom: 12 }}>
        {IS_REAL
          ? 'Moves are recorded from the day this report went live; earlier moves were not kept.'
          : 'Moves are recorded by the server, so this report has data only when signed in to it.'}
      </div>

      {error && (
        <div className="report-screen-only" style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#ef4444', display: 'flex', gap: 8,
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {raw && (
        <>
          <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
              <strong style={{ color: 'var(--c-text1)' }}>{dataRows}</strong> {per === 'device' ? 'event' : 'change'}{dataRows === 1 ? '' : 's'}
              {' · '}{groups.length} {per === 'device' ? 'tracker' : 'vehicle'}{groups.length === 1 ? '' : 's'}
              {raw.moves.length >= MOVE_LIMIT && <span style={{ color: '#f97316' }}> · more moves than one report reads — narrow the range</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ColumnPicker columns={columns} hidden={hiddenCols} onChange={setHiddenCols} />
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), fileNameOf(title))} icon={FileDown} primary disabled={!dataRows}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), fileNameOf(title))} icon={FileSpreadsheet} disabled={!dataRows}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!dataRows}>Print</ToolbarButton>
            </div>
          </div>

          <PaperTable
            title={title}
            company="FleetmaxX"
            filters={filters}
            columns={shownCols}
            groups={groups}
            printDate={applied.printDate}
            emptyText={per === 'device' ? 'No tracker was installed or taken out in this period.' : 'No vehicle was changed in this period.'}
          />
        </>
      )}
    </ReportFrame>
  )
}
