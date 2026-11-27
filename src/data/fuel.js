/**
 * Fuel (client, 2026-11-24): the Uffizio fuel-vehicle feed
 * (server/src/routes/uffizio.js). Real mode only — the feed and the readings
 * live on the server.
 */

import { request } from './http.js'

export const fetchUffizioStatus = () => request('/api/uffizio/status')
export const pollUffizio = () => request('/api/uffizio/poll', { method: 'POST', body: {} })
export const testUffizio = () => request('/api/uffizio/test', { method: 'POST', body: {} })
/** An Uffizio vehicle removed in FleetmaxX, back again: { id, plateNo, status }. */
export const restoreUffizioVehicle = id => request(`/api/uffizio/vehicles/${encodeURIComponent(id)}/restore`, { method: 'POST', body: {} })

// ── calibrations (server/src/routes/fuel.js) ────────────────────────────────

export const fetchFuelOverview = () => request('/api/fuel/overview')
export const fetchVehicleFuel = vehicleId => request(`/api/fuel/vehicles/${encodeURIComponent(vehicleId)}`)
/** body: { vehicleIds, method, port, tankCapacityL, points, fileName, note } */
export const applyFuelCalibration = body => request('/api/fuel/calibrations', { method: 'POST', body })
export const removeFuelCalibration = id => request(`/api/fuel/calibrations/${encodeURIComponent(id)}`, { method: 'DELETE' })

/**
 * One vehicle's fuel over a period (<= 31 days): { vehicleId, label, calibrated, unit, port, calibration,
 * series: [{ ts, v }], events, summary, latest } — the Fuel report's entry plus the newest reading.
 * Used by the vehicle panel's Fuel Monitoring and the Replay fuel line.
 */
export const fetchFuelSeries = ({ vehicleId, from, to }) => request('/api/fuel/series', { query: { vehicleId, from, to } })

/** The Fuel report: { from, to, threshold, vehicles: [...] } (server/src/lib/fuel.js buildFuelReport). */
export const fetchFuelReport = ({ from, to, vehicleIds, threshold, allowance }) =>
  request('/api/fuel/report', { query: { from, to, vehicleIds: vehicleIds?.length ? vehicleIds.join(',') : undefined, threshold, allowance: allowance || undefined } })
