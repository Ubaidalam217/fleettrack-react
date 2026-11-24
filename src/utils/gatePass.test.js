import { describe, it, expect } from 'vitest'
import {
  gatePassState, matchesGatePassFilter, buildGatePassRows, groupGatePassRows, gatePassSummary, contractorOptions, hasGatePass,
} from './gatePass'
import { isoDateFromToday } from './licenceExpiry'

const NOW = new Date(2026, 10, 24, 12, 0, 0) // 24 Nov 2026, local
const at = days => isoDateFromToday(days, NOW)

// Fake people only: the repo is public.
const D = (id, name, days, extra = {}) => ({
  id, name, companyId: 'bg1', status: 'Active', employeeId: `E${id}`, gatePassTag: `04AA${id}`,
  gatePassExpiry: days === null ? '' : at(days), contractorName: 'Acme Contracting', ...extra,
})

const drivers = [
  D('1', 'Sample Driver One', -10),
  D('2', 'Sample Driver Two', 0),
  D('3', 'Sample Driver Three', 7),
  D('4', 'Sample Driver Four', 20),
  D('5', 'Sample Driver Five', 45),
  D('6', 'Sample Driver Six', 200),
  D('7', 'Sample Driver Seven', null),
  D('8', 'No Card Person', null, { gatePassTag: '', contractorName: '' }),
  D('9', 'Other Group', -3, { companyId: 'bg2', contractorName: 'Site B' }),
  D('10', 'Gone Driver', -50, { status: 'Inactive' }),
]

describe('gatePassState', () => {
  it('reads expired, expiring, valid and none', () => {
    expect(gatePassState(at(-1), NOW)).toEqual({ state: 'expired', days: -1 })
    expect(gatePassState(at(0), NOW)).toEqual({ state: 'expiring', days: 0 })
    expect(gatePassState(at(30), NOW)).toEqual({ state: 'expiring', days: 30 })
    expect(gatePassState(at(31), NOW)).toEqual({ state: 'valid', days: 31 })
    expect(gatePassState(at(45), NOW, 60)).toEqual({ state: 'expiring', days: 45 })
    expect(gatePassState('', NOW)).toEqual({ state: 'none', days: null })
  })
})

describe('matchesGatePassFilter', () => {
  it('windows are inclusive and exclude the expired', () => {
    expect(matchesGatePassFilter(7, 'd7')).toBe(true)
    expect(matchesGatePassFilter(8, 'd7')).toBe(false)
    expect(matchesGatePassFilter(-1, 'd7')).toBe(false)
    expect(matchesGatePassFilter(0, 'd60')).toBe(true)
  })
  it('attention = expired or within 30 days', () => {
    expect(matchesGatePassFilter(-100, 'attention')).toBe(true)
    expect(matchesGatePassFilter(30, 'attention')).toBe(true)
    expect(matchesGatePassFilter(31, 'attention')).toBe(false)
  })
  it('a card with no expiry shows only under All', () => {
    expect(matchesGatePassFilter(null, 'all')).toBe(true)
    expect(matchesGatePassFilter(null, 'expired')).toBe(false)
    expect(matchesGatePassFilter(null, 'attention')).toBe(false)
  })
})

