import { request, get, post, del } from './http.js'

/**
 * Live location share links (server: routes/locationShares.js). A link shows
 * one vehicle's current position, updating, until its expiry; it opens without
 * signing in, on the public /share/location/:token page.
 */

/** @returns {Promise<{id, token, deviceId, vehicleName, expiresAt}>} */
export const createLocationShare = ({ deviceId, vehicleName, expiresAt }) =>
  post('/api/location-shares', { deviceId, vehicleName, expiresAt: new Date(expiresAt).toISOString() })

/** My links still open, for one vehicle when `deviceId` is given. */
export const listLocationShares = deviceId => get('/api/location-shares', deviceId ? { deviceId } : undefined)

export const revokeLocationShare = id => del(`/api/location-shares/${id}`)

/** The link's public page, on whichever host serves the app. */
export const locationShareUrl = token => `${window.location.origin}/share/location/${token}`

/**
 * Where the shared vehicle is now, read without a sign-in. Throws an ApiError
 * whose status is 410 once the link has expired and 404 when it is unknown or
 * switched off.
 */
export const fetchSharedLocation = token =>
  request(`/api/public/location/${encodeURIComponent(token)}`, { auth: false })
