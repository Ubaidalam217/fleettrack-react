import { download, fileStamp } from './reportExport'
import { expenseDay } from '../data/expenses'

/**
 * Settings › Master › Expense → Excel, the list as filtered on screen, with a
 * total row. exceljs is imported lazily, as for the report exports.
 */
export async function exportExpensesExcel(rows, { branchOf, title = 'Expenses' } = {}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'FleetmaxX'
  const ws = wb.addWorksheet('Expenses', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'To', key: 'to', width: 12 },
    { header: 'Business Group', key: 'bg', width: 24 },
    { header: 'Branch', key: 'branch', width: 20 },
    { header: 'Vehicle', key: 'vehicle', width: 16 },
    { header: 'Category', key: 'category', width: 10 },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Sub Type', key: 'subType', width: 16 },
    { header: 'Odometer (km)', key: 'odometer', width: 14 },
    { header: 'Work Hours', key: 'workHours', width: 11 },
    { header: 'Fuel Source', key: 'fuelSource', width: 14 },
    { header: 'Vendor', key: 'vendor', width: 20 },
    { header: 'Reference No', key: 'referenceNo', width: 16 },
    { header: 'Amount (AED)', key: 'amount', width: 14 },
    { header: 'Bills', key: 'bills', width: 7 },
    { header: 'Description', key: 'description', width: 36 },
    { header: 'Added By', key: 'addedBy', width: 20 },
  ]
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1F5' } }

  for (const e of rows) {
    ws.addRow({
      date: expenseDay(e),
      to: e.category === 'Fix' ? e.toDate : '',
      bg: e.bg?.name ?? '',
      branch: branchOf ? branchOf(e) : (e.vehicle?.branch?.name ?? ''),
      vehicle: e.vehicle?.plateNo || e.vehicleLabel,
      category: e.category,
      type: e.type,
      subType: e.subType ?? '',
      odometer: e.odometer ?? '',
      workHours: e.workHours ?? '',
      fuelSource: e.fuelSource ?? '',
      vendor: e.vendor ?? '',
      referenceNo: e.referenceNo ?? '',
      amount: e.amount,
      bills: e.bills?.length ?? 0,
      description: e.description ?? '',
      addedBy: e.createdByName ?? '',
    })
  }
  ws.getColumn('amount').numFmt = '#,##0.00'
  ws.getColumn('odometer').numFmt = '#,##0'

  const total = ws.addRow({ referenceNo: 'Total', amount: rows.reduce((s, e) => s + (e.amount || 0), 0) })
  total.font = { bold: true }

  const buffer = await wb.xlsx.writeBuffer()
  download(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${title.replace(/\s+/g, '_')}_${fileStamp()}.xlsx`
  )
}
