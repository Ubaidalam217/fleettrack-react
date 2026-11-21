/**
 * Files for Journey Management (client 2026-11-21): reading an uploaded stops
 * sheet (Excel or CSV) into rows of cells, the downloadable sample, and the
 * QR sheet of a journey's stops (PNG per stop, or one PDF to print).
 */

import { IMPORT_COLUMNS, parseCsv, sampleCsv } from './journeyStopsImport'
import { download } from './reportExport'

/** An .xlsx / .csv File → rows of cells (strings), the first sheet only. */
export async function readSheetFile(file) {
  const name = String(file?.name ?? '').toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') return parseCsv(await file.text())
  if (!name.endsWith('.xlsx')) throw new Error('Upload an Excel (.xlsx) or CSV file')
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) return []
  const rows = []
  ws.eachRow({ includeEmpty: false }, row => {
    const cells = []
    for (let c = 1; c <= Math.max(row.cellCount, IMPORT_COLUMNS.length); c++) {
      const v = row.getCell(c).value
      const text = v == null ? '' : typeof v === 'object' ? (v.text ?? v.result ?? (v instanceof Date ? v.toISOString().slice(11, 16) : '')) : v
      cells.push(String(text))
    }
    if (cells.some(x => x.trim() !== '')) rows.push(cells)
  })
  return rows
}

/** The sample sheet, as Excel (with a note row) or CSV. */
export async function downloadStopsSample(kind = 'xlsx') {
  if (kind === 'csv') {
    download(new Blob([sampleCsv()], { type: 'text/csv' }), 'FleetmaxX_stops_sample.csv')
    return
  }
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Stops')
  const rows = parseCsv(sampleCsv())
  rows.forEach((r, i) => {
    const row = ws.addRow(r)
    if (i === 0) row.font = { bold: true }
  })
  ws.columns.forEach(c => { c.width = 22 })
  ws.addRow([])
  ws.addRow(['Leave Latitude and Longitude empty to use an address-book entry with the same name.']).font = { italic: true, color: { argb: 'FF666666' } }
  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'FleetmaxX_stops_sample.xlsx')
}

/** A QR as a PNG data URL. */
export async function qrDataUrl(text, size = 320) {
  const QR = (await import('qrcode')).default
  return QR.toDataURL(String(text), { width: size, margin: 1, errorCorrectionLevel: 'M' })
}

/** One stop's QR as a PNG file. */
export async function downloadStopQr(journey, stop) {
  const url = await qrDataUrl(stop.code, 600)
  const blob = await (await fetch(url)).blob()
  download(blob, `${journey.ref}_${String(stop.name).replace(/[^\w-]+/g, '_')}_QR.png`)
}

/**
 * The journey's QR sheet: one card per stop that is visited by QR (or every
 * stop, `all`), with the stop's name, its code for typing, and the journey.
 * To print and put up at each stop.
 */
export async function downloadQrSheet(journey, { all = false } = {}) {
  const stops = journey.stops.filter((s, i) => i > 0 && (all || s.visitVia === 'QR'))
  if (!stops.length) throw new Error('No stop is visited by QR')
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const cardW = (W - 72) / 2, cardH = 330
  for (const [k, s] of stops.entries()) {
    const slot = k % 4
    if (k && slot === 0) doc.addPage()
    const x = 36 + (slot % 2) * cardW, y = 40 + Math.floor(slot / 2) * (cardH + 20)
    doc.setDrawColor(180); doc.setLineDashPattern([4, 3], 0); doc.rect(x + 4, y, cardW - 8, cardH); doc.setLineDashPattern([], 0)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(20)
    doc.text(doc.splitTextToSize(String(s.name), cardW - 40)[0], x + cardW / 2, y + 26, { align: 'center' })
    doc.addImage(await qrDataUrl(s.code, 400), 'PNG', x + (cardW - 200) / 2, y + 38, 200, 200)
    doc.setFont('courier', 'bold'); doc.setFontSize(20)
    doc.text(String(s.code), x + cardW / 2, y + 268, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90)
    doc.text(`${journey.ref} · ${journey.title}`.slice(0, 70), x + cardW / 2, y + 290, { align: 'center' })
    doc.text('Driver: scan this at the stop, or type the code', x + cardW / 2, y + 306, { align: 'center' })
  }
  doc.save(`${journey.ref}_QR_sheet.pdf`)
}
