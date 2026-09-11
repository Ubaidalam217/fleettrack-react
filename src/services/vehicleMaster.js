// Vehicle master data — plate no, fleet no, vehicle type, driver, sensor config.
//
// Flespi has no vehicle master, so this lives in each device's free-form
// `metadata` JSON object, namespaced under a single `fleet` key so we never
// clobber metadata owned by other Flespi tooling.
//
// Reads cost nothing extra: `metadata` rides along on the /gw/devices/all call
// useFlespiMQTT already makes at startup, which hands the raw value here via
// cacheRawMetadata(). Writes are a REST PUT, fired only when a user saves a
// form — never on the live telemetry path.

import { BASE_URL, HEADERS } from '../hooks/flespiConfig'

export const MASTER_KEY     = 'fleet'
export const SCHEMA_VERSION = 1

export const VEHICLE_TYPES = ['', 'car', 'van', 'truck', 'bus', 'trailer', 'equipment']

// Sensor flags drive the Sensors tab's "show only if configured" rule.
export const SENSOR_KEYS = ['fuel', 'temperature', 'door', 'seatbelt', 'passenger', 'immobilizer']

function emptyDriver() {
  return { name: '', mobile: '', nationality: '', licenseExpiry: null }
}

function emptySensors() {
  return SENSOR_KEYS.reduce((acc, k) => { acc[k] = false; return acc }, {})
}

/**
 * Coerce a device's raw `metadata` into a complete master record.
 *
 * Defensive by necessity: metadata comes back as `{}` on most devices but is
 * `undefined` on some (confirmed on two devices in this account), and any
 * field inside it may be missing or the wrong type. Callers must never have to
 * null-check the result.
 */
export function normalizeMaster(metadata) {
  const raw = (metadata && typeof metadata === 'object' && !Array.isArray(metadata))
    ? metadata
    : {}
  const m = (raw[MASTER_KEY] && typeof raw[MASTER_KEY] === 'object' && !Array.isArray(raw[MASTER_KEY]))
    ? raw[MASTER_KEY]
    : {}
  const driver  = (m.driver  && typeof m.driver  === 'object') ? m.driver  : {}
  const sensors = (m.sensors && typeof m.sensors === 'object') ? m.sensors : {}

  return {
    schemaVersion: typeof m.schemaVersion === 'number' ? m.schemaVersion : SCHEMA_VERSION,
    plateNo:       typeof m.plateNo     === 'string' ? m.plateNo     : '',
    fleetNo:       typeof m.fleetNo     === 'string' ? m.fleetNo     : '',
    vehicleType:   typeof m.vehicleType === 'string' ? m.vehicleType : '',
    odometerBase:  typeof m.odometerBase === 'number' ? m.odometerBase : null,
    driver: {
      ...emptyDriver(),
      name:          typeof driver.name          === 'string' ? driver.name          : '',
      mobile:        typeof driver.mobile        === 'string' ? driver.mobile        : '',
      nationality:   typeof driver.nationality   === 'string' ? driver.nationality   : '',
      licenseExpiry: typeof driver.licenseExpiry === 'string' ? driver.licenseExpiry : null,
    },
    sensors: SENSOR_KEYS.reduce((acc, k) => {
      acc[k] = sensors[k] === true
      return acc
    }, emptySensors()),
  }
}

// True when a device has no master data filled in yet.
export function isEmptyMaster(master) {
  return !master.plateNo && !master.fleetNo && !master.vehicleType
}

export function hasDriver(master) {
  return !!master?.driver?.name
}

// ── Raw metadata cache ─────────────────────────────────────────────────────
// PUT replaces `metadata` wholesale rather than deep-merging, so every write
// has to be read-modify-write. We keep each device's last known raw metadata
// here — populated from the bootstrap the app already performs — so a save is
// a single PUT instead of a GET+PUT round trip.
//
// Trade-off: the merge is against our cached copy, so a concurrent edit made
// in another browser since page load would be overwritten. Acceptable for
// single-operator use; revisit if the module goes multi-user.
const rawMetadataById = new Map()

export function cacheRawMetadata(deviceId, metadata) {
  rawMetadataById.set(
    deviceId,
    (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) ? metadata : {}
  )
}

export function getRawMetadata(deviceId) {
  return rawMetadataById.get(deviceId) ?? {}
}

/**
 * Persist a partial master update to the device's Flespi metadata.
 *
 * @param {number} deviceId
 * @param {object} patch  Partial master — top-level fields replace, `driver`
 *                        and `sensors` merge key-by-key so a form editing one
 *                        sensor flag does not clear the rest.
 * @returns {Promise<object>} the saved (normalized) master record
 */
export async function saveMaster(deviceId, patch = {}) {
  const currentRaw    = getRawMetadata(deviceId)
  const currentMaster = normalizeMaster(currentRaw)

  const nextMaster = {
    ...currentMaster,
    ...patch,
    schemaVersion: SCHEMA_VERSION,
    driver:  { ...currentMaster.driver,  ...(patch.driver  || {}) },
    sensors: { ...currentMaster.sensors, ...(patch.sensors || {}) },
  }

  // Preserve every other top-level key already in metadata.
  const nextRaw = { ...currentRaw, [MASTER_KEY]: nextMaster }

  const res = await fetch(`${BASE_URL}/gw/devices/${deviceId}`, {
    method:  'PUT',
    headers: HEADERS,
    body:    JSON.stringify({ metadata: nextRaw }),
  })

  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body?.errors?.[0]?.reason || detail
    } catch { /* response was not JSON — keep statusText */ }
    const err = new Error(`Saving vehicle master failed (${res.status}): ${detail}`)
    err.status = res.status
    throw err
  }

  cacheRawMetadata(deviceId, nextRaw)
  return nextMaster
}
