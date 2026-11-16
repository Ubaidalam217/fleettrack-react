/**
 * Vehicle multi-assign (client, 2026-11-13: "One vehicle can be assigned to
 * multiple Group, BG, Branch").
 *
 * A vehicle keeps ONE owner — Vehicle.bgId / branchId: its tracker, its edits,
 * its expenses, papers, reminders and driver. A VehicleShare row is another
 * place it also shows: a Group, a Business Group, or a Branch of any BG. Who
 * sees what follows lib/scope.js vehicleWhere(); this file makes and removes
 * shares and says, for each vehicle handed to a caller, which of its shares
 * that caller may know about. lib/sharePolicy.js holds the client's switches.
 *
 * Who may share: anyone who may write the vehicle (it is theirs — the
 * `ownedVehicle` entity) AND can see the place (findScopedOrThrow on it). So a
 * BG user shares between its own branches, a GGB admin anywhere in its GGB, a
 * Super Admin anywhere — and a place the vehicle is shared into cannot pass it
 * on (it does not own it). Every add and remove goes into the Reallocation
 * History (level 'share'). Nothing here touches Flespi.
 */

import prisma from '../prisma.js'
import { badRequest, notFound } from './http.js'
import { bgFleetWhere, findScopedOrThrow, isSuperAdmin, isSubUser, ROLES, scopedWhere } from './scope.js'
import { GROUP_SHARE_REACHES_BG_USERS, SHARE_LEVELS } from './sharePolicy.js'
import { shareRow } from './vehicleMoves.js'
import { revokeGrantsForBg } from './flespiGrant.js'

/** A share with what it takes to name it and to place it in a tree. */
export const SHARE_SELECT = {
  id: true,
  level: true,
  targetId: true,
  groupId: true,
  bgId: true,
  branchId: true,
  createdAt: true,
  createdByName: true,
  group: { select: { id: true, name: true, ggbId: true } },
  bg: { select: { id: true, name: true, groupId: true, ggbId: true } },
  branch: { select: { id: true, name: true } },
}

/** For a vehicle query's `include` / `select`: its shares, oldest first. */
export const SHARES_INCLUDE = { select: SHARE_SELECT, orderBy: { createdAt: 'asc' } }

/** What the vehicle looks like in a Reallocation History row, plus its home group. */
const VEHICLE_SELECT = {
  id: true, bgId: true, branchId: true, groupId: true, plateNo: true, fleetNo: true, imei: true,
  bg: { select: { groupId: true } },
}

/** "BG", "BG / Branch" or "Group" — how a share's place reads everywhere. */
export function shareLabel(s) {
  if (s.level === 'group') return s.group?.name ?? s.label ?? 'Group'
  if (s.level === 'bg') return s.bg?.name ?? s.label ?? 'Business Group'
  return s.label ?? `${s.bg?.name ?? 'Business Group'} / ${s.branch?.name ?? 'Branch'}`
}

/** The share as the API hands it out. */
export function publicShare(s) {
  return {
    id: s.id,
    level: s.level,
    targetId: s.targetId,
    groupId: s.groupId,
    bgId: s.bgId,
    branchId: s.branchId,
    label: shareLabel(s),
    group: s.group ? { id: s.group.id, name: s.group.name } : null,
    bg: s.bg ? { id: s.bg.id, name: s.bg.name, groupId: s.bg.groupId } : null,
    branch: s.branch ? { id: s.branch.id, name: s.branch.name } : null,
    createdAt: s.createdAt,
    createdByName: s.createdByName ?? null,
  }
}

/** Per-request facts shareInScope() needs that the scope itself does not carry. */
async function scopeContext(scope) {
  if (!GROUP_SHARE_REACHES_BG_USERS || !scope.bgId) return {}
  const bg = await prisma.businessGroup.findUnique({ where: { id: scope.bgId }, select: { groupId: true } })
  return { bgGroupId: bg?.groupId ?? null }
}

/**
 * Does this share land inside the scope — i.e. is it one of the places the
 * caller itself sees? (The same rule as scope.js shareTargetWhere, in memory.)
 */
