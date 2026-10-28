// Distance driven between two consecutive Flespi messages — the one rule every
// report uses (Daywise Distance, Movement Report's Cumulative Odo, Geo Zone
// trips, the vehicle Usage tab), so a vehicle's kilometres agree everywhere.
//
// ── Why there is a GPS fallback at all ──────────────────────────────────────
//
// The odometer (`vehicle.mileage`) is the better source, and it is used
// whenever BOTH ends of an interval carry it. But four of the ten devices on
// this account do not send it (probed 2026-10-19): WCR 6665 D, KM 6168 E -
// Falcon and KM 6651 F never do, and MC KM 8294 E stopped around 2026-10-06.
// They send only `segment.vehicle.mileage`, which is NOT usable — summed it
// runs 20-200x the real distance. With an odometer-only rule those vehicles
// read 0 km while driving hundreds of km a day, so an interval without an
// odometer reading on both ends falls back to the straight line between the
// two GPS fixes.
//
// Measured on the devices that send both, GPS lands ~5-10% UNDER the odometer
// (a 60-second fix cuts corners). Under-reporting slightly is the safe
// direction for a client-facing report; the alternative was 0.
//
// ── Why the GPS branch is guarded ───────────────────────────────────────────
//
//   - only when the vehicle was moving at either end (> GPS_MOVING_KMH): a
//     parked tracker's fix drifts by metres every message, and those metres
//     summed over a night become kilometres nobody drove;
//   - never across an invalid fix (`position.valid === false`);
//   - never when the implied speed is impossible (> GPS_MAX_KMH) — that is a
//     GPS jump, not driving.
//
// The odometer branch keeps the existing rule: SIGNED deltas (the odometer
// jitters down by metres, and a signed sum absorbs it the way `last - first`
// does), with a fall of a kilometre or more treated as a reset — that interval
// falls back to GPS instead of subtracting a real day's driving.
//
// ── Why it is a stepper, not a pure pair function ───────────────────────────
//
// Some devices put `vehicle.mileage` on only part of their messages (VL149:
// ~70%), and the messages without it often carry no usable position either.
// Judged pair by pair, every interval touching such a message measured 0 and
// the day lost ~8% (57.0 km -> 52.6 km on 2026-10-18). So the odometer is
// anchored on the LAST message that carried it: when the next reading
// arrives, that interval is credited the odometer's whole advance since the
// anchor, minus whatever GPS already credited the intervals in between — so
// the total equals the odometer exactly and nothing is counted twice.

const EARTH_M = 6371000

/** Above this the vehicle is moving; below it a fix change is GPS drift. */
export const GPS_MOVING_KMH = 2

/** Implied speeds above this between two fixes are a GPS jump, not driving. */
export const GPS_MAX_KMH = 200

/** An odometer fall of this much or more is a reset/replaced unit, not jitter. */
const ODOMETER_RESET_KM = 1

// An odometer RISE that GPS cannot account for is a glitch, not driving: VL149
// flips between two stored values (172.0 <-> 291.6 km, then 291.6 <-> 415.2)
// within seconds while parked, and crediting those rises put 248 km on a day
// GPS measured at 8. A rise is trusted while it stays within
// GPS x ODO_VS_GPS_FACTOR + ODO_VS_GPS_SLACK_KM over the same span — on the
// healthy devices the two agree within ~3%, and the slack covers short spans
// and stretches where the fix is too sparse for GPS to see the road.
const ODO_VS_GPS_FACTOR = 2
const ODO_VS_GPS_SLACK_KM = 3

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * A per-device distance accumulator. Feed it the device's messages in
 * ascending timestamp order; each call returns the kilometres driven in the
 * interval ENDING at that message (the first call returns 0).
 *
 *   const step = createDistanceStepper()
 *   for (const m of messages) total += step(m).km
 *
 * Every message must go through the stepper, including ones the caller does
 * not count (outside a window, say) — skipping one breaks the odometer anchor.
 *
 * @returns {(cur: object) => { km: number, source: 'odometer' | 'gps' | null }}
 *          source null = nothing could be measured (km is 0)
 */
export function createDistanceStepper() {
  let prev = null
  let anchor = null          // last vehicle.mileage reading seen
  let gpsSinceAnchor = 0     // km GPS credited since that reading

  return function step(cur) {
    const mileage = num(cur?.['vehicle.mileage'])
    let out = { km: 0, source: null }

    if (prev) {
      const gps = gpsDistanceKm(prev, cur)
      const delta = mileage != null && anchor != null ? mileage - anchor : null
      // Evidence of movement over the span: what GPS credited, or — across a
      // silence where both ends read speed 0 — how far apart the two fixes are.
      const evidenceKm = gpsSinceAnchor + Math.max(gps.km, straightKm(prev, cur))
      const plausible = delta != null
        && delta > -ODOMETER_RESET_KM
        && delta <= evidenceKm * ODO_VS_GPS_FACTOR + ODO_VS_GPS_SLACK_KM
      if (plausible) {
        const km = delta - gpsSinceAnchor
        // GPS already credited more than the odometer advanced — keep what GPS
        // gave rather than take kilometres back off.
        out = { km: km > -ODOMETER_RESET_KM ? km : 0, source: 'odometer' }
      } else {
        // No odometer, a reset, or a jump GPS cannot explain: measure this
        // interval from GPS. The reading below still becomes the new anchor,
        // so the next interval is a clean delta from it.
        out = gps
      }
    }

    if (mileage != null) {
      anchor = mileage
      gpsSinceAnchor = 0
    } else if (anchor != null) {
      gpsSinceAnchor += out.km
    }
    prev = cur
    return out
  }
}

/** Straight-line km between two messages' fixes, 0 when either lacks one. */
function straightKm(a, b) {
  const lat0 = num(a?.['position.latitude']), lng0 = num(a?.['position.longitude'])
  const lat1 = num(b?.['position.latitude']), lng1 = num(b?.['position.longitude'])
  if (lat0 == null || lng0 == null || lat1 == null || lng1 == null) return 0
  return haversineMeters(lat0, lng0, lat1, lng1) / 1000
}

/**
 * Straight-line kilometres between two consecutive fixes, or 0 when the
 * vehicle was parked, a fix is missing/invalid, or the jump is impossible.
 *
 * @returns {{ km: number, source: 'gps' | null }}
 */
export function gpsDistanceKm(prev, cur) {
  const lat0 = num(prev?.['position.latitude'])
  const lng0 = num(prev?.['position.longitude'])
  const lat1 = num(cur?.['position.latitude'])
  const lng1 = num(cur?.['position.longitude'])
  if (lat0 == null || lng0 == null || lat1 == null || lng1 == null) return { km: 0, source: null }
  if (prev['position.valid'] === false || cur['position.valid'] === false) return { km: 0, source: null }

  const moving = (num(prev['position.speed']) ?? 0) > GPS_MOVING_KMH
    || (num(cur['position.speed']) ?? 0) > GPS_MOVING_KMH
  if (!moving) return { km: 0, source: 'gps' }

  const km = haversineMeters(lat0, lng0, lat1, lng1) / 1000
  const dt = (cur.timestamp ?? 0) - (prev.timestamp ?? 0)
  if (!(dt > 0) || (km / dt) * 3600 > GPS_MAX_KMH) return { km: 0, source: 'gps' }

  return { km, source: 'gps' }
}

/** Every field the stepper reads — for a Flespi `fields` list. */
export const DISTANCE_FIELDS = [
  'vehicle.mileage',
  'position.latitude',
  'position.longitude',
  'position.speed',
  'position.valid',
]
