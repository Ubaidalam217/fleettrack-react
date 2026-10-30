/**
 * API shape ⇄ frontend shape, in both directions, for every Settings entity.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The frontend and the backend name the same things differently. The frontend's
 * names predate the client's vocabulary and are load-bearing: `companyId` is
 * referenced by eight Settings pages, the vehicle Console, the alert scope picker
 * and ~30 pure selectors in mockData.js.
 *
 *   frontend          API
 *   ────────────────  ──────────────────
 *   reseller          Ggb
 *   company           BusinessGroup
 *   resellerId        ggbId
 *   companyId         bgId
 *   vehicleNumber     plateNo
 *   vehicleId         fleetNo
 *   settings.minTemp  minTemp
 *   subuser.name      shortName
 *   permissions       screenAccess
 *
 * Renaming the frontend to match would touch every page, every selector and the
 * mock store, to buy nothing a translation at the boundary does not. So the
 * boundary translates, and everything above it speaks one language in both modes.
 *
 * ── Two invariants ──────────────────────────────────────────────────────────
 *
 * 1. `toFe` must return EVERY key the matching empty*() factory declares. A form
 *    binds inputs straight to these values, and a missing key turns a controlled
 *    input into an uncontrolled one mid-edit.
 *
 * 2. `''` and `null` are not interchangeable. The frontend uses `''` for "no
 *    selection" because it binds to <select value>, where null would flip the
 *    control to uncontrolled. The API uses null for a nullable column. Every
 *    crossing converts explicitly — `?? ''` inbound, `|| null` outbound.
 *
 * ── Updates must round-trip ─────────────────────────────────────────────────
 *
 * The server's optional fields parse an omitted key as null (see the Zod note in
 * server/src/lib/fields.js), so a PUT that leaves out `shortName` CLEARS it. Every
 * toApi update payload therefore sends the full field set, including fields no
 * form on the frontend renders — otherwise saving the User form would silently
 * wipe a shortName set from somewhere else.
 */

import { DEFAULT_PASSWORD, alertTypeOf } from '../pages/settings/mockData'

/** '' / null / undefined → null, for a nullable foreign key or text column. */
const orNull = v => {
  const s = typeof v === 'string' ? v.trim() : v
  return s === '' || s === undefined || s === null ? null : s
}

/** null / undefined → '', for anything bound to an input or <select>. */
const orBlank = v => (v === null || v === undefined ? '' : v)

/** A number column → the string the form's text input holds. */
const numToText = v => (v === null || v === undefined ? '' : String(v))

// ── GGB (API: Ggb) ──────────────────────────────────────────────────────────

export const ggb = {
  toFe: r => ({
    id: r.id,
    name: r.name ?? '',
    email: orBlank(r.email),
  }),
  toApi: r => ({
    name: r.name,
    email: orNull(r.email),
  }),
}

// ── Group ───────────────────────────────────────────────────────────────────

export const group = {
  toFe: r => ({
    id: r.id,
    name: r.name ?? '',
    resellerId: r.ggbId ?? '',
  }),
  toApiCreate: r => ({
    name: r.name,
    ggbId: r.resellerId,
  }),
  // The API deliberately does not let a group change GGB: that would move every
  // BG, vehicle and account under it across a tenant boundary in one request.
  toApiUpdate: r => ({
    name: r.name,
  }),
}

// ── BG (API: BusinessGroup) ─────────────────────────────────────────────────

export const company = {
  toFe: r => ({
    id: r.id,
    name: r.name ?? '',
    email: r.email ?? '',
    resellerId: r.ggbId ?? '',
    // '' is the real state "this BG is its own group", which the frontend renders
    // as "— (own group)".
    groupId: orBlank(r.groupId),
  }),
  toApiCreate: r => ({
    name: r.name,
    email: r.email,
    ggbId: r.resellerId,
    groupId: orNull(r.groupId),
  }),
  toApiUpdate: r => ({
    name: r.name,
    email: r.email,
    groupId: orNull(r.groupId),
  }),
}

// ── Branch ──────────────────────────────────────────────────────────────────

export const branch = {
  toFe: r => ({
    id: r.id,
    name: r.name ?? '',
    companyId: r.bgId ?? '',
    parentBranchId: orBlank(r.parentBranchId),
  }),
  toApiCreate: r => ({
    name: r.name,
    bgId: r.companyId,
    parentBranchId: orNull(r.parentBranchId),
  }),
  // bgId is not editable — moving a branch between BGs would carry its vehicles
  // and sub-user assignments across a tenant boundary.
  toApiUpdate: r => ({
    name: r.name,
    parentBranchId: orNull(r.parentBranchId),
  }),
}

