// Browser Push Notification service — no dependencies, native Notification API only

const KEYS = {
  permissionState:  'push_permission_state',
  askedAt:          'push_permission_asked_at',
  dismissedAt:      'push_permission_dismissed_at',
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

// ── State readers ──────────────────────────────────────────────────────────

export function getPermissionState() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  // Always read live from the browser — localStorage is only a cache for our UI
  return Notification.permission // 'default' | 'granted' | 'denied'
}

export function shouldShowPrompt() {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (getPermissionState() !== 'default') return false

  const dismissedAt = localStorage.getItem(KEYS.dismissedAt)
  if (!dismissedAt) return true
  return (Date.now() - Number(dismissedAt)) > SEVEN_DAYS
}

// ── Permission flow ────────────────────────────────────────────────────────

export async function requestPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'

  let result
  try {
    result = await Notification.requestPermission()
  } catch {
    // Old callback-style browsers
    result = await new Promise(resolve => Notification.requestPermission(resolve))
  }

  localStorage.setItem(KEYS.permissionState, result)
  localStorage.setItem(KEYS.askedAt, String(Date.now()))
  return result
}

export function dismissPrompt() {
  localStorage.setItem(KEYS.dismissedAt, String(Date.now()))
}

// ── Send ───────────────────────────────────────────────────────────────────

/**
 * @param {string} title
 * @param {{ body: string, tag: string, severity: string }} options
 */
export function sendPushNotification(title, options = {}) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    const n = new Notification(title, {
      body:                options.body  || '',
      icon:                '/favicon.ico',
      tag:                 options.tag   || title,   // browser dedupes by tag
      requireInteraction:  options.severity === 'critical',
      silent:              false,
    })

    n.onclick = () => {
      window.focus()
      window.location.href = '/notifications'
      n.close()
    }
  } catch (err) {
    // Silently ignore — push is best-effort, never block the engine
    if (import.meta.env.DEV) console.warn('[Push] sendPushNotification failed:', err.message)
  }
}
