// Movement Report exports: PDF, Excel, Print.
//
// The PDF is a deliberate reproduction of the client's Ctrack sample
// (Movement_Report.pdf). Every constant below was measured out of that file by
// decompressing its content streams and reading the text matrices and fill
// rects, so this is the sample's geometry rather than an approximation of it:
//
//   page            A4 landscape, 841.89 x 595.28 pt
//   outer border    (13.15, 12.65) 815.75 x 545.95, 1pt black
//   title           x 23.15, baseline 34.85, 16.1pt bold
//   subtitle        baseline 48.6, 7.15pt
//   filter band     (13.15, 55.4) h 31.05, #B0C4DE, rows at baseline 66.1/79.6
//   header band     (13.15, 87.45) h 18.7, #B0C4DE, two lines at 94.6/104.2
//   vehicle group   h 9.3,  #C0C0C0, baseline +6.85
//   date sub-header h 9.25, #FFFFC0, baseline +7.1
//   data row        h 9.25 per location line, zebra #E6E6E6, baseline +7.7
//   footer          baseline 568.8
//
// Column x-positions are the sample's; Speed and Cumulative Odo are right-
// aligned at the x their digits end on there (437.5 and 505.5).
//
// jsPDF core only — no autotable. The three band rows, the exact column stops
// and the repeated page chrome are less code drawn directly than they are as
// autotable hook overrides, and this way the positions are exact.

import { rowLocation, formatPrintDate, formatDateTime, MOVEMENT_COLUMNS } from './movementReport'
import { locationUrl } from './mapLink'

// ── geometry ──────────────────────────────────────────────────────────────

const BORDER = { x: 13.15, y: 12.65, w: 815.75, h: 545.95 }
const BAND   = { x: 13.15, w: 815.75 }
// The sample's zebra rects are (11.9, 818) — wider than the border — because it
// paints them before the border and lets the border cover the overhang. Here
// the border is drawn with the rest of the page chrome, before any rows, so the
// zebra is inset to the border's interior instead of painting over it.
const ZEBRA  = { x: BORDER.x + 0.5, w: BORDER.w - 1 }

const COL = {
  vehicle:    23.1,
  time:       119.9,
  driver:     183.6,
  status:     288.6,
  speedRight: 437.5,
  odoRight:   505.5,
  location:   526.4,
}

// Each column's slot in the sample: where it starts, how much room it has up to
// the next one, and for the numbers where their digits end.
const SLOTS = [
  { key: 'vehicle',  x: 23.1,  slot: 96.8,  w: 92 },
  { key: 'time',     x: 119.9, slot: 63.7,  w: 60 },
  { key: 'driver',   x: 183.6, slot: 105,   w: 101 },
  { key: 'status',   x: 288.6, slot: 130.3, w: 126 },
  { key: 'speed',    x: 418.9, slot: 45.9,  right: 437.5 },
  { key: 'odo',      x: 464.8, slot: 61.6,  right: 505.5 },
  { key: 'location', x: 526.4, slot: 296,   w: 292 },
]
const NUMERIC = new Set(['speed', 'odo'])

/**
 * Where each shown column goes. With every column shown this is the sample's
 * geometry exactly; with some switched off, the rest keep their proportions
 * and share the freed width.
 *
 * @returns {{ cols: object, full: boolean, labelX: number, labelW: number, dateX: number }}
 */
function movementLayout(hidden) {
  const shown = SLOTS.filter(s => !hidden?.has(s.key))
  const full = shown.length === SLOTS.length || shown.length === 0
  let cols
  if (full) {
    cols = Object.fromEntries(SLOTS.map(s => [s.key, s]))
  } else {
    const k = SLOTS.reduce((a, s) => a + s.slot, 0) / shown.reduce((a, s) => a + s.slot, 0)
    let x = SLOTS[0].x
    cols = {}
    for (const s of shown) {
      const slot = s.slot * k
      cols[s.key] = { key: s.key, x, slot, w: slot - 4, right: s.right != null ? x + (s.right - s.x) * k : undefined }
      x += slot
    }
  }
  // A band's text (vehicle, date) goes in the Vehicle / Time column, or the
  // first text column left when that one is off.
  const firstText = Object.values(cols).find(c => !NUMERIC.has(c.key)) ?? Object.values(cols)[0]
  const labelCol = cols.vehicle ?? firstText
  return {
    cols,
    full,
    labelX: labelCol.x,
    labelW: labelCol.w ?? labelCol.slot - 4,
    // 93.6 in the sample: the date label starts left of the Time column.
    dateX: full ? 93.6 : (cols.time ?? firstText).x,
  }
}