// ── Vehicle ─────────────────────────────────────────────────────────────────

export const vehicle = {
  toFe: r => ({
    id: r.id,
    companyId: r.bgId ?? '',
    branchId: orBlank(r.branchId),
    /**
     * The vehicle's own groupId when set, else inherited from its BG.
     *
     * The Vehicle form only lets the operator choose a group when the BG has none
     * of its own; otherwise it displays the BG's. Falling back to `bg.groupId`
     * reproduces that without a second request — the list and read endpoints both
     * include the BG.
     */
    groupId: orBlank(r.groupId ?? r.bg?.groupId),
    subGroup: orBlank(r.subGroup),
    vehicleNumber: orBlank(r.plateNo),
    vehicleId: orBlank(r.fleetNo),
    imei: r.imei ?? '',
    odometer: orBlank(r.odometer),
    make: orBlank(r.make),
    model: orBlank(r.model),
    mobileNo: orBlank(r.mobileNo),
    deviceType: orBlank(r.deviceType),
    // Collected by the Live Map's Console rather than the Settings form, so it
    // rides along untouched when a row is saved from Settings.
    vehicleType: orBlank(r.vehicleType),
  }),
  toApiCreate: r => ({
    bgId: r.companyId,
    ...vehicle.fields(r),
  }),
  toApiUpdate: r => vehicle.fields(r),
  /** Everything except bgId, which only a create may set. */
  fields: r => ({
    branchId: orNull(r.branchId),
    groupId: orNull(r.groupId),
    subGroup: orNull(r.subGroup),
    plateNo: orNull(r.vehicleNumber),
    fleetNo: orNull(r.vehicleId),
    imei: r.imei,
    odometer: orNull(r.odometer),
    make: orNull(r.make),
    model: orNull(r.model),
    deviceType: orNull(r.deviceType),
    mobileNo: orNull(r.mobileNo),
    vehicleType: orNull(r.vehicleType),
  }),
}

// ── User, BG login account (API: User, role BG_USER) ────────────────────────

export const user = {
  toFe: r => ({
    id: r.id,
    companyId: r.scope?.bgId ?? '',
    email: r.email ?? '',
    /**
     * The hash is never returned, and that is deliberate on the server.
     *
     * The form shows the default so an operator creating an account knows what to
     * hand over. On an existing row it is a write-only box: leaving it alone
     * changes nothing, typing in it triggers a reset (see settings.js
     * updateUser).
     */
    password: DEFAULT_PASSWORD,
    forceChange: !!r.mustChangePassword,
    status: r.status ?? 'Active',
    // Not on the User form, but carried so an update cannot blank them.
    shortName: orBlank(r.shortName),
    mobile: orBlank(r.mobile),
  }),
  toApiCreate: r => ({
    email: r.email,
    role: 'BG_USER',
    bgId: r.companyId,
    status: r.status || 'Active',
    shortName: orNull(r.shortName),
    mobile: orNull(r.mobile),
  }),
  toApiUpdate: r => ({
    role: 'BG_USER',
    bgId: r.companyId,
    status: r.status || 'Active',
    shortName: orNull(r.shortName),
    mobile: orNull(r.mobile),
  }),
}

// ── Sub-user (API: User, role SUB_USER) ─────────────────────────────────────
// The six-tab form. Four of the tabs are JSON columns on the server, which is why
// the shapes below are assembled and disassembled here rather than being stored
// field by field.

const DEFAULT_SHARE_VIA = { email: false, sms: false }
const DEFAULT_NOTIFY = { inApp: true, email: false, sms: false }

