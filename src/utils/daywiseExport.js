/**
 * Daywise Work Hour / Daywise Distance exports: PDF, Excel, Print.
 *
 * Same house style as the Movement Report's exports — A4 landscape, the band
 * colours the client's samples use, the logo in the top-right slot, a print-date
 * footer — and the shared pieces (logo embedding, filename stamp, download) are
 * imported from reportExport.js rather than written again.
 *
 * What is different, and why this is not the same builder: a daywise sheet is a
 * wide grid, 31 narrow numeric columns plus two or three identity columns, where
 * the Movement Report is a tall one with fixed column stops measured out of a
 * Ctrack sample. The day columns here are computed from the page width and the
 * number of days in the month, so a 28-day February is not laid out with three
 * empty columns' worth of gap.
 */

import { drawLogo, drawAccountSlot, fileStamp, download, loadLogo } from './reportExport'
import { loadAccountLogo, addExcelLogoRow } from './reportLogo'
import { formatPrintDate } from './movementReport'

// ── geometry (A4 landscape, points) ────────────────────────────────────────

// The Movement Report PDF's page, title block, filter band and footer
// (reportExport.js), so a downloaded daywise sheet is in the same theme
// (client, 2026-11-11).
const BORDER = { x: 13.15, y: 12.65, w: 815.75, h: 545.95 }

const BAND_Y = 55.4
const BAND_H = 17.55
const HEAD_Y = BAND_Y + BAND_H + 1
const HEAD_H = 16
const BODY_TOP = HEAD_Y + HEAD_H
const ROW_H = 11
const BODY_BOTTOM = 556
const FOOTER_Y = 568.8

const DAY_FONT = 6

const BAND_BLUE = [176, 196, 222]
const ZEBRA_GRAY = [230, 230, 230]
const FUTURE_GRAY = [226, 228, 232]
const TOTAL_TINT = [255, 255, 192] // the Movement paper's total yellow

/** The filter band, in the order the paper shows it. */
const BAND_FILTERS = meta => [['Month', meta.monthLabel], ['Selection', meta.selection], ['Company', meta.bgLabel]]

/** Identity columns get the left of the page; days share what is left. */
function layout(columns, days) {
  const idWidth = Math.min(
    BORDER.w * 0.33,
    columns.reduce((a, c) => a + Math.max(58, c.width * 0.52), 0)
  )
  const scale = idWidth / columns.reduce((a, c) => a + Math.max(58, c.width * 0.52), 0)
  const idCols = []
  let x = BORDER.x
  for (const c of columns) {
    const w = Math.max(58, c.width * 0.52) * scale
    idCols.push({ ...c, x, w })
    x += w
  }
  const dayW = (BORDER.x + BORDER.w - x) / days
  return { idCols, dayX: x, dayW }
}

