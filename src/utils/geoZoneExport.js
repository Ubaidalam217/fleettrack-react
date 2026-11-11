// Geo Zone Visit Report — PDF/Excel/Print export.
//
// Five sub-reports, each with its own column set, share ONE generic table
// renderer rather than five pixel-exact clones of the reference PDFs the way
// reportExport.js does for the single-table Movement Report — with 5 reports
// x 2 export formats that would be ten hand-measured geometries to keep in
// sync. What IS kept exact is the Movement Report PDF's look (its page
// geometry, title block, filter band, bands, zebra and footer) and the FleetmaX
// branding (loadLogo/drawLogo, never the AI Revofleet mark) — just driven by a
// `columns` config per report instead of hard-coded x-positions.
//
// Column widths are WEIGHTS, not points: the renderer scales every column's
// weight to the page's actual usable width, so a report with 12 columns and
// one with 26 both fill the page edge-to-edge without per-report tuning.
import { loadLogo, drawLogo, fileStamp, download } from './reportExport'
import { locationText } from './geoZoneReports'

// Page geometry and colours are the Movement Report PDF's (reportExport.js),
// so every report downloads in the same theme (client, 2026-11-11: "when I
// download the report, the theme changes"): title block and logo, the blue
// filter band of "Key : Value" cells, the blue header row, silver group bars,
// yellow date/total bands, zebra rows and the same footer.
const BORDER = { x: 13.15, y: 12.65, w: 815.75, h: 545.95 }
const BAND = { x: BORDER.x, w: BORDER.w }
const ZEBRA = { x: BORDER.x + 0.5, w: BORDER.w - 1 }
const BAND_TOP = 55.4
const BODY_BOTTOM = 556
const FOOTER_Y = 568.8
const GROUP_H = 9.3
const DATE_H = 9.25
// Cells WRAP, the way the reference PDFs do, instead of being cut to the
// column width — cutting turned "Ahtisham Malik" into "Ahtisham" and every
// "TEST - Base KM 6651 F" into "TEST -", which made the PDF useless for
// telling fences and vehicles apart. A row is as tall as its tallest cell.
const MAX_CELL_LINES = 6
const HEADER_MIN_H = 16

const BAND_BLUE = [176, 196, 222]
const GROUP_GRAY = [192, 192, 192]
const ZEBRA_GRAY = [230, 230, 230]
const TOTAL_YELLOW = [255, 255, 192]
const LINK_BLUE = [10, 126, 156]

/**
 * Body type: the Movement Report's 7pt, stepping down to 6.3pt for a table
 * wide enough (the Geofence Trip Report's 20-odd columns) to need it.
 */
function metricsFor(cols) {
  const fs = cols.length > 14 ? 6.3 : 7
  return { fs, lineH: fs >= 7 ? 9.25 : 8.6, wrapH: fs * 1.15 }
}

function clip(doc, text, width) {
  const s = String(text ?? '')
  if (!s) return ''
  return doc.splitTextToSize(s, width)[0] ?? ''
}

/** A cell's text wrapped to its column, capped at MAX_CELL_LINES (last line marked "..."). */
function wrap(doc, text, width) {
  const s = String(text ?? '')
  if (!s) return ['']
  const lines = doc.splitTextToSize(s, width)
  if (lines.length <= MAX_CELL_LINES) return lines
  const kept = lines.slice(0, MAX_CELL_LINES)
  // Plain dots: the standard Helvetica encoding has no reliable U+2026.
  kept[MAX_CELL_LINES - 1] = clip(doc, `${kept[MAX_CELL_LINES - 1].replace(/.{0,3}$/, '')}...`, width)
  return kept
}

/** Draw wrapped lines top-aligned in a cell whose top edge is `top`. */
function drawCellLines(doc, lines, col, top, m) {
  const tx = col.align === 'right' ? col.x + col.w - 3 : col.x + 3
  const opts = col.align === 'right' ? { align: 'right' } : undefined
  lines.forEach((line, i) => doc.text(line, tx, top + m.lineH - 1.6 + i * m.wrapH, opts))
}

const heightFor = (lineCount, m) => Math.max(m.lineH, m.lineH + (lineCount - 1) * m.wrapH)

