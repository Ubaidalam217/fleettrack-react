/**
 * FleetmaX Assistant — server-side proxy to Google Gemini.
 *
 * WHY THIS EXISTS: a Gemini key in the React bundle is a public key. Every
 * visitor can read it out of the JS and spend against it. The key lives only in
 * this function's environment (Netlify env var GEMINI_API_KEY, mirrored into
 * the gitignored .env for `netlify dev`) and never crosses to the client.
 *
 * The browser POSTs { messages } here; this calls Gemini and returns { reply }.
 * Nothing in any client-side file references the key.
 */

// Overridable without a code change: if Google retires this name, set
// GEMINI_MODEL in the Netlify UI rather than redeploying.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'

// Cost control. A support answer never needs deep history, and every extra
// turn is billed on each request.
const MAX_TURNS = 10
const MAX_CHARS_PER_MSG = 4000
const TIMEOUT_MS = 25_000

// What the user sees when anything goes wrong. Deliberately identical across
// failure modes — a distinct message per cause would let a probe map out the
// backend, and none of the detail is actionable for an end user anyway.
const GENERIC_ERROR = 'Assistant is unavailable right now. Please try again in a moment.'

const SYSTEM_INSTRUCTION = `You are the FleetmaX Assistant, a helpful in-app guide for FleetmaX Solutions — a vehicle tracking web application. You ONLY help users understand and use FleetmaX features. Keep answers short, clear, and step-by-step. If asked something unrelated to FleetmaX, politely redirect. You cannot perform actions, only explain how.

ABOUT FLEETMAX:
FleetmaX is a fleet vehicle tracking platform. Live vehicle data comes from GPS trackers. Users can view live vehicle locations on a map, replay past trips, run reports, and manage their fleet through the Settings module.

ROLE HIERARCHY (top to bottom):
- Super Admin: manages everything.
- Reseller: a main company that owns sub-companies.
- Company: owns vehicles. When a company is created it becomes a login account (a User) that can see ALL of its own vehicles.
- Sub-user: created under a company and assigned only SOME or all of that company's vehicles. A sub-user sees ONLY the vehicles assigned to them.

NAVIGATION:
The left sidebar has: Dashboard, Live Map, Reports, Charts, Notifications, Announcements, and Settings. Settings opens a nested menu: Settings > General > Users (User, Company, Company Subuser, Branch), Settings > General > Object (Vehicle), Settings > General > Alerts, and Settings > General > Driver. Master, Address - Geofence, Technician and Bulk Action are in the menu but not built yet.
Every list page has an "Add ..." button at the top right. Required fields are marked with a red asterisk (*) and are checked when you press Save. Each form has Save, Back and Reset buttons at the bottom; Back returns to the list without saving.

SETTINGS MODULE:
1. Company (Settings > General > Users > Company): Create a company. Fields: Reseller (dropdown), Company Name* and Email*. The email becomes the company's login username and must be unique. The list shows Company Name, Email and Reseller. There is also an "Import from Certificate" button for pulling companies in from the Certificate app.
2. Branch (Settings > General > Users > Branch): A company can be divided into branches. Fields: Company* (dropdown) and Branch Name*. If a company has no branch, the company name itself acts as the branch.
3. User (Settings > General > Users > User): The main login account for a company. Fields: Company*, Email*, Username (read-only — it is filled automatically from the Email), Password (pre-filled with the default Aa@123456, editable) and a "Force password change on first login" checkbox which is ticked by default. Each user email must be unique. A User sees all vehicles of their company. The list shows Company, Username (email) and Status (Active or Inactive).
4. Company Sub-user (Settings > General > Users > Company Subuser): Created under a company. Fields: Company*, Short Name*, Email* (this is the username, and must be unique among sub-users), Password, and a Vehicle Assignment panel. In Vehicle Assignment you either tick "Assign All" or pick individual vehicles with checkboxes — you must select at least one. The sub-user sees only the vehicles assigned here. The list shows Sub-user Name, Company and how many vehicles are assigned.
5. Vehicle (Settings > General > Object > Vehicle): Add a vehicle manually. Fields: Company*, Branch (optional — the dropdown only lists branches of the chosen company), Vehicle Name*, IMEI Number* and Plate Number (optional). The IMEI is the key that matches the vehicle to its live GPS data: it must be digits only and unique, and is normally 15 digits (a different length is allowed but shows a warning). You can also import vehicles from the Certificate app with the "Import from Certificate (TRACKING APP)" button.
6. Alerts (Settings > General > Alerts): Create alerts for violations. Fields: Alert Name*, Alert Type* (currently Temperature High/Low), "Apply To — Company"*, a Vehicles panel, the temperature settings, Notify Via, and a Status toggle (Active or Inactive, Active by default).
   - In the Vehicles panel, "All Vehicles" covers the company's whole fleet including any vehicle added later; switch it off to tick specific vehicles instead, and at least one must be selected.
   - Temperature settings: Min Temperature (°C) and Max Temperature (°C). You must set at least one of them, and if you set both, the maximum must be greater than or equal to the minimum.
   - Notify Via: In-App (on by default), Email and SMS.

OTHER FEATURES:
- Live Map (sidebar > Live Map): shows the fleet on a map, centered on the UAE by default. Selecting a vehicle from the list or clicking its marker zooms to it and opens a detail panel at the bottom with tabs for Vehicle Info, Driver Info, Usage, Sensors, Alerts and Documents.
- Replay: click a vehicle's marker and choose "Replay Route" to replay its past route. Pick a date range and press Load, then Play. When you press Play the bottom info panel automatically minimizes to give the map more room — you can reopen it any time with the restore control on the panel, and it will stay open. Closing replay with the X returns the map to the UAE-wide live view.
- Reports and Charts: available from the sidebar for fleet analysis.

Always answer as a friendly guide. Give numbered steps when explaining how to do something.`

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

