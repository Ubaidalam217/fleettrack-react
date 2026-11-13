import { describe, expect, it } from 'vitest'
import { siteField, withSite, siteOf } from './vehicleSite'

const branchName = id => ({ b1: 'Mussafah Depot' })[id] ?? '—'

describe('siteOf', () => {
  it('uses the vehicle Site, then its branch, then nothing', () => {
    expect(siteOf({ branchId: 'b1', customFields: [{ name: 'Site', value: ' Ruwais Plant ' }] }, branchName)).toBe('Ruwais Plant')
    expect(siteOf({ branchId: 'b1', customFields: [{ name: 'Contract', value: 'C-1' }] }, branchName)).toBe('Mussafah Depot')
    expect(siteOf({ branchId: 'b1', customFields: [{ name: 'SITE', value: '  ' }] }, branchName)).toBe('Mussafah Depot')
    // No branch: the BG is its branch, which is not a site.
    expect(siteOf({ branchId: '', customFields: [] }, branchName)).toBe('')
    expect(siteOf({ branchId: 'gone' }, branchName)).toBe('')
    expect(siteOf(null, branchName)).toBe('')
  })
})

describe('siteField / withSite', () => {
  const fields = [{ name: 'Contract', value: 'C-1' }, { name: 'site', value: 'Old' }, { name: 'Owner', value: 'ADNOC' }]

  it('reads the field named Site in any case', () => {
    expect(siteField(fields)).toBe('Old')
    expect(siteField(undefined)).toBe('')
  })

  it('sets Site in its place, adds it when missing, removes it when blank', () => {
    expect(withSite(fields, ' Ruwais ')).toEqual([
      { name: 'Contract', value: 'C-1' }, { name: 'site', value: 'Ruwais' }, { name: 'Owner', value: 'ADNOC' },
    ])
    expect(withSite([{ name: 'Contract', value: 'C-1' }], 'Ruwais')).toEqual([
      { name: 'Contract', value: 'C-1' }, { name: 'Site', value: 'Ruwais' },
    ])
    expect(withSite(fields, '')).toEqual([{ name: 'Contract', value: 'C-1' }, { name: 'Owner', value: 'ADNOC' }])
    expect(withSite([], '')).toEqual([])
  })
})
