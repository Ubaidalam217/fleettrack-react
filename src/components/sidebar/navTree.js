/**
 * Shared shape and helpers for the sidebar's nested menus.
 *
 * A node is a *branch* when it has `children` and a *leaf* when it has a `path`;
 * nothing has both, which is what lets TreeMenu stay a single recursive function.
 *
 * Settings owned all of this first. Reports needs the identical behaviour —
 * one highlighted row, deep links expanding their ancestors, a title read back
 * out of the config — so the walks live here and both trees pass their own nodes
 * in. Copying them was the alternative, and the copy is where the two would
 * quietly diverge.
 */

/**
 * The tree with the leaves this role cannot use pruned out.
 *
 * Prunes rather than hides per row, because a branch whose every leaf is gone has
 * to go too — a BG user would otherwise get a "Users" branch that expands to
 * nothing, which reads as a loading failure rather than as a permission.
 *
 * The caller owns who may see what; this file owns only the shape of the tree.
 */
export function filterMenu(nodes, canSee) {
  const out = []
  for (const node of nodes) {
    if (node.children) {
      const children = filterMenu(node.children, canSee)
      if (children.length) out.push({ ...node, children })
      continue
    }
    if (canSee(node.id)) out.push(node)
  }
  return out
}

/**
 * Ids of every branch on the way down to `pathname`, including `rootId`.
 * Used to auto-open the tree so a deep link lands with its parents expanded.
 * Returns an empty array when the path is not in the tree.
 */
export function ancestorIdsIn(nodes, rootId, pathname) {
  const walk = (list, trail) => {
    for (const node of list) {
      if (node.path === pathname) return trail
      if (node.children) {
        const hit = walk(node.children, [...trail, node.id])
        if (hit) return hit
      }
    }
    return null
  }
  return walk(nodes, [rootId]) || []
}

/** Human label for a path in the tree — lets a placeholder page title itself. */
export function labelForPathIn(nodes, pathname) {
  const walk = list => {
    for (const node of list) {
      if (node.path === pathname) return node.label
      if (node.children) {
        const hit = walk(node.children)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(nodes)
}
