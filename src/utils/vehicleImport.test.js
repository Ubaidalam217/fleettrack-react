import { describe, it, expect } from 'vitest'
import {
  IMPORT_COLUMNS, mapHeader, findHeaderRow, checkVehicleRow, readVehicleRows, customFieldsOf, sampleCsv, errorsCsv, SAMPLE_ROW,
} from './vehicleImport'
import { parseCsv } from './journeyStopsImport'
import { cellText } from './vehicleImportFiles'

const HEADER = IMPORT_COLUMNS.map(c => c.label)
const row = o => IMPORT_COLUMNS.map(c => o[c.key] ?? '')
const good = (n, imei, extra = {}) => row({ name: `Test Truck ${n}`, imei, ...extra })
// The client's layout: a notes row, a group row, then the header on row 3.
const sheet = (...data) => [['Note', 'x'], ['Object Information'], HEADER, ...data]

describe('header', () => {
  it('maps the template header, with its stars, brackets and spelling', () => {
    const m = mapHeader(HEADER)
    expect(m.name).toBe(0)
    expect(m.imei).toBe(5)
    expect(m.gpsWarranty).toBe(11)
    expect(m.vin).toBe(12)
    expect(m.elockPassword).toBe(25)
    expect(Object.keys(m)).toHaveLength(26)
  })
  it('finds the header on row 3 and tolerates other orders and short names', () => {
    expect(findHeaderRow(sheet())).toBe(2)
    expect(findHeaderRow([['IMEI', 'Name', 'Plate']])).toBe(0)
    expect(findHeaderRow([['Name', 'Plate']])).toBe(-1)
  })
})