export async function buildDaywisePdf(model, meta) {
  const [{ jsPDF }, , account] = await Promise.all([import('jspdf'), loadLogo(), loadAccountLogo()])
  const { rows, days, lastElapsed, columns, format, valueOf, totalOf } = model
  const printDate = meta.printDate ?? formatPrintDate()

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const { idCols, dayX, dayW } = layout(columns, days)

  // A day column is ~17-19pt wide in a 31-day month, and "122.62" at 6pt is
  // ~19pt — three-digit days ran into their neighbours. One size for the whole
  // grid, just small enough for its widest value, keeps the columns even.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(DAY_FONT)
  let widest = 0
  for (const row of rows) {
    for (let d = 1; d <= lastElapsed && d <= days; d++) {
      widest = Math.max(widest, doc.getTextWidth(format(valueOf(row, d))))
    }
  }
  // The Total line's day sums are the widest numbers on the sheet.
  if (totalOf) {
    for (let d = 1; d <= lastElapsed && d <= days; d++) {
      widest = Math.max(widest, doc.getTextWidth(format(rows.reduce((a, r) => a + (valueOf(r, d) || 0), 0))))
    }
  }
  const room = dayW - 3
  const dayFont = widest > room ? DAY_FONT * (room / widest) : DAY_FONT

  let pageNo = 0
  let y = BODY_TOP

  const chrome = () => {
    doc.setTextColor(0, 0, 0)
    doc.setDrawColor(0, 0, 0)

    // The account's logo first and the title after it; FleetmaxX top right.
    const tx = drawAccountSlot(doc, account)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16.1)
    doc.text(meta.title, tx, 34.85)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.15)
    doc.text('FleetmaxX', tx, 48.6)

    drawLogo(doc)

    // Filter band — the Movement band's "Key  :  Value" cells, three across.
    doc.setFillColor(...BAND_BLUE)
    doc.setLineWidth(1)
    doc.rect(BORDER.x, BAND_Y, BORDER.w, BAND_H, 'FD')
    doc.setFontSize(7)
    const cellW = (BORDER.w - 20) / 3
    BAND_FILTERS(meta).forEach(([k, v], i) => {
      doc.text(doc.splitTextToSize(`${k}  :  ${v ?? ''}`, cellW - 12)[0] ?? '', 23.15 + i * cellW, BAND_Y + 10.7)
    })

    // Header band.
    doc.setFillColor(...BAND_BLUE)
    doc.rect(BORDER.x, HEAD_Y, BORDER.w, HEAD_H, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.6)
    for (const c of idCols) {
      doc.text(c.label, c.x + 4, HEAD_Y + 10.5, { maxWidth: c.w - 6 })
    }
    for (let d = 1; d <= days; d++) {
      doc.text(String(d), dayX + dayW * (d - 0.5), HEAD_Y + 10.5, { align: 'center' })
    }

    doc.setLineWidth(1)
    doc.rect(BORDER.x, BORDER.y, BORDER.w, BORDER.h, 'S')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text('Print Date : ', 19.4, FOOTER_Y)
    doc.text(String(printDate), 67.4, FOOTER_Y)
    doc.text('FleetmaxX', 407.1, FOOTER_Y)
    doc.text(String(pageNo), 825.5, FOOTER_Y, { align: 'right' })
  }

  const startPage = () => {
    if (pageNo > 0) doc.addPage()
    pageNo += 1
    chrome()
    y = BODY_TOP
  }

  startPage()

  rows.forEach((row, i) => {
    if (y + ROW_H > BODY_BOTTOM) startPage()

    if (i % 2 === 1) {
      doc.setFillColor(...ZEBRA_GRAY)
      doc.rect(BORDER.x + 0.5, y, BORDER.w - 1, ROW_H, 'F')
    }

    // Future days: one flat block, drawn before the text so nothing is covered.
    if (lastElapsed < days) {
      doc.setFillColor(...FUTURE_GRAY)
      doc.rect(dayX + dayW * lastElapsed, y, dayW * (days - lastElapsed), ROW_H, 'F')
    }

    doc.setTextColor(0, 0, 0)
    doc.setFontSize(6.6)
    idCols.forEach(c => {
      const isTotal = c.key === 'total'
      if (isTotal) {
        doc.setFillColor(...TOTAL_TINT)
        doc.rect(c.x, y, c.w, ROW_H, 'F')
      }
      doc.setFont('helvetica', isTotal ? 'bold' : 'normal')
      const text = String(c.get(row) ?? '')
      if (c.align === 'right') doc.text(text, c.x + c.w - 4, y + 7.9, { align: 'right', maxWidth: c.w - 6 })
      else doc.text(text, c.x + 4, y + 7.9, { maxWidth: c.w - 6 })
    })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(dayFont)
    for (let d = 1; d <= lastElapsed && d <= days; d++) {
      const v = valueOf(row, d)
      doc.setTextColor(...(v > 0 ? [0, 0, 0] : [150, 150, 150]))
      doc.text(format(v), dayX + dayW * d - 2, y + 7.9, { align: 'right' })
    }

    y += ROW_H
  })

  // The Total line the screen ends on, on the total yellow, then END OF REPORT.
  if (totalOf && rows.length) {
    if (y + ROW_H + 12 > BODY_BOTTOM) startPage()
    doc.setFillColor(...TOTAL_TINT)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(1)
    doc.rect(BORDER.x, y, BORDER.w, ROW_H, 'FD')
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.6)
    idCols.forEach((c, i) => {
      const text = c.key === 'total' ? format(rows.reduce((a, r) => a + (totalOf(r) || 0), 0)) : i === 0 ? `Total (${rows.length})` : ''
      if (c.align === 'right') doc.text(text, c.x + c.w - 4, y + 7.9, { align: 'right', maxWidth: c.w - 6 })
      else doc.text(text, c.x + 4, y + 7.9, { maxWidth: c.w - 6 })
    })
    doc.setFontSize(dayFont)
    for (let d = 1; d <= lastElapsed && d <= days; d++) {
      doc.text(format(rows.reduce((a, r) => a + (valueOf(r, d) || 0), 0)), dayX + dayW * d - 2, y + 7.9, { align: 'right' })
    }
    y += ROW_H
  }
  y += 4
  if (y + 9.25 > BODY_BOTTOM) startPage()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(0, 0, 0)
  doc.text('END OF REPORT', BORDER.x + BORDER.w / 2, y + 7.7, { align: 'center' })

  return doc
}

export async function exportDaywisePdf(model, meta) {
  const doc = await buildDaywisePdf(model, meta)
  // doc.save(), the same call exportMovementPdf() uses. Handing the blob to the
  // shared download() helper instead produced a download Chromium cancelled,
  // while the identical helper delivers the .xlsx from this page without
  // trouble — so the PDF goes out the way the one that works does.
  doc.save(`${meta.exportName}_${fileStamp()}.pdf`)
}

// ── Excel ───────────────────────────────────────────────────────────────────

function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

