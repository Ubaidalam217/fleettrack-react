/**
 * The one name a vehicle is shown under, everywhere in the app (client,
 * 2026-11-16: "Vehicles numbers should be auto updated everywhere").
 *
 *   our plate number → our fleet no. → the Flespi device's metadata plate →
 *   the Flespi device name → the IMEI
 *
 * Our register (Settings › Object) is the source of truth. The Flespi device
 * name is only a fallback for a tracker nobody has registered yet: it is edited
 * in the Flespi panel, outside the app, and goes stale the moment someone
 * renames a vehicle here or moves a tracker there. Matching a live device to
 * its register row is by IMEI (Flespi's configuration.ident), digits only.
 *
 * Three shapes reach these helpers, and vehicleLabel() takes any of them:
 *   - a register row in the Settings store: { vehicleNumber, vehicleId (= fleet no.), imei }
 *   - a vehicle as the API sends it:       { plateNo, fleetNo, imei }
 *   - a live device (hooks/useFlespiMQTT):  { id, name, ident, master, label?, flespiName? }
 *
 * The server has the same rule in server/src/lib/vehicleLabel.js.
 */

const clean = s => (s == null ? '' : String(s).trim())
const digits = s => String(s ?? '').replace(/\D/g, '')

/** The rule itself, on named parts. '' when there is nothing to name it by. */
export function labelOf({ plateNo, fleetNo, flespiPlate, flespiName, imei } = {}) {
  return clean(plateNo) || clean(fleetNo) || clean(flespiPlate) || clean(flespiName) || clean(imei)
}

const isRegisterRow = v => 'vehicleNumber' in v
const isApiVehicle = v => ('plateNo' in v || 'fleetNo' in v) && !('master' in v)

/**
 * The display name of a register row, an API vehicle or a live device.
 * '' for nothing; a live device with an id always has one ("Device 123" at worst).
 */
export function vehicleLabel(v) {
  if (!v || typeof v !== 'object') return ''
  if (isRegisterRow(v)) return labelOf({ plateNo: v.vehicleNumber, fleetNo: v.vehicleId, imei: v.imei })
  if (isApiVehicle(v)) return labelOf({ plateNo: v.plateNo, fleetNo: v.fleetNo, imei: v.imei })
  return clean(v.label)
    || labelOf({ flespiPlate: v.master?.plateNo, flespiName: v.flespiName ?? v.name, imei: v.ident ?? v.imei })
    || (v.id != null ? `Device ${v.id}` : '')
}

/**
 * The Flespi device's own name, when it is not what the app shows — a picker's
 * small grey note, so a vehicle can still be found by what the Flespi panel
 * calls it. null when the two agree or there is no Flespi name.
 */
export function flespiNameNote(device) {
  // An Uffizio vehicle (live id "uffizio:<id>") has no Flespi device, so no Flespi name.
  if (!device || device.source === 'UFFIZIO') return null
  const flespi = clean(device.flespiName ?? device.name)
  return flespi && flespi !== vehicleLabel(device) ? flespi : null
}

// ── Live devices carry the register's name ──────────────────────────────────

// device object → { row, out }. A device the poll did not change keeps its
// object, and so keeps its labelled copy: markers and memoised rows downstream
// do not re-render for nothing.
const overlayCache = new WeakMap()

function overlayOne(d, row) {
  const flespiName = clean(d.flespiName ?? d.name)
  if (!row) {
    const label = labelOf({ flespiPlate: d.master?.plateNo, flespiName, imei: d.ident }) || `Device ${d.id}`
    return { ...d, flespiName, label }
  }
  const plateNo = clean(row.vehicleNumber)
  const fleetNo = clean(row.vehicleId)
  const label = labelOf({ plateNo, fleetNo, flespiPlate: d.master?.plateNo, flespiName, imei: d.ident }) || `Device ${d.id}`
  return {
    ...d,
    flespiName,
    label,
    // Every older reader shows `master.plateNo || name`, so both carry ours.
    name: label,
    master: { ...(d.master ?? {}), plateNo, fleetNo },
    registered: true,
  }
}

/**
 * Live devices with the names our register gives them: `label` (what to show),
 * `name` (the same, for older readers), `master.plateNo` / `master.fleetNo`
 * (ours, even when blank) and `flespiName` (the Flespi device's own name).
 * A device no register row points at keeps its Flespi name and metadata.
 *
 * @param {object[]} devices  useFlespiMQTT's vehicles
 * @param {object[]} rows     the Settings store's vehicles (vehicleNumber / vehicleId / imei)
 */
export function withRegisterLabels(devices, rows) {
  if (!Array.isArray(devices)) return devices
  const byImei = new Map()
  for (const r of rows ?? []) {
    const k = digits(r?.imei)
    if (k && !byImei.has(k)) byImei.set(k, r)
  }
  return devices.map(d => {
    if (!d || typeof d !== 'object') return d
    const row = byImei.get(digits(d.ident)) ?? null
    const hit = overlayCache.get(d)
    if (hit && hit.row === row) return hit.out
    const out = overlayOne(d, row)
    overlayCache.set(d, { row, out })
    return out
  })
}

/**
 * How a register row stands against Flespi, for a read-only hint on the
 * Object page. Nothing is ever renamed in Flespi from it.
 *   { state: 'missing' }                 no Flespi device has this IMEI (the
 *                                        tracker was removed, or its Flespi
 *                                        device now carries another IMEI)
 *   { state: 'differs', flespiName }     the Flespi device is named otherwise
 *   null                                 it matches, or there is nothing to say
 *
 * @param {object} row          register row
 * @param {Map<string, object>} devicesByImei  live devices by IMEI digits
 */
export function flespiStatusFor(row, devicesByImei) {
  const key = digits(row?.imei)
  if (!key || !devicesByImei) return null
  const d = devicesByImei.get(key)
  if (!d) return { state: 'missing' }
  const flespiName = clean(d.flespiName ?? d.name)
  const ours = vehicleLabel(row)
  return flespiName && ours && flespiName !== ours ? { state: 'differs', flespiName } : null
}
