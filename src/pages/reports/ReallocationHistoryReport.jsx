import { useCallback, useMemo, useRef, useState } from 'react'
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

/**
 * Reallocation History Report (client report list, 2026-11-10): each time a
 * vehicle moved to another branch, group, Group Global Admin or Business
 * Group — when, from where to where, and who did it — and, "device wise",
 * which vehicles each tracker was installed in. The server records them
 * (server/src/lib/vehicleMoves.js) from the day this shipped; earlier moves
 * were never kept, so there is nothing to show before then.
 */

const MAX_RANGE_DAYS = 366
const MOVE_LIMIT = 5000
const LEVELS = [
  { key: 'all',    label: 'All' },
  { key: 'bg',     label: 'Business Group' },
  { key: 'branch', label: 'Branch' },
  { key: 'group',  label: 'Group' },
  { key: 'ggb',    label: 'Group Global Admin' },
  { key: 'device', label: 'Tracker' },
]
const LEVEL_LABEL = { bg: 'Business Group', branch: 'Branch', group: 'Group', ggb: 'Group Global Admin' }

/** A tracker row: installed in a vehicle (toName) or taken out of one (fromName). */
const installed = m => m.level === 'device' && !!m.toName
const deviceText = m => (installed(m) ? 'Tracker installed' : 'Tracker taken out')

// Per tracker (client: "if we select by device wise then where this device installed history").
const DEVICE_COLUMNS = [
  { key: 'when',    label: 'Date / Time',     width: '16%', pdf: 15 },
  { key: 'event',   label: 'Event',           width: '15%', pdf: 14 },
  { key: 'vehicle', label: 'Vehicle',         width: '18%', pdf: 17 },
  { key: 'bg',      label: 'Business Group',  width: '25%', pdf: 24 },
  { key: 'by',      label: 'By',              width: '26%', pdf: 24 },
]

const COLUMNS = [
  { key: 'when',  label: 'Date / Time',     width: '15%', pdf: 14 },
  { key: 'imei',  label: 'IMEI',            width: '12%', pdf: 12 },
  { key: 'bg',    label: 'Business Group',  width: '14%', pdf: 13 },
  { key: 'level', label: 'Moved',           width: '11%', pdf: 10 },
  { key: 'from',  label: 'From',            width: '17%', pdf: 17 },
  { key: 'to',    label: 'To',              width: '17%', pdf: 17 },
  { key: 'by',    label: 'Moved By',        width: '14%', pdf: 14 },
]

export default function ReallocationHistoryReport(props) {
  const now = useRef(new Date()).current
  const [preset, setPreset] = useState('d30')
  const [fromDate, setFromDate] = useState(() => dateStr(presetRange('d30', now).from))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))
  const [level, setLevel] = useState('all')
  const [per, setPer] = useState('vehicle') // 'vehicle' | 'device'
  const [search, setSearch] = useState('')
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

  // Level and search filter what was fetched; one vehicle (or tracker) per group, oldest first.
  const groups = useMemo(() => {
    if (!raw) return []
    const q = search.trim().toLowerCase()
    const kept = raw.moves.filter(m =>
      (per === 'device' ? m.level === 'device' : level === 'all' || m.level === level) &&
      (!q || [m.vehicleLabel, m.imei, m.fromName, m.toName, m.bg?.name, m.movedByName].some(x => String(x ?? '').toLowerCase().includes(q))))
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
          event: deviceText(m),
          vehicle: (installed(m) ? m.toName : m.fromName) || m.vehicleLabel,
          bg: m.bg?.name || '—',
          by: m.movedByName || '—',
          cellStyle: { event: { fontWeight: 700, color: installed(m) ? '#15803d' : '#b91c1c' } },
        }))
        const last = list[list.length - 1]
        return {
          key: imei, label: `Tracker ${imei}`, rows,
          total: installed(last) ? `Now in ${last.toName}` : `Not in a vehicle since ${rows[rows.length - 1].when}`,
        }
      })
    }
    const byVehicle = new Map()
    for (const m of kept) {
      const key = m.vehicleId || `${m.vehicleLabel}|${m.imei}`
      if (!byVehicle.has(key)) byVehicle.set(key, { key, label: m.vehicleLabel, deleted: !m.vehicleId, moves: [] })
      byVehicle.get(key).moves.push(m)
    }
    return [...byVehicle.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(v => ({
        key: v.key,
        label: v.deleted ? `${v.label} (deleted)` : v.label,
        rows: v.moves
          .sort((a, b) => Date.parse(a.movedAt) - Date.parse(b.movedAt))
          .map(m => ({
            key: m.id,
            when: formatDateTime(Math.floor(Date.parse(m.movedAt) / 1000)),
            imei: m.imei || '—',
            bg: m.bg?.name || '—',
            level: m.level === 'device' ? deviceText(m) : LEVEL_LABEL[m.level] ?? m.level,
            // A tracker row names the tracker; the vehicle is the group.
            from: m.level === 'device' ? (installed(m) ? '—' : `IMEI ${m.imei}`) : m.fromName || '—',
            to: m.level === 'device' ? (installed(m) ? `IMEI ${m.imei}` : '—') : m.toName || '—',
            by: m.movedByName || '—',
            cellStyle: { to: { fontWeight: 700 } },
          })),
        total: `Moves : ${v.moves.length}`,
      }))
  }, [raw, level, search, per])

  const applied = raw?.applied
  const dataRows = groups.reduce((n, g) => n + g.rows.length, 0)
  const filters = applied ? [
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs)],
    ['Per', per === 'device' ? 'Tracker' : 'Vehicle'],
    ...(per === 'vehicle' ? [['Moved', LEVELS.find(l => l.key === level)?.label ?? 'All']] : []),
    ...(search.trim() ? [['Search', search.trim()]] : []),
  ] : []

  const exportOpts = () => ({
    title: 'Reallocation History Report',
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
      title="Reallocation History Report"
      desc="Each time a vehicle moved to another Business Group, branch, group or Group Global Admin, and where each tracker has been installed: when, from where to where, and by whom."
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
                id="realloc-search" type="search" placeholder="Vehicle, IMEI, branch…" value={search}
                onChange={e => setSearch(e.target.value)} style={{ ...FIELD, paddingLeft: 30 }}
              />
            </div>
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
                <span style={{ ...LABEL, marginBottom: 0, marginRight: 4 }}>MOVED</span>
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
              <strong style={{ color: 'var(--c-text1)' }}>{dataRows}</strong> {per === 'device' ? 'event' : 'move'}{dataRows === 1 ? '' : 's'}
              {' · '}{groups.length} {per === 'device' ? 'tracker' : 'vehicle'}{groups.length === 1 ? '' : 's'}
              {raw.moves.length >= MOVE_LIMIT && <span style={{ color: '#f97316' }}> · more moves than one report reads — narrow the range</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ColumnPicker columns={columns} hidden={hiddenCols} onChange={setHiddenCols} />
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), 'Reallocation_History_Report')} icon={FileDown} primary disabled={!dataRows}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), 'Reallocation_History_Report')} icon={FileSpreadsheet} disabled={!dataRows}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!dataRows}>Print</ToolbarButton>
            </div>
          </div>

          <PaperTable
            title="Reallocation History Report"
            company="FleetmaxX"
            filters={filters}
            columns={shownCols}
            groups={groups}
            printDate={applied.printDate}
            emptyText={per === 'device' ? 'No tracker was installed or taken out in this period.' : 'No vehicle was moved in this period.'}
          />
        </>
      )}
    </ReportFrame>
  )
}
