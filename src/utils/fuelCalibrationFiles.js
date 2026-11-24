/**
 * Files for Settings › Master › Fuel › Calibration: reading an uploaded
 * calibration sheet (.xlsx or .csv) into rows of cell text, and the sample
 * file in the client's layout (`Fuel Liter *`, `Voltage *`). An old Excel
 * .xls cannot be read in the browser: it is refused with a note to save it
 * as .xlsx first.
 */

import { parseCsv } from './journeyStopsImport'
import { download } from './reportExport'
import { cellText } from './vehicleImportFiles'
import { SAMPLE_POINTS, sampleCalibrationCsv } from './fuelCalibration'

export const XLS_NOTE = 'This is an old Excel (.xls) file. Open it in Excel and use Save As › Excel Workbook (.xlsx), then upload the .xlsx.'

/** An .xlsx / .csv File → rows of cells (strings) of its first sheet. */
export async function readCalibrationFile(file) {
  const name = String(file?.name ?? '').toLowerCase()
  if (name.endsWith('.xls')) throw new Error(XLS_NOTE)
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
    for (let c = 1; c <= Math.max(row.cellCount, 2); c++) cells.push(cellText(row.getCell(c).value))
    rows.push(cells)
  }
  return rows
}

/** The sample: the client's two columns and an invented 200 L table. */
export async function downloadCalibrationSample(kind = 'xlsx') {
  if (kind === 'csv') {
    download(new Blob([sampleCalibrationCsv()], { type: 'text/csv' }), 'FleetmaxX_fuel_calibration_sample.csv')
    return
  }
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Calibration')
  ws.columns = [{ header: 'Fuel Liter *', width: 16 }, { header: 'Voltage *', width: 16 }]
  ws.getRow(1).font = { bold: true }
  for (const p of SAMPLE_POINTS) ws.addRow([p.litres, p.mv])
  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'FleetmaxX_fuel_calibration_sample.xlsx')
}
