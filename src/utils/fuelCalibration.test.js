import { describe, expect, it } from 'vitest'
import {
  validateCalibration, rawToLitres, readingLitres, parseCalibrationRows, toNumber, sampleCalibrationCsv, SAMPLE_POINTS,
  canonicalPort, samePort,
} from './fuelCalibration'
import { parseCsv } from './journeyStopsImport'

const table = [{ litres: 0, mv: 500 }, { litres: 50, mv: 1500 }, { litres: 100, mv: 2500 }]
const cal = { method: 'PORT', port: 'BLE Fuel Level #1', points: table, tankCapacityL: 100 }

describe('toNumber', () => {
  it('reads plain, comma-decimal and thousands figures', () => {
    expect(toNumber('1,234.5')).toBe(1234.5)
    expect(toNumber('12,5')).toBe(12.5)
    expect(toNumber(' 300 ')).toBe(300)
    expect(toNumber('')).toBeNull()
    expect(toNumber('abc')).toBeNull()
    expect(toNumber(7)).toBe(7)
  })
})

describe('validateCalibration', () => {
  it('sorts by voltage and accepts a rising table', () => {
    const v = validateCalibration([{ litres: 100, mv: 2500 }, { litres: 0, mv: 500 }, { litres: 50, mv: 1500 }])
    expect(v.errors).toEqual([])
    expect(v.direction).toBe('rising')
    expect(v.points.map(p => p.mv)).toEqual([500, 1500, 2500])
  })

  it('accepts a falling table (voltage drops as the tank fills)', () => {
    const v = validateCalibration([{ litres: 0, mv: 4000 }, { litres: 50, mv: 2500 }, { litres: 100, mv: 1000 }])
    expect(v.errors).toEqual([])
    expect(v.direction).toBe('falling')
    expect(rawToLitres(1750, { method: 'AIN1', points: v.points })).toEqual({ litres: 75, flag: null })
  })

  it('uses an exact duplicate row once, with a warning', () => {
    const v = validateCalibration([{ litres: 0, mv: 500, row: 2 }, { litres: 0, mv: 500, row: 3 }, { litres: 10, mv: 900, row: 4 }])
    expect(v.errors).toEqual([])
    expect(v.points).toHaveLength(2)
    expect(v.warnings[0]).toMatchObject({ row: 3 })
  })

  it('refuses one voltage with two levels, and a table that goes up and down', () => {
    expect(validateCalibration([{ litres: 0, mv: 500, row: 2 }, { litres: 10, mv: 500, row: 3 }, { litres: 20, mv: 900, row: 4 }]).errors[0]).toMatchObject({ row: 3 })
    const zig = validateCalibration([{ litres: 0, mv: 500 }, { litres: 30, mv: 900 }, { litres: 20, mv: 1300 }, { litres: 40, mv: 1700 }])
    expect(zig.errors[0].message).toMatch(/only rise or only fall/)
  })

  it('needs two rows and numbers', () => {
    expect(validateCalibration([{ litres: 0, mv: 500 }]).errors[0].message).toMatch(/at least 2 rows/)
    expect(validateCalibration([{ litres: 'x', mv: 500, row: 5 }, { litres: 1, mv: 600 }, { litres: 2, mv: 700 }]).errors[0]).toEqual({ row: 5, message: 'Fuel Liter is not a number' })
    expect(validateCalibration([{ litres: -1, mv: 500 }, { litres: 1, mv: 600 }]).errors[0].message).toMatch(/negative/)
  })

  it('warns when the table and the tank capacity disagree', () => {
    expect(validateCalibration(table, { tankCapacityL: 80 }).warnings[0].message).toMatch(/more than the 80 L tank/)
    expect(validateCalibration(table, { tankCapacityL: 300 }).warnings[0].message).toMatch(/stops at 100 L/)
    expect(validateCalibration(table, { tankCapacityL: 100 }).warnings).toEqual([])
  })
})

describe('rawToLitres', () => {
  it('interpolates between points', () => {
    expect(rawToLitres(1000, cal)).toEqual({ litres: 25, flag: null })
    expect(rawToLitres(2500, cal)).toEqual({ litres: 100, flag: null })
    expect(rawToLitres(500, cal)).toEqual({ litres: 0, flag: null })
  })

  it('holds a reading just outside the table to its end', () => {
    expect(rawToLitres(2600, cal)).toEqual({ litres: 100, flag: 'clamped' })
    expect(rawToLitres(400, cal)).toEqual({ litres: 0, flag: 'clamped' })
  })

  it('gives no litres far outside the table (a dropout to 0, another scale)', () => {
    expect(rawToLitres(30022, cal)).toEqual({ litres: null, flag: 'out_of_range' })
    expect(rawToLitres(0, cal)).toEqual({ litres: null, flag: 'out_of_range' })
    expect(rawToLitres(null, cal)).toEqual({ litres: null, flag: 'out_of_range' })
  })

  it('CAN is percent of the tank', () => {
    const can = { method: 'CAN', tankCapacityL: 400 }
    expect(rawToLitres(25, can)).toEqual({ litres: 100, flag: null })
    expect(rawToLitres(104, can)).toEqual({ litres: 400, flag: 'clamped' })
    expect(rawToLitres(250, can)).toEqual({ litres: null, flag: 'out_of_range' })
    expect(rawToLitres(25, { method: 'CAN' })).toEqual({ litres: null, flag: 'no_tank' })
  })

  it('without a calibration there are no litres', () => {
    expect(rawToLitres(1000, null)).toEqual({ litres: null, flag: 'no_calibration' })
    expect(readingLitres({ raw: 1000, port: 'BLE Fuel Level #2' }, cal)).toEqual({ litres: null, flag: 'other_port' })
    expect(readingLitres({ raw: 1000, port: 'BLE Fuel Level #1' }, cal)).toEqual({ litres: 25, flag: null })
  })
})

