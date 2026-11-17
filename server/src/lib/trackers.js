/**
 * Trackers are changed in FleetmaxX, never in the Flespi panel (client,
 * 2026-11-17: "it should be updated with the new information but keep the
 * history of change and we can search it ... we will add front end and that
 * will link with flespi"). Three operations, each with a history row:
 *
 *   Change tracker  the vehicle keeps its record, history, drivers and reports
 *                   and gets another IMEI. Flespi follows the same rule as a
 *                   vehicle edit (lib/flespiDevices.js syncVehicleDevice):
 *                     - the new IMEI is already a Flespi device (an
 *                       unregistered tracker): the vehicle links to THAT device,
 *                       which takes the plate as its name. The old device is
 *                       left exactly as it is, with its messages.
 *                     - the new IMEI is not in Flespi: the vehicle's own device
 *                       takes the new IMEI (and the new device type), so its
 *                       message history carries on in one device — what the
 *                       client did by hand in the Flespi panel.
 *                     - neither: a device is created (needs the type).
 *                   Nothing is ever deleted in Flespi.
 *   Remove tracker  the vehicle stays with no tracker (imei null). Flespi is
 *                   not touched: the device keeps its IMEI and its messages,
 *                   and shows as an unregistered tracker if it is still there.
 *   Merge           a stale vehicle (its tracker gone) into the vehicle that
 *                   has the tracker now: its history, driver assignments,
 *                   papers, expenses, reminders, shares, sub-user and alert
 *                   memberships move over; the stale row is archived
 *                   (deletedAt), never deleted. No Flespi call — except with
 *                   `takeTracker`, the other way round: the stale vehicle
 *                   (AD 149) stays and takes the tracker of the one merged
 *                   into it (registered as "iTriangle"), whose Flespi device
 *                   is renamed to the plate.
 */

import prisma from '../prisma.js'
import { badRequest } from './http.js'
import { vehicleLabel } from './vehicleLabel.js'
import { archiveRow, deviceRow, mergeRow } from './vehicleMoves.js'

const short = imei => (imei ? String(imei) : '—')

/** The history notes of a tracker change: each side names the other tracker. */
export function swapNotes(oldImei, newImei, note) {
  const user = note ? ` — ${note}` : ''
  return {
    out: `Replaced by ${short(newImei)}${user}`,
    in: oldImei ? `Replaced ${short(oldImei)}${user}` : (note || null),
  }
}

/** The move rows of a Change tracker. `after` is the vehicle as it reads after it. */
export function swapRows(before, after, by, note) {
  const notes = swapNotes(before.imei, after.imei, note)
  const out = []
  if (before.imei) out.push(deviceRow(after, before.imei, false, by, notes.out))
  out.push(deviceRow(after, after.imei, true, by, notes.in))
  return out
}

