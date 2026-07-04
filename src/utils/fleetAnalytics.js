// Uptime: vehicles that sent telemetry within the last 15 minutes
const ONLINE_THRESHOLD_SEC = 15 * 60

// At-risk: vehicles silent for 30+ minutes or permanently inactive
const AT_RISK_THRESHOLD_SEC = 30 * 60

export function computeUptime(vehicles) {
  if (!vehicles || vehicles.length === 0) return 75
  const nowSec = Date.now() / 1000
  const online = vehicles.filter(
    v => v.lastTs != null && nowSec - v.lastTs < ONLINE_THRESHOLD_SEC
  )
  return Math.round((online.length / vehicles.length) * 100)
}

// At-risk = vehicles with no telemetry in 30+ min OR permanently inactive.
// Stopped vehicles with fresh GPS are NOT at risk — they are simply parked.
export function computeAtRisk(vehicles) {
  if (!vehicles || vehicles.length === 0) return 0
  const nowSec = Date.now() / 1000
  return vehicles.filter(
    v =>
      v.status === 'Inactive' ||
      v.lastTs == null ||
      nowSec - v.lastTs > AT_RISK_THRESHOLD_SEC
  ).length
}

export function computePercentile(score) {
  if (score >= 90) return { label: '90th', pos: '90%' }
  if (score >= 75) return { label: '75th', pos: '75%' }
  if (score >= 60) return { label: '60th', pos: '60%' }
  if (score >= 45) return { label: '45th', pos: '45%' }
  return { label: '25th', pos: '25%' }
}
