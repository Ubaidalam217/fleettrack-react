/**
 * Fuel (client, 2026-11-24): the Uffizio fuel-vehicle feed
 * (server/src/routes/uffizio.js). Real mode only — the feed and the readings
 * live on the server.
 */

import { request } from './http.js'

export const fetchUffizioStatus = () => request('/api/uffizio/status')
export const pollUffizio = () => request('/api/uffizio/poll', { method: 'POST', body: {} })
export const testUffizio = () => request('/api/uffizio/test', { method: 'POST', body: {} })
