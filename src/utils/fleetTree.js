/**
 * The Live Map list as a tree (client, 2026-11-09): Group → Business Group →
 * Branch → vehicles, so it is clear whose vehicle each one is. The GGB is not
 * shown ("woh tu Master k pass ho ga").
 *
 * A level that does not exist is skipped: a BG with no Group is a top-level
 * entry of its own, and a vehicle with no Branch sits directly under its BG.
 * Each role starts below itself:
 *   Super Admin, GGB Admin  Group → BG → Branch
 *   Group Admin             BG → Branch
 *   BG user, Sub-user       Branch
 * A tracker not registered under Settings goes in a "Not registered in
 * Settings" group, last.
 */

export const LEVEL_LABEL = { group: 'Group', bg: 'BG', branch: 'Branch', none: '' }

const LEVELS_BY_ROLE = {
  SUPER_ADMIN: ['group', 'bg', 'branch'],
  GGB_ADMIN: ['group', 'bg', 'branch'],
  GROUP_ADMIN: ['bg', 'branch'],
  BG_USER: ['branch'],
  SUB_USER: ['branch'],
}

/** The levels the tree shows for a role; demo mode (no role) shows all three. */
export function levelsForRole(role) {
  if (role == null) return ['group', 'bg', 'branch']
  return LEVELS_BY_ROLE[role] ?? []
}

/**
 * Where a vehicle sits: { group, bg, branch }, each { id, name } or null; null
 * for a tracker with no Settings registration.
 *
 * @param {object} v    Live Map vehicle (`v.ident` is the IMEI)
 * @param {object} ctx  { vehicleByImei(imei), companies, groups, branches } — the last three Maps by id
 */
export function placeVehicle(v, ctx) {
  const row = ctx.vehicleByImei(v.ident)
  if (!row || !row.companyId) return null
  const bg = ctx.companies.get(row.companyId) ?? null
  const groupId = row.groupId || bg?.groupId || ''
  const group = groupId ? ctx.groups.get(groupId) ?? null : null
  const branch = row.branchId ? ctx.branches.get(row.branchId) ?? null : null
  return {
    group: groupId ? { id: groupId, name: group?.name || 'Group' } : null,
    bg: { id: row.companyId, name: bg?.name || 'Business Group' },
    branch: row.branchId ? { id: row.branchId, name: branch?.name || 'Branch' } : null,
  }
}

const byLabel = (a, b) => (a.level === 'none') - (b.level === 'none') || a.label.localeCompare(b.label)

function finish(node) {
  node.children.sort(byLabel)
  node.children.forEach(finish)
  node.count = node.vehicles.length + node.children.reduce((s, c) => s + c.count, 0)
  return node
}

/**
 * The tree for the vehicles on the list, in their list order inside each group.
 * @returns {{ key, level, label, children, vehicles, count }} the root
 */
export function buildFleetTree(vehicles, placeOf, levels) {
  const root = { key: 'root', level: 'root', label: '', children: [], vehicles: [] }
  if (!levels.length) {
    root.vehicles = [...vehicles]
    return finish(root)
  }
  const unregistered = []
  for (const v of vehicles) {
    const place = placeOf(v)
    if (!place) { unregistered.push(v); continue }
    let node = root
    for (const level of levels) {
      const part = place[level]
      if (!part) continue // e.g. a BG with no Group, a vehicle with no Branch
      const key = `${node.key}/${level}:${part.id}`
      let child = node.children.find(c => c.key === key)
      if (!child) {
        child = { key, level, label: part.name, children: [], vehicles: [] }
        node.children.push(child)
      }
      node = child
    }
    node.vehicles.push(v)
  }
  if (unregistered.length) {
    root.children.push({ key: 'root/unregistered', level: 'none', label: 'Not registered in Settings', children: [], vehicles: unregistered })
  }
  return finish(root)
}

/** Every vehicle id under a node. */
export function vehicleIdsOf(node) {
  return [...node.vehicles.map(v => v.id), ...node.children.flatMap(vehicleIdsOf)]
}
