import { describe, expect, it } from 'vitest'
import { changedCells } from './bulkUpdate'

describe('changedCells', () => {
  const row = { make: 'Volvo', model: 'FH16', branchId: 'b1', vehicleNumber: 'AD 1' }
  it('keeps only what differs from the saved vehicle', () => {
    expect(changedCells(row, { make: 'Volvo ', model: 'FH12', branchId: 'b1' })).toEqual({ model: 'FH12' })
    expect(changedCells(row, undefined)).toEqual({})
  })
  it('counts an odometer once something is typed', () => {
    expect(changedCells(row, { odometer: '' })).toEqual({})
    expect(changedCells(row, { odometer: '150000' })).toEqual({ odometer: '150000' })
  })
})