describe('checkVehicleRow', () => {
  it('accepts the sample row', () => {
    const r = checkVehicleRow(SAMPLE_ROW)
    expect(r.problems).toEqual([])
    expect(r.vehicle.engineHourMode).toBe('From Sensor Port')
    expect(r.vehicle.odometer).toBe(45200)
  })
  it('needs a name and an IMEI', () => {
    expect(checkVehicleRow({}).problems).toEqual(['Vehicle Name is required', 'IMEI Number is required'])
  })
  it('limits and characters of the name, plate and IMEI', () => {
    expect(checkVehicleRow({ name: 'x'.repeat(61), imei: '350000000000001' }).problems[0]).toMatch(/up to 60/)
    expect(checkVehicleRow({ name: 'a<b>', imei: '350000000000001' }).problems[0]).toMatch(/letters, numbers/)
    expect(checkVehicleRow({ name: 'AD 91620-R8', imei: '350000000000001' }).problems).toEqual([])
    expect(checkVehicleRow({ name: 'A', plate: 'p'.repeat(41), imei: '350000000000001' }).problems[0]).toMatch(/up to 40/)
    expect(checkVehicleRow({ name: 'A', imei: '12345' }).problems[0]).toMatch(/10 to 20 digits/)
    expect(checkVehicleRow({ name: 'A', imei: '35000000000000A' }).problems[0]).toMatch(/10 to 20 digits/)
    expect(checkVehicleRow({ name: 'A', imei: '8.6e+14' }).problems[0]).toMatch(/format the column as Text/)
    expect(checkVehicleRow({ name: 'A', imei: ' 350 000 000 000 001 ' }).vehicle.imei).toBe('350000000000001')
  })
  it('SIM numbers are 6 to 20 digits', () => {
    const ok = { name: 'A', imei: '350000000000001' }
    expect(checkVehicleRow({ ...ok, sim: '12345' }).problems[0]).toMatch(/Sim Card Number: 6 to 20/)
    expect(checkVehicleRow({ ...ok, sim2: 'abc12345' }).problems[0]).toMatch(/Secondary Sim Number/)
    expect(checkVehicleRow({ ...ok, sim: '+971 50 000 0001' }).vehicle.sim).toBe('971500000001')
  })
  it('dates are real YYYY-MM-DD dates', () => {
    const ok = { name: 'A', imei: '350000000000001' }
    expect(checkVehicleRow({ ...ok, purchaseDate: '2022-02-30' }).problems).toEqual(['Purchase Date: use YYYY-MM-DD'])
    expect(checkVehicleRow({ ...ok, installDate: '15/01/2022' }).problems).toEqual(['Installation Date: use YYYY-MM-DD'])
    expect(checkVehicleRow({ ...ok, manufactureDate: '2022-01-15' }).problems).toEqual([])
    expect(checkVehicleRow({ ...ok, disposalDate: '2024-12-31T00:00:00.000Z' }).vehicle.disposalDate).toBe('2024-12-31')
  })
  it('warranty, seats, odometer, satellite IMEI, category and engine-hour source', () => {
    const ok = { name: 'A', imei: '350000000000001' }
    expect(checkVehicleRow({ ...ok, gpsWarranty: '12345' }).problems[0]).toMatch(/GPS Warrenty/)
    expect(checkVehicleRow({ ...ok, seats: '123456789' }).problems[0]).toMatch(/passenger seat/i)
    expect(checkVehicleRow({ ...ok, odometer: '-1' }).problems[0]).toMatch(/Odometer/)
    expect(checkVehicleRow({ ...ok, odometer: '10000000' }).problems[0]).toMatch(/Odometer/)
    expect(checkVehicleRow({ ...ok, odometer: '1,234.5' }).vehicle.odometer).toBe(1234.5)
    expect(checkVehicleRow({ ...ok, satelliteImei: '123' }).problems[0]).toMatch(/22 digits/)
    expect(checkVehicleRow({ ...ok, satelliteImei: '1'.repeat(22) }).problems).toEqual([])
    expect(checkVehicleRow({ ...ok, category: 'movable' }).vehicle.category).toBe('Movable')
    expect(checkVehicleRow({ ...ok, category: 'Flying' }).problems[0]).toMatch(/Movable or Immovable/)
    expect(checkVehicleRow({ ...ok, engineHourMode: '1' }).vehicle.engineHourMode).toBe('From Device CAN')
    expect(checkVehicleRow({ ...ok, engineHourMode: '7' }).problems[0]).toMatch(/Engine Work Hour/)
  })
  it('the Elock password is noted but never kept', () => {
    const r = checkVehicleRow({ name: 'A', imei: '350000000000001', elockPassword: 'secret' })
    expect(r.vehicle.hadElockPassword).toBe(true)
    expect(JSON.stringify(r.vehicle)).not.toContain('secret')
  })
})

