// The violations an Oil & Gas report shows (client, 2026-11-13: "Oil & Gas
// reports should show only violations related to Oil and Gas, not standard
// events (temp, driver license, ignition on, ignition off and so on)").
//
// The ids are the alert engine's (server/src/lib/alertEngine.js TYPES, the
// Settings › Alerts types in pages/settings/mockData.js ALERT_TYPES):
//
//   kept       overspeed, geofence_speed (zone speed), harsh_braking,
//              harsh_acceleration, night_driving, idle (excess idle), tamper,
//              battery_tamper, panic (SOS)
//   left out   temperature, license_expiry, ignition_on / ignition_off,
//              geofence / geofence_enter / geofence_exit, offline,
//              suspended_driver, custom
//
// Harsh cornering, fatigue / rest and power failure are no alert type yet:
// harsh_cornering is listed so it is kept the day the engine raises it.

export const OIL_GAS_VIOLATION_TYPES = Object.freeze([
  'overspeed', 'geofence_speed', 'harsh_braking', 'harsh_acceleration', 'harsh_cornering',
  'night_driving', 'idle', 'tamper', 'battery_tamper', 'panic',
])

/** The engine's types an Oil & Gas report leaves out — status, paperwork, the vehicle's cargo. */
export const NOT_OIL_GAS_TYPES = Object.freeze([
  'temperature', 'license_expiry', 'ignition_on', 'ignition_off', 'geofence', 'geofence_enter', 'geofence_exit',
  'offline', 'suspended_driver', 'custom',
])

/**
 * One-time events: a moment, not a span — the map shows one point with its
 * time and speed, no route and no duration (client, 2026-11-13: "SOS button,
 * Harsh Braking, Harsh Acceleration as these are one time events").
 */
export const ONE_TIME_VIOLATION_TYPES = Object.freeze(['panic', 'harsh_braking', 'harsh_acceleration', 'harsh_cornering'])

const OIL_GAS = new Set(OIL_GAS_VIOLATION_TYPES)
const ONE_TIME = new Set(ONE_TIME_VIOLATION_TYPES)

export const isOilGasViolation = type => OIL_GAS.has(type)
export const isOneTimeViolation = type => ONE_TIME.has(type)