describe('buildGatePassRows', () => {
  const names = o => buildGatePassRows(drivers, { now: NOW, ...o }).map(r => r.driverName)

  it('default: active drivers that are expired or expiring within 30 days, soonest first', () => {
    expect(names({})).toEqual(['Sample Driver One', 'Other Group', 'Sample Driver Two', 'Sample Driver Three', 'Sample Driver Four'])
  })

  it('Expired only', () => {
    expect(names({ filter: 'expired' })).toEqual(['Sample Driver One', 'Other Group'])
  })

  it('Expiring windows', () => {
    expect(names({ filter: 'd7' })).toEqual(['Sample Driver Two', 'Sample Driver Three'])
    expect(names({ filter: 'd15' })).toEqual(['Sample Driver Two', 'Sample Driver Three'])
    expect(names({ filter: 'd30' })).toEqual(['Sample Driver Two', 'Sample Driver Three', 'Sample Driver Four'])
    expect(names({ filter: 'd60' })).toEqual(['Sample Driver Two', 'Sample Driver Three', 'Sample Driver Four', 'Sample Driver Five'])
  })

  it('All lists every driver with a card, undated last, and leaves out drivers with no card', () => {
    const all = names({ filter: 'all' })
    expect(all[all.length - 1]).toBe('Sample Driver Seven')
    expect(all).not.toContain('No Card Person')
    expect(all).not.toContain('Gone Driver') // inactive by default
    expect(all).toHaveLength(8)
  })

  it('status text follows the window: 30 days by default, 60 on the 60-day view', () => {
    const st = o => Object.fromEntries(buildGatePassRows(drivers, { now: NOW, ...o }).map(r => [r.driverName, r.status]))
    expect(st({ filter: 'all' })['Sample Driver Four']).toBe('Expiring')
    expect(st({ filter: 'all' })['Sample Driver Five']).toBe('Valid')
    expect(st({ filter: 'd60' })['Sample Driver Five']).toBe('Expiring')
  })

  it('driver status all brings the inactive one back', () => {
    expect(names({ filter: 'expired', driverStatus: 'all' })[0]).toBe('Gone Driver')
  })

  it('filters by Business Group and contractor', () => {
    expect(names({ filter: 'all', companyId: 'bg2' })).toEqual(['Other Group'])
    expect(names({ filter: 'all', contractor: 'site b' })).toEqual(['Other Group'])
  })

  it('searches name, tag, ID and contractor', () => {
    expect(names({ filter: 'all', query: 'driver five' })).toEqual(['Sample Driver Five'])
    expect(names({ filter: 'all', query: 'E3' })).toEqual(['Sample Driver Three'])
    expect(names({ filter: 'all', query: '04AA6' })).toEqual(['Sample Driver Six'])
  })

  it('rows carry the sample file columns', () => {
    const r = buildGatePassRows(drivers, { now: NOW, filter: 'expired' })[0]
    expect(r).toMatchObject({
      driverName: 'Sample Driver One', tagNumber: '04AA1', idNumber: 'E1', contractorName: 'Acme Contracting',
      status: 'Expired', days: -10, daysLeft: '-10',
    })
    expect(r.tagExpiry).toMatch(/^\d{1,2} [A-Z][a-z]{2} 2026$/)
  })

  it('a removed driver is never listed', () => {
    expect(buildGatePassRows([{ ...D('x', 'Removed', -5), deletedAt: '2026-11-01' }], { now: NOW, filter: 'all' })).toEqual([])
  })
})

describe('grouping, summary, options', () => {
  const rows = buildGatePassRows(drivers, { now: NOW, filter: 'all' })

  it('groups per BG and numbers S. NO from 1 in each group', () => {
    const groups = groupGatePassRows(rows, id => (id === 'bg1' ? 'Alpha Group' : 'Beta Group'))
    expect(groups.map(g => g.label)).toEqual(['Alpha Group', 'Beta Group'])
    expect(groups[0].rows.map(r => r.sno)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(groups[1].rows.map(r => r.sno)).toEqual(['1'])
    expect(groups[0].total).toBe('Total Drivers : 7')
  })

  it('summary counts', () => {
    const s = Object.fromEntries(gatePassSummary(rows).map(x => [x.label, x.value]))
    expect(s).toMatchObject({ Expired: '2', 'Expiring in 7 days': '2', 'Expiring in 30 days': '3', 'No expiry date': '1', 'Total Drivers': '8' })
  })

  it('contractor options are distinct free values of drivers holding a card', () => {
    expect(contractorOptions(drivers)).toEqual(['Acme Contracting', 'Site B'])
    expect(contractorOptions(drivers, 'bg2')).toEqual(['Site B'])
  })

  it('hasGatePass', () => {
    expect(hasGatePass({ gatePassTag: ' ' })).toBe(false)
    expect(hasGatePass({ gatePassExpiry: '2027-01-01' })).toBe(true)
  })
})
