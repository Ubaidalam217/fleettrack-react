/**
 * Branch tree arithmetic: subtree walks and cycle prevention.
 *
 * Split out of routes/branches.js because every one of these is a rule the
 * frontend already enforces against its mock, and the two have to agree
 * exactly — keeping them in one named function each makes that comparison
 * possible.
 */

import prisma from '../prisma.js'
import { badRequest } from './http.js'

/**
 * Every branch below `branchId`, at any depth. Excludes the branch itself.
 *
 * One query for the whole BG then an in-memory walk, rather than a recursive CTE
 * or a query per level: a BG's branch count is in the tens, and this keeps the
 * logic readable and identical in shape to the frontend's version.
 *
 * Iterative with a `seen` set, so a parent chain that somehow loops terminates
 * instead of recursing until the stack gives out. The data model prevents cycles
 * (see assertNoCycle) but a restored dump or a hand-edited row can still carry
 * one, and the delete path must not be the thing that falls over.
 */
export async function descendantIds(bgId, branchId) {
  if (!branchId) return []
  const all = await prisma.branch.findMany({
    where: { bgId },
    select: { id: true, parentBranchId: true },
  })

  const childrenOf = new Map()
  for (const b of all) {
    const key = b.parentBranchId ?? ''
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key).push(b.id)
  }

  const out = []
  const seen = new Set([branchId])
  const stack = [branchId]
  while (stack.length) {
    for (const childId of childrenOf.get(stack.pop()) ?? []) {
      if (seen.has(childId)) continue
      seen.add(childId)
      out.push(childId)
      stack.push(childId)
    }
  }
  return out
}

/** A branch plus everything under it — what a delete actually removes. */
export async function subtreeIds(bgId, branchId) {
  return branchId ? [branchId, ...(await descendantIds(bgId, branchId))] : []
}

/**
 * Throws unless `parentBranchId` is a legal parent for `branchId` in `bgId`.
 *
 * Three ways it can be illegal, and all three are reachable from the UI:
 *  - the parent belongs to a different BG (a stale dropdown, or a crafted
 *    request). Checked by querying with bgId in the where, so a cross-BG id
 *    reads as "no such branch in this BG" rather than being found and then
 *    rejected;
 *  - the parent is the branch itself;
 *  - the parent is one of the branch's own descendants, which would detach the
 *    whole subtree from the tree and make every row in it invisible to a walk
 *    from the top. This is the case a naive `parentId !== id` check misses.
 */
export async function assertValidParent({ bgId, branchId, parentBranchId }) {
  if (!parentBranchId) return

  const parent = await prisma.branch.findFirst({
    where: { id: parentBranchId, bgId },
    select: { id: true },
  })
  if (!parent) {
    throw badRequest('Parent branch must be an existing branch of the same business group')
  }

  // Only relevant when editing an existing branch; a new one has no descendants.
  if (!branchId) return

  if (parentBranchId === branchId) {
    throw badRequest('A branch cannot be its own parent')
  }

  const below = await descendantIds(bgId, branchId)
  if (below.includes(parentBranchId)) {
    throw badRequest('A branch cannot be moved under one of its own sub-branches')
  }
}

/**
 * The BG's branches flattened depth-first with a `depth` on each row — the order
 * and indentation the frontend's table and both pickers render from.
 *
 * Two guards, both about never losing a row from the page:
 *  - a parentBranchId that does not resolve inside this BG is treated as
 *    top-level rather than dropped, so the row stays visible and therefore
 *    fixable;
 *  - anything left unvisited after the walk sat in a parent cycle, and is
 *    appended flat for the same reason.
 */
export function buildTree(rows) {
  const byId = new Map(rows.map(b => [b.id, b]))

  const childrenOf = new Map()
  for (const b of rows) {
    const key = b.parentBranchId && byId.has(b.parentBranchId) ? b.parentBranchId : ''
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key).push(b)
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.name.localeCompare(b.name))

  const out = []
  const seen = new Set()
  const walk = (parent, depth) => {
    for (const b of childrenOf.get(parent) ?? []) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      out.push({ ...b, depth })
      walk(b.id, depth + 1)
    }
  }
  walk('', 0)
  for (const b of rows) if (!seen.has(b.id)) out.push({ ...b, depth: 0 })
  return out
}
