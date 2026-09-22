// Client half of the AI assistant. Talks only to our own Netlify function —
// the Gemini key lives there and never reaches this bundle.
//
// Split from the panel component so that file exports only a component, which
// is what keeps React Fast Refresh working (same reason useToasts is split out
// of Toasts.jsx).

const ENDPOINT = '/.netlify/functions/ai-assistant'

const FALLBACK = 'Assistant is unavailable right now. Please try again in a moment.'

/**
 * @param {{role: 'user'|'assistant', text: string}[]} messages
 *        Full visible history; the function trims it to the last few turns.
 * @returns {Promise<string>} the assistant's reply
 * @throws  {Error} with a message safe to render in the UI
 */
export async function askAssistant(messages) {
  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    })
  } catch {
    // Offline, or `vite` is running without `netlify dev` so the function
    // route does not exist.
    throw new Error(FALLBACK)
  }

  // A 404 here in development almost always means the plain Vite server is
  // running; say so, because the generic message sends people hunting for a
  // problem in their API key instead.
  if (res.status === 404 && import.meta.env.DEV) {
    throw new Error('Assistant function not found — run `netlify dev` instead of `npm run dev`.')
  }

  let data = null
  try { data = await res.json() } catch { /* fall through to the generic message */ }

  if (!res.ok) throw new Error(data?.error || FALLBACK)
  if (!data?.reply) throw new Error(FALLBACK)

  return data.reply
}

// ── Transcript persistence ─────────────────────────────────────────────────
// Per-browser only: there is no backend, and none is wanted. Versioned key so
// bumping v1 retires any transcript written against an older message shape
// instead of trying to render it.

const CHAT_KEY = 'fleetmax-assistant-chat-v1'

// Storage cap, independent of the ~10 turns the function sends to Gemini. This
// one only stops the key growing without bound in a long-lived browser.
const MAX_STORED = 30

const isMessage = m =>
  m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant')

/**
 * @returns {{role:'user'|'assistant', text:string}[] | null}
 *          null when there is nothing usable — the caller falls back to the
 *          welcome message. Never throws: a corrupt key, a quota-blocked
 *          browser or private mode all degrade to a fresh chat.
 */
export function loadChat() {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    // Drop anything that is not a message rather than rendering `undefined`
    // into a bubble if the shape ever changes underneath us.
    const clean = parsed.filter(isMessage)
    return clean.length ? clean : null
  } catch {
    return null
  }
}

export function saveChat(messages) {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-MAX_STORED)))
  } catch { /* private mode or quota — the chat still works in memory */ }
}

export function clearChat() {
  try {
    localStorage.removeItem(CHAT_KEY)
  } catch { /* nothing to clear */ }
}
