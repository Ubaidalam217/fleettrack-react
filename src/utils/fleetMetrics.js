// Demo defaults produce a balanced hexagon matching ClyHealth reference
const DEMO = { uptime: 88, efficiency: 76, safety: 82, response: 68, activity: 71, maintenance: 73 }

// Per-axis realistic output ranges
const RANGES = {
  uptime:      [65, 95],
  efficiency:  [60, 90],
  safety:      [70, 95],
  response:    [50, 85],
  activity:    [55, 90],
  maintenance: [60, 85],
}

export function computeFleetMetrics(fleetData) {
  if (!fleetData || !fleetData.total || fleetData.total === 0) return DEMO
  const { total, running = 0, idle = 0, stopped = 0, inactive = 0, noData = 0 } = fleetData
  const active  = running + idle
  const offline = inactive + noData
  const raw = {
    uptime:      Math.round(((total - offline) / total) * 100),
    efficiency:  Math.round((running / total) * 100),
    safety:      Math.round((Math.max(0, total - stopped - offline) / total) * 100),
    response:    Math.round(((total - inactive - noData) / total) * 100),
    activity:    Math.round((active / total) * 100),
    maintenance: Math.round(((total - stopped - noData) / total) * 100),
  }
  // Blend 55% live ratios + 45% demo defaults, clamp to realistic range
  const result = {}
  for (const key of Object.keys(DEMO)) {
    const [lo, hi] = RANGES[key]
    result[key] = Math.min(hi, Math.max(lo, Math.round(raw[key] * 0.55 + DEMO[key] * 0.45)))
  }
  return result
}
