import { describe, expect, it } from 'vitest'
import { buildFleetTree, levelsForRole, placeVehicle, vehicleIdsOf } from './fleetTree'

const ctx = {
  vehicleByImei: imei => ({
    '1': { companyId: 'bgA', groupId: '', branchId: 'brA' },
    '2': { companyId: 'bgA', groupId: '', branchId: '' },
    '3': { companyId: 'bgB', groupId: '', branchId: '' },
    '4': { companyId: 'bgC', groupId: '', branchId: '' },
  })[imei] ?? null,
  companies: new Map([
    ['bgA', { id: 'bgA', name: 'Al Habtoor Logistics', groupId: 'grp1' }],
    ['bgB', { id: 'bgB', name: 'Desert Rose Transport', groupId: 'grp1' }],
    ['bgC', { id: 'bgC', name: 'Northern Gulf Haulage', groupId: '' }],
  ]),
  groups: new Map([['grp1', { id: 'grp1', name: 'Dubai Metro' }]]),
  branches: new Map([['brA', { id: 'brA', name: 'Mussafah Depot' }]]),
}
const V = ['1', '2', '3', '4', '9'].map((ident, i) => ({ id: 100 + i, ident }))
const place = v => placeVehicle(v, ctx)

describe('buildFleetTree', () => {
  it('nests Group → BG → Branch, skips a missing level, puts unregistered last, never shows a GGB', () => {
    const root = buildFleetTree(V, place, levelsForRole('SUPER_ADMIN'))
    expect(root.count).toBe(5)
    expect(root.children.map(c => `${c.level}:${c.label}:${c.count}`)).toEqual([
      'group:Dubai Metro:3', 'bg:Northern Gulf Haulage:1', 'none:Not registered in Settings:1',
    ])
    const habtoor = root.children[0].children[0]
    expect(habtoor).toMatchObject({ level: 'bg', label: 'Al Habtoor Logistics', count: 2 })
    // One vehicle in its branch, the other (no branch) straight under the BG.
    expect(habtoor.children.map(c => `${c.level}:${c.label}`)).toEqual(['branch:Mussafah Depot'])
    expect(habtoor.vehicles.map(v => v.id)).toEqual([101])
    expect(vehicleIdsOf(root.children[0])).toEqual([101, 100, 102])
  })

  it('starts lower for lower roles', () => {
    expect(buildFleetTree(V, place, levelsForRole('GROUP_ADMIN')).children.map(c => c.level)).toEqual(['bg', 'bg', 'bg', 'none'])
    const bgUser = buildFleetTree(V.slice(0, 2), place, levelsForRole('BG_USER'))
    expect(bgUser.children.map(c => c.label)).toEqual(['Mussafah Depot'])
    expect(bgUser.vehicles.map(v => v.id)).toEqual([101])
    expect(buildFleetTree(V, place, []).vehicles).toHaveLength(5)
  })
})