const LINE_H      = 9.25
const BODY_TOP    = 107.15
const BODY_BOTTOM = 556      // rows must finish above the border's inner edge
const FOOTER_Y    = 568.8

const BAND_BLUE   = [176, 196, 222]
const GROUP_GRAY  = [192, 192, 192]
const LINK_BLUE   = [10, 126, 156]
const DATE_YELLOW = [255, 255, 192]
const ZEBRA_GRAY  = [230, 230, 230]
const LOGO_SEA    = [10, 143, 176]  // Sea Blue, #0a8fb0 — the light theme's brand colour
const LOGO_SRC    = '/logo/fleetmax-logo-sea.png'

// ── small helpers ─────────────────────────────────────────────────────────
//
// fileStamp, download, loadLogo and drawLogo are exported for daywiseExport.js:
// the Daywise sheets are a different geometry but the same house style, and the
// logo in particular is worth embedding through one cached code path rather than
// two.

function clip(doc, text, width) {
  const s = String(text ?? '')
  if (!s) return ''
  return doc.splitTextToSize(s, width)[0] ?? ''
}

export function fileStamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked late: Safari aborts the download if the object URL dies too soon.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ── PDF ───────────────────────────────────────────────────────────────────

// Occupies the sample's top-right corporate logo slot (a 72x36 image at
// x 749.15, y 14.4).
//
// This used to draw a vector truck glyph plus the wordmark in text, so the
// export carried no bundled asset. The rebrand puts the real artwork in
// instead — a wordmark redrawn in Helvetica is not the logo, and the PDF is
// the one surface a client is most likely to forward on. loadLogo() caches the
// data URL, so the fetch happens at most once per session and a failure
// degrades to the text wordmark rather than breaking the export.
let logoDataUrl // undefined = not tried, null = tried and failed

// Width the logo is downsampled to before embedding. It is drawn 76pt wide, so
// 300px is ~4x oversampled — plenty for print — while keeping the payload tiny.
const LOGO_PDF_W = 300

/**
 * Fetch the logo and re-encode it small, flattened onto white, as JPEG.
 *
 * Handing jsPDF the source PNG directly costs ~950KB per export: it embeds
 * transparent PNGs as a raw uncompressed bitmap, so the 863x273 artwork lands
 * as 863*273*4 bytes. Downsampling to 300px and dropping the alpha (the PDF
 * page is white anyway) takes the same logo under ~20KB.
 */
export async function loadLogo() {
  if (logoDataUrl !== undefined) return logoDataUrl
  try {
    const res = await fetch(LOGO_SRC)
    if (!res.ok) throw new Error(String(res.status))
    const bmp = await createImageBitmap(await res.blob())

    const w = LOGO_PDF_W
    const h = Math.round(bmp.height * (w / bmp.width))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h

    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()

    logoDataUrl = canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    logoDataUrl = null
  }
  return logoDataUrl
}

export function drawLogo(doc) {
  const y = 18
  if (logoDataUrl) {
    // Source is 863x273 (~3.16:1); 76pt wide keeps it inside the slot.
    // The alias (4th-from-last arg) makes jsPDF store the bitmap once and
    // reference it from every page, instead of re-embedding it per page.
    const w = 76
    doc.addImage(logoDataUrl, 'JPEG', 803 - w, y, w, w * (273 / 863), 'fleetmax-logo', 'FAST')
    return
  }
  doc.setTextColor(...LOGO_SEA)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('FleetmaxX', 803, y + 12, { align: 'right' })
}

