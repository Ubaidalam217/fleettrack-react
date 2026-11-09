/**
 * The Live Map list as a tree (client, 2026-11-09): GGB → Group → BG → vehicles,
 * so it is clear whose vehicle each one is — the way the client's reference
 * system groups its list.
 *
 * Each signed-in role starts the tree at the first level below its own:
 *   Super Admin  GGB → Group → BG
 *   GGB Admin    Group → BG
 *   Group Admin  BG
 *   BG / Sub-user  a flat list
 * A BG that has no Group sits straight under its GGB. A tracker that is not
 * registered under Settings goes in a "Not registered in Settings" group last.
 */

export const LEVEL_LABEL = { ggb: 'GGB', group: 'Group', bg: 'BG', none: '' }

const LEVELS_BY_ROLE = {
  SUPER_ADMIN: ['ggb', 'group', 'bg'],
  GGB_ADMIN: ['group', 'bg'],
  GROUP_ADMIN: ['bg'],
  BG_USER: [],
  SUB_USER: [],
}

/** The levels the tree shows for a role; demo mode (no role) shows all three. */
export function levelsForRole(role) {
  if (role == null) return ['ggb', 'group', 'bg']
  return LEVELS_BY_ROLE[role] ?? []
}

/**
 * Where a vehicle sits: { ggb, group, bg }, each { id, name } or null; null
 * for a tracker with no Settings registration.
 *
 * @param {object} v    Live Map vehicle (`v.ident` is the IMEI)
 * @param {object} ctx  { vehicleByImei(imei), companies, groups, resellers } — the last three Maps by id
 */
export function placeVehicle(v, ctx) {
  const row = ctx.vehicleByImei(v.ident)
  if (!row || !row.companyId) return null
  const bg = ctx.companies.get(row.companyId) ?? null
  const groupId = row.groupId || bg?.groupId || ''
  const group = groupId ? ctx.groups.get(groupId) ?? null : null
  const ggbId = bg?.resellerId || group?.resellerId || ''
  const ggb = ggbId ? ctx.resellers.get(ggbId) ?? null : null
  return {
    ggb: ggbId ? { id: ggbId, name: ggb?.name || 'Group Global Admin' } : null,
    group: groupId ? { id: groupId, name: group?.name || 'Group' } : null,
    bg: { id: row.companyId, name: bg?.name || 'Business Group' },
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
      if (!part) continue // e.g. a BG with no Group: straight under its GGB
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
