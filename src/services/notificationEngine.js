// Pure function — no side effects, no imports from React

// ── Haversine distance in meters ──────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Cooldown check ────────────────────────────────────────────────────────
function cooldownOk(vehicleId, ruleId, existingNotifs, cooldownMs) {
  const latest = existingNotifs
    .filter(n => n.vehicleId === vehicleId && n.ruleId === ruleId)
    .sort((a, b) => b.timestamp - a.timestamp)[0]
  if (!latest) return true
  return Date.now() - latest.timestamp > cooldownMs
}

// ── Build notification object ─────────────────────────────────────────────
function makeNotif(severity, title, message, vehicle, ruleId) {
  return {
    id: crypto.randomUUID(),
    type: 'alert',
    severity,
    title,
    message,
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    ruleId,
    timestamp: Date.now(),
    read: false,
  }
}

/**
 * generateNotifications
 *
 * @param {Array}  currentSnap   - latest telemetry snapshot: [{ id, name, speed, ignition, lat, lng, serverTs }]
 * @param {Array}  previousSnap  - previous run's snapshot (same shape), or null on first run
 * @param {Array}  existingNotifs - all notifications from the store (for cooldown checks)
 * @param {Object} timeTracking  - { idleStart: {vehicleId: ms}, stopStart: {vehicleId: ms} }
 * @returns {{ newNotifs: Array, updatedTimeTracking: Object, ruleResults: Array }}
 */