describe('parseCalibrationRows', () => {
  it('reads the client template (Fuel Liter * / Voltage *)', () => {
    const rows = [['Fuel Liter *', 'Voltage *'], ['0', '500'], ['', ''], ['50', '1,500'], ['100', 'x']]
    const p = parseCalibrationRows(rows)
    expect(p.layout).toBe('template')
    expect(p.points).toEqual([{ row: 2, litres: 0, mv: 500 }, { row: 4, litres: 50, mv: 1500 }, { row: 5, litres: 100, mv: null }])
    expect(p.errors).toEqual([{ row: 5, message: 'Voltage “x” is not a number' }])
  })

  it('finds the header below a title and in other columns', () => {
    const p = parseCalibrationRows([['Calibration'], [], ['', 'Voltage*', 'Fuel Liter*'], ['', '600', '0'], ['', '900', '10']])
    expect(p.points).toEqual([{ row: 4, litres: 0, mv: 600 }, { row: 5, litres: 10, mv: 900 }])
  })

  it('reads the installer’s pairs layout without a header', () => {
    const rows = [
      ['REF NO.', 'XX-001'], [], ['DEVICE NO.', '1234'], [],
      ['TANK', '0', '', '40', '', '200', '', '1900'],
      ['', '20', '', '210', '', '220', '', '2050'],
      ['', '40', '', '380', '', '240', '', ''],
    ]
    const p = parseCalibrationRows(rows)
    expect(p.layout).toBe('pairs')
    expect(p.points.map(x => [x.litres, x.mv])).toEqual([[0, 40], [20, 210], [40, 380], [200, 1900], [220, 2050]])
    expect(p.warnings).toEqual([{ row: 7, message: '240 L has no voltage — skipped' }])
    expect(validateCalibration(p.points).errors).toEqual([])
  })

  it('says so when there is no table', () => {
    expect(parseCalibrationRows([['Name', 'Value'], ['a', 'b']]).errors[0].message).toMatch(/No header row/)
  })

  it('the sample file reads back as a valid table', () => {
    const p = parseCalibrationRows(parseCsv(sampleCalibrationCsv(), { keepBlank: true }))
    expect(p.errors).toEqual([])
    const v = validateCalibration(p.points, { tankCapacityL: 200 })
    expect(v.errors).toEqual([])
    expect(v.points).toEqual(SAMPLE_POINTS)
  })
})

describe('sensor port names (client 2026-11-27: the calibration of 8 of 11 vehicles never applied)', () => {
  it('the same port written with or without the # is one port', () => {
    expect(canonicalPort('BLE Fuel Level #1')).toBe('BLE Fuel Level 1')
    expect(canonicalPort('  BLE  Fuel Level 1 ')).toBe('BLE Fuel Level 1')
    expect(samePort('BLE Fuel Level #1', 'BLE Fuel Level 1')).toBe(true)
    expect(samePort('ble fuel level 1', 'BLE Fuel Level #1')).toBe(true)
    expect(samePort('BLE Fuel Level 1', 'BLE Fuel Level 2')).toBe(false)
    expect(samePort('ain.1', 'ain.2')).toBe(false)
  })

  it('a calibration saved against #1 converts a reading of the port without the #', () => {
    const cal = { method: 'PORT', port: 'BLE Fuel Level #1', tankCapacityL: 100, points: [{ litres: 0, mv: 0 }, { litres: 100, mv: 1000 }] }
    expect(readingLitres({ port: 'BLE Fuel Level 1', raw: 500 }, cal)).toMatchObject({ litres: 50 })
    expect(readingLitres({ port: 'BLE Fuel Level 2', raw: 500 }, cal)).toMatchObject({ litres: null, flag: 'other_port' })
  })
})

describe('Flespi sources (client 2026-11-27)', () => {
  it('names the port of every method and converts CAN litres without a table', async () => {
    const m = await import('./fuelCalibration')
    expect(m.METHOD_PORT).toMatchObject({ AIN1: 'ain.1', AIN2: 'ain.2', CAN: 'can.fuel.level', CAN_VOLUME: 'can.fuel.volume' })
    expect(m.FLESPI_FUEL_SOURCES.AIN2).toEqual({ field: 'ain.2', port: 'ain.2', unit: 'V' })
    expect(m.readingLitres({ port: 'can.fuel.volume', raw: 22 }, { method: 'CAN_VOLUME' })).toEqual({ litres: 22, flag: null })
    expect(m.readingLitres({ port: 'can.fuel.level', raw: 22 }, { method: 'CAN_VOLUME' }).flag).toBe('other_port')
  })
})
