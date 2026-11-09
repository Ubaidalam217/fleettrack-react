import { request, get, post, del } from './http.js'

/**
 * Replay share links (server: routes/replayShares.js). A link carries one
 * vehicle's replay for a period and stops working at its expiry; it opens
 * without signing in, on the public /share/replay/:token page.
 */

/** @returns {Promise<{id, token, vehicleName, fromTs, toTs, expiresAt, pointCount, truncated}>} */
export const createReplayShare = ({ deviceId, vehicleName, fromTs, toTs, expiresAt }) =>
  post('/api/replay-shares', { deviceId, vehicleName, fromTs, toTs, expiresAt: new Date(expiresAt).toISOString() })

export const listReplayShares = () => get('/api/replay-shares')

export const revokeReplayShare = id => del(`/api/replay-shares/${id}`)

/** The link's public page, on whichever host serves the app. */
export const replayShareUrl = token => `${window.location.origin}/share/replay/${token}`

/**
 * The shared replay, read without a sign-in. Throws an ApiError whose status is
 * 410 once the link has expired and 404 when it is unknown or switched off.
 */
export const fetchSharedReplay = token =>
  request(`/api/public/replay/${encodeURIComponent(token)}`, { auth: false })
