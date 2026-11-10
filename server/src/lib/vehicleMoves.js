/**
 * Reallocation History (client report list, 2026-11-10): a VehicleMove row each
 * time a vehicle lands under another branch, group or Group Global Admin —
 * from the vehicle form (branch, or the group of a group-less BG) and from
 * moving its BG or its group (lib/moves.js).
 *
 * The rows are written in the same transaction as the change itself, so the
 * history cannot miss a move or record one that did not happen. Names are
 * copied as they read at the time.
 */

import prisma from '../prisma.js'

/** Who made the change, as the history shows them. */
export const actorOf = req => ({ id: req.user?.id ?? null, name: req.user?.shortName || req.user?.email || null })

const vehicleLabel = v => v.plateNo || v.fleetNo || v.imei

const VEHICLE_SELECT = { id: true, bgId: true, plateNo: true, fleetNo: true, imei: true, groupId: true }

function row(v, level, fromName, toName, by) {
  return {
    bgId: v.bgId, vehicleId: v.id, vehicleLabel: vehicleLabel(v), imei: v.imei ?? null,
    level, fromName: fromName ?? null, toName: toName ?? null,
    movedById: by?.id ?? null, movedByName: by?.name ?? null,
  }
}

async function namesOf(delegate, ids) {
  const list = [...new Set(ids.filter(Boolean))]
  if (!list.length) return new Map()
  const rows = await prisma[delegate].findMany({ where: { id: { in: list } }, select: { id: true, name: true } })
  return new Map(rows.map(r => [r.id, r.name]))
}

/**
 * The rows for a vehicle edit that changes its branch or its group.
 * `vehicle` is the row as it will read after the edit (for its label);
 * `before` the stored one. A vehicle with no branch counts its BG as its
 * branch (client, 2026-11-09), so that is the name the history shows.
 */
export async function editMoves(before, vehicle, { branchId, groupId }, by) {
  const branchChanged = (before.branchId ?? null) !== (branchId ?? null)
  const bg = await prisma.businessGroup.findUnique({ where: { id: before.bgId }, select: { name: true, groupId: true } })
  // The BG's own group is the vehicle's group whenever it has one.
  const groupBefore = before.groupId || bg?.groupId || null
  const groupAfter = groupId || bg?.groupId || null
  if (!branchChanged && groupBefore === groupAfter) return []

  const label = { ...before, ...vehicle }
  const out = []
  if (branchChanged) {
    const names = await namesOf('branch', [before.branchId, branchId])
    out.push(row(label, 'branch', names.get(before.branchId) ?? bg?.name, names.get(branchId) ?? bg?.name, by))
  }
  if (groupBefore !== groupAfter) {
    const names = await namesOf('group', [groupBefore, groupAfter])
    out.push(row(label, 'group', names.get(groupBefore) ?? 'No group', names.get(groupAfter) ?? 'No group', by))
  }
  return out
}

/** The rows for moving a BG — every vehicle in it — to another group and/or GGB. */
export async function bgMoves(bg, target, by) {
  const vehicles = await prisma.vehicle.findMany({ where: { bgId: bg.id }, select: VEHICLE_SELECT })
  if (!vehicles.length) return []
  const groups = await namesOf('group', [bg.groupId, target.groupId, ...vehicles.map(v => v.groupId)])
  const ggbs = await namesOf('ggb', [bg.ggbId, target.ggbId])
  const out = []
  for (const v of vehicles) {
    // The move clears a vehicle's own group, so after it the group is the target's.
    const before = v.groupId || bg.groupId || null
    if (before !== (target.groupId ?? null)) {
      out.push(row(v, 'group', groups.get(before) ?? 'No group', groups.get(target.groupId) ?? 'No group', by))
    }
    if (bg.ggbId !== target.ggbId) out.push(row(v, 'ggb', ggbs.get(bg.ggbId), ggbs.get(target.ggbId), by))
  }
  return out
}

/** The rows for moving a group — every vehicle of its BGs — to another GGB. */
export async function groupMoves(group, targetGgbId, by) {
  const vehicles = await prisma.vehicle.findMany({ where: { bg: { groupId: group.id } }, select: VEHICLE_SELECT })
  if (!vehicles.length) return []
  const ggbs = await namesOf('ggb', [group.ggbId, targetGgbId])
  return vehicles.map(v => row(v, 'ggb', ggbs.get(group.ggbId), ggbs.get(targetGgbId), by))
}