export function generateNotifications(currentSnap, previousSnap, existingNotifs, timeTracking) {
  if (!currentSnap?.length) {
    return { newNotifs: [], updatedTimeTracking: timeTracking || {}, ruleResults: [] }
  }

  const now     = Date.now()
  const nowSec  = now / 1000
  const nowHour = new Date().getHours()

  // Build lookup for previous snapshot by vehicle id
  const prevMap = {}
  if (previousSnap?.length) {
    previousSnap.forEach(v => { prevMap[v.id] = v })
  }

  // Clone time-tracking so we can mutate freely
  const tt = {
    idleStart: { ...(timeTracking?.idleStart || {}) },
    stopStart: { ...(timeTracking?.stopStart || {}) },
  }

  const newNotifs   = []
  const ruleResults = [] // [ { vehicle, rule, condition, status: 'FIRED'|'COOLDOWN'|'TRACKING' } ]

  for (const v of currentSnap) {
    const prev = prevMap[v.id] || null

    // ── Rule: overspeed ──────────────────────────────────────────────────
    if ((v.speed ?? 0) > 80) {
      const cd = cooldownOk(v.id, 'overspeed', existingNotifs, 10 * 60_000)
      ruleResults.push({
        vehicle:   v.name,
        rule:      'overspeed',
        condition: `speed ${Math.round(v.speed)} km/h > 80`,
        status:    cd ? 'FIRED' : 'COOLDOWN',
      })
      if (cd) {
        newNotifs.push(makeNotif(
          'warning',
          'Overspeed Alert',
          `${v.name} was travelling at ${Math.round(v.speed)} km/h (limit 80 km/h).`,
          v, 'overspeed'
        ))
      }
    }

    // ── Rule: gps_lost ────────────────────────────────────────────────────
    if (v.serverTs != null) {
      const ageSec = nowSec - v.serverTs
      if (ageSec > 15 * 60) {
        const cd = cooldownOk(v.id, 'gps_lost', existingNotifs, 30 * 60_000)
        const ageMin = Math.round(ageSec / 60)
        ruleResults.push({
          vehicle:   v.name,
          rule:      'gps_lost',
          condition: `last update ${ageMin} min ago > 15 min`,
          status:    cd ? 'FIRED' : 'COOLDOWN',
        })
        if (cd) {
          newNotifs.push(makeNotif(
            'critical',
            'GPS Signal Lost',
            `No data from ${v.name} for ${ageMin} minutes. Check device connectivity.`,
            v, 'gps_lost'
          ))
        }
      }
    }

    // ── Rule: off_hours_engine ────────────────────────────────────────────
    if (v.ignition === true && (nowHour >= 22 || nowHour < 6)) {
      const cd = cooldownOk(v.id, 'off_hours_engine', existingNotifs, 60 * 60_000)
      ruleResults.push({
        vehicle:   v.name,
        rule:      'off_hours_engine',
        condition: `ignition=true at ${nowHour}:00 (off-hours)`,
        status:    cd ? 'FIRED' : 'COOLDOWN',
      })
      if (cd) {
        newNotifs.push(makeNotif(
          'warning',
          'After-Hours Engine Running',
          `${v.name} engine is on outside business hours (${nowHour}:00 local time).`,
          v, 'off_hours_engine'
        ))
      }
    }

    // ── Rule: high_idle ───────────────────────────────────────────────────
    if (v.ignition === true && prev) {
      const dist = haversine(v.lat, v.lng, prev.lat, prev.lng)
      if (dist < 50) {
        if (!tt.idleStart[v.id]) {
          tt.idleStart[v.id] = now
          ruleResults.push({
            vehicle:   v.name,
            rule:      'high_idle',
            condition: `ignition=true, moved ${Math.round(dist)}m < 50m — started tracking`,
            status:    'TRACKING',
          })
        } else {
          const idleMs  = now - tt.idleStart[v.id]
          const idleMin = Math.round(idleMs / 60_000)
          if (idleMs >= 20 * 60_000) {
            const cd = cooldownOk(v.id, 'high_idle', existingNotifs, 30 * 60_000)
            ruleResults.push({
              vehicle:   v.name,
              rule:      'high_idle',
              condition: `idle ${idleMin} min >= 20 min, dist ${Math.round(dist)}m`,
              status:    cd ? 'FIRED' : 'COOLDOWN',
            })
            if (cd) {
              newNotifs.push(makeNotif(
                'warning',
                'High Idle Detected',
                `${v.name} engine has been running with no movement for ${idleMin} minutes.`,
                v, 'high_idle'
              ))
            }
          } else {
            ruleResults.push({
              vehicle:   v.name,
              rule:      'high_idle',
              condition: `idle ${idleMin} min (need 20+), dist ${Math.round(dist)}m`,
              status:    'TRACKING',
            })
          }
        }
      } else {
        if (tt.idleStart[v.id]) {
          ruleResults.push({
            vehicle:   v.name,
            rule:      'high_idle',
            condition: `moved ${Math.round(dist)}m >= 50m — idle reset`,
            status:    'RESET',
          })
        }
        delete tt.idleStart[v.id]
      }
    } else if (v.ignition !== true) {
      delete tt.idleStart[v.id]
    }

    // ── Rule: long_stop ────────────────────────────────────────────────────
    const isBusinessHours = nowHour >= 8 && nowHour < 18
    if ((v.speed ?? 0) === 0 && isBusinessHours) {
      if (!tt.stopStart[v.id]) {
        tt.stopStart[v.id] = now
        ruleResults.push({
          vehicle:   v.name,
          rule:      'long_stop',
          condition: 'speed=0 during business hours — started tracking',
          status:    'TRACKING',
        })
      } else {
        const stopMs = now - tt.stopStart[v.id]
        const stopHr = (stopMs / 3_600_000).toFixed(1)
        if (stopMs >= 4 * 60 * 60_000) {
          const cd = cooldownOk(v.id, 'long_stop', existingNotifs, 60 * 60_000)
          ruleResults.push({
            vehicle:   v.name,
            rule:      'long_stop',
            condition: `stopped ${stopHr}h >= 4h during business hours`,
            status:    cd ? 'FIRED' : 'COOLDOWN',
          })
          if (cd) {
            newNotifs.push(makeNotif(
              'info',
              'Extended Vehicle Stop',
              `${v.name} has been stationary for ${stopHr} hours during business hours.`,
              v, 'long_stop'
            ))
          }
        } else {
          ruleResults.push({
            vehicle:   v.name,
            rule:      'long_stop',
            condition: `stopped ${stopHr}h (need 4h), business hours`,
            status:    'TRACKING',
          })
        }
      }
    } else {
      if (tt.stopStart[v.id]) {
        ruleResults.push({
          vehicle:   v.name,
          rule:      'long_stop',
          condition: (v.speed ?? 0) > 0
            ? `speed ${Math.round(v.speed)} km/h > 0 — stop reset`
            : `outside business hours (${nowHour}:00) — stop reset`,
          status:    'RESET',
        })
      }
      delete tt.stopStart[v.id]
    }
  }

  return { newNotifs, updatedTimeTracking: tt, ruleResults }
}
