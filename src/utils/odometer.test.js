import { describe, expect, it } from 'vitest'
import { fmtKm, hasCorrection, odometerLabel, vehicleKm } from './odometer'

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