/** The move row of a Remove tracker. */
export function removeRow(before, by, note) {
  return deviceRow(before, before.imei, false, by, ['Tracker removed — the vehicle has no tracker now', note].filter(Boolean).join(' — '))
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * What merging `source` into `target` moves, and what it cannot move (a rule,
 * share or account the target already has). Read-only: the dialog's preview,
 * and the plan the merge itself carries out.
 */
export async function mergePlan(source, target, { takeTracker = false } = {}) {
  const id = source.id
  const [
    moves, assignments, openAssignments, incidents, documents, expenses, acks, events, odometer,
    reminders, targetRules, shares, targetShares, subusers, targetSubusers, alerts, targetAlerts,
    sourceDriver, targetDriver,
  ] = await Promise.all([
    prisma.vehicleMove.count({ where: { vehicleId: id } }),
    prisma.driverAssignment.count({ where: { vehicleId: id } }),
    prisma.driverAssignment.findMany({ where: { vehicleId: id, endDate: null }, select: { id: true, role: true } }),
    prisma.driverIncident.count({ where: { vehicleId: id } }),
    prisma.vehicleDocument.count({ where: { vehicleId: id } }),
    prisma.expense.count({ where: { vehicleId: id } }),
    prisma.reminderAck.count({ where: { vehicleId: id } }),
    prisma.alertEvent.count({ where: { vehicleId: id } }),
    prisma.odometerAdjustment.count({ where: { vehicleId: id } }),
    prisma.reminderVehicle.findMany({ where: { vehicleId: id }, select: { id: true, ruleId: true } }),
    prisma.reminderVehicle.findMany({ where: { vehicleId: target.id }, select: { ruleId: true } }),
    prisma.vehicleShare.findMany({ where: { vehicleId: id }, select: { id: true, targetId: true, level: true, branchId: true } }),
    prisma.vehicleShare.findMany({ where: { vehicleId: target.id }, select: { targetId: true } }),
    prisma.subuserVehicle.findMany({ where: { vehicleId: id }, select: { userId: true } }),
    prisma.subuserVehicle.findMany({ where: { vehicleId: target.id }, select: { userId: true } }),
    prisma.alertVehicle.findMany({ where: { vehicleId: id }, select: { alertId: true } }),
    prisma.alertVehicle.findMany({ where: { vehicleId: target.id }, select: { alertId: true } }),
    prisma.driver.findUnique({ where: { vehicleId: id }, select: { id: true, name: true } }),
    prisma.driver.findUnique({ where: { vehicleId: target.id }, select: { id: true, name: true } }),
  ])
  const hasRule = new Set(targetRules.map(r => r.ruleId))
  const hasShare = new Set(targetShares.map(s => s.targetId))
  const hasUser = new Set(targetSubusers.map(s => s.userId))
  const hasAlert = new Set(targetAlerts.map(a => a.alertId))
  // A share into the branch the target is filed in would be a share to its own place.
  const shareDrop = s => hasShare.has(s.targetId) || (s.level === 'branch' && s.branchId && s.branchId === target.branchId)
  return {
    moves, assignments, incidents, documents, expenses, acks, events, odometer,
    reminders: { move: reminders.filter(r => !hasRule.has(r.ruleId)).map(r => r.id), drop: reminders.filter(r => hasRule.has(r.ruleId)).map(r => r.id) },
    shares: { move: shares.filter(s => !shareDrop(s)).map(s => s.id), drop: shares.filter(shareDrop).map(s => s.id) },
    subusers: { move: subusers.filter(s => !hasUser.has(s.userId)).map(s => s.userId), drop: subusers.filter(s => hasUser.has(s.userId)).map(s => s.userId) },
    alerts: { move: alerts.filter(a => !hasAlert.has(a.alertId)).map(a => a.alertId), drop: alerts.filter(a => hasAlert.has(a.alertId)).map(a => a.alertId) },
    // The source's driver drives the target from now on when the target has
    // none; otherwise the target keeps its own and the source's is freed.
    driver: sourceDriver
      ? { id: sourceDriver.id, name: sourceDriver.name, outcome: targetDriver ? 'unassigned' : 'moved', targetDriver: targetDriver?.name ?? null }
      : null,
    openPrimary: openAssignments.filter(a => a.role === 'Primary').map(a => a.id),
    // With takeTracker the source's tracker goes into the target, and the
    // target's own (stale) one comes out; otherwise the source's comes out.
    takeTracker: !!(takeTracker && source.imei),
    trackerMoved: takeTracker && source.imei ? source.imei : null,
    trackerRemoved: takeTracker && source.imei ? target.imei ?? null : source.imei ?? null,
    customFields: (Array.isArray(source.customFields) && source.customFields.length > 0 && !(Array.isArray(target.customFields) && target.customFields.length > 0))
      ? source.customFields.length : 0,
  }
}

/** The plan as the dialog and the response show it, and the merge row's note. */
export function planSummary(plan) {
  const parts = [
    plan.moves && plural(plan.moves, 'history row'),
    plan.assignments && plural(plan.assignments, 'driver assignment'),
    plan.documents && plural(plan.documents, 'document'),
    plan.expenses && plural(plan.expenses, 'expense'),
    plan.reminders.move.length && plural(plan.reminders.move.length, 'reminder'),
    plan.acks && plural(plan.acks, 'reminder done record', 'reminder done records'),
    plan.shares.move.length && plural(plan.shares.move.length, 'share'),
    plan.subusers.move.length && plural(plan.subusers.move.length, 'sub-user access', 'sub-user accesses'),
    plan.alerts.move.length && plural(plan.alerts.move.length, 'alert rule'),
    plan.events && plural(plan.events, 'alert event'),
    plan.incidents && plural(plan.incidents, 'incident'),
    plan.odometer && plural(plan.odometer, 'odometer adjustment'),
  ].filter(Boolean)
  return parts.length ? `Moved: ${parts.join(', ')}` : 'Nothing else to move'
}

/** The public shape of a plan (no row ids). */
export function planView(plan) {
  return {
    moves: plan.moves, assignments: plan.assignments, incidents: plan.incidents, documents: plan.documents,
    expenses: plan.expenses, acks: plan.acks, events: plan.events, odometer: plan.odometer,
    reminders: plan.reminders.move.length, remindersAlreadyOnTarget: plan.reminders.drop.length,
    shares: plan.shares.move.length, sharesAlreadyOnTarget: plan.shares.drop.length,
    subusers: plan.subusers.move.length, alerts: plan.alerts.move.length,
    driver: plan.driver, trackerRemoved: plan.trackerRemoved, trackerMoved: plan.trackerMoved, customFields: plan.customFields,
    summary: planSummary(plan),
  }
}

/**
 * Merge `source` into `target` inside `tx`, following `plan`, and archive the
 * source. Both are owned by the caller and in the same Business Group (the
 * route checks). Returns nothing; the caller reads the rows back.
 */
export async function mergeInto(tx, source, target, plan, by, note, { flespiDeviceId = null } = {}) {
  const from = { vehicleId: source.id }
  const to = { vehicleId: target.id }
  const now = new Date()

  // The driver first: Driver.vehicleId is unique.
  if (plan.driver?.outcome === 'moved') {
    await tx.driver.update({ where: { id: plan.driver.id }, data: to })
  } else if (plan.driver?.outcome === 'unassigned') {
    await tx.driver.update({ where: { id: plan.driver.id }, data: { vehicleId: null } })
    // Its open Primary row ends now; the target's own driver stays the one driving it.
    if (plan.openPrimary.length) await tx.driverAssignment.updateMany({ where: { id: { in: plan.openPrimary } }, data: { endDate: now } })
  }
  await tx.driverAssignment.updateMany({ where: from, data: to })
  await tx.driverIncident.updateMany({ where: from, data: to })
  await tx.vehicleDocument.updateMany({ where: from, data: to })
  await tx.expense.updateMany({ where: from, data: to })
  await tx.reminderAck.updateMany({ where: from, data: to })
  await tx.alertEvent.updateMany({ where: from, data: to })
  await tx.odometerAdjustment.updateMany({ where: from, data: to })
  await tx.vehicleMove.updateMany({ where: from, data: to })

  // What the target already has (the same rule, place, account, alert) would be
  // a duplicate: the source's copy goes. These are memberships, not history.
  if (plan.reminders.drop.length) await tx.reminderVehicle.deleteMany({ where: { id: { in: plan.reminders.drop } } })
  if (plan.shares.drop.length) await tx.vehicleShare.deleteMany({ where: { id: { in: plan.shares.drop } } })
  if (plan.subusers.drop.length) await tx.subuserVehicle.deleteMany({ where: { vehicleId: source.id, userId: { in: plan.subusers.drop } } })
  if (plan.alerts.drop.length) await tx.alertVehicle.deleteMany({ where: { vehicleId: source.id, alertId: { in: plan.alerts.drop } } })
  if (plan.reminders.move.length) await tx.reminderVehicle.updateMany({ where: { id: { in: plan.reminders.move } }, data: to })
  if (plan.shares.move.length) await tx.vehicleShare.updateMany({ where: { id: { in: plan.shares.move } }, data: to })
  if (plan.subusers.move.length) await tx.subuserVehicle.updateMany({ where: { vehicleId: source.id, userId: { in: plan.subusers.move } }, data: to })
  if (plan.alerts.move.length) await tx.alertVehicle.updateMany({ where: { vehicleId: source.id, alertId: { in: plan.alerts.move } }, data: to })
  if (plan.customFields) {
    await tx.vehicle.update({ where: { id: target.id }, data: { customFields: source.customFields, customFieldsUpdatedAt: now, customFieldsUpdatedBy: by?.name ?? null } })
  }

  // The source's tracker (if any) comes out with it, then the source is put away.
  const summary = planSummary(plan)
  const said = [note, summary].filter(Boolean).join(' — ')
  const history = []
  if (source.imei) {
    history.push(deviceRow(source, source.imei, false, by, plan.takeTracker ? `Moved to ${vehicleLabel(target)} (merged)` : `Merged into ${vehicleLabel(target)}`))
  }
  history.push(archiveRow(source, target, by, said))
  history.push(mergeRow(source, target, by, said))
  await tx.vehicle.update({
    where: { id: source.id },
    data: { deletedAt: now, deletedBy: by?.name ?? null, mergedIntoId: target.id, imei: null, flespiDeviceId: null },
  })
  // takeTracker: the target keeps its number and gets the source's tracker;
  // its own stale tracker comes out.
  if (plan.takeTracker) {
    if (target.imei) history.push(deviceRow(target, target.imei, false, by, `Replaced by ${source.imei} from ${vehicleLabel(source)} (merged)`))
    history.push(deviceRow(target, source.imei, true, by, `From ${vehicleLabel(source)} (merged)${target.imei ? `, replaced ${target.imei}` : ''}`))
    await tx.vehicle.update({
      where: { id: target.id },
      data: { imei: source.imei, deviceType: source.deviceType ?? target.deviceType, flespiDeviceId },
    })
  }
  await tx.vehicleMove.createMany({ data: history })
}

/** Both sides of a merge must be in one Business Group: drivers, rules and papers are the BG's. */
export function assertSameBg(source, target, bgName) {
  if (source.id === target.id) throw badRequest('Choose another vehicle to merge into', { targetId: 'Same vehicle' })
  if (source.bgId !== target.bgId) {
    throw badRequest(
      `${vehicleLabel(target)} is in another Business Group${bgName ? ` (${bgName})` : ''}. Move one of them first (row menu › Move to another Business Group), then merge.`,
      { targetId: 'Another Business Group' },
    )
  }
}