/** Scale each column's relative `width` weight to fill the page's usable width. */
function layoutColumns(columns, usableWidth) {
  const cols = columns.filter(c => !c.excelOnly)
  const totalWeight = cols.reduce((s, c) => s + (c.width || 1), 0)
  let x = BORDER.x + 3
  return cols.map(c => {
    const w = (c.width / totalWeight) * usableWidth
    const col = { ...c, x, w }
    x += w
    return col
  })
}

/**
 * The filter band's [key, value] pairs: `opts.filters` when the caller has
 * them, else read back out of `filtersText` ("Key: Value" pieces joined by
 * wide spaces — what every report page builds).
 */
export function filterPairs({ filters, filtersText }) {
  if (filters?.length) return filters.map(([k, v]) => [String(k ?? ''), String(v ?? '')])
  if (!filtersText) return []
  return String(filtersText).split(/\s{3,}/).filter(Boolean).map(p => {
    const i = p.indexOf(': ')
    return i > 0 ? [p.slice(0, i), p.slice(i + 2)] : ['', p]
  })
}

// Three cells to a band row, 13.5pt apart, as the Movement band's two rows are.
const bandHeight = n => (n ? 10.7 + (Math.ceil(n / 3) - 1) * 13.5 + 6.85 : 0)

/** Title, logo, filter band and page border; returns where the body starts. */
function drawChrome(doc, { title, subtitle, pairs }) {
  doc.setTextColor(0, 0, 0)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(1)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16.1)
  doc.text(clip(doc, title, 640), 23.15, 34.85)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.15)
  doc.text(subtitle, 23.15, 48.6)
  drawLogo(doc)

  let top = BAND_TOP
  if (pairs.length) {
    const h = bandHeight(pairs.length)
    doc.setFillColor(...BAND_BLUE)
    doc.rect(BAND.x, BAND_TOP, BAND.w, h, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    const cellW = (BAND.w - 20) / 3
    pairs.forEach(([k, v], i) => {
      const text = k ? `${k}  :  ${v}` : v
      doc.text(clip(doc, text, cellW - 12), 23.15 + (i % 3) * cellW, BAND_TOP + 10.7 + Math.floor(i / 3) * 13.5)
    })
    top += h
  }

  doc.setLineWidth(1)
  doc.rect(BORDER.x, BORDER.y, BORDER.w, BORDER.h, 'S')
  return top + 1
}

function drawFooter(doc, pageNo, printDate, systemName) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(0, 0, 0)
  doc.text('Print Date : ', 19.4, FOOTER_Y)
  doc.text(String(printDate ?? ''), 67.4, FOOTER_Y)
  doc.text(systemName, 407.1, FOOTER_Y)
  doc.text(String(pageNo), 825.5, FOOTER_Y, { align: 'right' })
}