function drawChrome(doc, filters, meta, L) {
  doc.setTextColor(0, 0, 0)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(1)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16.1)
  doc.text('Movement Report', 23.15, 34.85)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.15)
  doc.text(meta.subtitle, 23.15, 48.6)

  drawLogo(doc)

  // Filter summary band — two rows of three label/value pairs.
  doc.setFillColor(...BAND_BLUE)
  doc.rect(BAND.x, 55.4, BAND.w, 31.05, 'FD')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(0, 0, 0)
  doc.text(`Selection    :  ${clip(doc, filters.selection, 230)}`, COL.vehicle, 66.1)
  doc.text('Apply Tolerance', 282.6, 66.1)
  doc.text(`:  ${filters.applyTolerance ? 'True' : 'False'}`, 338.1, 66.1)
  doc.text('Tolerance', 479.1, 66.1)
  doc.text(`(m) :  ${filters.toleranceMeters}`, 511.4, 66.1)
  // Not in the Ctrack sample, so only drawn when used — a thinned report must
  // say it is thinned.
  if (filters.intervalSec > 0) doc.text(`Interval :  ${filters.intervalLabel}`, 640, 66.1)
  doc.text(`From Date   :  ${filters.fromLabel}`, COL.vehicle, 79.6)
  doc.text('To Date   ', 282.6, 79.6)
  doc.text(`:  ${filters.toLabel}`, 313.4, 79.6)
  doc.text(`Statuses :  ${clip(doc, filters.statusesLabel, 290)}`, 479.1, 79.6)

  // Column header band — "Speed (km/h)" and "Cumulative Odo (km)" wrap onto a
  // second line at 104.2, which is why the band is 18.7 tall and the others 9.
  doc.setFillColor(...BAND_BLUE)
  doc.rect(BAND.x, 87.45, BAND.w, 18.7, 'FD')
  doc.setFont('helvetica', 'bold')
  if (L.full) {
    doc.text('Vehicle ID',        COL.vehicle,  94.6)
    doc.text('Time',              COL.time,     94.6)
    doc.text('Driver ID',         COL.driver,   94.6)
    doc.text('Status',            COL.status,   94.6)
    doc.text('Speed (',           418.9,        94.6)
    doc.text('km/h)',             422.3,        104.2)
    doc.text('Cumulative Odo ',   464.8,        94.6)
    doc.text('(km)',              484.2,        104.2)
    doc.text('Location',          COL.location, 94.6)
  } else {
    for (const c of MOVEMENT_COLUMNS) {
      const col = L.cols[c.key]
      if (!col) continue
      doc.splitTextToSize(c.label, col.slot - 4).slice(0, 2).forEach((line, i) => doc.text(line, col.x, 94.6 + i * 9.6))
    }
  }

  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(1)
  doc.rect(BORDER.x, BORDER.y, BORDER.w, BORDER.h, 'S')
}

function drawFooter(doc, pageNo, meta) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(0, 0, 0)
  doc.text('Print Date : ', 19.4, FOOTER_Y)
  doc.text(meta.printDate, 67.4, FOOTER_Y)
  doc.text(meta.systemName, 407.1, FOOTER_Y)
  doc.text(String(pageNo), 825.5, FOOTER_Y, { align: 'right' })
}

/**
 * Render the whole report to a jsPDF document.
 *
 * jsPDF (and the html2canvas/dompurify it pulls in) is imported lazily: nothing
 * but these two buttons needs it, so it stays out of the main bundle.
 *
 * @param {object} report   from buildMovementReport / deriveMovementReport
 * @param {object} filters  { selection, fromLabel, toLabel, applyTolerance, toleranceMeters, statusesLabel }
 * @param {object} [meta]   { subtitle, systemName, printDate }
 */
