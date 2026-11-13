import { describe, expect, it } from 'vitest'
import { checkReading, fmtKm, hasCorrection, odometerLabel, vehicleKm } from './odometer'

describe('vehicle odometer', () => {
  it('adds the correction to the tracker reading', () => {
    expect(vehicleKm(1200.5, 148799.5)).toBe(150000)
    expect(vehicleKm(1200.5, null)).toBe(1200.5)
    expect(vehicleKm(null, 100)).toBeNull()
  })
  it('formats and detects a correction', () => {
    expect(fmtKm(150000)).toBe('150,000.0 km')
    expect(fmtKm(null)).toBeNull()
    expect(hasCorrection(0)).toBe(true)
    expect(hasCorrection(null)).toBe(false)
  })
})

describe('odometerLabel', () => {
  it('shows the tracker reading beside a corrected one', () => {
    expect(odometerLabel(1200.5, 148799.5)).toBe('150,000.0 km · Device 1,200.5 km')
    expect(odometerLabel(1200.5, null)).toBe('1,200.5 km')
    expect(odometerLabel(null, 5)).toBeNull()
  })
})

describe('checkReading', () => {
  it('blocks what the server would refuse', () => {
    expect(checkReading('', 1000).error).toBeTruthy()
    expect(checkReading('abc', 1000).error).toBeTruthy()
    expect(checkReading('-5', 1000).error).toBeTruthy()
    expect(checkReading('10000000', 1000).error).toBeTruthy()
  })
  it('warns below the current total and on a jump that looks like a typo', () => {
    expect(checkReading('999', 1000)).toMatchObject({ value: 999, error: null })
    expect(checkReading('999', 1000).warning).toMatch(/Lower than the current 1,000.0 km/)
    expect(checkReading('1,101,000', 1000).warning).toMatch(/check the digits/)
  })
  it('passes a normal reading, and any reading when there is no current total', () => {
    expect(checkReading(' 150,000 ', 149000)).toEqual({ value: 150000, error: null, warning: null })
    expect(checkReading('5', null)).toEqual({ value: 5, error: null, warning: null })
  })
})
