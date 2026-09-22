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