export const subuser = {
  toFe: r => {
    const my = r.myAccount ?? {}
    const auth = r.authentication ?? {}
    return {
      id: r.id,
      companyId: r.scope?.bgId ?? '',
      // Keyed `name` on the frontend so the shared SettingsTable can use it for
      // row action labels the way Company and Branch rows do.
      name: orBlank(r.shortName),
      email: r.email ?? '',
      password: DEFAULT_PASSWORD,
      vehicleIds: Array.isArray(r.vehicleIds) ? [...r.vehicleIds] : [],
      branchIds: Array.isArray(r.branchIds) ? [...r.branchIds] : [],

      // ── My Account ──
      shareVia: { ...DEFAULT_SHARE_VIA, ...(my.shareVia ?? {}) },
      mobileNumber: orBlank(my.mobileNumber ?? r.mobile),
      enableSecurityPin: !!my.enableSecurityPin,
      passwordRecoveryEmail: orBlank(my.passwordRecoveryEmail),

      // ── Data Access ──
      selectionMode: my.selectionMode ?? 'object',

      // ── Screen Access ──
      permissions: { ...(r.screenAccess ?? {}) },

      // ── User Setting ──
      // Left undefined rather than defaulted when absent, so the frontend's own
      // normalizeSubuser() supplies defaultUserSetting() — one definition of the
      // defaults, in the file that owns the field catalogue.
      userSetting: r.userSetting ?? undefined,

      // ── Authentication ──
      authRequiredFor: Array.isArray(auth.authRequiredFor) ? [...auth.authRequiredFor] : [],
      deleteAuthFor: Array.isArray(auth.deleteAuthFor) ? [...auth.deleteAuthFor] : [],

      // ── SSO ──
      ssoProviders: Array.isArray(r.sso) ? r.sso.map(p => ({ ...p })) : [],

      status: r.status ?? 'Active',
    }
  },

  /** The half that is identical on create and update. */
  fields: r => ({
    role: 'SUB_USER',
    bgId: r.companyId,
    shortName: orNull(r.name),
    mobile: orNull(r.mobileNumber),
    status: r.status || 'Active',
    userSetting: r.userSetting ?? null,
    authentication: {
      authRequiredFor: r.authRequiredFor ?? [],
      deleteAuthFor: r.deleteAuthFor ?? [],
    },
    sso: r.ssoProviders ?? [],
    screenAccess: r.permissions ?? {},
    myAccount: {
      shareVia: r.shareVia ?? DEFAULT_SHARE_VIA,
      mobileNumber: orNull(r.mobileNumber),
      enableSecurityPin: !!r.enableSecurityPin,
      passwordRecoveryEmail: orNull(r.passwordRecoveryEmail),
      selectionMode: r.selectionMode ?? 'object',
    },
  }),

  toApiCreate: r => ({
    email: r.email,
    ...subuser.fields(r),
    // Accepted at creation time by the API, so a new sub-user arrives with its
    // fleet already assigned rather than in two round trips.
    vehicleIds: r.vehicleIds ?? [],
    branchIds: r.branchIds ?? [],
  }),

  // No vehicleIds/branchIds: the API takes assignment replacement on its own
  // endpoints (PUT :id/vehicles, PUT :id/branches), which settings.js calls
  // alongside this. Sending them here would be ignored and read as applied.
  toApiUpdate: r => subuser.fields(r),
}

// ── Geofence ────────────────────────────────────────────────────────────────

export const geofence = {
  toFe: r => ({
    id: r.id,
    companyId: r.bgId ?? '',
    kind: r.kind ?? 'GEOFENCE',
    shape: r.shape ?? 'POLYGON',
    name: r.name ?? '',
    points: Array.isArray(r.points) ? r.points.map(p => ({ ...p })) : [],
    centerLat: r.centerLat ?? null,
    centerLng: r.centerLng ?? null,
    // A text input, like Vehicle.odometer — the editor's radius box is a
    // number input, but '' reads as empty rather than as "0".
    radius: r.radius ?? null,
    category: orBlank(r.category),
    color: orBlank(r.color) || '#2563eb',
    description: orBlank(r.description),
    active: r.active ?? true,
  }),
  toApiCreate: r => ({
    bgId: r.companyId,
    ...geofence.fields(r),
  }),
  toApiUpdate: r => geofence.fields(r),
  /** Everything except bgId, which only a create may set. */
  fields: r => ({
    name: r.name,
    kind: r.kind,
    shape: r.shape,
    // Only the fields the current shape actually uses are sent — the server
    // nulls out the other set regardless, but sending stale polygon points on
    // a row just switched to CIRCLE would round-trip through validation for
    // fields it is about to discard.
    points: r.shape === 'POLYGON' ? r.points : null,
    centerLat: r.shape === 'CIRCLE' ? numOrNull(r.centerLat) : null,
    centerLng: r.shape === 'CIRCLE' ? numOrNull(r.centerLng) : null,
    radius: r.shape === 'CIRCLE' ? numOrNull(r.radius) : null,
    category: orNull(r.category),
    color: orNull(r.color),
    description: orNull(r.description),
    active: !!r.active,
  }),
}

const numOrNull = v => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── Driver ──────────────────────────────────────────────────────────────────
// `vehicleId` is a vehicle RECORD id on both sides (see emptyDriver()), so it
// crosses unrenamed — unlike Vehicle's own `vehicleId`, which is the fleet number.

