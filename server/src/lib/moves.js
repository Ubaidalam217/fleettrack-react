/**
 * Moving a Group or a BG, with everything under it, to another parent.
 *
 * Client, 2026-11-02: "move the whole structure, not just the one row". That
 * is cheap here because almost everything hangs off the BG (branches, vehicles,
 * drivers, alerts, geofences, BG users, sub-users) or off the group (group
 * admins): change the BG's or the group's parent and the rest follows. Only the
 * two denormalized copies need writing as well:
 *
 *   BusinessGroup.ggbId — every BG of a moved group takes the group's new GGB;
 *   Vehicle.groupId     — a hand-picked group for a vehicle of a group-less BG,
 *                         meaningless once the BG moves, so it is cleared.
 *
 * Access changes on the spot (every request re-reads scope), but Flespi tokens
 * already issued carry the old device list, so the grants of the admins who
 * gain or lose the moved vehicles are revoked; they are re-issued on next use.
 *
 * Who may move: a Super Admin anything anywhere; a GGB admin a BG between groups
 * of its own GGB. Moving a group always crosses GGBs, so it is Super Admin only.
 */

import prisma from '../prisma.js'
import { badRequest, forbidden, notFound } from './http.js'
import { ROLES } from './scope.js'
import { revokeGrantsWhere } from './flespiGrant.js'

/** What moves with a set of BGs — for the response, so the UI can say so. */
async function countUnder(bgIds) {
  const where = { bgId: { in: bgIds } }
  const [branches, vehicles, users] = await Promise.all([
    prisma.branch.count({ where }),
    prisma.vehicle.count({ where }),
    prisma.user.count({ where }),
  ])
  return { businessGroups: bgIds.length, branches, vehicles, users }
}

/** Admins above the moved node, on both sides of the move. */
async function revokeAdmins({ ggbIds = [], groupIds = [] }) {
  const ggbs = [...new Set(ggbIds.filter(Boolean))]
  const groups = [...new Set(groupIds.filter(Boolean))]
  if (ggbs.length) await revokeGrantsWhere({ role: ROLES.GGB_ADMIN, ggbId: { in: ggbs } })
  if (groups.length) await revokeGrantsWhere({ role: ROLES.GROUP_ADMIN, groupId: { in: groups } })
}

/** Move a group, its BGs and everything under them to another GGB. */
export async function moveGroup(scope, groupId, targetGgbId) {
  if (scope.role !== ROLES.SUPER_ADMIN) throw forbidden('Only a Super Admin can move a group to another Group Global Admin')
  const group = await prisma.group.findUnique({ where: { id: groupId } })
  if (!group) throw notFound('Group')
  const target = await prisma.ggb.findUnique({ where: { id: String(targetGgbId ?? '') }, select: { id: true } })
  if (!target) throw badRequest('Choose the Group Global Admin to move to', { ggbId: 'Invalid Group Global Admin' })
  if (target.id === group.ggbId) throw badRequest('The group is already in this Group Global Admin', { ggbId: 'Same Group Global Admin' })

  const bgs = await prisma.businessGroup.findMany({ where: { groupId }, select: { id: true } })
  const bgIds = bgs.map(b => b.id)
  await prisma.$transaction([
    prisma.group.update({ where: { id: groupId }, data: { ggbId: target.id } }),
    prisma.businessGroup.updateMany({ where: { groupId }, data: { ggbId: target.id } }),
  ])
  await revokeAdmins({ ggbIds: [group.ggbId, target.id] })
  return { id: groupId, fromGgbId: group.ggbId, toGgbId: target.id, moved: await countUnder(bgIds) }
}

/**
 * Move a BG and everything under it into another group, or directly under a
 * GGB with no group (`groupId` null). With a group, the GGB is the group's.
 */
export async function moveBg(scope, bgId, { ggbId, groupId }) {
  const bg = await prisma.businessGroup.findUnique({ where: { id: bgId } })
  if (!bg) throw notFound('Business Group')

  let target
  if (groupId) {
    const group = await prisma.group.findUnique({ where: { id: String(groupId) }, select: { id: true, ggbId: true } })
    if (!group) throw badRequest('Choose the group to move to', { groupId: 'Invalid group' })
    target = { ggbId: group.ggbId, groupId: group.id }
  } else {
    const ggb = await prisma.ggb.findUnique({ where: { id: String(ggbId ?? '') }, select: { id: true } })
    if (!ggb) throw badRequest('Choose the Group Global Admin to move to', { ggbId: 'Invalid Group Global Admin' })
    target = { ggbId: ggb.id, groupId: null }
  }

  if (scope.role === ROLES.GGB_ADMIN) {
    // Its own BGs only, and only inside its own GGB.
    if (bg.ggbId !== scope.ggbId) throw notFound('Business Group')
    if (target.ggbId !== scope.ggbId) throw forbidden('A Group Global Admin can only move a Business Group inside its own Group Global Admin')
  } else if (scope.role !== ROLES.SUPER_ADMIN) {
    throw forbidden('Your role may not move business groups')
  }
  if (target.ggbId === bg.ggbId && target.groupId === bg.groupId) {
    throw badRequest('The business group is already there', { groupId: 'Same place' })
  }

  await prisma.$transaction([
    prisma.businessGroup.update({ where: { id: bgId }, data: target }),
    prisma.vehicle.updateMany({ where: { bgId }, data: { groupId: null } }),
  ])
  await revokeAdmins({ ggbIds: [bg.ggbId, target.ggbId], groupIds: [bg.groupId, target.groupId] })
  return { id: bgId, from: { ggbId: bg.ggbId, groupId: bg.groupId }, to: target, moved: await countUnder([bgId]) }
}
