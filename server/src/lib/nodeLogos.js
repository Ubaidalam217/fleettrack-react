/**
 * Logos of GGBs, Groups, Business Groups and Branches (client, 2026-11-13).
 *
 * A report header shows, at its left, the logo of the account that made it:
 * the nearest logo up the account's own chain (Branch → BG → Group → GGB),
 * with FleetmaxX on the right. A Super Admin has no chain and sees FleetmaxX
 * only. The bytes live in NodeLogo; each node keeps the key of its current
 * logo, which GET /api/node-logos/:key serves (routes/nodeLogos.js).
 */

import prisma from '../prisma.js'
import { ROLES } from './scope.js'

/** Upload limit, as for scanned documents. */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024

/** The scope entity name → its Prisma delegate and its NodeLogo column. */
export const LOGO_KINDS = Object.freeze({
  ggb: { delegate: 'ggb', fk: 'ggbId' },
  group: { delegate: 'group', fk: 'groupId' },
  bg: { delegate: 'businessGroup', fk: 'bgId' },
  branch: { delegate: 'branch', fk: 'branchId' },
})

export const logoUrl = key => (key ? `/api/node-logos/${key}` : null)

const NODE = { id: true, name: true, logoKey: true }

/**
 * The logos above this account, nearest first, as { kind, id, name, url }:
 * a sub-user's branches (then the branches above them), its BG, the BG's
 * Group, the GGB. Nodes without a logo are left out; a Super Admin gets [].
 *
 * Reads ancestors by id, which scope.js otherwise forbids, because every id
 * here comes from the account's own scope or from the rows above it — never
 * from the request — and only names and logos go back.
 */
export async function chainLogos(scope) {
  if (scope.role === ROLES.SUPER_ADMIN) return []
  const nodes = []
  let bgId = null
  let groupId = null
  let ggbId = null
  if (scope.role === ROLES.BG_USER || scope.role === ROLES.SUB_USER) bgId = scope.bgId
  if (scope.role === ROLES.GROUP_ADMIN) groupId = scope.groupId
  if (scope.role === ROLES.GGB_ADMIN) ggbId = scope.ggbId

  if (scope.role === ROLES.SUB_USER && bgId && scope.assignedBranchIds?.length) {
    const all = await prisma.branch.findMany({ where: { bgId }, select: { ...NODE, parentBranchId: true } })
    const byId = new Map(all.map(b => [b.id, b]))
    const own = scope.assignedBranchIds.map(id => byId.get(id)).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
    const seen = new Set()
    const add = b => {
      if (seen.has(b.id)) return
      seen.add(b.id)
      nodes.push({ kind: 'branch', ...b })
    }
    own.forEach(add)
    for (const b of own) {
      // Bounded: stored parent links could loop.
      for (let p = byId.get(b.parentBranchId), n = 0; p && n < 64; p = byId.get(p.parentBranchId), n++) add(p)
    }
  }
  if (bgId) {
    const bg = await prisma.businessGroup.findUnique({ where: { id: bgId }, select: { ...NODE, groupId: true, ggbId: true } })
    if (bg) {
      nodes.push({ kind: 'bg', ...bg })
      groupId = bg.groupId
      ggbId = bg.ggbId
    }
  }
  if (groupId) {
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { ...NODE, ggbId: true } })
    if (group) {
      nodes.push({ kind: 'group', ...group })
      ggbId = group.ggbId
    }
  }
  if (ggbId) {
    const ggb = await prisma.ggb.findUnique({ where: { id: ggbId }, select: NODE })
    if (ggb) nodes.push({ kind: 'ggb', ...ggb })
  }
  return nodes.filter(n => n.logoKey).map(n => ({ kind: n.kind, id: n.id, name: n.name, url: logoUrl(n.logoKey) }))
}
