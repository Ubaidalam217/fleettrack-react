/**
 * Files for the vehicle import (client 2026-11-24, Master Data sheet): reading an
 * uploaded .xlsx / .csv into rows of cells with the sheet's own row numbers, and
 * the downloadable sample (the template's own layout: notes, group row, header).
 */

import { parseCsv } from './journeyStopsImport'
import { download } from './reportExport'
import { IMPORT_COLUMNS, IMPORT_NOTES, SAMPLE_ROW, sampleCsv, errorsCsv } from './vehicleImport'

const pad = n => String(n).padStart(2, '0')

/** One exceljs cell value as text: rich text, formulas, links and date cells included. */
export function cellText(v) {
  if (v == null) return ''
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(p => p.text ?? '').join('')
    if ('result' in v) return cellText(v.result)
    if ('text' in v) return cellText(v.text)
    return ''
  }
  return String(v)
}

/** An .xlsx / .csv File → rows of cells (strings), the first sheet, blank rows kept. */
export async function readVehicleSheet(file) {
  const name = String(file?.name ?? '').toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') return parseCsv(await file.text(), { keepBlank: true })
  if (!name.endsWith('.xlsx')) throw new Error('Upload an Excel (.xlsx) or CSV file')
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) return []
  const rows = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cells = []
    for (let c = 1; c <= Math.max(row.cellCount, IMPORT_COLUMNS.length); c++) cells.push(cellText(row.getCell(c).value))
    rows.push(cells)
  }
  return rows
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** The sample sheet: the notes, the "Object Information" group row, the header, and one made-up vehicle. */
export async function downloadVehicleSample(kind = 'xlsx') {
  if (kind === 'csv') {
    download(new Blob([sampleCsv()], { type: 'text/csv' }), 'FleetmaxX_vehicles_sample.csv')
    return
  }
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Vehicles')
  const n = IMPORT_COLUMNS.length
  const note = ws.addRow(['Note', IMPORT_NOTES.map(x => `- ${x}`).join('\n')])
  note.getCell(1).font = { bold: true }
  note.getCell(2).alignment = { wrapText: true, vertical: 'top' }
  ws.mergeCells(1, 2, 1, n)
  note.height = 150
  const group = ws.addRow(Array(n).fill('Object Information'))
  group.font = { bold: true }
  group.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB0C4DE' } } })
  const head = ws.addRow(IMPORT_COLUMNS.map(c => c.label))
  head.font = { bold: true }
  ws.addRow(IMPORT_COLUMNS.map(c => SAMPLE_ROW[c.key] ?? ''))
  ws.columns.forEach((c, i) => { c.width = Math.max(16, Math.min(30, IMPORT_COLUMNS[i].label.length + 2)) })
  // Text columns, so Excel keeps IMEIs, SIMs and the 22-digit satellite IMEI whole.
  for (const key of ['imei', 'sim', 'sim2', 'satelliteImei']) {
    ws.getColumn(IMPORT_COLUMNS.findIndex(c => c.key === key) + 1).numFmt = '@'
  }
  ws.views = [{ state: 'frozen', ySplit: 3 }]
  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: XLSX_TYPE }), 'FleetmaxX_vehicles_sample.xlsx')
}

/** The failed rows as a CSV file. */
export function downloadImportErrors(errors) {
  download(new Blob([errorsCsv(errors)], { type: 'text/csv' }), 'FleetmaxX_vehicle_import_problems.csv')
}
