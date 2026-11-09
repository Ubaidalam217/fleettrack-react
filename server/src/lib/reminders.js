/**
 * Maintenance and renewal reminders (Settings › Master › Reminder Rule and
 * Reports › Reminder Status, client 2026-11-10, after the reference system).
 *
 * A rule counts, for each of its vehicles, from that vehicle's start point:
 * by duration (every N days / weeks / months), by distance (every N km on the
 * odometer) and/or by engine hours — whichever comes first. Inside the notify
 * window it is Due, past the mark Overdue, and each of those raises one
 * notification per cycle. "Mark done" starts the next cycle. A renewal
 * (insurance, registration…) may carry its own expiry date, which then stands
 * for the duration.
 *
 * Engine hours: the trackers send no hour meter, so the server counts
 * ignition-on time itself (VehicleEngineHours) from when this went live.
 */

import prisma from '../prisma.js'
import { sendAlertEmail } from './mailer.js'

/** The reference's grouped Reminder Type list; any other text is accepted. */
export const REMINDER_TYPES = Object.freeze({
  Service: [
    'Oil Change', 'Oil Filter', 'Air Filter', 'Fuel Filter', 'Antifreeze', 'Coolant Flush', 'Battery',
    'Brakes Front', 'Brakes Rear', 'Tires Change', 'Tire Rotation', 'Transmission Service', 'Windshield Wipers',
    'Cleaning', 'Repair', 'General Service', '100k Service', 'Device SIM Card',
  ],
  Renewal: [
    'Insurance', 'Registration', 'Inspection', 'Road Tax', 'Vehicle License', 'Fitness Certificate',
    'Roadworthy Certificate', 'Tank Certificate', 'Speed Limit Certificate',
  ],
})

const DAY = 86_400_000
/** Ignition-on stretches split by a longer silence than this are not counted across it. */
const MAX_GAP_SEC = 10 * 60
/** Telemetry older than this does not move the engine-hour count. */
const FRESH_SEC = 15 * 60

const digits = s => String(s ?? '').replace(/\D/g, '')
const utcDay = d => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

function addMonths(d, n) {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
  out.setUTCDate(Math.min(d.getUTCDate(), last))
  return out
}

/** When the duration side falls due: the renewal's expiry, else start + interval. */
export function dueDateOf(rule, rv) {
  if (rv.expiryDate) return rv.expiryDate
  if (!rule.byDuration || !rule.every) return null
  const start = rv.startDate
  const unit = rule.recurring ? rule.frequency : 'Monthly'
  if (unit === 'Daily') return new Date(start.getTime() + rule.every * DAY)
  if (unit === 'Weekly') return new Date(start.getTime() + rule.every * 7 * DAY)
  return addMonths(start, rule.every)
}

const RANK = { upcoming: 0, due: 1, overdue: 2 }

/**
 * Where one vehicle stands on one rule. `meter` is { odometer, engineHours }
 * now (either may be null). Every basis the rule uses is worked out; the
 * worst decides the status, and its detail says why.
 */
export function reminderStatus(rule, rv, meter = {}, now = new Date()) {
  if (rv.completedAt) return { status: 'completed', parts: [] }
  const parts = []

  const dueDate = dueDateOf(rule, rv)
  if (dueDate) {
    const daysLeft = Math.round((utcDay(dueDate) - utcDay(now)) / DAY)
    const state = daysLeft < 0 ? 'overdue' : daysLeft <= (rule.notifyDays ?? 0) ? 'due' : 'upcoming'
    parts.push({ basis: 'duration', state, dueDate: dueDate.toISOString().slice(0, 10), daysLeft })
  }
  if (rule.byDistance && rule.everyKm) {
    const odo = meter.odometer
    const since = odo != null && rv.startOdometer != null ? Math.max(0, odo - rv.startOdometer) : 0
    const used = (rv.kmBefore ?? 0) + since
    const left = rule.everyKm - used
    const state = left <= 0 ? 'overdue' : left <= (rule.notifyKm ?? 0) ? 'due' : 'upcoming'
    parts.push({ basis: 'distance', state, used: Math.round(used), left: Math.round(left), every: rule.everyKm, known: odo != null })
  }
  if (rule.byEngineHours && rule.everyHours) {
    const hrs = meter.engineHours
    const since = hrs != null && rv.startEngineHours != null ? Math.max(0, hrs - rv.startEngineHours) : 0
    const used = (rv.hoursBefore ?? 0) + since
    const left = rule.everyHours - used
    const state = left <= 0 ? 'overdue' : left <= (rule.notifyHours ?? 0) ? 'due' : 'upcoming'
    parts.push({ basis: 'engineHours', state, used: Math.round(used * 10) / 10, left: Math.round(left * 10) / 10, every: rule.everyHours, known: hrs != null })
  }
  const status = parts.reduce((s, p) => (RANK[p.state] > RANK[s] ? p.state : s), 'upcoming')
  return { status, parts }
}

