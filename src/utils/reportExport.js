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

import { rowLocation, formatPrintDate } from './movementReport'

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

const WIDTH = {
  vehicle:  92,
  time:     60,
  driver:   101,
  status:   126,
  location: 292,
}

const LINE_H      = 9.25
const BODY_TOP    = 107.15
const BODY_BOTTOM = 556      // rows must finish above the border's inner edge
const FOOTER_Y    = 568.8

const BAND_BLUE   = [176, 196, 222]
const GROUP_GRAY  = [192, 192, 192]
const DATE_YELLOW = [255, 255, 192]
const ZEBRA_GRAY  = [230, 230, 230]
const LOGO_GREEN  = [91, 163, 84]   // FleetmaX brand green, #5ba354
const LOGO_SRC    = '/logo/fleetmax-logo.png'

// ── small helpers ─────────────────────────────────────────────────────────

function clip(doc, text, width) {
  const s = String(text ?? '')
  if (!s) return ''
  return doc.splitTextToSize(s, width)[0] ?? ''
}

function fileStamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function download(blob, filename) {
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
async function loadLogo() {
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

function drawLogo(doc) {
  const y = 18
  if (logoDataUrl) {
    // Source is 863x273 (~3.16:1); 76pt wide keeps it inside the slot.
    // The alias (4th-from-last arg) makes jsPDF store the bitmap once and
    // reference it from every page, instead of re-embedding it per page.
    const w = 76
    doc.addImage(logoDataUrl, 'JPEG', 803 - w, y, w, w * (273 / 863), 'fleetmax-logo', 'FAST')
    return
  }
  doc.setTextColor(...LOGO_GREEN)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('FleetmaX', 803, y + 12, { align: 'right' })
}

function drawChrome(doc, filters, meta) {
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
  doc.text(`From Date   :  ${filters.fromLabel}`, COL.vehicle, 79.6)
  doc.text('To Date   ', 282.6, 79.6)
  doc.text(`:  ${filters.toLabel}`, 313.4, 79.6)
  doc.text(`Statuses :  ${clip(doc, filters.statusesLabel, 290)}`, 479.1, 79.6)

  // Column header band — "Speed (km/h)" and "Cumulative Odo (km)" wrap onto a
  // second line at 104.2, which is why the band is 18.7 tall and the others 9.
  doc.setFillColor(...BAND_BLUE)
  doc.rect(BAND.x, 87.45, BAND.w, 18.7, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.text('Vehicle ID',        COL.vehicle,  94.6)
  doc.text('Time',              COL.time,     94.6)
  doc.text('Driver ID',         COL.driver,   94.6)
  doc.text('Status',            COL.status,   94.6)
  doc.text('Speed (',           418.9,        94.6)
  doc.text('km/h)',             422.3,        104.2)
  doc.text('Cumulative Odo ',   464.8,        94.6)
  doc.text('(km)',              484.2,        104.2)
  doc.text('Location',          COL.location, 94.6)

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
  // Both awaited up front: startPage() below is synchronous and every page
  // calls drawLogo(), so the artwork has to be resolved before the first one.
  const [{ jsPDF }] = await Promise.all([import('jspdf'), loadLogo()])

  const resolved = {
    subtitle:   meta.subtitle   ?? 'AI Revofleet',
    systemName: meta.systemName ?? 'FleetmaX',
    printDate:  meta.printDate  ?? formatPrintDate(),
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  let pageNo = 0
  let y = BODY_TOP
  let zebra = false

  const startPage = () => {
    if (pageNo > 0) doc.addPage()
    pageNo += 1
    drawChrome(doc, filters, resolved)
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
    doc.text(clip(doc, vehicle.vehicleId, WIDTH.vehicle), COL.vehicle, base)
    doc.text(String(vehicle.maxSpeed), COL.speedRight, base, { align: 'right' })
    doc.text(vehicle.totalDistanceKm.toFixed(3), COL.odoRight, base, { align: 'right' })
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
    doc.text(date.label, 93.6, base)
    doc.text(String(date.maxSpeed), COL.speedRight, base, { align: 'right' })
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
        const lines = doc.splitTextToSize(rowLocation(row), WIDTH.location)
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
        if (stampVehicleId) {
          doc.text(clip(doc, vehicle.vehicleId, WIDTH.vehicle), COL.vehicle, base)
          stampVehicleId = false
        }
        doc.text(row.time, COL.time, base)
        doc.text(clip(doc, row.driverId, WIDTH.driver), COL.driver, base)
        doc.text(clip(doc, row.status, WIDTH.status), COL.status, base)
        doc.text(String(row.speed), COL.speedRight, base, { align: 'right' })
        doc.text(row.odoKm.toFixed(3), COL.odoRight, base, { align: 'right' })
        lines.forEach((line, i) => doc.text(line, COL.location, base + i * LINE_H))

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

const HEADERS = ['Vehicle ID', 'Time', 'Driver ID', 'Status', 'Speed (km/h)', 'Cumulative Odo (km)', 'Location']
const COL_WIDTHS = [18, 13, 22, 28, 12, 20, 70]

function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function paint(row, argb, bold) {
  for (let c = 1; c <= HEADERS.length; c++) {
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
  const subtitle   = meta.subtitle   ?? 'AI Revofleet'
  const systemName = meta.systemName ?? 'FleetmaX'
  const printDate  = meta.printDate  ?? formatPrintDate()

  const wb = new ExcelJS.Workbook()
  wb.creator = systemName
  const ws = wb.addWorksheet('Movement Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 6 }],
  })
  ws.columns = COL_WIDTHS.map(width => ({ width }))

  const span = `A%r:${String.fromCharCode(64 + HEADERS.length)}%r`
  const mergeRow = r => ws.mergeCells(span.replace(/%r/g, r))

  const title = ws.addRow(['Movement Report'])
  title.getCell(1).font = { bold: true, size: 16 }
  mergeRow(title.number)

  const sub = ws.addRow([subtitle])
  sub.getCell(1).font = { size: 9 }
  mergeRow(sub.number)

  const f1 = ws.addRow([
    `Selection :  ${filters.selection}`, '', '',
    `Apply Tolerance :  ${filters.applyTolerance ? 'True' : 'False'}`, '',
    `Tolerance (m) :  ${filters.toleranceMeters}`, '',
  ])
  const f2 = ws.addRow([
    `From Date :  ${filters.fromLabel}`, '', '',
    `To Date :  ${filters.toLabel}`, '',
    `Statuses :  ${filters.statusesLabel}`, '',
  ])
  for (const r of [f1, f2]) {
    paint(r, 'FFB0C4DE', false)
    ws.mergeCells(`A${r.number}:C${r.number}`)
    ws.mergeCells(`D${r.number}:E${r.number}`)
    ws.mergeCells(`F${r.number}:G${r.number}`)
  }

  ws.addRow([])

  const header = ws.addRow(HEADERS)
  paint(header, 'FFB0C4DE', true)
  header.alignment = { vertical: 'middle' }

  for (const vehicle of report.vehicles) {
    const g = ws.addRow([vehicle.vehicleId, '', '', '', vehicle.maxSpeed, Number(vehicle.totalDistanceKm.toFixed(3)), ''])
    paint(g, 'FFC0C0C0', true)

    for (const date of vehicle.dates) {
      const d = ws.addRow(['', date.label, '', '', date.maxSpeed, '', ''])
      paint(d, 'FFFFFFC0', true)

      let stamp = true
      for (const row of date.rows) {
        const r = ws.addRow([
          stamp ? vehicle.vehicleId : '',
          row.time,
          row.driverId,
          row.status,
          row.speed,
          Number(row.odoKm.toFixed(3)),
          rowLocation(row),
        ])
        stamp = false
        r.font = { size: 9 }
        r.getCell(7).alignment = { wrapText: true, vertical: 'top' }
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