/** A full-width band — silver for a group, yellow for a date or total line. */
function drawBand(doc, y, h, color, text) {
  doc.setFillColor(...color)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(1)
  doc.rect(BAND.x, y, BAND.w, h, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(0, 0, 0)
  doc.text(clip(doc, text, BAND.w - 14), BORDER.x + 6, y + h - 2.3)
}

/**
 * The tables without the columns the user switched off (`opts.hiddenColumns`,
 * a Set of keys — utils/reportColumns.js). A table left with no columns is
 * dropped.
 */
function shownTables({ tables = [], hiddenColumns }) {
  return tables
    .map(t => (hiddenColumns?.size ? { ...t, columns: t.columns.filter(c => !hiddenColumns.has(c.key)) } : t))
    .filter(t => t.columns.length)
}

/** The closing "Report Summary" lines: the summary cards, then the report's own summary. */
const summaryLines = opts => [...(opts.summaryCards ?? []), ...(opts.reportSummary ?? [])]

/**
 * Render one or more {heading, columns, rows} tables in sequence, Movement
 * style: the header row is stamped at the top of every page and again only
 * when the columns change, each table's heading is a silver group bar (redrawn
 * on a continuation page), and a `{ kind: 'band', label }` row is a yellow
 * date band.
 *
 * @param {object} opts  {title, subtitle, filters?|filtersText, printDate, systemName, summaryCards, tables, hiddenColumns?, reportSummary?}
 *   A row with `strong` prints bold on the total yellow (a "Day Summary" line).
 *   `summaryCards` and `reportSummary` ([{label, value}]) print as the
 *   "Report Summary" block after the last table, the way Ctrack MaXx ends its
 *   reports.
 */
export async function buildGeoZonePdf(opts) {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), loadLogo()])
  const { title, subtitle = 'FleetmaxX', printDate, systemName = 'FleetmaxX' } = opts
  const pairs = filterPairs(opts)
  const tables = shownTables(opts)

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  let pageNo = 0
  let y = 0
  let stamped = null // the column set whose header row is on this page

  const startPage = () => {
    if (pageNo > 0) doc.addPage()
    pageNo += 1
    y = drawChrome(doc, { title, subtitle, pairs })
    drawFooter(doc, pageNo, printDate, systemName)
    stamped = null
  }

  startPage()

  for (const table of tables) {
    const cols = layoutColumns(table.columns, BORDER.w - 6)
    const m = metricsFor(cols)
    const sig = cols.map(c => `${c.key}:${c.w.toFixed(1)}`).join('|')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(m.fs)
    const headerLines = cols.map(c => wrap(doc, c.label, c.w - 6))
    const headerLineCount = Math.max(...headerLines.map(l => l.length))
    const headerH = Math.max(HEADER_MIN_H, headerLineCount * m.wrapH + 7)

    const drawHeader = () => {
      if (stamped === sig) return
      doc.setFillColor(...BAND_BLUE)
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(1)
      doc.rect(BAND.x, y, BAND.w, headerH, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(m.fs)
      doc.setTextColor(0, 0, 0)
      // Vertically centred in the band; each label top-aligned within that.
      const top = y + (headerH - heightFor(headerLineCount, m)) / 2
      cols.forEach((c, i) => drawCellLines(doc, headerLines[i], c, top, m))
      y += headerH
      stamped = sig
    }
    const drawGroup = () => {
      if (!table.heading) return
      drawBand(doc, y, GROUP_H, GROUP_GRAY, table.heading)
      y += GROUP_H + 1
    }
    const newPage = () => { startPage(); drawHeader(); drawGroup() }

    const need = (stamped === sig ? 0 : headerH) + (table.heading ? GROUP_H + 1 : 0) + m.lineH
    if (y + need > BODY_BOTTOM) startPage()
    drawHeader()
    drawGroup()
    let zebra = false

    for (const row of table.rows) {
      if (row.kind === 'band') {
        if (y + DATE_H + m.lineH > BODY_BOTTOM) newPage()
        drawBand(doc, y, DATE_H, TOTAL_YELLOW, row.label)
        y += DATE_H
        zebra = false
        continue
      }
      doc.setFont('helvetica', row.strong ? 'bold' : 'normal')
      doc.setFontSize(m.fs)
      const cellLines = cols.map(c => wrap(doc, row[c.key], c.w - 6))
      const lineCount = Math.max(...cellLines.map(l => l.length))
      // Single-line rows keep the Movement pitch; wrapped ones get a little air.
      const rowH = heightFor(lineCount, m) + (lineCount > 1 ? 2 : 0)

      if (y + rowH > BODY_BOTTOM) { newPage(); zebra = false }
      if (row.strong) {
        doc.setFillColor(...TOTAL_YELLOW)
        doc.rect(ZEBRA.x, y, ZEBRA.w, rowH, 'F')
      } else if (zebra) {
        doc.setFillColor(...ZEBRA_GRAY)
        doc.rect(ZEBRA.x, y, ZEBRA.w, rowH, 'F')
      }
      zebra = row.strong ? false : !zebra
      doc.setFont('helvetica', row.strong ? 'bold' : 'normal')
      doc.setFontSize(m.fs)
      cols.forEach((c, i) => {
        // A column with `hrefKey` links its cell, e.g. a location to our map.
        const href = c.hrefKey ? row[c.hrefKey] : null
        doc.setTextColor(...(href ? LINK_BLUE : [0, 0, 0]))
        drawCellLines(doc, cellLines[i], c, y, m)
        if (href) doc.link(c.x, y, c.w, rowH, { url: href })
      })
      doc.setTextColor(0, 0, 0)
      y += rowH
    }
    y += 1
  }

  const summary = summaryLines(opts)
  if (summary.length) {
    y += 6
    const blockH = 16 + summary.length * 11
    if (y + blockH > BODY_BOTTOM) startPage()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(0, 0, 0)
    doc.text('Report Summary:', BORDER.x + 6, y + 9)
    y += 16
    doc.setFontSize(7.5)
    for (const { label, value } of summary) {
      doc.setFont('helvetica', 'bold')
      doc.text(`${label}:`, BORDER.x + 6, y + 7)
      doc.setFont('helvetica', 'normal')
      doc.text(String(value ?? ''), BORDER.x + 130, y + 7)
      y += 11
    }
  }

  // "END OF REPORT", centred on the table, one row below the last one.
  y += 4
  if (y + 9.25 > BODY_BOTTOM) startPage()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(0, 0, 0)
  doc.text('END OF REPORT', BORDER.x + BORDER.w / 2, y + 7.7, { align: 'center' })

  return doc
}