export function shareInScope(s, scope, ctx = {}) {
  switch (scope.role) {
    case ROLES.SUPER_ADMIN:
      return true
    case ROLES.GGB_ADMIN:
      return !!scope.ggbId && (s.bg?.ggbId ?? s.group?.ggbId) === scope.ggbId
    case ROLES.GROUP_ADMIN:
      return !!scope.groupId && (s.groupId === scope.groupId || s.bg?.groupId === scope.groupId)
    case ROLES.BG_USER:
    case ROLES.SUB_USER:
      if (!scope.bgId) return false
      if (s.bgId === scope.bgId) return true
      return GROUP_SHARE_REACHES_BG_USERS && !!s.groupId && s.groupId === ctx.bgGroupId
    default:
      return false
  }
}

/** Which of these vehicle ids the scope owns (not merely sees through a share). */
export async function ownedIdsOf(scope, ids) {
  if (!ids.length) return new Set()
  if (isSuperAdmin(scope)) return new Set(ids)
  const rows = await prisma.vehicle.findMany({
    where: scopedWhere('ownedVehicle', scope, { id: { in: ids } }),
    select: { id: true },
  })
  return new Set(rows.map(r => r.id))
}

/**
 * Vehicle rows (loaded with `shares: SHARES_INCLUDE`) as the API hands them
 * out: `owned` — its home is inside the caller's scope, so it is not merely
 * shared in — and `shares`, cut down to what the caller may know. The owner
 * side sees every place its vehicle is shared to; a place the vehicle is
 * shared into sees only the shares that land inside its own scope, never where
 * else the vehicle goes. A sub-user is always the second kind.
 */
export async function withShares(rows, scope) {
  const owned = await ownedIdsOf(scope, rows.map(r => r.id))
  const ctx = await scopeContext(scope)
  return rows.map(r => {
    const mine = owned.has(r.id)
    const all = r.shares ?? []
    const shares = mine && !isSubUser(scope) ? all : all.filter(s => shareInScope(s, scope, ctx))
    return { ...r, owned: mine, shares: shares.map(publicShare) }
  })
}

/** One row, same treatment. */
export async function withSharesOne(row, scope) {
  return (await withShares([row], scope))[0]
}

// ── Making and removing shares ───────────────────────────────────────────────

/**
 * The place a share points at, confirmed to be one the caller can see (404
 * otherwise — the same answer as for a place that does not exist).
 */
export async function resolveTarget(scope, level, id) {
  if (!SHARE_LEVELS.includes(level)) throw badRequest('Choose a Group, Business Group or Branch', { level: 'Invalid' })
  if (level === 'group') {
    const g = await findScopedOrThrow('group', id, scope, { select: { id: true, name: true } })
    return { level, targetId: g.id, groupId: g.id, bgId: null, branchId: null, label: g.name }
  }
  if (level === 'bg') {
    const b = await findScopedOrThrow('bg', id, scope, { select: { id: true, name: true } })
    return { level, targetId: b.id, groupId: null, bgId: b.id, branchId: null, label: b.name }
  }
  const br = await findScopedOrThrow('branch', id, scope, { select: { id: true, name: true, bgId: true, bg: { select: { name: true } } } })
  return { level, targetId: br.id, groupId: null, bgId: br.bgId, branchId: br.id, label: `${br.bg?.name ?? 'Business Group'} / ${br.name}` }
}

/**
 * Is the place where the vehicle already lives? Its own BG, its own branch,
 * or its BG's Group — a share there would add nobody. (A branch of its own
 * BG other than its home branch is a real share: it shows in both.)
 */
export function isHome(v, t) {
  if (t.level === 'bg') return t.bgId === v.bgId
  if (t.level === 'branch') return t.branchId === v.branchId
  return !!v.bg?.groupId && t.groupId === v.bg.groupId
}

/** The vehicles, each one the caller OWNS; 404 for the lot otherwise. */
async function ownedOrThrow(scope, ids) {
  const unique = [...new Set(ids)]
  const rows = await prisma.vehicle.findMany({
    where: scopedWhere('ownedVehicle', scope, { id: { in: unique } }),
    select: VEHICLE_SELECT,
  })
  if (rows.length !== unique.length) throw notFound('Vehicle')
  return rows
}