export async function buildMovementPdf(report, filters, meta = {}) {
  const L = movementLayout(meta.hiddenColumns)
  const C = L.cols
  // Both awaited up front: startPage() below is synchronous and every page
  // calls drawLogo(), so the artwork has to be resolved before the first one.
  const [{ jsPDF }] = await Promise.all([import('jspdf'), loadLogo()])

  const resolved = {
    subtitle:   meta.subtitle   ?? 'FleetmaxX',
    systemName: meta.systemName ?? 'FleetmaxX',
    printDate:  meta.printDate  ?? formatPrintDate(),
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  let pageNo = 0
  let y = BODY_TOP
  let zebra = false

  const startPage = () => {
    if (pageNo > 0) doc.addPage()
    pageNo += 1
    drawChrome(doc, filters, resolved, L)
    drawFooter(doc, pageNo, resolved)
    y = BODY_TOP
    zebra = false
  }

  startPage()

  const drawGroupRow = vehicle => {
    doc.setFillColor(...GROUP_GRAY)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(1)
    doc.rect(BAND.x, y, BAND.w, 9.3, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(0, 0, 0)
    const base = y + 6.85
    doc.text(clip(doc, vehicle.vehicleId, L.labelW), L.labelX, base)
    if (C.speed) doc.text(String(vehicle.maxSpeed), C.speed.right, base, { align: 'right' })
    if (C.odo) doc.text(vehicle.totalDistanceKm.toFixed(3), C.odo.right, base, { align: 'right' })
    // 1pt gap before the next band, as in the sample (116.45 -> 117.45).
    y += 10.3
  }

  const drawDateRow = date => {
    doc.setFillColor(...DATE_YELLOW)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(1)
    doc.rect(BAND.x, y, BAND.w, 9.25, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(0, 0, 0)
    const base = y + 7.1
    // 93.6 in the sample: the label runs up to the Time column and the date
    // itself sits on it.
    doc.text(date.label, L.dateX, base)
    if (C.speed) doc.text(String(date.maxSpeed), C.speed.right, base, { align: 'right' })
    y += 9.25
  }

  // Vehicles flow continuously; a page break re-emits the vehicle group row so
  // a continuation page still says whose rows these are, and the first data row
  // of every page re-stamps the Vehicle ID cell (the sample leaves it blank on
  // every other row).
  for (const vehicle of report.vehicles) {
    if (y + 10.3 + 9.25 + LINE_H > BODY_BOTTOM) startPage()
    drawGroupRow(vehicle)
    let stampVehicleId = true

    for (const date of vehicle.dates) {
      if (y + 9.25 + LINE_H > BODY_BOTTOM) {
        startPage()
        drawGroupRow(vehicle)
        stampVehicleId = true
      }
      drawDateRow(date)

      for (const row of date.rows) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        const lines = C.location ? doc.splitTextToSize(rowLocation(row), C.location.w) : ['']
        const h = LINE_H * Math.max(1, lines.length)

        if (y + h > BODY_BOTTOM) {
          startPage()
          drawGroupRow(vehicle)
          stampVehicleId = true
        }

        if (zebra) {
          doc.setFillColor(...ZEBRA_GRAY)
          doc.rect(ZEBRA.x, y, ZEBRA.w, h, 'F')
        }
        zebra = !zebra

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(0, 0, 0)
        const base = y + 7.7
        if (stampVehicleId && C.vehicle) doc.text(clip(doc, vehicle.vehicleId, C.vehicle.w), C.vehicle.x, base)
        stampVehicleId = false
        if (C.time) doc.text(row.time, C.time.x, base)
        if (C.driver) doc.text(clip(doc, row.driverId, C.driver.w), C.driver.x, base)
        if (C.status) doc.text(clip(doc, row.status, C.status.w), C.status.x, base)
        if (C.speed) doc.text(String(row.speed), C.speed.right, base, { align: 'right' })
        if (C.odo) doc.text(row.odoKm.toFixed(3), C.odo.right, base, { align: 'right' })
        // Client, 2026-11-02: a location in the PDF opens the point on our map.
        const href = C.location && locationUrl({ lat: row.lat, lng: row.lng, vehicle: vehicle.vehicleId, time: formatDateTime(row.ts), address: rowLocation(row) })
        if (href) doc.setTextColor(...LINK_BLUE)
        if (C.location) lines.forEach((line, i) => doc.text(line, C.location.x, base + i * LINE_H))
        if (href) {
          doc.link(C.location.x, y, C.location.w, h, { url: href })
          doc.setTextColor(0, 0, 0)
        }

        y += h
      }
    }
  }

  // "END OF REPORT", centred on the table, one row below the last one.
  y += 4
  if (y + LINE_H > BODY_BOTTOM) startPage()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(0, 0, 0)
  doc.text('END OF REPORT', BORDER.x + BORDER.w / 2, y + 7.7, { align: 'center' })

  return doc
}

/** Build and download the PDF. */
export async function exportMovementPdf(report, filters, meta) {
  const doc = await buildMovementPdf(report, filters, meta)
  doc.save(`Movement_Report_${fileStamp()}.pdf`)
}

/** Build the PDF and open it in a new tab — used to preview the export. */
export async function openMovementPdf(report, filters, meta) {
  const doc = await buildMovementPdf(report, filters, meta)
  const url = URL.createObjectURL(doc.output('blob'))
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return url
}

// ── Excel ─────────────────────────────────────────────────────────────────

const COL_WIDTHS = { vehicle: 18, time: 13, driver: 22, status: 28, speed: 12, odo: 20, location: 70 }

function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function paint(row, argb, bold, n) {
  for (let c = 1; c <= n; c++) {
    const cell = row.getCell(c)
    cell.fill = fill(argb)
    if (bold) cell.font = { bold: true, size: 9 }
    else cell.font = { size: 9 }
  }
}

/**
 * Export the report as a styled .xlsx carrying the same bands as the PDF.
 *
 * exceljs is imported lazily: it is ~400KB and nothing but this one button
 * needs it, so it stays out of the main bundle.
 */
export async function exportMovementExcel(report, filters, meta = {}) {
  const ExcelJS = (await import('exceljs')).default
  const subtitle   = meta.subtitle   ?? 'FleetmaxX'
  const systemName = meta.systemName ?? 'FleetmaxX'
  const printDate  = meta.printDate  ?? formatPrintDate()

  const wb = new ExcelJS.Workbook()
  wb.creator = systemName
  const ws = wb.addWorksheet('Movement Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 6 }],
  })
  const cols = MOVEMENT_COLUMNS.filter(c => !meta.hiddenColumns?.has(c.key))
  const full = cols.length === MOVEMENT_COLUMNS.length
  const n = cols.length
  ws.columns = cols.map(c => ({ width: COL_WIDTHS[c.key] }))

  const span = `A%r:${String.fromCharCode(64 + n)}%r`
  const mergeRow = r => { if (n > 1) ws.mergeCells(span.replace(/%r/g, r)) }
  // One cell per shown column, from values keyed by column.
  const line = values => cols.map(c => values[c.key] ?? '')
  // A band's text sits in the Vehicle / Time column, or the first text column left.
  const textKey = preferred => (cols.some(c => c.key === preferred) ? preferred : (cols.find(c => c.key !== 'speed' && c.key !== 'odo') ?? cols[0]).key)

  const title = ws.addRow(['Movement Report'])
  title.getCell(1).font = { bold: true, size: 16 }
  mergeRow(title.number)

  const sub = ws.addRow([subtitle])
  sub.getCell(1).font = { size: 9 }
  mergeRow(sub.number)

  const pairs = [
    [`Selection :  ${filters.selection}`,
      `Apply Tolerance :  ${filters.applyTolerance ? 'True' : 'False'}`,
      `Tolerance (m) :  ${filters.toleranceMeters}${filters.intervalSec > 0 ? `    Interval :  ${filters.intervalLabel}` : ''}`],
    [`From Date :  ${filters.fromLabel}`, `To Date :  ${filters.toLabel}`, `Statuses :  ${filters.statusesLabel}`],
  ]
  if (full) {
    for (const [a, b, c] of pairs) {
      const r = ws.addRow([a, '', '', b, '', c, ''])
      paint(r, 'FFB0C4DE', false, n)
      ws.mergeCells(`A${r.number}:C${r.number}`)
      ws.mergeCells(`D${r.number}:E${r.number}`)
      ws.mergeCells(`F${r.number}:G${r.number}`)
    }
  } else {
    // Fewer columns than the band's three pairs need: one filter per row.
    for (const text of pairs.flat()) {
      const r = ws.addRow([text])
      paint(r, 'FFB0C4DE', false, n)
      mergeRow(r.number)
    }
  }

  ws.addRow([])

  const header = ws.addRow(cols.map(c => c.label))
  paint(header, 'FFB0C4DE', true, n)
  header.alignment = { vertical: 'middle' }

  for (const vehicle of report.vehicles) {
    const g = ws.addRow(line({ [textKey('vehicle')]: vehicle.vehicleId, speed: vehicle.maxSpeed, odo: Number(vehicle.totalDistanceKm.toFixed(3)) }))
    paint(g, 'FFC0C0C0', true, n)

    for (const date of vehicle.dates) {
      const d = ws.addRow(line({ [textKey('time')]: date.label, speed: date.maxSpeed }))
      paint(d, 'FFFFFFC0', true, n)

      let stamp = true
      for (const row of date.rows) {
        const r = ws.addRow(line({
          vehicle: stamp ? vehicle.vehicleId : '',
          time: row.time,
          driver: row.driverId,
          status: row.status,
          speed: row.speed,
          odo: Number(row.odoKm.toFixed(3)),
          location: rowLocation(row),
        }))
        stamp = false
        r.font = { size: 9 }
        const locAt = cols.findIndex(c => c.key === 'location') + 1
        if (locAt > 0) {
          r.getCell(locAt).alignment = { wrapText: true, vertical: 'top' }
          const href = locationUrl({ lat: row.lat, lng: row.lng, vehicle: vehicle.vehicleId, time: formatDateTime(row.ts), address: rowLocation(row) })
          if (href) {
            r.getCell(locAt).value = { text: rowLocation(row), hyperlink: href, tooltip: 'Show on the FleetmaxX map' }
            r.getCell(locAt).font = { size: 9, color: { argb: 'FF0A7E9C' }, underline: true }
          }
        }
      }
    }
  }

  ws.addRow([])
  const end = ws.addRow(['END OF REPORT'])
  end.getCell(1).font = { bold: true, size: 9 }
  const stamp = ws.addRow([`Print Date : ${printDate}`, '', '', systemName])
  stamp.font = { size: 8 }

  const buffer = await wb.xlsx.writeBuffer()
  download(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `Movement_Report_${fileStamp()}.xlsx`
  )
}

// ── Print ─────────────────────────────────────────────────────────────────

// The on-screen report already carries the same bands and columns, so printing
// is the browser's own job — Reports.jsx ships the @media print rules that drop
// the app chrome and let the table break across sheets.
export function printMovementReport() {
  window.print()
}
