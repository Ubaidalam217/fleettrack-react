/**
 * The Live Map list as a tree (client, 2026-11-09): Group → Business Group →
 * Branch → vehicles, so it is clear whose vehicle each one is. The GGB is not
 * shown ("woh tu Master k pass ho ga").
 *
 * A level that does not exist is skipped: a BG with no Group is a top-level
 * entry of its own. A vehicle with no Branch is under a branch named after its
 * Business Group — the client counts as the branch (client, 2026-11-09).
 * Each role starts below itself:
 *   Super Admin, GGB Admin  Group → BG → Branch
 *   Group Admin             BG → Branch
 *   BG user, Sub-user       Branch
 * A tracker not registered under Settings goes in a "Not registered in
 * Settings" group, last.
 *
 * One vehicle can be in several places (client, 2026-11-13; see
 * utils/vehiclePlacement.js): it is listed under each, marked shared where it
 * is not its home, and counted once wherever its places meet — a BG's [n] is
 * how many vehicles, not how many rows.
 */

import { placementsOf } from './vehiclePlacement.js'

export const LEVEL_LABEL = { group: 'Group', bg: 'Business Group', branch: 'Branch', none: '' }

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
 * Every place a Live Map vehicle sits: [{ group, bg, branch, shared }], each
 * part { id, name } or null; [] for a tracker with no Settings registration.
 *
 * @param {object} v    Live Map vehicle (`v.ident` is the IMEI)
 * @param {object} ctx  { vehicleByImei(imei), companies, groups, branches } — the last three Maps by id
 */
export function placesOf(v, ctx) {
  const row = ctx.vehicleByImei(v.ident)
  if (!row || !row.companyId) return []
  return placementsOf(row, ctx)
}

/** The first of them (its home for the viewer's own vehicle); null if unregistered. */
export function placeVehicle(v, ctx) {
  return placesOf(v, ctx)[0] ?? null
}

const byLabel = (a, b) => (a.level === 'none') - (b.level === 'none') || a.label.localeCompare(b.label)

/** Every vehicle id under a node, once each. */
export function vehicleIdsOf(node) {
  const ids = new Set(node.vehicles.map(v => v.id))
  for (const c of node.children) for (const id of vehicleIdsOf(c)) ids.add(id)
  return [...ids]
}

function finish(node) {
  node.children.sort(byLabel)
  node.children.forEach(finish)
  node.count = vehicleIdsOf(node).length
  return node
}

/**
 * The tree for the vehicles on the list, in their list order inside each group.
 * `placeOf(v)` gives one place or an array of them (a vehicle shared to other
 * places). A leaf lists a vehicle once; `sharedIds` holds the ones that are
 * there through a share, for the row's "Shared" chip.
 * @returns {{ key, level, label, children, vehicles, sharedIds, count }} the root
 */
export function buildFleetTree(vehicles, placeOf, levels) {
  const root = { key: 'root', level: 'root', label: '', children: [], vehicles: [], sharedIds: new Set() }
  if (!levels.length) {
    root.vehicles = [...vehicles]
    return finish(root)
  }
  const unregistered = []
  for (const v of vehicles) {
    const places = [].concat(placeOf(v) ?? [])
    if (!places.length) { unregistered.push(v); continue }
    for (const place of places) {
      let node = root
      for (const level of levels) {
        const part = place[level]
        if (!part) continue // e.g. a BG with no Group
        const key = `${node.key}/${level}:${part.id}`
        let child = node.children.find(c => c.key === key)
        if (!child) {
          child = { key, level, label: part.name, children: [], vehicles: [], sharedIds: new Set() }
          node.children.push(child)
        }
        node = child
      }
      if (node.vehicles.some(x => x.id === v.id)) {
        // Two of its places meet here: once is enough, and it is not "shared"
        // if one of them is its home.
        if (!place.shared) node.sharedIds.delete(v.id)
        continue
      }
      node.vehicles.push(v)
      if (place.shared) node.sharedIds.add(v.id)
    }
  }
  if (unregistered.length) {
    root.children.push({ key: 'root/unregistered', level: 'none', label: 'Not registered in Settings', children: [], vehicles: unregistered, sharedIds: new Set() })
  }
  return finish(root)
}