const shareData = (vehicleId, t, by) => ({
  vehicleId, level: t.level, targetId: t.targetId, groupId: t.groupId, bgId: t.bgId, branchId: t.branchId,
  createdById: by?.id ?? null, createdByName: by?.name ?? null,
})

/**
 * After shares go: every BG that no longer sees the vehicle (not its owner,
 * nothing shared into it any more) loses what it had given the vehicle — its
 * sub-users' assignments and its alert rules' lists — as a transfer strips the
 * old BG. The scope filter would already hide the vehicle from them; this keeps
 * their "n vehicles" counts honest. Run inside the transaction that removed the shares.
 */
export async function stripLostAccess(tx, vehicle) {
  const [subs, alerts] = await Promise.all([
    tx.subuserVehicle.findMany({ where: { vehicleId: vehicle.id }, select: { user: { select: { bgId: true } } } }),
    tx.alertVehicle.findMany({ where: { vehicleId: vehicle.id }, select: { alert: { select: { bgId: true } } } }),
  ])
  const bgIds = new Set([...subs.map(s => s.user?.bgId), ...alerts.map(a => a.alert?.bgId)].filter(Boolean))
  bgIds.delete(vehicle.bgId)
  const stripped = { subuserAssignments: 0, alertAssignments: 0 }
  for (const bgId of bgIds) {
    const stillSees = await tx.vehicle.count({ where: { AND: [{ id: vehicle.id }, bgFleetWhere(bgId)] } })
    if (stillSees) continue
    const a = await tx.subuserVehicle.deleteMany({ where: { vehicleId: vehicle.id, user: { bgId } } })
    const b = await tx.alertVehicle.deleteMany({ where: { vehicleId: vehicle.id, alert: { bgId } } })
    stripped.subuserAssignments += a.count
    stripped.alertAssignments += b.count
  }
  return stripped
}

/** The BGs whose accounts' view changed, for revokeGrantsForBg(). */
const bgsOf = targets => [...new Set(targets.map(t => t.bgId).filter(Boolean))]

async function revokeFor(bgIds) {
  for (const bgId of bgIds) await revokeGrantsForBg(bgId)
}

/**
 * Show these vehicles in one more place (POST /api/vehicle-shares/add, the
 * node's "Also show here", Bulk Action). Vehicles already there, or whose home
 * it is, are skipped and reported rather than refused, so a bulk pick can mix.
 */
export async function addShares(scope, by, vehicleIds, level, targetId) {
  const target = await resolveTarget(scope, level, targetId)
  const vehicles = await ownedOrThrow(scope, vehicleIds)
  const have = new Set((await prisma.vehicleShare.findMany({
    where: { vehicleId: { in: vehicles.map(v => v.id) }, targetId: target.targetId },
    select: { vehicleId: true },
  })).map(s => s.vehicleId))
  const skipped = { home: [], already: [] }
  const todo = []
  for (const v of vehicles) {
    if (isHome(v, target)) skipped.home.push(v.id)
    else if (have.has(v.id)) skipped.already.push(v.id)
    else todo.push(v)
  }
  if (todo.length) {
    await prisma.$transaction([
      prisma.vehicleShare.createMany({ data: todo.map(v => shareData(v.id, target, by)), skipDuplicates: true }),
      prisma.vehicleMove.createMany({ data: todo.map(v => shareRow(v, target, true, by)) }),
    ])
    await revokeFor(bgsOf([target]))
  }
  return { target: { level: target.level, targetId: target.targetId, label: target.label }, added: todo.map(v => v.id), skipped }
}

