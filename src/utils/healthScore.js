// Fleet Health Score — composite 0-100 index
// 40% activity | 30% uptime | 20% alerts | 10% maintenance
export function computeHealthScore(fleetData) {
  if (!fleetData || fleetData.total === 0) return 72   // demo default

  const {
    total,
    running  = 0,
    idle     = 0,
    stopped  = 0,
    inactive = 0,
    noData   = 0,
  } = fleetData

  // 40 % — active ratio (running + idle)
  const activity = ((running + idle) / total) * 100

  // 30 % — uptime: vehicles with recent telemetry (not noData)
  const uptime = ((total - noData) / total) * 100

  // 20 % — inverse alert load (every 20 % of fleet offline/stopped costs 15 pts)
  const problemRatio = (stopped + inactive + noData) / total
  const alertScore   = Math.max(0, 100 - Math.round(problemRatio * 3) * 15)

  // 10 % — maintenance proxy: vehicles reporting data
  const maintenance = ((total - noData) / total) * 100

  const raw = activity * 0.40 + uptime * 0.30 + alertScore * 0.20 + maintenance * 0.10
  return Math.min(100, Math.max(0, Math.round(raw)))
}

export function scoreLabel(score) {
  if (score >= 90) return 'Excellent'
  if (score >= 75) return 'Good'
  if (score >= 50) return 'Fair'
  return 'Poor'
}

// Used for gauge stroke colour
export function scoreColor(score) {
  if (score >= 65) return '#22c55e'
  if (score >= 45) return '#f59e0b'
  return '#ef4444'
}