const fmtDate = iso => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`
}
const n0 = v => Math.round(v).toLocaleString('en-US')

/** "due on 20 Nov 2026", "9,620 of 10,000 km", … — the part that decided the status first. */
export function describe(result) {
  const p = result.parts.find(x => x.state === result.status) ?? result.parts[0]
  if (!p) return ''
  if (p.basis === 'duration') {
    if (p.daysLeft < 0) return `${-p.daysLeft} day${p.daysLeft === -1 ? '' : 's'} overdue (was due ${fmtDate(p.dueDate)})`
    if (p.daysLeft === 0) return `due today (${fmtDate(p.dueDate)})`
    return `due ${fmtDate(p.dueDate)}, in ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}`
  }
  const unit = p.basis === 'distance' ? 'km' : 'engine hours'
  if (p.left <= 0) return `${n0(-p.left)} ${unit} over (${n0(p.used)} of ${n0(p.every)})`
  return `${n0(p.used)} of ${n0(p.every)} ${unit}, ${n0(p.left)} left`
}

/**
 * Odometer (vehicle.mileage) and counted engine hours now, per vehicle id.
 * `telemetry` is the engine's deviceId → reading map, `deviceByImei` IMEI → deviceId.
 */
export async function metersFor(vehicles, telemetry, deviceByImei) {
  const counted = await prisma.vehicleEngineHours.findMany({ where: { vehicleId: { in: vehicles.map(v => v.id) } } })
  const hoursById = new Map(counted.map(r => [r.vehicleId, r.hours]))
  const out = new Map()
  for (const v of vehicles) {
    const dev = deviceByImei?.get(digits(v.imei))
    const t = dev !== undefined ? telemetry?.get(dev) : undefined
    out.set(v.id, {
      odometer: typeof t?.mileage === 'number' && Number.isFinite(t.mileage) ? t.mileage : null,
      engineHours: hoursById.has(v.id) ? hoursById.get(v.id) : null,
      ts: t?.ts ?? null,
    })
  }
  return out
}

/** Adds ignition-on time since the last reading to each vehicle's engine-hour count. */
async function countEngineHours(vehicles, telemetry, deviceByImei, now) {
  const rows = await prisma.vehicleEngineHours.findMany({ where: { vehicleId: { in: vehicles.map(v => v.id) } } })
  const byId = new Map(rows.map(r => [r.vehicleId, r]))
  for (const v of vehicles) {
    const dev = deviceByImei.get(digits(v.imei))
    const t = dev !== undefined ? telemetry.get(dev) : undefined
    if (!t?.ts || now - t.ts > FRESH_SEC || typeof t.ignition !== 'boolean') continue
    const row = byId.get(v.id)
    if (row?.lastTs && t.ts <= row.lastTs) continue
    const gap = row?.lastTs ? t.ts - row.lastTs : 0
    const add = row?.lastIgnition && t.ignition && gap > 0 && gap <= MAX_GAP_SEC ? gap / 3600 : 0
    await prisma.vehicleEngineHours.upsert({
      where: { vehicleId: v.id },
      create: { vehicleId: v.id, hours: 0, lastTs: t.ts, lastIgnition: t.ignition },
      update: { hours: { increment: add }, lastTs: t.ts, lastIgnition: t.ignition },
    })
  }
}

const vehicleName = v => v.plateNo || v.fleetNo || v.imei

/**
 * One pass, run by the alert engine's timer with the telemetry it already has.
 * Counts engine hours, fills start points the save could not know, and raises
 * the Due / Overdue notifications. Returns the events it created.
 */
export async function runReminderPass(telemetry, deviceByImei, now = Math.floor(Date.now() / 1000)) {
  const vehicles = await prisma.vehicle.findMany({ select: { id: true, imei: true, plateNo: true, fleetNo: true, bgId: true } })
  await countEngineHours(vehicles, telemetry, deviceByImei, now)

  const rules = await prisma.reminderRule.findMany({ where: { active: true }, include: { vehicles: true } })
  if (!rules.length) return []
  const meters = await metersFor(vehicles, telemetry, deviceByImei)
  const vehicleById = new Map(vehicles.map(v => [v.id, v]))
  const created = []
  const nowDate = new Date(now * 1000)

  for (const rule of rules) {
    for (const rv of rule.vehicles) {
      const v = vehicleById.get(rv.vehicleId)
      if (!v) continue
      const meter = meters.get(v.id) ?? {}
      // A start point the save could not read (tracker silent then) is taken now.
      const fill = {}
      if (rv.startOdometer == null && meter.odometer != null) fill.startOdometer = meter.odometer
      if (rv.startEngineHours == null && meter.engineHours != null) fill.startEngineHours = meter.engineHours
      const current = { ...rv, ...fill }
      const result = reminderStatus(rule, current, meter, nowDate)
      const step = result.status === 'due' || result.status === 'overdue' ? result.status : null
      // Each step once per cycle; going back to upcoming (a later start date) re-arms.
      const notify = step && current.alerted !== step && !(step === 'due' && current.alerted === 'overdue')
      const alerted = step ? (notify ? step : current.alerted) : null
      if (Object.keys(fill).length || alerted !== rv.alerted) {
        await prisma.reminderVehicle.update({ where: { id: rv.id }, data: { ...fill, alerted } })
      }
      if (!notify) continue
      const event = await prisma.alertEvent.create({
        data: {
          bgId: rule.bgId, vehicleId: v.id, type: 'reminder', severity: step === 'overdue' ? 'High' : 'Medium',
          title: rule.name,
          message: `${vehicleName(v)}: ${rule.type} ${step === 'overdue' ? 'is overdue' : 'is due'}, ${describe(result)}`,
          occurredAt: nowDate,
          // In-app off: kept for the history, not in the bell.
          ...(rule.notifyInApp ? {} : { readAt: nowDate }),
        },
      })
      created.push(event)
      if (rule.notifyEmail && rule.emails.length) {
        sendAlertEmail(rule.emails, event).catch(err => console.error(`[fleetmax] reminder email failed: ${err.message}`))
      }
    }
  }
  return created
}