/** Stop showing these vehicles in one place (POST /api/vehicle-shares/remove). */
export async function removeShares(scope, by, vehicleIds, level, targetId) {
  const target = await resolveTarget(scope, level, targetId)
  const vehicles = await ownedOrThrow(scope, vehicleIds)
  const byId = new Map(vehicles.map(v => [v.id, v]))
  const rows = await prisma.vehicleShare.findMany({
    where: { vehicleId: { in: vehicles.map(v => v.id) }, targetId: target.targetId },
    select: { id: true, vehicleId: true },
  })
  const stripped = { subuserAssignments: 0, alertAssignments: 0 }
  if (rows.length) {
    await prisma.$transaction(async tx => {
      await tx.vehicleShare.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })
      await tx.vehicleMove.createMany({ data: rows.map(r => shareRow(byId.get(r.vehicleId), target, false, by)) })
      for (const r of rows) {
        const s = await stripLostAccess(tx, byId.get(r.vehicleId))
        stripped.subuserAssignments += s.subuserAssignments
        stripped.alertAssignments += s.alertAssignments
      }
    })
    await revokeFor(bgsOf([target]))
  }
  return { removed: rows.map(r => r.vehicleId), stripped }
}

/**
 * The vehicle form's "Also show in": make the vehicle's shares this list —
 * but only among the places the caller can see. A share somebody higher up
 * made to a place outside the caller's scope is neither shown to it nor
 * removed by its save.
 */
export async function setShares(scope, by, vehicleId, targets) {
  const [vehicle] = await ownedOrThrow(scope, [vehicleId])
  const wanted = new Map()
  for (const t of targets) {
    const target = await resolveTarget(scope, t.level, t.id)
    if (isHome(vehicle, target)) {
      throw badRequest(`${target.label} is where this vehicle already is`, { targets: `${target.label}: already its own` })
    }
    wanted.set(target.targetId, target)
  }
  const ctx = await scopeContext(scope)
  const current = await prisma.vehicleShare.findMany({ where: { vehicleId }, select: SHARE_SELECT })
  const toAdd = [...wanted.values()].filter(t => !current.some(s => s.targetId === t.targetId))
  const toRemove = current.filter(s => !wanted.has(s.targetId) && shareInScope(s, scope, ctx))
  if (toAdd.length || toRemove.length) {
    await prisma.$transaction(async tx => {
      if (toRemove.length) await tx.vehicleShare.deleteMany({ where: { id: { in: toRemove.map(s => s.id) } } })
      if (toAdd.length) await tx.vehicleShare.createMany({ data: toAdd.map(t => shareData(vehicle.id, t, by)), skipDuplicates: true })
      await tx.vehicleMove.createMany({
        data: [
          ...toAdd.map(t => shareRow(vehicle, t, true, by)),
          ...toRemove.map(s => shareRow(vehicle, { ...s, label: shareLabel(s) }, false, by)),
        ],
      })
      if (toRemove.length) await stripLostAccess(tx, vehicle)
    })
    await revokeFor(bgsOf([...toAdd, ...toRemove]))
  }
  return sharesVisibleTo(scope, vehicleId)
}

/** A vehicle's shares as this caller may see them. 404 unless it sees the vehicle. */
export async function sharesVisibleTo(scope, vehicleId) {
  const row = await findScopedOrThrow('vehicle', vehicleId, scope, { select: { id: true, shares: SHARES_INCLUDE } })
  return (await withSharesOne(row, scope)).shares
}

/**
 * A vehicle moving to another Business Group (POST /api/vehicles/:id/transfer):
 * its shares that land in the old BG (it leaves it) or in the new one, or in the
 * new BG's Group (it lives there now), go; its other shares stay — the places
 * it was shown in still show it. Each one dropped goes into the history.
 * `vehicle` is the row as it reads AFTER the move. Run inside the transfer.
 */
export async function dropSharesForTransfer(tx, vehicle, fromBgId, toBg, by) {
  const drop = await tx.vehicleShare.findMany({
    where: {
      vehicleId: vehicle.id,
      OR: [{ bgId: { in: [fromBgId, toBg.id] } }, ...(toBg.groupId ? [{ groupId: toBg.groupId }] : [])],
    },
    select: SHARE_SELECT,
  })
  if (!drop.length) return 0
  await tx.vehicleShare.deleteMany({ where: { id: { in: drop.map(s => s.id) } } })
  await tx.vehicleMove.createMany({ data: drop.map(s => shareRow(vehicle, { ...s, label: shareLabel(s) }, false, by)) })
  return drop.length
}
