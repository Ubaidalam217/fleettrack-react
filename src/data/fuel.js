/**
 * Fuel (client, 2026-11-24): the Uffizio fuel-vehicle feed
 * (server/src/routes/uffizio.js). Real mode only — the feed and the readings
 * live on the server.
 */

import { request } from './http.js'

export const fetchUffizioStatus = () => request('/api/uffizio/status')
export const pollUffizio = () => request('/api/uffizio/poll', { method: 'POST', body: {} })
export const testUffizio = () => request('/api/uffizio/test', { method: 'POST', body: {} })

// ── calibrations (server/src/routes/fuel.js) ────────────────────────────────

export const fetchFuelOverview = () => request('/api/fuel/overview')
export const fetchVehicleFuel = vehicleId => request(`/api/fuel/vehicles/${encodeURIComponent(vehicleId)}`)
/** body: { vehicleIds, method, port, tankCapacityL, points, fileName, note } */
export const applyFuelCalibration = body => request('/api/fuel/calibrations', { method: 'POST', body })
export const removeFuelCalibration = id => request(`/api/fuel/calibrations/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** The Fuel report: { from, to, threshold, vehicles: [...] } (server/src/lib/fuel.js buildFuelReport). */
export const fetchFuelReport = ({ from, to, vehicleIds, threshold }) =>
  request('/api/fuel/report', { query: { from, to, vehicleIds: vehicleIds?.length ? vehicleIds.join(',') : undefined, threshold } })