/**
 * Client turns -> Gemini `contents`. Gemini names the assistant role "model",
 * and rejects any other value, so anything that is not a user turn is mapped
 * there rather than passed through.
 */
function toGeminiContents(messages) {
  return messages
    .filter(m => m && typeof m.text === 'string' && m.text.trim())
    .slice(-MAX_TURNS)
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text.slice(0, MAX_CHARS_PER_MSG) }],
    }))
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed.' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    // Logged for the developer reading function logs; the caller is told
    // nothing beyond the generic message.
    console.error('[ai-assistant] GEMINI_API_KEY is not set in this environment.')
    return json(503, { error: GENERIC_ERROR })
  }

  let messages
  try {
    ({ messages } = JSON.parse(event.body || '{}'))
  } catch {
    return json(400, { error: 'Malformed request.' })
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'No question was sent.' })
  }

  const contents = toGeminiContents(messages)
  if (contents.length === 0) {
    return json(400, { error: 'No question was sent.' })
  }
  // Gemini requires the conversation to end on a user turn.
  if (contents[contents.length - 1].role !== 'user') {
    return json(400, { error: 'No question was sent.' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${API_ROOT}/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents,
        generationConfig: {
          // Low temperature: this is documentation lookup, not brainstorming.
          temperature: 0.3,
          maxOutputTokens: 800,
        },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // Server-side only. Truncated, and the key is never in the body — it
      // rides in the query string, which is not echoed back by the API.
      console.error(`[ai-assistant] Gemini HTTP ${res.status}:`, detail.slice(0, 500))
      if (res.status === 404) {
        console.error(
          `[ai-assistant] Model "${MODEL}" was not found. Set the GEMINI_MODEL env var to a current model name.`
        )
      }
      return json(502, { error: GENERIC_ERROR })
    }

    const data = await res.json()

    // A prompt can be refused outright, in which case there are no candidates.
    const blocked = data?.promptFeedback?.blockReason
    if (blocked) {
      console.error('[ai-assistant] Prompt blocked:', blocked)
      return json(200, { reply: "I can't help with that one. Try asking me about a FleetmaX feature." })
    }

    const reply = (data?.candidates?.[0]?.content?.parts || [])
      .map(p => p?.text || '')
      .join('')
      .trim()

    if (!reply) {
      console.error('[ai-assistant] Empty completion. finishReason:', data?.candidates?.[0]?.finishReason)
      return json(502, { error: GENERIC_ERROR })
    }

    return json(200, { reply })
  } catch (err) {
    // Covers the abort timeout and any network failure. Only the message is
    // logged, never the request (whose URL carries the key).
    console.error('[ai-assistant] Request failed:', err?.name, err?.message)
    return json(504, { error: GENERIC_ERROR })
  } finally {
    clearTimeout(timer)
  }
}
