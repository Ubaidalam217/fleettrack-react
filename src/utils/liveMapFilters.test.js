import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, NOT_SET, validityState, vehicleAttributes, matchesAttributes, filterOptions, activeFilterCount } from './liveMapFilters'

const NOW = new Date(2026, 10, 6, 15, 0) // 6 Nov 2026, local

describe('validityState', () => {
  it('reads expired, expiring within 30 days, valid and not set', () => {
    expect(validityState('2026-11-05', NOW)).toBe('expired')
    expect(validityState('2026-11-06', NOW)).toBe('expiring')
    expect(validityState('2026-12-06', NOW)).toBe('expiring')
    expect(validityState('2026-12-07', NOW)).toBe('valid')
    expect(validityState('', NOW)).toBe(NOT_SET)
  })
})

const profile = (vehicle, extra = {}) => ({ linked: true, vehicle, bgName: 'Al Habtoor', branchName: 'Depot', ...extra })
const a1 = vehicleAttributes({ master: { vehicleType: 'truck' } }, profile({ companyId: 'c1', branchId: 'b1', subGroup: 'Heavy', deviceType: 'FMB920', validUntil: '2026-10-01' }), NOW)
// No branch: the client (Business Group) stands in as the branch.
const a2 = vehicleAttributes({ master: { vehicleType: '' } }, profile({ companyId: 'c2', branchId: '', subGroup: '', deviceType: 'FMC130', validUntil: '2027-05-01' }, { bgName: 'Desert Rose', branchName: 'Desert Rose' }), NOW)
const unlinked = vehicleAttributes({ master: {} }, { linked: false }, NOW)

describe('matchesAttributes', () => {
  it('passes everything with no filter set', () => {
    expect([a1, a2, unlinked].every(a => matchesAttributes(a, EMPTY_FILTERS))).toBe(true)
  })

  it('matches each filter, and Not set matches the blanks', () => {
    expect(matchesAttributes(a1, { ...EMPTY_FILTERS, assetType: 'truck', company: 'c1', validity: 'expired' })).toBe(true)
    expect(matchesAttributes(a2, { ...EMPTY_FILTERS, assetType: 'truck' })).toBe(false)
    expect(matchesAttributes(a2, { ...EMPTY_FILTERS, assetGroup: NOT_SET, branch: 'bg:c2', validity: 'valid' })).toBe(true)
    expect(matchesAttributes(a2, { ...EMPTY_FILTERS, branch: NOT_SET })).toBe(false)
    expect(matchesAttributes(unlinked, { ...EMPTY_FILTERS, company: 'c1' })).toBe(false)
    expect(matchesAttributes(unlinked, { ...EMPTY_FILTERS, validity: NOT_SET })).toBe(true)
  })
})

describe('filterOptions', () => {
  it('lists distinct values, and branches only of the chosen company', () => {
    const o = filterOptions([a1, a2, unlinked], { ...EMPTY_FILTERS, company: 'c2' })
    expect(o.company.map(x => x.label)).toEqual(['Al Habtoor', 'Desert Rose'])
    expect(o.assetType).toEqual([{ value: 'truck', label: 'Truck' }])
    expect(o.branch).toEqual([{ value: 'bg:c2', label: 'Desert Rose' }])
    expect(activeFilterCount({ ...EMPTY_FILTERS, company: 'c2', validity: 'valid' })).toBe(2)
  })
})

describe('custom vehicle types', () => {
  it('treats one custom type in any case as one choice', () => {
    const t1 = vehicleAttributes({ master: { vehicleType: 'Tanker' } }, { linked: false }, NOW)
    const t2 = vehicleAttributes({ master: {} }, profile({ vehicleType: ' tanker ' }), NOW)
    expect(filterOptions([t1, t2, a1], EMPTY_FILTERS).assetType).toEqual([
      { value: 'tanker', label: 'Tanker' },
      { value: 'truck', label: 'Truck' },
    ])
    expect([t1, t2].every(a => matchesAttributes(a, { ...EMPTY_FILTERS, assetType: 'tanker' }))).toBe(true)
  })
})
