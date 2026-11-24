/**
 * Vehicles bulk import (client 2026-11-24, Master Data sheet): the server half.
 * The rows are checked here with the SAME rules the browser's preview used
 * (src/utils/vehicleImport.js) plus what only the database knows: the IMEI
 * already on a vehicle, chassis / engine numbers already on one.
 *
 * Flespi, in plain words:
 *   - An IMEI that is already a Flespi device is only LINKED (Vehicle.flespiDeviceId
 *     = that device). Nothing is written: no rename, no re-type, no new device, so
 *     no duplicate can come of an import. (The single-vehicle add renames the
 *     device and subscribes it to the webhook stream; an import leaves the 15-20
 *     existing devices exactly as they are.)
 *   - An IMEI that is not in Flespi yet: only when the user ticked "Create the
 *     missing devices in Flespi" and chose a device type. Then it goes through
 *     syncVehicleDevice() exactly as POST /api/vehicles does (a Flespi WRITE: one
 *     POST /gw/devices and one stream subscription per device, refused when the
 *     account's device limit is reached, in which case that row is not saved).
 *   - Otherwise the vehicle is saved with no device link; "Sync tracker" on the
 *     vehicle links it later.
 *   - dryRun reads Flespi (GET) only.
 */

import prisma from '../prisma.js'
import * as flespi from './flespi.js'
import { revokeGrantsForBg } from './flespiGrant.js'
import { deviceName, syncVehicleDevice } from './flespiDevices.js'
import { deviceRow } from './vehicleMoves.js'
import { applyOdometerReading, deviceOdometers } from './odometer.js'
import { scopedWhere } from './scope.js'
import { HttpError } from './http.js'
import { checkRows, customFieldsOf, ODOMETER_PENDING_LABEL, MAX_IMPORT_ROWS } from '../../../src/utils/vehicleImport.js'

export { MAX_IMPORT_ROWS }

const norm = s => String(s ?? '').trim().toUpperCase()

/** Chassis and engine numbers already on the vehicles the caller can see (custom fields), upper-case. */
async function knownNumbers(scope) {
  const rows = await prisma.vehicle.findMany({ where: scopedWhere('vehicle', scope), select: { customFields: true } })
  const vins = new Set(), engines = new Set()
  for (const r of rows) {
    for (const f of Array.isArray(r.customFields) ? r.customFields : []) {
      if (f?.name === 'VIN (Chassis Number)' && f.value) vins.add(norm(f.value))
      if (f?.name === 'Engine Number' && f.value) engines.add(norm(f.value))
    }
  }
  return { vins, engines }
}

/** Flespi's IMEI → device id map (a GET), or an empty one when Flespi is not set up or unreachable. */
async function deviceIdsByImei() {
  if (!flespi.isConfigured()) return { map: new Map(), known: false }
  try {
    return { map: await flespi.deviceMap({ force: true }), known: true }
  } catch {
    return { map: new Map(), known: false }
  }
}

/**
 * @param {object} p
 * @param {object} p.scope        req.scope
 * @param {object} p.bg           the Business Group the vehicles go into (already write-checked)
 * @param {string|null} p.branchId already resolved against the BG
 * @param {{row:number, raw:object}[]} p.rows
 * @param {boolean} p.dryRun
 * @param {boolean} p.createDevices
 * @param {string|null} p.deviceType  device type title for devices created in Flespi
 * @param {{id:string|null, name:string|null}} p.by
 */
