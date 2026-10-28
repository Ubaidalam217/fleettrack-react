// Geo Zone Visit Report — PDF/Excel/Print export.
//
// Five sub-reports, each with its own column set, share ONE generic table
// renderer rather than five pixel-exact clones of the reference PDFs the way
// reportExport.js does for the single-table Movement Report — with 5 reports
// x 2 export formats that would be ten hand-measured geometries to keep in
// sync. What IS kept exact: the FleetmaX branding (loadLogo/drawLogo, the
// house colors, never the AI Revofleet mark) and the house style (band blue,
// zebra rows, bordered page, page-numbered footer) — just driven by a
// `columns` config per report instead of hard-coded x-positions.
//
// Column widths are WEIGHTS, not points: the renderer scales every column's
// weight to the page's actual usable width, so a report with 12 columns and
// one with 26 both fill the page edge-to-edge without per-report tuning.
import { loadLogo, drawLogo, fileStamp, download } from './reportExport'
import { locationText } from './geoZoneReports'

const BORDER = { x: 13.15, y: 12.65, w: 815.75, h: 545.95 }
const BODY_TOP = 95
const BODY_BOTTOM = 556
const LINE_H = 8.6
const FONT_SIZE = 6.3
// Cells WRAP, the way the reference PDFs do, instead of being cut to the
// column width — cutting turned "Ahtisham Malik" into "Ahtisham" and every
// "TEST - Base KM 6651 F" into "TEST -", which made the PDF useless for
// telling fences and vehicles apart. A row is as tall as its tallest cell.
const WRAP_LINE_H = FONT_SIZE * 1.15
const MAX_CELL_LINES = 6
const HEADER_MIN_H = 16

const BAND_BLUE = [176, 196, 222]
const ZEBRA_GRAY = [232, 232, 232]

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
function drawCellLines(doc, lines, col, top) {
  const tx = col.align === 'right' ? col.x + col.w - 3 : col.x + 3
  const opts = col.align === 'right' ? { align: 'right' } : undefined
  lines.forEach((line, i) => doc.text(line, tx, top + LINE_H - 2 + i * WRAP_LINE_H, opts))
}

const heightFor = lineCount => Math.max(LINE_H, LINE_H + (lineCount - 1) * WRAP_LINE_H)

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

function drawChrome(doc, { title, subtitle, filtersText }) {
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(title, 23.15, 32)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(subtitle, 23.15, 44)
  if (filtersText) {
    doc.setFontSize(6.5)
    doc.setTextColor(70, 70, 70)
    doc.text(clip(doc, filtersText, 650), 23.15, 54)
    doc.setTextColor(0, 0, 0)
  }
  drawLogo(doc)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(1)
  doc.rect(BORDER.x, BORDER.y, BORDER.w, BORDER.h, 'S')
}

function drawFooter(doc, pageNo, printDate, systemName) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(0, 0, 0)
  doc.text(`Print Date : ${printDate}`, 19.4, 568.8)
  doc.text(systemName, 407.1, 568.8)
  doc.text(String(pageNo), 825.5, 568.8, { align: 'right' })
}

/** Small label:value chips — the per-report aggregate stats (No of Visits, Distance, ...). */
function drawSummaryCards(doc, y, cards) {
  const w = 130, h = 26, gap = 8
  let x = BORDER.x + 4
  for (const { label, value } of cards) {
    doc.setFillColor(...BAND_BLUE)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.5)
    doc.rect(x, y, w, h, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(40, 40, 40)
    doc.text(label, x + 6, y + 10)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(0, 0, 0)
    doc.text(String(value), x + 6, y + 21)
    x += w + gap
    if (x + w > BORDER.x + BORDER.w) { x = BORDER.x + 4; y += h + 6 }
  }
  return y + h + 10
}

/**
 * Render one or more {heading, columns, rows} tables in sequence, with
 * header-band re-stamping and page breaks shared across every sub-report.
 *
 * @param {object} opts  {title, subtitle, filtersText, printDate, systemName, summaryCards, tables}
 */
