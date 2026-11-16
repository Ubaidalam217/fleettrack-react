/**
 * Which geofences the Live Map draws (client, 2026-11-16: "Geozones like the
 * heat map" — the same button-with-options as the heat map).
 *
 *   show    'all' every geofence · 'custom' a picked list · 'rules' the ones
 *           the selected vehicle's alert rules watch (geofence enter / exit
 *           and zone speed)
 *   type    'all' · 'zone' (watched for entry / exit) · 'address' (a tagged
 *           place) · 'speed' (has a speed limit, the zone-speed rule)
 *   labels  names on the map
 *
 * Pure: no React, no storage.
 */

export const GEO_SHOWS = [['all', 'All'], ['custom', 'Custom'], ['rules', 'Vehicle rules']]
export const GEO_TYPES = [['all', 'All'], ['zone', 'Zones'], ['address', 'Addresses'], ['speed', 'Speed zones']]

export const DEFAULT_GEO_OPTIONS = Object.freeze({ show: 'all', ids: [], type: 'all', labels: false })

/** Any stored or patched value as a full, valid options object. */
export function normalizeGeoOptions(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    show: GEO_SHOWS.some(([k]) => k === r.show) ? r.show : DEFAULT_GEO_OPTIONS.show,
    ids: Array.isArray(r.ids) ? [...new Set(r.ids.filter(id => typeof id === 'string' && id))] : [],
    type: GEO_TYPES.some(([k]) => k === r.type) ? r.type : DEFAULT_GEO_OPTIONS.type,
    labels: typeof r.labels === 'boolean' ? r.labels : DEFAULT_GEO_OPTIONS.labels,
  }
}

const hasSpeedLimit = g => g?.speedLimitKmh !== '' && g?.speedLimitKmh != null && Number(g.speedLimitKmh) > 0

/** Whether a geofence is of a type ('all' matches everything). */
export function matchesGeoType(g, type) {
  switch (type) {
    case 'zone':    return (g?.kind ?? 'GEOFENCE') === 'GEOFENCE'
    case 'address': return g?.kind === 'ADDRESS'
    case 'speed':   return hasSpeedLimit(g)
    default:        return true
  }
}

/** How many geofences each type has, for the type buttons. */
export function geoTypeCounts(geofences) {
  const out = {}
  for (const [key] of GEO_TYPES) out[key] = (geofences ?? []).filter(g => matchesGeoType(g, key)).length
  return out
}

const GEOFENCE_RULES = new Set(['geofence', 'geofence_enter', 'geofence_exit', 'geofence_speed'])

/**
 * The geofences the selected vehicle's alert rules watch — read off the
 * Settings alert rules already loaded, no server call. A rule applies to the
 * vehicle when it lists it, or when it covers all vehicles of the vehicle's
 * business group; "All geofences" means every geofence of the rule's group.
 *
 * @param {object[]} alerts     Settings alert rules (type, status, allVehicles,
 *                              vehicleIds, companyId, settings.geofenceIds / allGeofences)
 * @param {object[]} geofences  Settings geofences (id, companyId)
 * @param {{settingsId: string|null, bgId: string|null}|null} vehicle
 * @returns {Set<string>|null}  null with no vehicle selected
 */
export function ruleGeofenceIds(alerts, geofences, vehicle) {
  if (!vehicle) return null
  const out = new Set()
  for (const a of alerts ?? []) {
    if (!GEOFENCE_RULES.has(a?.type) || (a.status && a.status !== 'Active')) continue
    const applies = a.allVehicles
      ? !a.companyId || !vehicle.bgId || a.companyId === vehicle.bgId
      : (a.vehicleIds ?? []).includes(vehicle.settingsId)
    if (!applies) continue
    const s = a.settings ?? {}
    const ids = Array.isArray(s.geofenceIds) ? s.geofenceIds : []
    if (s.allGeofences || !ids.length) {
      for (const g of geofences ?? []) if (!a.companyId || g.companyId === a.companyId) out.add(g.id)
    } else {
      ids.forEach(id => out.add(id))
    }
  }
  return out
}

/** The geofences to draw. */
export function shownGeozones(geofences, options, { ruleIds = null } = {}) {
  const o = normalizeGeoOptions(options)
  let list = geofences ?? []
  if (o.show === 'custom') {
    const picked = new Set(o.ids)
    list = list.filter(g => picked.has(g.id))
  } else if (o.show === 'rules') {
    list = ruleIds ? list.filter(g => ruleIds.has(g.id)) : []
  }
  return list.filter(g => matchesGeoType(g, o.type))
}

/** [[south, west], [north, east]] around the geofences, or null. */
export function geozoneBounds(geofences) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity
  const add = (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    s = Math.min(s, lat); n = Math.max(n, lat)
    w = Math.min(w, lng); e = Math.max(e, lng)
  }
  for (const g of geofences ?? []) {
    if (g.shape === 'CIRCLE') {
      const lat = Number(g.centerLat), lng = Number(g.centerLng), r = Number(g.radius) || 0
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const dLat = r / 111320
      const dLng = r / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
      add(lat - dLat, lng - dLng)
      add(lat + dLat, lng + dLng)
    } else {
      for (const p of g.points ?? []) add(Number(p.lat), Number(p.lng))
    }
  }
  return Number.isFinite(s) ? [[s, w], [n, e]] : null
}

/** "12 geofences shown", "1 geofence shown of 30". */
export function geozoneCaption(shown, total) {
  const word = shown === 1 ? 'geofence' : 'geofences'
  return shown < total ? `${shown} ${word} shown of ${total}` : `${shown} ${word} shown`
}