export async function exportGeoZonePdf(opts, filenameBase) {
  const doc = await buildGeoZonePdf(opts)
  doc.save(`${filenameBase}_${fileStamp()}.pdf`)
}

// ── Excel ───────────────────────────────────────────────────────────────────

function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

export async function exportGeoZoneExcel(opts, filenameBase) {
  const ExcelJS = (await import('exceljs')).default
  const { title, subtitle = 'FleetmaxX', printDate, systemName = 'FleetmaxX' } = opts
  const pairs = filterPairs(opts)
  const tables = shownTables(opts)

  const wb = new ExcelJS.Workbook()
  wb.creator = systemName
  const ws = wb.addWorksheet(title.slice(0, 31) || 'Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  // The Movement sheet's look: every band runs the width of the widest table.
  const n = Math.max(3, ...tables.map(t => t.columns.length))
  const paint = (row, argb, bold) => {
    for (let c = 1; c <= n; c++) {
      const cell = row.getCell(c)
      if (argb) cell.fill = fill(argb)
      cell.font = { ...(cell.font ?? {}), bold, size: 9 }
    }
  }
  const lastCol = (() => { let s = '', k = n; while (k > 0) { const r = (k - 1) % 26; s = String.fromCharCode(65 + r) + s; k = Math.floor((k - 1) / 26) } return s })()
  const mergeRow = r => ws.mergeCells(`A${r}:${lastCol}${r}`)

  const t = ws.addRow([title])
  t.getCell(1).font = { bold: true, size: 16 }
  mergeRow(t.number)
  const s = ws.addRow([subtitle])
  s.getCell(1).font = { size: 9 }
  mergeRow(s.number)

  // Filter band: three "Key : Value" cells a row, spread across the sheet.
  const third = Math.max(1, Math.floor(n / 3))
  for (let i = 0; i < pairs.length; i += 3) {
    const cells = Array(n).fill('')
    pairs.slice(i, i + 3).forEach(([k, v], j) => { cells[j * third] = k ? `${k} :  ${v}` : v })
    paint(ws.addRow(cells), 'FFB0C4DE', false)
  }
  ws.addRow([])

  let widths = null
  let stamped = null
  for (const table of tables) {
    const cols = table.columns // Excel gets every column, including excelOnly ones.
    const sig = cols.map(c => c.key).join('|')
    if (!widths) {
      widths = cols.map(c => Math.max(10, Math.round((c.width || 1) * 1.6)))
      ws.columns = widths.map(width => ({ width }))
    }
    if (stamped !== sig) {
      paint(ws.addRow(cols.map(c => c.label)), 'FFB0C4DE', true)
      stamped = sig
    }
    if (table.heading) {
      const h = ws.addRow([table.heading])
      paint(h, 'FFC0C0C0', true)
    }
    for (const row of table.rows) {
      if (row.kind === 'band') {
        paint(ws.addRow([row.label]), 'FFFFFFC0', true)
        continue
      }
      const r = ws.addRow(cols.map(c => row[c.key] ?? ''))
      r.font = { size: 9, bold: !!row.strong }
      if (row.strong) r.eachCell(cell => { cell.fill = fill('FFFFFFC0') })
      cols.forEach((c, i) => {
        const href = c.hrefKey ? row[c.hrefKey] : null
        if (!href) return
        const cell = r.getCell(i + 1)
        cell.value = { text: String(row[c.key] ?? ''), hyperlink: href }
        cell.font = { size: 9, color: { argb: 'FF0A7E9C' }, underline: true }
      })
    }
  }

  const summary = summaryLines(opts)
  if (summary.length) {
    ws.addRow([])
    const h = ws.addRow(['Report Summary:'])
    h.getCell(1).font = { bold: true, size: 10 }
    for (const { label, value } of summary) {
      const r = ws.addRow([`${label}:`, value])
      r.getCell(1).font = { bold: true, size: 9 }
      r.getCell(2).font = { size: 9 }
    }
  }

  ws.addRow([])
  const end = ws.addRow(['END OF REPORT'])
  end.getCell(1).font = { bold: true, size: 9 }
  const stamp = ws.addRow([`Print Date : ${printDate}`, '', systemName])
  stamp.font = { size: 8 }

  const buffer = await wb.xlsx.writeBuffer()
  download(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${filenameBase}_${fileStamp()}.xlsx`
  )
}

export function printGeoZoneReport() {
  window.print()
}

// ── per-report shaping ───────────────────────────────────────────────────────
// Turns geoZoneReports.js's aggregation output into {summaryCards, tables} for
// the generic renderer above. Resolves each row's Location/Position display
// text here (via locationText()) rather than baking it into geoZoneReports.js,
// so the aggregation layer stays free of "what does the UI show right now"
// concerns — it only needs to know the geocode cache may still be filling in.

export function withLocationText(rows, fields) {
  return rows.map(r => {
    const out = { ...r }
    for (const [textKey, latKey, lngKey] of fields) {
      out[`${textKey}Text`] = locationText(r, textKey, latKey, lngKey)
    }
    return out
  })
}

// ── 1. Geofence Trip Report ──────────────────────────────────────────────────

export const TRIP_COLUMNS = [
  { key: 'company', label: 'Company', width: 55 },
  { key: 'branch', label: 'Branch', width: 60 },
  { key: 'vehicle', label: 'Vehicle', width: 50 },
  { key: 'driver', label: 'Driver', width: 35 },
  { key: 'startFence', label: 'Start Fence', width: 50 },
  { key: 'startLocationText', label: 'Start Location', width: 85 },
  { key: 'startPosition', label: 'Start Position', width: 75, excelOnly: true },
  { key: 'startTime', label: 'Start Time', width: 70 },
  { key: 'startTemp', label: 'Start Temp', width: 38, align: 'right' },
  { key: 'endFence', label: 'End Fence', width: 50 },
  { key: 'endLocationText', label: 'End Location', width: 85 },
  { key: 'endPosition', label: 'End Position', width: 75, excelOnly: true },
  { key: 'endTime', label: 'End Time', width: 70 },
  { key: 'endTemp', label: 'End Temp', width: 38, align: 'right' },
  { key: 'avgTemp', label: 'Avg Temp', width: 38, align: 'right' },
  { key: 'distanceKm', label: 'Distance (km)', width: 48, align: 'right' },
  { key: 'lastDistanceKm', label: 'Last Distance', width: 48, align: 'right' },
  { key: 'runningSec', label: 'Running', width: 50, align: 'right' },
  { key: 'idleSec', label: 'Idle', width: 50, align: 'right' },
  { key: 'stopSec', label: 'Stop', width: 50, align: 'right' },
  { key: 'inactiveSec', label: 'Inactive', width: 50, align: 'right' },
  { key: 'duration', label: 'Duration', width: 50, align: 'right' },
  { key: 'startFuel', label: 'Start Fuel', width: 35, align: 'right', excelOnly: true },
  { key: 'endFuel', label: 'End Fuel', width: 35, align: 'right', excelOnly: true },
  { key: 'refill', label: 'Refill', width: 32, align: 'right', excelOnly: true },
  { key: 'drain', label: 'Drain', width: 32, align: 'right', excelOnly: true },
  { key: 'fuelConsumed', label: 'Fuel Consumed', width: 48, align: 'right' },
  { key: 'fuelCost', label: 'Fuel Cost', width: 38, align: 'right', excelOnly: true },
]

function tripReportTables(report) {
  return report.perVehiclePages.map(p => ({
    heading: `${p.meta.company} — ${p.meta.branch} — ${p.meta.vehicleId}`,
    columns: TRIP_COLUMNS,
    rows: withLocationText(p.rows, [
      ['startLocation', 'startLat', 'startLng'],
      ['endLocation', 'endLat', 'endLng'],
    ]),
  }))
}

function tripReportSummaryCards(report) {
  const s = report.summary
  return [
    { label: 'Distance (km)', value: s.distanceKm },
    { label: 'Running', value: s.runningSec },
    { label: 'Idle', value: s.idleSec },
    { label: 'Stop', value: s.stopSec },
    { label: 'Inactive', value: s.inactiveSec },
    { label: 'Fuel Consumed', value: s.fuelConsumed },
  ]
}

function tripReportExportOpts(report, filters, meta) {
  return {
    title: 'Geofence Trip Report',
    subtitle: meta.subtitle, filters: filters.pairs, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
    hiddenColumns: meta.hiddenColumns,
    summaryCards: tripReportSummaryCards(report),
    tables: tripReportTables(report),
  }
}

export const exportTripReportPdf = (report, filters, meta) => exportGeoZonePdf(tripReportExportOpts(report, filters, meta), 'Geofence_Trip_Report')
export const exportTripReportExcel = (report, filters, meta) => exportGeoZoneExcel(tripReportExportOpts(report, filters, meta), 'Geofence_Trip_Report')

// ── 2. Geofence Visited Summary ──────────────────────────────────────────────

export const VISITED_OVERVIEW_COLUMNS = [
  { key: 'company', label: 'Company', width: 70 },
  { key: 'branch', label: 'Branch', width: 80 },
  { key: 'vehicle', label: 'Vehicle', width: 60 },
  { key: 'noOfVisits', label: 'No of Visits', width: 45, align: 'right' },
  { key: 'geofenceDuration', label: 'Geofence Duration (HH:MM:SS)', width: 70, align: 'right' },
  { key: 'geofenceOutsideDuration', label: 'Geofence Outside Duration (HH:MM:SS)', width: 75, align: 'right' },
]

export const VISITED_DETAIL_COLUMNS = [
  { key: 'geofence', label: 'Geofence', width: 55 },
  { key: 'reachTime', label: 'Reach Time', width: 65 },
  { key: 'reachLocationText', label: 'Reach Location', width: 90 },
  { key: 'reachCoordinates', label: 'Reach Coordinates', width: 70, excelOnly: true },
  { key: 'departTime', label: 'Depart Time', width: 65 },
  { key: 'departLocationText', label: 'Depart Location', width: 90 },
  { key: 'departCoordinates', label: 'Depart Coordinates', width: 70, excelOnly: true },
  { key: 'geofenceDuration', label: 'Geofence Duration', width: 55, align: 'right' },
  { key: 'geofenceOutsideDuration', label: 'Geofence Outside Duration (HH:MM:SS)', width: 55, align: 'right' },
  { key: 'tempPort', label: 'Temp (Port)', width: 38, align: 'right' },
  { key: 'tempReach', label: 'Temp (Reach)', width: 38, align: 'right' },
  { key: 'tempDeparture', label: 'Temp (Depart)', width: 38, align: 'right' },
  { key: 'tempAverage', label: 'Temp (Avg)', width: 38, align: 'right' },
]

function visitedSummaryTables(report) {
  const tables = [{ heading: 'Overview', columns: VISITED_OVERVIEW_COLUMNS, rows: report.vehicleRows }]
  for (const p of report.perVehiclePages) {
    tables.push({
      heading: `${p.meta.company} — ${p.meta.branch} — ${p.meta.vehicleId}  (Duration ${p.summary.geofenceDuration}, Outside ${p.summary.geofenceOutsideDuration})`,
      columns: VISITED_DETAIL_COLUMNS,
      rows: withLocationText(p.rows, [
        ['reachLocation', 'reachLat', 'reachLng'],
        ['departLocation', 'departLat', 'departLng'],
      ]),
    })
  }
  return tables
}

function visitedSummaryExportOpts(report, filters, meta) {
  return {
    title: 'Geofence Visited Summary',
    subtitle: meta.subtitle, filters: filters.pairs, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
    hiddenColumns: meta.hiddenColumns,
    summaryCards: [
      { label: 'No of Visits', value: report.summary.noOfVisits },
      { label: 'Geofence Duration', value: report.summary.geofenceDuration },
      { label: 'Geofence Outside Duration', value: report.summary.geofenceOutsideDuration },
    ],
    tables: visitedSummaryTables(report),
  }
}

export const exportVisitedSummaryPdf = (report, filters, meta) => exportGeoZonePdf(visitedSummaryExportOpts(report, filters, meta), 'Geofence_Visited_Summary')
export const exportVisitedSummaryExcel = (report, filters, meta) => exportGeoZoneExcel(visitedSummaryExportOpts(report, filters, meta), 'Geofence_Visited_Summary')

// ── 3. Address Visits ────────────────────────────────────────────────────────

export const ADDRESS_VISITS_COLUMNS = [
  { key: 'company', label: 'Company', width: 60 },
  { key: 'branch', label: 'Branch', width: 65 },
  { key: 'object', label: 'Object', width: 55 },
  { key: 'driver', label: 'Driver', width: 40 },
  { key: 'name', label: 'Name', width: 90 },
  { key: 'type', label: 'Type', width: 55 },
  { key: 'arrivalTime', label: 'Arrival Time', width: 70 },
  { key: 'departureTime', label: 'Departure Time', width: 70 },
  { key: 'visitDuration', label: 'Visit Duration (HH:MM)', width: 55, align: 'right' },
]

function addressVisitsExportOpts(report, filters, meta) {
  return {
    title: 'Address Visits',
    subtitle: meta.subtitle, filters: filters.pairs, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
    hiddenColumns: meta.hiddenColumns,
    summaryCards: [{ label: 'Total Visits', value: report.rows.length }],
    tables: [{ heading: null, columns: ADDRESS_VISITS_COLUMNS, rows: report.rows }],
  }
}

export const exportAddressVisitsPdf = (report, filters, meta) => exportGeoZonePdf(addressVisitsExportOpts(report, filters, meta), 'Address_Visits')
export const exportAddressVisitsExcel = (report, filters, meta) => exportGeoZoneExcel(addressVisitsExportOpts(report, filters, meta), 'Address_Visits')

// ── 4. Geofence History ──────────────────────────────────────────────────────

export const HISTORY_SUMMARY_COLUMNS = [
  { key: 'company', label: 'Company', width: 60 },
  { key: 'branch', label: 'Branch', width: 65 },
  { key: 'object', label: 'Object', width: 55 },
  { key: 'driver', label: 'Driver', width: 35 },
  { key: 'employeeNo', label: 'Employee No', width: 40 },
  { key: 'geofenceName', label: 'Geofence Name', width: 60 },
  { key: 'geofenceType', label: 'Geofence Type', width: 50 },
  { key: 'noOfVisits', label: 'No of Visits', width: 40, align: 'right' },
]

export const HISTORY_DETAIL_COLUMNS = [
  { key: 'company', label: 'Company', width: 55 },
  { key: 'branch', label: 'Branch', width: 60 },
  { key: 'vehicle', label: 'Vehicle', width: 50 },
  { key: 'driver', label: 'Driver', width: 35 },
  { key: 'employeeNo', label: 'Employee No', width: 40 },
  { key: 'geofenceName', label: 'Geofence Name', width: 55 },
  { key: 'entryTime', label: 'Fence Entry Time', width: 65 },
  { key: 'entryPositionText', label: 'Entry Position', width: 95 },
  { key: 'durationInFence', label: 'Duration in Fence', width: 55, align: 'right' },
  { key: 'approxDistance', label: 'Approx Distance (km)', width: 55, align: 'right' },
  { key: 'exitTime', label: 'Fence Exit Time', width: 65 },
  { key: 'exitPositionText', label: 'Exit Position', width: 95 },
]

function geofenceHistoryTables(report) {
  const tables = [{
    heading: 'Summary',
    columns: HISTORY_SUMMARY_COLUMNS,
    rows: report.groups.map(g => ({ ...g })),
  }]
  for (const g of report.groups) {
    tables.push({
      heading: `${g.company} — ${g.branch} — ${g.object} — ${g.geofenceName}`,
      columns: HISTORY_DETAIL_COLUMNS,
      rows: withLocationText(g.detailRows, [
        ['entryPosition', 'entryLat', 'entryLng'],
        ['exitPosition', 'exitLat', 'exitLng'],
      ]),
    })
  }
  return tables
}

function geofenceHistoryExportOpts(report, filters, meta) {
  return {
    title: 'Geofence History',
    subtitle: meta.subtitle, filters: filters.pairs, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
    hiddenColumns: meta.hiddenColumns,
    summaryCards: [{ label: 'Geofence×Vehicle Pairs', value: report.groups.length }],
    tables: geofenceHistoryTables(report),
  }
}

export const exportGeofenceHistoryPdf = (report, filters, meta) => exportGeoZonePdf(geofenceHistoryExportOpts(report, filters, meta), 'Geofence_History')
export const exportGeofenceHistoryExcel = (report, filters, meta) => exportGeoZoneExcel(geofenceHistoryExportOpts(report, filters, meta), 'Geofence_History')

// ── 5. Geofence-to-Geofence Trip Summary ─────────────────────────────────────

export const G2G_OVERVIEW_COLUMNS = [
  { key: 'company', label: 'Company', width: 55 },
  { key: 'branch', label: 'Branch', width: 60 },
  { key: 'vehicle', label: 'Vehicle', width: 50 },
  { key: 'driver', label: 'Driver', width: 35 },
  { key: 'employeeNo', label: 'Employee No', width: 40 },
  { key: 'startFence', label: 'Trip Start Geofence', width: 55 },
  { key: 'endFence', label: 'Trip End Geofence', width: 55 },
  { key: 'noOfTrips', label: 'No of Trips', width: 40, align: 'right' },
  { key: 'distanceKm', label: 'Distance (km)', width: 45, align: 'right' },
  { key: 'running', label: 'Running', width: 42, align: 'right' },
  { key: 'idle', label: 'Idle', width: 38, align: 'right' },
  { key: 'stop', label: 'Stop', width: 38, align: 'right' },
  { key: 'inactive', label: 'Inactive', width: 42, align: 'right' },
  { key: 'duration', label: 'Duration', width: 42, align: 'right' },
]

export const G2G_DETAIL_COLUMNS = [
  { key: 'tripNo', label: 'Trip No', width: 28, align: 'right' },
  { key: 'driver', label: 'Driver', width: 35 },
  { key: 'employeeNo', label: 'Employee No', width: 40 },
  { key: 'startFence', label: 'Trip Start Geofence', width: 55 },
  { key: 'startDate', label: 'Trip Start Date', width: 68 },
  { key: 'endFence', label: 'Trip End Geofence', width: 55 },
  { key: 'endDate', label: 'Trip End Date', width: 68 },
  { key: 'distanceKm', label: 'Distance', width: 42, align: 'right' },
  { key: 'running', label: 'Running', width: 40, align: 'right' },
  { key: 'idle', label: 'Idle', width: 36, align: 'right' },
  { key: 'stop', label: 'Stop', width: 36, align: 'right' },
  { key: 'inactive', label: 'Inactive', width: 40, align: 'right' },
  { key: 'duration', label: 'Duration', width: 40, align: 'right' },
  { key: 'avg', label: 'AVG', width: 28, align: 'right' },
  { key: 'max', label: 'MAX', width: 28, align: 'right' },
]

function g2gTripSummaryTables(report) {
  const tables = [{ heading: 'Overview', columns: G2G_OVERVIEW_COLUMNS, rows: report.vehicleRows }]
  for (const p of report.perVehiclePages) {
    tables.push({
      heading: `${p.meta.company} — ${p.meta.branch} — ${p.meta.vehicleId}`,
      columns: G2G_DETAIL_COLUMNS,
      rows: p.rows,
    })
  }
  return tables
}

function g2gTripSummaryExportOpts(report, filters, meta) {
  return {
    title: 'Geofence to Geofence Trip Summary',
    subtitle: meta.subtitle, filters: filters.pairs, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
    hiddenColumns: meta.hiddenColumns,
    summaryCards: [
      { label: 'No of Trips', value: report.summary.noOfTrips },
      { label: 'Distance (km)', value: report.summary.distanceKm },
      { label: 'Running', value: report.summary.running },
      { label: 'Stop', value: report.summary.stop },
      { label: 'Inactive', value: report.summary.inactive },
    ],
    tables: g2gTripSummaryTables(report),
  }
}

export const exportG2GTripSummaryPdf = (report, filters, meta) => exportGeoZonePdf(g2gTripSummaryExportOpts(report, filters, meta), 'Geofence_to_Geofence_Trip_Summary')
export const exportG2GTripSummaryExcel = (report, filters, meta) => exportGeoZoneExcel(g2gTripSummaryExportOpts(report, filters, meta), 'Geofence_to_Geofence_Trip_Summary')
