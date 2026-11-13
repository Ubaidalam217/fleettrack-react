import { describe, expect, it } from 'vitest'
import { vehicleTypeOptions, vehicleTypeLabel, canonicalVehicleType, cleanVehicleType, MAX_CUSTOM_TYPE } from './vehicleTypes'

describe('vehicleTypeOptions', () => {
  it('keeps the built-ins first and adds each custom type once, ignoring case', () => {
    expect(vehicleTypeOptions(['Tanker', 'truck', ' tanker ', 'Crane', 'TRUCK', '', null, 'Water  Bowser'])).toEqual([
      '', 'car', 'bus', 'truck', 'bike', 'machine', 'Crane', 'Tanker', 'Water Bowser',
    ])
    expect(vehicleTypeOptions()).toEqual(['', 'car', 'bus', 'truck', 'bike', 'machine'])
  })
})

describe('canonicalVehicleType', () => {
  const options = vehicleTypeOptions(['Tanker'])
  it('takes an existing spelling when the typed name matches one', () => {
    expect(canonicalVehicleType('CAR', options)).toBe('car')
    expect(canonicalVehicleType(' tanker', options)).toBe('Tanker')
    expect(canonicalVehicleType('Dump  Truck ', options)).toBe('Dump Truck')
    expect(canonicalVehicleType('   ', options)).toBe('')
  })
  it('cuts a custom name at the limit', () => {
    expect(cleanVehicleType('x'.repeat(60))).toHaveLength(MAX_CUSTOM_TYPE)
  })
})

describe('vehicleTypeLabel', () => {
  it('capitalises built-ins and shows custom types as typed', () => {
    expect(vehicleTypeLabel('truck')).toBe('Truck')
    expect(vehicleTypeLabel('oil tanker')).toBe('oil tanker')
    expect(vehicleTypeLabel('')).toBe('')
  })
})