export const driver = {
  toFe: r => ({
    id: r.id,
    companyId: r.bgId ?? '',
    name: r.name ?? '',
    mobile: orBlank(r.mobile),
    licenseNo: orBlank(r.licenseNo),
    // Already "YYYY-MM-DD" from the API, which is what <input type="date"> binds.
    licenseExpiry: orBlank(r.licenseExpiry),
    vehicleId: orBlank(r.vehicleId),
    notes: orBlank(r.notes),
    status: r.status ?? 'Active',
  }),
  toApiCreate: r => ({
    bgId: r.companyId,
    ...driver.fields(r),
  }),
  // bgId only at creation: the API keeps a driver in its BG, and a vehicle
  // assignment is validated against it.
  toApiUpdate: r => driver.fields(r),
  fields: r => ({
    name: r.name,
    mobile: orNull(r.mobile),
    licenseNo: orNull(r.licenseNo),
    licenseExpiry: orNull(r.licenseExpiry),
    vehicleId: orNull(r.vehicleId),
    notes: orNull(r.notes),
    status: r.status || 'Active',
  }),
}

// ── Alert ───────────────────────────────────────────────────────────────────

/**
 * The form keeps one flat `settings` bag per type; the API splits it in two.
 * Temperature bounds are columns of their own (minTemp / maxTemp, which predate
 * the other types), and everything else rides in the `params` JSON whose shape
 * the server's cleanParams() checks per type.
 */
function alertSettingsToFe(type, r) {
  const defaults = alertTypeOf(type)?.defaults() ?? {}
  if (type === 'temperature') {
    // The form's bounds are text inputs, so a numeric column has to arrive as a
    // string — and null has to arrive as '' for a one-sided rule to render empty
    // rather than as "null".
    return { ...defaults, minTemp: numToText(r.minTemp), maxTemp: numToText(r.maxTemp) }
  }
  const out = { ...defaults }
  for (const [k, v] of Object.entries(r.params ?? {})) {
    out[k] = Array.isArray(v) ? [...v] : typeof v === 'number' ? String(v) : v
  }
  if (Array.isArray(out.geofenceIds)) out.allGeofences = out.geofenceIds.length === 0
  return out
}

function alertParams(type, s) {
  switch (type) {
    case 'overspeed':
      return { speedKmh: numOrNull(s.speedKmh) }
    case 'idle':
    case 'offline':
      return { minutes: numOrNull(s.minutes) }
    case 'geofence_enter':
    case 'geofence_exit':
      // [] is the server's "every geofence of the BG", so the All box sends that
      // rather than today's ids — a fence drawn next month is covered too.
      return { geofenceIds: s.allGeofences ? [] : [...(s.geofenceIds ?? [])] }
    case 'night_driving':
      return { from: s.from, to: s.to, minSpeedKmh: numOrNull(s.minSpeedKmh) }
    case 'license_expiry':
      return { days: numOrNull(s.days) }
    default:
      return {}
  }
}

export const alert = {
  toFe: r => {
    const type = r.type ?? 'temperature'
    return {
      id: r.id,
      name: r.name ?? '',
      type,
      severity: r.severity ?? 'Medium',
      companyId: r.bgId ?? '',
      allVehicles: !!r.allVehicles,
      vehicleIds: Array.isArray(r.vehicleIds) ? [...r.vehicleIds] : [],
      settings: alertSettingsToFe(type, r),
      notify: { ...DEFAULT_NOTIFY, ...(r.notify ?? {}) },
      emails: Array.isArray(r.emails) ? [...r.emails] : [],
      status: r.status ?? 'Active',
    }
  },
  toApiCreate: r => ({
    bgId: r.companyId,
    ...alert.fields(r),
  }),
  toApiUpdate: r => alert.fields(r),
  fields: r => {
    const type = r.type || 'temperature'
    const s = r.settings ?? {}
    // Licence expiry watches drivers, not vehicles: it is always sent as
    // all-vehicles so a stale explicit list from another type is not validated.
    const byVehicle = alertTypeOf(type)?.vehicles !== false
    return {
      name: r.name,
      type,
      severity: r.severity || 'Medium',
      params: alertParams(type, s),
      emails: r.emails ?? [],
      allVehicles: byVehicle ? !!r.allVehicles : true,
      // Only read by the server when allVehicles is false, but sent either way so
      // toggling the mode back and forth in one edit session cannot lose the list.
      vehicleIds: byVehicle ? (r.vehicleIds ?? []) : [],
      // A PUT that leaves these out clears them anyway (see the note at the top);
      // sending null for other types says so on purpose.
      minTemp: type === 'temperature' ? orNull(s.minTemp) : null,
      maxTemp: type === 'temperature' ? orNull(s.maxTemp) : null,
      notify: r.notify ?? DEFAULT_NOTIFY,
      status: r.status || 'Active',
    }
  },
}
