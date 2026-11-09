import { describe, expect, it } from 'vitest'
import { buildFleetTree, levelsForRole, placeVehicle, vehicleIdsOf } from './fleetTree'

const ctx = {
  vehicleByImei: imei => ({
    '1': { companyId: 'bgA', groupId: '' },
    '2': { companyId: 'bgA', groupId: '' },
    '3': { companyId: 'bgB', groupId: '' },
    '4': { companyId: 'bgC', groupId: '' },
  })[imei] ?? null,
  companies: new Map([
    ['bgA', { id: 'bgA', name: 'AAA Transport & Services', resellerId: 'g1', groupId: 'grp1' }],
    ['bgB', { id: 'bgB', name: 'Al Noor Gen Transport', resellerId: 'g1', groupId: '' }],
    ['bgC', { id: 'bgC', name: 'Adnan General Transport', resellerId: 'g2', groupId: '' }],
  ]),
  groups: new Map([['grp1', { id: 'grp1', name: 'Abu Dhabi Ops', resellerId: 'g1' }]]),
  resellers: new Map([['g1', { id: 'g1', name: 'AAA Transport Services' }], ['g2', { id: 'g2', name: 'Adnan Holding' }]]),
}
const V = ['1', '2', '3', '4', '9'].map((ident, i) => ({ id: 100 + i, ident }))
const place = v => placeVehicle(v, ctx)

describe('buildFleetTree', () => {
  it('nests GGB → Group → BG for a Super Admin, skips a missing Group, and puts unregistered last', () => {
    const root = buildFleetTree(V, place, levelsForRole('SUPER_ADMIN'))
    expect(root.count).toBe(5)
    expect(root.children.map(c => `${c.level}:${c.label}:${c.count}`)).toEqual([
      'ggb:AAA Transport Services:3', 'ggb:Adnan Holding:1', 'none:Not registered in Settings:1',
    ])
    const aaa = root.children[0]
    expect(aaa.children.map(c => `${c.level}:${c.label}`)).toEqual(['group:Abu Dhabi Ops', 'bg:Al Noor Gen Transport'])
    expect(aaa.children[0].children[0]).toMatchObject({ level: 'bg', label: 'AAA Transport & Services', count: 2 })
    expect(vehicleIdsOf(aaa)).toEqual([100, 101, 102])
  })

  it('starts lower for lower roles, and is flat for a BG user', () => {
    expect(buildFleetTree(V, place, levelsForRole('GROUP_ADMIN')).children.map(c => c.level)).toEqual(['bg', 'bg', 'bg', 'none'])
    const flat = buildFleetTree(V, place, levelsForRole('BG_USER'))
    expect(flat.children).toEqual([])
    expect(flat.vehicles.map(v => v.id)).toEqual([100, 101, 102, 103, 104])
  })
})
