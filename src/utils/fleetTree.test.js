import { describe, expect, it } from 'vitest'
import { buildFleetTree, levelsForRole, placeVehicle, placesOf, vehicleIdsOf } from './fleetTree'
import { GROUP_SHARE_LABEL, displayPlacement, vehicleInCompany } from './vehiclePlacement'

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
  it('nests Group → BG → Branch, skips a missing Group, names a missing branch after the client, puts unregistered last', () => {
    const root = buildFleetTree(V, place, levelsForRole('SUPER_ADMIN'))
    expect(root.count).toBe(5)
    expect(root.children.map(c => `${c.level}:${c.label}:${c.count}`)).toEqual([
      'group:Dubai Metro:3', 'bg:Northern Gulf Haulage:1', 'none:Not registered in Settings:1',
    ])
    const habtoor = root.children[0].children[0]
    expect(habtoor).toMatchObject({ level: 'bg', label: 'Al Habtoor Logistics', count: 2 })
    // One vehicle in its branch; the other has none, so the client (BG) is its branch.
    expect(habtoor.children.map(c => `${c.level}:${c.label}`)).toEqual(['branch:Al Habtoor Logistics', 'branch:Mussafah Depot'])
    expect(habtoor.vehicles).toEqual([])
    expect(vehicleIdsOf(root.children[0])).toEqual([101, 100, 102])
  })

  it('starts lower for lower roles', () => {
    expect(buildFleetTree(V, place, levelsForRole('GROUP_ADMIN')).children.map(c => c.level)).toEqual(['bg', 'bg', 'bg', 'none'])
    const bgUser = buildFleetTree(V.slice(0, 2), place, levelsForRole('BG_USER'))
    expect(bgUser.children.map(c => c.label)).toEqual(['Al Habtoor Logistics', 'Mussafah Depot'])
    expect(bgUser.vehicles).toEqual([])
    expect(buildFleetTree(V, place, []).vehicles).toHaveLength(5)
  })
})

// ── One vehicle in several places (client, 2026-11-13) ──────────────────────

describe('buildFleetTree with shared vehicles', () => {
  const rows = {
    // Home: Al Habtoor / Mussafah Depot; also shared to Desert Rose (BG) and to
    // a second branch of its own BG.
    '1': {
      companyId: 'bgA', groupId: '', branchId: 'brA', owned: true, ownerName: 'Al Habtoor Logistics',
      shares: [
        { id: 's1', level: 'bg', companyId: 'bgB', branchId: '', groupId: '', companyName: 'Desert Rose Transport' },
        { id: 's2', level: 'branch', companyId: 'bgA', branchId: 'brY', groupId: '', companyName: 'Al Habtoor Logistics', branchName: 'Al Ain Yard' },
      ],
    },
    '2': { companyId: 'bgA', groupId: '', branchId: '', owned: true, shares: [] },
    // Another tenant's vehicle shared into Desert Rose: no home for this viewer.
    '5': {
      companyId: 'bgZ', groupId: '', branchId: '', owned: false, ownerName: 'Emirates Cold Chain',
      shares: [{ id: 's3', level: 'bg', companyId: 'bgB', branchId: '', groupId: '', companyName: 'Desert Rose Transport' }],
    },
    // Shared to the Group only.
    '6': {
      companyId: 'bgC', groupId: '', branchId: '', owned: true,
      shares: [{ id: 's4', level: 'group', groupId: 'grp1', companyId: '', branchId: '', groupName: 'Dubai Metro' }],
    },
  }
  const sctx = {
    ...ctx,
    vehicleByImei: imei => rows[imei] ?? null,
    branches: new Map([...ctx.branches, ['brY', { id: 'brY', name: 'Al Ain Yard' }]]),
  }
  const vs = ['1', '2', '5', '6'].map((ident, i) => ({ id: 200 + i, ident }))
  const places = v => placesOf(v, sctx)

  it('lists a shared vehicle under each of its places, marks the shares, and counts it once', () => {
    const root = buildFleetTree(vs, places, levelsForRole('SUPER_ADMIN'))
    const metro = root.children.find(c => c.label === 'Dubai Metro')
    // v200 under Habtoor (home + Al Ain Yard) and Desert Rose; v202 in Desert
    // Rose; v203 in the Group's shared row. Four vehicles, however many rows.
    expect(metro.count).toBe(4)
    expect(root.count).toBe(4)
    const habtoor = metro.children.find(c => c.label === 'Al Habtoor Logistics')
    expect(habtoor.count).toBe(2)
    const depot = habtoor.children.find(c => c.label === 'Mussafah Depot')
    const yard = habtoor.children.find(c => c.label === 'Al Ain Yard')
    expect(depot.vehicles.map(v => v.id)).toEqual([200])
    expect(depot.sharedIds.has(200)).toBe(false)
    expect(yard.sharedIds.has(200)).toBe(true)
    const rose = metro.children.find(c => c.label === 'Desert Rose Transport')
    expect(rose.children[0].vehicles.map(v => v.id)).toEqual([200, 202])
    expect([...rose.children[0].sharedIds]).toEqual([200, 202])
    const groupRow = metro.children.find(c => c.label === GROUP_SHARE_LABEL)
    expect(groupRow.vehicles.map(v => v.id)).toEqual([203])
    // Its home BG (no group) still lists it too.
    expect(root.children.find(c => c.label === 'Northern Gulf Haulage').count).toBe(1)
    expect(vehicleIdsOf(metro)).toHaveLength(4)
  })

  it('a vehicle shared in shows only where it was shared to, never under its owner', () => {
    const bgUser = buildFleetTree([vs[2]], places, levelsForRole('BG_USER'))
    expect(bgUser.children.map(c => c.label)).toEqual(['Desert Rose Transport'])
    expect(bgUser.children[0].sharedIds.has(202)).toBe(true)
  })
})

describe('displayPlacement', () => {
  it('names the home for the viewer\'s own vehicle and the share for one shared in', () => {
    const own = { companyId: 'bgA', branchId: 'brA', groupId: '', owned: true, shares: [{ id: 's', level: 'bg', companyId: 'bgB', branchId: '', groupId: '' }] }
    expect(displayPlacement(own, ctx)).toMatchObject({ companyName: 'Al Habtoor Logistics', branchName: 'Mussafah Depot', shared: false })
    const theirs = { companyId: 'bgZ', branchId: 'brZ', groupId: '', owned: false, ownerName: 'Emirates Cold Chain', shares: [{ id: 's', level: 'branch', companyId: 'bgA', branchId: 'brA', groupId: '', branchName: 'Mussafah Depot' }] }
    expect(displayPlacement(theirs, ctx)).toMatchObject({ companyId: 'bgA', companyName: 'Al Habtoor Logistics', branchName: 'Mussafah Depot', shared: true, ownerName: 'Emirates Cold Chain' })
    expect(vehicleInCompany(theirs, 'bgA')).toBe(true)
    expect(vehicleInCompany(theirs, 'bgB')).toBe(false)
  })
})
