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

import { drawLogo, fileStamp, download, loadLogo } from './reportExport'
import { formatPrintDate } from './movementReport'

// ── geometry (A4 landscape, points) ────────────────────────────────────────

const PAGE = { w: 841.89, h: 595.28 }
const MARGIN = 14
const BORDER = { x: MARGIN, y: MARGIN, w: PAGE.w - MARGIN * 2, h: PAGE.h - MARGIN * 2 }

const TITLE_Y = 34
const SUB_Y = 47
const BAND_Y = 55
const BAND_H = 17
const HEAD_Y = 78
const HEAD_H = 16
const BODY_TOP = 94
const ROW_H = 13
const BODY_BOTTOM = PAGE.h - MARGIN - 20
const FOOTER_Y = PAGE.h - MARGIN - 7

const DAY_FONT = 6

const BAND_BLUE = [176, 196, 222]
const ZEBRA_GRAY = [238, 240, 243]
const FUTURE_GRAY = [226, 228, 232]
const TOTAL_TINT = [222, 236, 220]

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
  const [{ jsPDF }] = await Promise.all([import('jspdf'), loadLogo()])
  const { rows, days, lastElapsed, columns, format, valueOf } = model
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
  const room = dayW - 3
  const dayFont = widest > room ? DAY_FONT * (room / widest) : DAY_FONT

  let pageNo = 0
  let y = BODY_TOP

  const chrome = () => {
    doc.setTextColor(0, 0, 0)
    doc.setDrawColor(0, 0, 0)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.text(meta.title, BORDER.x + 9, TITLE_Y)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.2)
    doc.text(meta.monthLabel, BORDER.x + 9, SUB_Y)

    drawLogo(doc)

    // Filter band.
    doc.setFillColor(...BAND_BLUE)
    doc.setLineWidth(1)
    doc.rect(BORDER.x, BAND_Y, BORDER.w, BAND_H, 'FD')
    doc.setFontSize(7)
    doc.text(`Selection :  ${meta.selection}`, BORDER.x + 9, BAND_Y + 11)
    doc.text(`Company :  ${meta.bgLabel}`, BORDER.x + 300, BAND_Y + 11)
    doc.text(`Month :  ${meta.monthLabel}`, BORDER.x + 620, BAND_Y + 11)

    // Header band.
    doc.setFillColor(...BAND_BLUE)
    doc.rect(BORDER.x, HEAD_Y, BORDER.w, HEAD_H, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.6)
    for (const c of idCols) {
      doc.text(c.label, c.x + 4, HEAD_Y + 11, { maxWidth: c.w - 6 })
    }
    for (let d = 1; d <= days; d++) {
      doc.text(String(d), dayX + dayW * (d - 0.5), HEAD_Y + 11, { align: 'center' })
    }

    doc.setLineWidth(1)
    doc.rect(BORDER.x, BORDER.y, BORDER.w, BORDER.h, 'S')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(`Print Date : ${printDate}`, BORDER.x + 6, FOOTER_Y)
    doc.text('FleetmaX', PAGE.w / 2, FOOTER_Y, { align: 'center' })
    doc.text(String(pageNo), BORDER.x + BORDER.w - 6, FOOTER_Y, { align: 'right' })
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
      if (c.align === 'right') doc.text(text, c.x + c.w - 4, y + 9, { align: 'right', maxWidth: c.w - 6 })
      else doc.text(text, c.x + 4, y + 9, { maxWidth: c.w - 6 })
    })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(dayFont)
    for (let d = 1; d <= lastElapsed && d <= days; d++) {
      const v = valueOf(row, d)
      doc.setTextColor(...(v > 0 ? [0, 0, 0] : [150, 150, 150]))
      doc.text(format(v), dayX + dayW * d - 2, y + 9, { align: 'right' })
    }

    y += ROW_H
  })

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
  const { rows, days, lastElapsed, columns, format, valueOf } = model
  const printDate = meta.printDate ?? formatPrintDate()

  const wb = new ExcelJS.Workbook()
  wb.creator = 'FleetmaX'
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

  const title = ws.addRow([meta.title])
  title.getCell(1).font = { bold: true, size: 15 }
  mergeRow(title.number)

  const sub = ws.addRow([meta.monthLabel])
  sub.getCell(1).font = { size: 9 }
  mergeRow(sub.number)

  const band = ws.addRow([`Selection :  ${meta.selection}`, '', `Company :  ${meta.bgLabel}`])
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
        r.getCell(c).fill = fill('FFDEECDE')
        r.getCell(c).alignment = { horizontal: 'right' }
      }
    }
  }

  ws.addRow([])
  const stamp = ws.addRow([`Print Date : ${printDate}`, '', 'FleetmaX'])
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