export async function importVehicles({ scope, bg, branchId, rows, dryRun, createDevices, deviceType, by }) {
  const imeis = rows.map(r => String(r.raw?.imei ?? '').replace(/\D/g, '')).filter(Boolean)
  const [taken, numbers, devices] = await Promise.all([
    prisma.vehicle.findMany({ where: { imei: { in: imeis } }, select: { imei: true } }),
    knownNumbers(scope),
    deviceIdsByImei(),
  ])
  const checked = checkRows(rows, {
    existingImeis: new Set(taken.map(v => v.imei)),
    existingVins: numbers.vins,
    existingEngines: numbers.engines,
  })

  const errors = checked.filter(i => !i.ok).map(i => ({ row: i.row, name: i.vehicle.name, imei: i.vehicle.imei, message: i.problems.join('; ') }))
  const good = checked.filter(i => i.ok)
  const flespiOf = imei => (devices.map.has(imei) ? 'linked' : createDevices && deviceType ? 'created' : 'none')

  if (dryRun) {
    return {
      dryRun: true,
      flespiKnown: devices.known,
      rows: checked.map(i => ({
        row: i.row, ok: i.ok, name: i.vehicle.name, imei: i.vehicle.imei, problems: i.problems,
        ...(i.ok ? { flespi: flespiOf(i.vehicle.imei), odometer: i.vehicle.odometer != null ? 'will be applied if the tracker has reported a reading' : null } : {}),
      })),
      valid: good.length,
      errors,
    }
  }

  const created = []
  let deviceLimit = false
  for (const it of good) {
    const v = it.vehicle
    const fail = message => errors.push({ row: it.row, name: v.name, imei: v.imei, message })
    try {
      let flespiDeviceId = devices.map.get(v.imei) ?? null
      let flespiState = flespiDeviceId ? 'linked' : 'none'
      if (!flespiDeviceId && createDevices && deviceType) {
        if (deviceLimit) { fail('Flespi device limit reached: not saved'); continue }
        // Flespi first, so a refused tracker saves nothing (as POST /api/vehicles does).
        const made = await syncVehicleDevice({ imei: v.imei, name: deviceName({ plateNo: v.plate, fleetNo: v.name, imei: v.imei }), deviceType, requireType: true })
        flespiDeviceId = made?.deviceId ?? null
        flespiState = made ? (made.created ? 'created' : 'linked') : 'none'
      }
      const fields = customFieldsOf(v)
      const row = await prisma.$transaction(async tx => {
        const made = await tx.vehicle.create({
          data: {
            bgId: bg.id,
            branchId,
            plateNo: v.plate || null,
            fleetNo: v.name,
            imei: v.imei,
            model: v.model || null,
            mobileNo: v.sim || null,
            deviceType: flespiState === 'created' ? deviceType : null,
            flespiDeviceId,
            customFields: fields,
            customFieldsUpdatedAt: fields.length ? new Date() : null,
            customFieldsUpdatedBy: fields.length ? by.name : null,
          },
        })
        // The tracker's install goes into the Reallocation History, as for a single add.
        await tx.vehicleMove.create({ data: deviceRow(made, made.imei, true, by, 'Imported from the Master Data sheet') })
        return made
      })
      created.push({ row: it.row, id: row.id, name: v.name, imei: v.imei, flespi: flespiState, odometer: v.odometer != null ? 'pending' : null, _v: v, _row: row })
    } catch (err) {
      if (err instanceof HttpError) {
        if (/device limit/i.test(err.message)) deviceLimit = true
        fail(err.message)
      } else if (err?.code === 'P2002') {
        fail('IMEI Number is already registered to a vehicle') // lost a race with another save
      } else {
        console.error(`[fleetmax] vehicle import row ${it.row} failed: ${err.message}`)
        fail('Could not be saved')
      }
    }
  }

  // Odometers: through the odometer correction (the tracker's own reading is
  // needed). One telemetry read for the whole file. A reading the tracker cannot
  // answer yet is kept in the vehicle's custom fields so it is not lost.
  const wantOdo = created.filter(c => c._v.odometer != null)
  if (wantOdo.length) {
    const readings = await deviceOdometers(wantOdo.map(c => c._row))
    for (const c of wantOdo) {
      try {
        const deviceKm = readings.get(c._row.id)?.deviceKm
        if (deviceKm != null) {
          await applyOdometerReading(c._row, { readingKm: c._v.odometer, deviceKm, by: by.name, note: 'Imported from the Master Data sheet' })
          c.odometer = 'applied'
        } else {
          const fields = [...customFieldsOf(c._v), { name: ODOMETER_PENDING_LABEL, value: String(c._v.odometer) }]
          await prisma.vehicle.update({ where: { id: c._row.id }, data: { customFields: fields, customFieldsUpdatedAt: new Date(), customFieldsUpdatedBy: by.name } })
          c.odometer = 'pending'
        }
      } catch (err) {
        console.error(`[fleetmax] vehicle import odometer failed: ${err.message}`)
        c.odometer = 'failed'
      }
    }
  }

  // The BG's fleet changed: its live Flespi ACLs are too narrow now.
  if (created.length) await revokeGrantsForBg(bg.id)

  return {
    dryRun: false,
    created: created.map(({ _v, _row, ...c }) => c),
    errors: errors.sort((a, b) => a.row - b.row),
    elockPasswordIgnored: good.filter(i => i.vehicle.hadElockPassword).length,
  }
}
