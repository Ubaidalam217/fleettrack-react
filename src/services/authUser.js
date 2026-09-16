// Single source of truth for "who is signed in", used by the dashboard
// greeting and the account dropdown so they can never drift apart.
//
// The session user is written by the login screen and read back from
// localStorage. Until a real identity API exists, unknown accounts fall back
// to a name derived from the email local-part, and a signed-out session falls
// back to the demo administrator profile so the UI never renders blank.

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'fleetUser'

/** Known demo accounts. Keyed by lower-cased email. */
const DIRECTORY = {
  'admin@fleettrack.com':   { name: 'Hassan Raza', role: 'Fleet Administrator' },
  'admin@gmail.com':        { name: 'Hassan Raza', role: 'Fleet Administrator' },
  'ubaidalam217@gmail.com': { name: 'Ubaid Alam',  role: 'Fleet Manager'       },
}

const DEFAULT_USER = {
  email: 'admin@fleettrack.com',
  ...DIRECTORY['admin@fleettrack.com'],
}

/** "ahmed.khan42@x.com" -> "Ahmed Khan" */
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0].replace(/\d+/g, '')
  const words = local.split(/[._-]+/).filter(Boolean)
  if (words.length === 0) return 'there'
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Builds a complete profile for an email, using the directory when known. */
export function profileFor(email) {
  const key = String(email || '').trim().toLowerCase()
  const known = DIRECTORY[key]
  return {
    email: key || DEFAULT_USER.email,
    name:  known?.name ?? nameFromEmail(key),
    role:  known?.role ?? 'Fleet Operator',
  }
}

/** Persists the signed-in profile. Called on successful login. */
export function setCurrentUser(email) {
  const profile = profileFor(email)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)) } catch {}
  return profile
}

export function clearCurrentUser() {
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}

/** The signed-in profile, or the demo administrator when none is stored. */
export function getCurrentUser() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (raw?.email) return profileFor(raw.email)
  } catch {}
  return DEFAULT_USER
}

/** First name only — what the greeting addresses the user by. */
export function firstName(user = getCurrentUser()) {
  return (user?.name || '').trim().split(/\s+/)[0] || 'there'
}

export function initials(user = getCurrentUser()) {
  const parts = (user?.name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Time-of-day greeting for the local clock. */
export function greetingFor(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Reads the profile once on mount and re-reads it when another tab signs in
 * or out, so the greeting and the account menu stay in sync.
 */
export function useCurrentUser() {
  const [user, setUser] = useState(getCurrentUser)

  useEffect(() => {
    const sync = e => {
      if (e && e.key && e.key !== STORAGE_KEY) return
      setUser(getCurrentUser())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  return user
}
