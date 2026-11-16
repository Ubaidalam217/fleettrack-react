/**
 * Settings › Device Data Monitor — the server's /api/data-monitor (Super
 * Admin only; server/src/routes/dataMonitor.js). Real mode only: the figures
 * are counted by the server as the trackers' messages and the Flespi calls go
 * through it, so the mock store has nothing to show.
 */

import { request } from './http.js'

export const fetchMonitorDevices = () => request('/api/data-monitor/devices')
export const fetchMonitorRequests = () => request('/api/data-monitor/requests')
export const fetchMonitorSettings = () => request('/api/data-monitor/settings')
export const saveMonitorSettings = patch => request('/api/data-monitor/settings', { method: 'PUT', body: patch })