export async function exportDaywiseExcel(model, meta) {
  const ExcelJS = (await import('exceljs')).default
  const { rows, days, lastElapsed, columns, format, valueOf, totalOf } = model
  const printDate = meta.printDate ?? formatPrintDate()

  const wb = new ExcelJS.Workbook()
  wb.creator = 'FleetmaxX'
  const ws = wb.addWorksheet(meta.title.slice(0, 31), {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    // Freeze the identity columns and the header, so scrolling to day 31 keeps
    // the vehicle name on screen — the same thing the sticky columns do on the
    // page.
    views: [{ state: 'frozen', xSplit: columns.length, ySplit: 5 }],
  })

  ws.columns = [
    ...columns.map(c => ({ width: Math.max(12, Math.round(c.width / 7)) })),
    ...Array.from({ length: days }, () => ({ width: 9 })),
  ]

  const lastCol = columns.length + days
  const colLetter = n => {
    let s = ''
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
    return s
  }
  const mergeRow = r => ws.mergeCells(`A${r}:${colLetter(lastCol)}${r}`)

  // The logo row (account logo left, FleetmaxX right) moves the frozen header down by one.
  const [account, fleetmax] = await Promise.all([loadAccountLogo(), loadLogo()])
  if (addExcelLogoRow(wb, ws, { account, fleetmax, lastCol })) ws.views = [{ state: 'frozen', xSplit: columns.length, ySplit: 6 }]

  const title = ws.addRow([meta.title])
  title.getCell(1).font = { bold: true, size: 16 }
  mergeRow(title.number)

  const sub = ws.addRow(['FleetmaxX'])
  sub.getCell(1).font = { size: 9 }
  mergeRow(sub.number)

  const third = Math.max(1, Math.floor(lastCol / 3))
  const bandCells = Array(lastCol).fill('')
  BAND_FILTERS(meta).forEach(([k, v], i) => { bandCells[i * third] = `${k} :  ${v ?? ''}` })
  const band = ws.addRow(bandCells)
  for (let c = 1; c <= lastCol; c++) {
    band.getCell(c).fill = fill('FFB0C4DE')
    band.getCell(c).font = { size: 9 }
  }

  ws.addRow([])

  const header = ws.addRow([...columns.map(c => c.label), ...Array.from({ length: days }, (_, i) => i + 1)])
  for (let c = 1; c <= lastCol; c++) {
    const cell = header.getCell(c)
    cell.fill = fill('FFB0C4DE')
    cell.font = { bold: true, size: 9 }
    cell.alignment = { vertical: 'middle', horizontal: c <= columns.length ? 'left' : 'center' }
  }

  for (const row of rows) {
    // Numbers, not strings, past the identity columns: a daywise sheet is
    // something people re-sum in Excel, and text cells make that impossible.
    // Work Hour keeps HH:MM — the client's format, and a decimal hour would not
    // match the screen.
    const cells = [
      ...columns.map(c => c.get(row)),
      ...Array.from({ length: days }, (_, i) => {
        const d = i + 1
        if (d > lastElapsed) return ''
        const v = valueOf(row, d)
        return meta.numeric ? Number(v.toFixed(2)) : format(v)
      }),
    ]
    const r = ws.addRow(cells)
    r.font = { size: 9 }
    for (let c = columns.length + 1; c <= lastCol; c++) {
      r.getCell(c).alignment = { horizontal: 'right' }
      if (c - columns.length > lastElapsed) r.getCell(c).fill = fill('FFE2E4E8')
    }
    for (let c = 1; c <= columns.length; c++) {
      if (columns[c - 1].key === 'total') {
        r.getCell(c).font = { size: 9, bold: true }
        r.getCell(c).fill = fill('FFFFFFC0')
        r.getCell(c).alignment = { horizontal: 'right' }
      }
    }
  }

  if (totalOf && rows.length) {
    const sum = f => rows.reduce((a, r) => a + (f(r) || 0), 0)
    const cells = [
      ...columns.map((c, i) => (c.key === 'total' ? format(sum(totalOf)) : i === 0 ? `Total (${rows.length})` : '')),
      ...Array.from({ length: days }, (_, i) => {
        const d = i + 1
        if (d > lastElapsed) return ''
        const v = sum(r => valueOf(r, d))
        return meta.numeric ? Number(v.toFixed(2)) : format(v)
      }),
    ]
    const r = ws.addRow(cells)
    for (let c = 1; c <= lastCol; c++) {
      r.getCell(c).fill = fill('FFFFFFC0')
      r.getCell(c).font = { size: 9, bold: true }
      if (c > 1) r.getCell(c).alignment = { horizontal: 'right' }
    }
  }

  ws.addRow([])
  const end = ws.addRow(['END OF REPORT'])
  end.getCell(1).font = { bold: true, size: 9 }
  const stamp = ws.addRow([`Print Date : ${printDate}`, '', 'FleetmaxX'])
  stamp.font = { size: 8 }

  const buffer = await wb.xlsx.writeBuffer()
  download(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${meta.exportName}_${fileStamp()}.xlsx`
  )
}

// ── Print ───────────────────────────────────────────────────────────────────

// The page ships the @media print rules that drop the app chrome and let the
// grid break across sheets, so printing is the browser's own job.
export function printDaywiseReport() {
  window.print()
}