describe('readVehicleRows', () => {
  it('reads valid rows with the sheet’s own row numbers (header on 3 → first vehicle on 4)', () => {
    const r = readVehicleRows(sheet(good(1, '350000000000001'), [], good(2, '350000000000002')))
    expect(r.fatal).toBeNull()
    expect(r.headerRow).toBe(3)
    expect(r.vehicles.map(v => [v.row, v.name])).toEqual([[4, 'Test Truck 1'], [6, 'Test Truck 2']])
    expect(r.errors).toEqual([])
  })

  it('flags a missing name or IMEI, a duplicate in the file and one already registered', () => {
    const r = readVehicleRows(
      sheet(
        good(1, '350000000000001'),
        good(2, '350000000000001'),                  // same IMEI as row 4
        row({ name: '', imei: '350000000000003' }),  // no name
        good(4, ''),                                 // no IMEI
        good(5, '350000000000005'),                  // already registered
      ),
      { existingImeis: new Set(['350000000000005']) }
    )
    expect(r.vehicles.map(v => v.row)).toEqual([4])
    const msg = Object.fromEntries(r.errors.map(e => [e.row, e.message]))
    expect(msg[5]).toBe('IMEI Number appears twice in the file (same as row 4)')
    expect(msg[6]).toBe('Vehicle Name is required')
    expect(msg[7]).toBe('IMEI Number is required')
    expect(msg[8]).toBe('IMEI Number is already registered to a vehicle')
  })

  it('chassis and engine numbers are unique, in the file and against the vehicles', () => {
    const r = readVehicleRows(
      sheet(
        good(1, '350000000000001', { vin: 'vin-1', engineNo: 'E1' }),
        good(2, '350000000000002', { vin: 'VIN-1' }),
        good(3, '350000000000003', { engineNo: 'taken' }),
      ),
      { existingEngines: new Set(['TAKEN']) }
    )
    const msg = Object.fromEntries(r.errors.map(e => [e.row, e.message]))
    expect(msg[5]).toMatch(/VIN \(Chassis Number\) appears twice.*row 4/)
    expect(msg[6]).toMatch(/Engine Number is already on another vehicle/)
    expect(r.vehicles).toHaveLength(1)
  })

  it('reports an empty file, a missing header and a header with no rows', () => {
    expect(readVehicleRows([]).fatal).toBe('The file is empty')
    expect(readVehicleRows([['a', 'b'], ['1', '2']]).fatal).toMatch(/No header row/)
    expect(readVehicleRows(sheet()).fatal).toBe('The file has no vehicle rows')
  })

  it('works in any column order and with a CSV', () => {
    const csv = 'IMEI Number,Vehicle Name,Odometer\n350000000000001,Csv Truck,1200\n'
    const r = readVehicleRows(parseCsv(csv, { keepBlank: true }))
    expect(r.vehicles).toHaveLength(1)
    expect(r.vehicles[0]).toMatchObject({ name: 'Csv Truck', imei: '350000000000001', odometer: 1200, row: 2 })
  })

  it('stops at the row limit', () => {
    const rows = Array.from({ length: 5 }, (_, i) => good(i, `35000000000${String(1000 + i)}`))
    const r = readVehicleRows(sheet(...rows), { maxRows: 3 })
    expect(r.items).toHaveLength(3)
    expect(r.errors.at(-1).message).toMatch(/Only the first 3 vehicles are read; 2 more/)
  })

  it('the sample CSV is itself a valid upload', () => {
    const r = readVehicleRows(parseCsv(sampleCsv(), { keepBlank: true }))
    expect(r.errors).toEqual([])
    expect(r.vehicles).toHaveLength(1)
  })
})

describe('customFieldsOf', () => {
  it('keeps the unmapped columns, in column order, leaving empty ones out', () => {
    const { vehicle } = checkVehicleRow({ ...SAMPLE_ROW, sim2: '', color: 'White' })
    const names = customFieldsOf(vehicle).map(f => f.name)
    expect(names).toEqual([
      'Object Category', 'Axles', 'Manufacture Date', 'Purchase Date', 'Installation Date', 'GPS Warranty', 'VIN (Chassis Number)',
      'Engine Number', 'Passenger Seats', 'GPS Tracker ID', 'GPS Tracker Serial No', 'Color', 'Engine Work Hour Consideration',
    ])
    expect(customFieldsOf(vehicle).find(f => f.name === 'Engine Work Hour Consideration').value).toBe('From Sensor Port')
  })
})

describe('files', () => {
  it('cellText reads rich text, formulas, links and dates', () => {
    expect(cellText({ richText: [{ text: 'Vehicle Name' }, { text: '*' }] })).toBe('Vehicle Name*')
    expect(cellText({ formula: 'A1', result: 42 })).toBe('42')
    expect(cellText({ text: 'x', hyperlink: 'http://a' })).toBe('x')
    expect(cellText(new Date(Date.UTC(2022, 0, 5)))).toBe('2022-01-05')
    expect(cellText(null)).toBe('')
  })
  it('errorsCsv quotes commas', () => {
    expect(errorsCsv([{ row: 4, name: 'A, B', imei: '1', message: 'bad' }])).toBe('Row,Vehicle Name,IMEI,Problem\n4,"A, B",1,bad\n')
  })
})
