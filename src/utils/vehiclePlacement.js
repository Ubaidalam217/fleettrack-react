/**
 * Where a vehicle shows (client, 2026-11-13: "One vehicle can be assigned to
 * multiple Group, BG, Branch").
 *
 * A vehicle has ONE home — its own Business Group and branch (`companyId`,
 * `branchId`), which keeps its tracker, its edits and its records — and may
 * also be shared to other places (`shares`, server: routes/vehicleShares.js):
 *
 *   'branch'  under that branch of that BG
 *   'bg'      directly under that BG (the BG counts as its branch, client 2026-11-09)
 *   'group'   under that Group, in a "Shared with this group" row — for the
 *             Group's admins (and the Super Admin / GGB admin above them)
 *
 * `owned` false means the vehicle is shared INTO the viewer's scope: it is
 * seen, never changed, and its home is not the viewer's to see, so it shows
 * only where it was shared to. The server already cut `shares` down to what the
 * viewer may know. Everything that groups vehicles by place reads it from here:
 * the Live Map tree, the vehicle list, the report headers.
 */

/** The label of the pseudo-BG row a Group share shows under. */
export const GROUP_SHARE_LABEL = 'Shared with this group'

const named = (id, name, fallback) => ({ id, name: name || fallback })

/** Is this vehicle the viewer's own (not merely shared into its scope)? */
export const isOwned = row => row?.owned !== false

/** Is the vehicle shown in this BG — its home or a share there? */
export function vehicleInCompany(row, companyId) {
  if (!row || !companyId) return false
  if (row.companyId === companyId) return true
  return (row.shares ?? []).some(s => s.companyId === companyId && (s.level === 'bg' || s.level === 'branch'))
}

/** Is the vehicle shown in this branch — its home branch or a share there? */
export function vehicleInBranch(row, branchId) {
  if (!row || !branchId) return false
  return row.branchId === branchId || (row.shares ?? []).some(s => s.level === 'branch' && s.branchId === branchId)
}

/**
 * Its home: { group, bg, branch, shared: false }, each { id, name } or null.
 * A vehicle with no branch sits under a branch named after its BG.
 * @param {object} ctx { companies, groups, branches } — Maps by id
 */
export function homePlacement(row, ctx) {
  if (!row?.companyId) return null
  const bg = ctx.companies.get(row.companyId) ?? null
  const groupId = row.groupId || bg?.groupId || ''
  const group = groupId ? ctx.groups.get(groupId) ?? null : null
  const branch = row.branchId ? ctx.branches.get(row.branchId) ?? null : null
  const bgName = bg?.name || row.ownerName || 'Business Group'
  return {
    group: groupId ? named(groupId, group?.name, 'Group') : null,
    bg: named(row.companyId, bgName),
    branch: row.branchId ? named(row.branchId, branch?.name, 'Branch') : named(`bg:${row.companyId}`, bgName),
    shared: false,
    shareId: null,
  }
}

/**
 * Where one share puts the vehicle, in the same shape; null if the viewer
 * cannot see that place (`force` places it anyway, by the share's own names).
 */
export function sharePlacement(share, ctx, { force = false } = {}) {
  if (share.level === 'group') {
    if (!force && !ctx.groups.has(share.groupId)) return null
    const g = ctx.groups.get(share.groupId)
    return {
      group: named(share.groupId, g?.name || share.groupName, 'Group'),
      bg: named(`shared:${share.groupId}`, GROUP_SHARE_LABEL),
      branch: null,
      shared: true,
      shareId: share.id,
    }
  }
  if (!force && !ctx.companies.has(share.companyId)) return null
  const bg = ctx.companies.get(share.companyId)
  const bgName = bg?.name || share.companyName || 'Business Group'
  // Its Group only when the viewer can see that Group (a BG user cannot).
  const groupId = bg?.groupId || share.companyGroupId || ''
  const group = groupId ? ctx.groups.get(groupId) ?? null : null
  return {
    group: group ? named(groupId, group.name, 'Group') : null,
    bg: named(share.companyId, bgName),
    branch: share.level === 'branch'
      ? named(share.branchId, ctx.branches.get(share.branchId)?.name || share.branchName, 'Branch')
      : named(`bg:${share.companyId}`, bgName),
    shared: true,
    shareId: share.id,
  }
}

/**
 * Every place the viewer sees the vehicle: its home when it is the viewer's
 * own, then each share whose place the viewer can see. Never empty for a
 * vehicle with a BG: a shared-in vehicle whose places are all out of sight
 * still shows at its first share.
 */
export function placementsOf(row, ctx) {
  if (!row?.companyId) return []
  const out = []
  if (isOwned(row)) out.push(homePlacement(row, ctx))
  const seen = new Set()
  for (const s of row.shares ?? []) {
    const p = sharePlacement(s, ctx)
    if (!p) continue
    const key = `${p.group?.id ?? ''}|${p.bg.id}|${p.branch?.id ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  if (!out.length) {
    const first = (row.shares ?? [])[0]
    out.push(first ? sharePlacement(first, ctx, { force: true }) : homePlacement(row, ctx))
  }
  return out
}

/**
 * The ONE place a report names for the vehicle — so a shared vehicle is one
 * row, never one per place: its home when it is the viewer's own, else where
 * it was shared to the viewer. { companyId, companyName, branchId,
 * branchName, groupId, groupName, shared, ownerName }.
 */
export function displayPlacement(row, ctx) {
  const p = placementsOf(row, ctx)[0]
  if (!p) return null
  const realBg = !p.bg.id.startsWith('shared:')
  const realBranch = p.branch && !String(p.branch.id).startsWith('bg:')
  return {
    companyId: realBg ? p.bg.id : '',
    companyName: p.bg.name,
    branchId: realBranch ? p.branch.id : '',
    branchName: realBranch ? p.branch.name : '',
    groupId: p.group?.id ?? '',
    groupName: p.group?.name ?? '',
    shared: p.shared,
    ownerName: row.ownerName || '',
  }
}

/** "Shared from Al Habtoor Logistics" — the chip's tooltip. */
export function sharedFromText(row) {
  return row?.ownerName ? `Shared from ${row.ownerName}` : 'Shared with you'
}

// ── The vehicle form's "Also show in" (pages/settings/ShareTargetsField.jsx) ──

const targetKey = t => `${t.level}:${t.id}`

/** The form's value from the vehicle's shares, and the shares it cannot change. */
export function shareTargetsOf(row, { companies, groups, branches }) {
  const value = []
  const fixed = []
  for (const s of row?.shares ?? []) {
    const visible = s.level === 'group' ? groups.has(s.groupId)
      : s.level === 'bg' ? companies.has(s.companyId)
        : branches.has(s.branchId)
    if (visible) value.push({ level: s.level, id: s.targetId })
    else fixed.push(s)
  }
  return { value, fixed }
}

/** Has the pick changed from what the vehicle has? */
export function sharesChanged(before, after) {
  const a = new Set(before.map(targetKey))
  const b = new Set(after.map(targetKey))
  return a.size !== b.size || [...a].some(k => !b.has(k))
}

