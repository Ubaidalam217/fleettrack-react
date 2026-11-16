/**
 * Formatting for Settings › Device Data Monitor (pages/settings/DataMonitor.jsx):
 * sizes, intervals, the status chips, the meters and the sparkline geometry.
 * Pure, so it is tested on its own (dataMonitor.test.js).
 */

/** 1536 → "1.5 KB", 5_242_880 → "5.0 MB". Binary units, as Flespi counts. */
export function fmtBytes(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '0 B'
  if (v < 1024) return `${Math.round(v)} B`
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`
  return `${(v / 1024 ** 3).toFixed(2)} GB`
}

/** Seconds between messages → "0.8 s", "30 s", "5 min", "1 h 10 min"; '—' when unknown. */
export function fmtInterval(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(Number(sec))) return '—'
  const s = Number(sec)
  if (s < 10) return `${Math.round(s * 10) / 10} s`
  if (s < 90) return `${Math.round(s)} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** 12345 → "12,345". */
export const fmtCount = n => (Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString('en-US') : '—')

/** A percentage with one decimal under 10, none above: 3.24 → "3.2%", 45.6 → "46%". */
export function fmtPct(p) {
  const v = Number(p)
  if (!Number.isFinite(v)) return '—'
  return `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)}%`
}

/** "Just now", "12 min ago", "3 h ago", "2 d ago"; '—' when never. */
export function fmtAgo(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return '—'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86_400)} d ago`
}

/**
 * A device's status for its chip: label, tone, and a sentence for screen
 * readers and the tooltip. Status colours carry an icon and a label too.
 */
export const STATUS = Object.freeze({
  normal:   { label: 'Normal',   tone: 'good',     hint: 'Sending as usual' },
  high:     { label: 'High',     tone: 'warning',  hint: 'Half way to an overload threshold' },
  overload: { label: 'Overload', tone: 'critical', hint: 'Over a threshold — flagged and notified' },
})
export const statusOf = s => STATUS[s] ?? STATUS.normal

/** Which rule an overload broke, in words. */
export const CAUSE_LABEL = Object.freeze({
  rate: 'Too many messages',
  interval: 'Interval too short',
  duplicates: 'Repeated messages',
})

/**
 * How full a meter is and its tone against the monitor's two levels:
 * under warnPct normal, from it warning, from shedPct critical.
 */
export function meter(pct, warnPct, shedPct) {
  const p = Math.max(0, Number(pct) || 0)
  return { fill: Math.min(100, p), tone: p >= shedPct ? 'critical' : p >= warnPct ? 'warning' : 'good' }
}

/**
 * The polyline points of a sparkline: `values` spread over `width`, scaled
 * to the largest (a flat zero line when all are 0), `pad` px kept top and
 * bottom so a 2px line is not clipped.
 */
export function sparkPoints(values, width, height, pad = 2) {
  const list = (values ?? []).map(v => Math.max(0, Number(v) || 0))
  if (!list.length) return ''
  const max = Math.max(...list)
  const step = list.length > 1 ? width / (list.length - 1) : 0
  const y = v => (max ? height - pad - (v / max) * (height - 2 * pad) : height - pad)
  return list.map((v, i) => `${round2(i * step)},${round2(y(v))}`).join(' ')
}
const round2 = v => Math.round(v * 100) / 100

/** The vehicle a device row stands for, or the device itself. */
export function deviceTitle(d) {
  return d?.vehicle?.plateNo || d?.vehicle?.fleetNo || `Device ${d?.deviceId ?? '?'}`
}

/** A request source's role in words. */
export const ROLE_LABEL = Object.freeze({
  SUPER_ADMIN: 'Super Admin', GGB_ADMIN: 'Group Global Admin', GROUP_ADMIN: 'Group Admin',
  BG_USER: 'Business Group User', SUB_USER: 'Sub-user',
})

/**
 * The Thresholds tab's fields, grouped, with what each one means. Keys are the
 * server's settings (server/src/lib/trafficMonitor.js SETTINGS_SPEC).
 */
export const SETTING_GROUPS = Object.freeze([
  {
    title: 'Device data overload',
    hint: 'A tracker is flagged when, over the last hour, any of these is true.',
    fields: [
      { key: 'rateMultiplier', label: 'Messages per hour over', unit: '× its own usual hour', hint: 'The device’s median hour of the last 7 days.' },
      { key: 'rateFloorPerHour', label: '…and over', unit: 'messages / hour', hint: 'Both must be passed. 600/h is one message every 6 s.' },
      { key: 'minIntervalSec', label: 'Average gap under', unit: 'seconds', hint: 'Between messages, by the tracker’s own time.' },
      { key: 'fastMinutes', label: '…for at least', unit: 'minutes in a row' },
      { key: 'duplicatePct', label: 'Repeated timestamps over', unit: '% of messages' },
      { key: 'duplicateMinMsgs', label: '…of at least', unit: 'messages' },
      { key: 'clearMinutes', label: 'Closed after normal for', unit: 'minutes', hint: 'No new notification until an overload has ended.' },
    ],
  },
  {
    title: 'Flespi plan limits',
    hint: 'Per minute, for the whole account (Free plan: 200 calls and 50 MiB).',
    fields: [
      { key: 'flespiCallsPerMin', label: 'REST calls', unit: 'per minute' },
      { key: 'flespiMiBPerMin', label: 'REST + MQTT traffic', unit: 'MiB per minute' },
      { key: 'requestWarnPct', label: 'Notify, and pause history reads, at', unit: '% of a limit' },
      { key: 'requestShedPct', label: 'Pause all browser reads at', unit: '% of a limit' },
    ],
  },
  {
    title: 'Recommended reporting interval',
    hint: 'Only used in the advice text. Nothing is sent to a device.',
    fields: [
      { key: 'recommendMovingSec', label: 'While moving', unit: 'seconds' },
      { key: 'recommendParkedSec', label: 'Parked', unit: 'seconds' },
    ],
  },
])

export const SETTING_TOGGLES = Object.freeze([
  { key: 'protectFlespi', label: 'Protect the Flespi limit', hint: 'Near the limit, or after Flespi answers 429, browser reads get a short “busy, retry” from FleetmaxX instead of being sent. Server jobs and changes are never held back.' },
  { key: 'dropDuplicates', label: 'Drop exact copies at the webhook', hint: 'A message identical to one the device already sent (same time, same content) is not stored or pushed again.' },
  { key: 'notifyBgAdmins', label: 'Also notify the vehicle’s Business Group', hint: 'Off: only Super Admins see data-overload notifications. Request overloads are always Super Admin only.' },
])

/** The fields of a settings form that differ from the saved settings, as numbers / booleans. */
export function changedSettings(saved, form) {
  const out = {}
  for (const [k, v] of Object.entries(form ?? {})) {
    if (!(k in (saved ?? {}))) continue
    const value = typeof saved[k] === 'boolean' ? !!v : Number(v)
    if (value !== saved[k]) out[k] = value
  }
  return out
}
