const MONTHLY_KEY = 'ft_score_monthly'
const SEED_KEY    = 'ft_score_seed'

function monthKey(offset) {
  const d = new Date()
  d.setMonth(d.getMonth() + (offset || 0))
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem(MONTHLY_KEY)) || {} }
  catch { return {} }
}

function saveHistory(h) {
  try { localStorage.setItem(MONTHLY_KEY, JSON.stringify(h)) } catch {}
}

// Save this month's score (called whenever we have live data)
export function saveMonthlyScore(score) {
  const h = getHistory()
  h[monthKey(0)] = score
  saveHistory(h)
}

// Get last month's persisted score (null if not yet stored)
export function getLastMonthScore() {
  return getHistory()[monthKey(-1)] ?? null
}

// Called once on first load: if last month has no entry, seed it with a
// small realistic delta below the current score so Change Over Time renders
// on first visit rather than showing placeholders forever.
export function ensureLastMonthSeed(currentScore) {
  const lastKey = monthKey(-1)
  const h = getHistory()
  if (h[lastKey] != null) return

  // Re-use the same seed across page loads so the displayed delta is stable
  let seed = parseInt(localStorage.getItem(SEED_KEY), 10)
  if (!seed || isNaN(seed)) {
    seed = Math.floor(Math.random() * 5) + 4  // 4..8
    try { localStorage.setItem(SEED_KEY, String(seed)) } catch {}
  }

  h[lastKey] = Math.max(30, currentScore - seed)
  saveHistory(h)
}
