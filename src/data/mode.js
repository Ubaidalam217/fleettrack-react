/**
 * Real mode vs mock mode. The only place in the app that reads VITE_API_URL.
 *
 * ── Why the switch exists ───────────────────────────────────────────────────
 *
 * The backend runs on localhost until the DigitalOcean deploy (Phase 5), and the
 * live Netlify demo cannot reach it. So the build has to work two ways:
 *
 *   VITE_API_URL set    → real mode: real login, every Settings page and the Live
 *                         Map read through the API.
 *   VITE_API_URL unset  → mock mode: exactly today's behaviour — the in-memory
 *                         store in pages/settings/mockData.js plus localStorage.
 *
 * Netlify has no VITE_API_URL, so the deployed demo keeps working untouched. A
 * local .env sets it, so development talks to the real server.
 *
 * ── Why it is only read here ────────────────────────────────────────────────
 *
 * Every other module imports IS_REAL from this file. A second `import.meta.env`
 * read somewhere else is how the two modes drift: one component checks the raw
 * variable, another checks a derived flag, and a trailing slash or an empty
 * string makes them disagree. Normalising once — trimmed, no trailing slash,
 * empty means unset — means there is one answer to "which mode is this".
 */

/** Base URL with no trailing slash, or '' when unset. */
export const API_URL = String(import.meta.env.VITE_API_URL ?? '')
  .trim()
  .replace(/\/+$/, '')

/** True when the app should talk to the real backend. */
export const IS_REAL = API_URL !== ''

/**
 * Logged once so it is obvious which mode a session is in.
 *
 * Mock mode is the one that can be mistaken for a bug — a demo where nothing
 * persists to a server looks broken if you expected real mode — so it says so
 * explicitly rather than staying silent.
 */
if (typeof window !== 'undefined') {
  console.log(
    IS_REAL
      ? `[FleetmaX] Real mode — API at ${API_URL}`
      : '[FleetmaX] Mock mode — no VITE_API_URL set, using the in-memory Settings store.'
  )
}