export async function buildGeoZonePdf(opts) {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), loadLogo()])
  const { title, subtitle = 'FleetmaX', filtersText = '', printDate, systemName = 'FleetmaX', summaryCards = [], tables = [] } = opts

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  let pageNo = 0
  let y = BODY_TOP

  const startPage = (withCards = false) => {
    if (pageNo > 0) doc.addPage()
    pageNo += 1
    drawChrome(doc, { title, subtitle, filtersText })
    drawFooter(doc, pageNo, printDate, systemName)
    y = BODY_TOP
    if (withCards && summaryCards.length) y = drawSummaryCards(doc, y, summaryCards)
  }

  startPage(true)

  for (const table of tables) {
    const cols = layoutColumns(table.columns, BORDER.w - 6)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(FONT_SIZE)
    const headerLines = cols.map(c => wrap(doc, c.label, c.w - 6))
    const headerLineCount = Math.max(...headerLines.map(l => l.length))
    const headerH = Math.max(HEADER_MIN_H, headerLineCount * WRAP_LINE_H + 7)

    const drawHeading = () => {
      if (!table.heading) return
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(0, 0, 0)
      doc.text(table.heading, BORDER.x + 4, y + 8)
      y += 14
    }

    const drawHeader = () => {
      doc.setFillColor(...BAND_BLUE)
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.5)
      doc.rect(BORDER.x + 3, y, BORDER.w - 6, headerH, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(FONT_SIZE)
      doc.setTextColor(0, 0, 0)
      // Vertically centred in the band; each label top-aligned within that.
      const top = y + (headerH - heightFor(headerLineCount)) / 2
      cols.forEach((c, i) => drawCellLines(doc, headerLines[i], c, top))
      y += headerH
    }

    if (y + 14 + headerH + LINE_H > BODY_BOTTOM) startPage()
    drawHeading()
    drawHeader()
    let zebra = false

    for (const row of table.rows) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(FONT_SIZE)
      const cellLines = cols.map(c => wrap(doc, row[c.key], c.w - 6))
      const lineCount = Math.max(...cellLines.map(l => l.length))
      // Single-line rows keep the original pitch; wrapped ones get a little air.
      const rowH = heightFor(lineCount) + (lineCount > 1 ? 2 : 0)

      if (y + rowH > BODY_BOTTOM) {
        startPage()
        drawHeading()
        drawHeader()
        zebra = false
      }
      if (zebra) {
        doc.setFillColor(...ZEBRA_GRAY)
        doc.rect(BORDER.x + 3, y, BORDER.w - 6, rowH, 'F')
      }
      zebra = !zebra
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(FONT_SIZE)
      doc.setTextColor(0, 0, 0)
      cols.forEach((c, i) => drawCellLines(doc, cellLines[i], c, y))
      y += rowH
    }
    y += 10
  }

  if (y + LINE_H > BODY_BOTTOM) startPage()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.text('END OF REPORT', BORDER.x + BORDER.w / 2, y + 7, { align: 'center' })

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
  const { title, subtitle = 'FleetmaX', filtersText = '', printDate, systemName = 'FleetmaX', summaryCards = [], tables = [] } = opts

  const wb = new ExcelJS.Workbook()
  wb.creator = systemName
  const ws = wb.addWorksheet(title.slice(0, 31) || 'Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const t = ws.addRow([title])
  t.getCell(1).font = { bold: true, size: 15 }
  const s = ws.addRow([subtitle])
  s.getCell(1).font = { size: 9 }
  if (filtersText) {
    const f = ws.addRow([filtersText])
    f.getCell(1).font = { size: 8, italic: true }
  }
  ws.addRow([])

  if (summaryCards.length) {
    const header = ws.addRow(summaryCards.map(c => c.label))
    header.eachCell(cell => { cell.fill = fill('FFB0C4DE'); cell.font = { bold: true, size: 9 } })
    const vals = ws.addRow(summaryCards.map(c => c.value))
    vals.eachCell(cell => { cell.font = { bold: true, size: 10 } })
    ws.addRow([])
  }

  for (const table of tables) {
    if (table.heading) {
      const h = ws.addRow([table.heading])
      h.getCell(1).font = { bold: true, size: 10 }
    }
    const cols = table.columns // Excel gets every column, including excelOnly ones.
    ws.columns = cols.map(c => ({ width: Math.max(10, Math.round((c.width || 1) * 1.6)) }))
    const header = ws.addRow(cols.map(c => c.label))
    header.eachCell(cell => { cell.fill = fill('FFB0C4DE'); cell.font = { bold: true, size: 9 } })
    for (const row of table.rows) {
      const r = ws.addRow(cols.map(c => row[c.key] ?? ''))
      r.font = { size: 9 }
    }
    ws.addRow([])
  }

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
    subtitle: meta.subtitle, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
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
    subtitle: meta.subtitle, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
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
    subtitle: meta.subtitle, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
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
    subtitle: meta.subtitle, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
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
    subtitle: meta.subtitle, filtersText: filters.rangeLabel, printDate: meta.printDate, systemName: meta.systemName,
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
