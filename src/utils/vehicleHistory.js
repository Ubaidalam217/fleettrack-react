/**
 * A VehicleMove row (server/src/lib/vehicleMoves.js) in words, for the
 * Reallocation History report and the History in the Vehicle information
 * dialog (client, 2026-11-17: "keep the history of change and we can search it").
 *
 *   level 'device'   a tracker installed (toName = the vehicle) or taken out (fromName)
 *         'rename'   the plate or fleet no. (fromName → toName)
 *         'merge'    fromName merged into toName, with its history
 *         'archive'  the merged vehicle put away
 *         'share'    also shown in toName / no longer in fromName
 *         'bg' | 'branch' | 'group' | 'ggb'   moved from → to
 */

export const HISTORY_LEVELS = [
  { key: 'all',     label: 'All' },
  { key: 'device',  label: 'Tracker' },
  { key: 'rename',  label: 'Renamed' },
  { key: 'merge',   label: 'Merged' },
  { key: 'archive', label: 'Archived' },
  { key: 'bg',      label: 'Business Group' },
  { key: 'branch',  label: 'Branch' },
  { key: 'group',   label: 'Group' },
  { key: 'ggb',     label: 'Group Global Admin' },
  { key: 'share',   label: 'Shared' },
]

const MOVED = { bg: 'Business Group', branch: 'Branch', group: 'Group', ggb: 'Group Global Admin' }

export const trackerInstalled = m => m?.level === 'device' && !!m.toName
export const shareAdded = m => m?.level === 'share' && !!m.toName

/** The event's name: "Tracker installed", "Renamed", "Branch"… */
export function moveEvent(m) {
  switch (m?.level) {
    case 'device': return trackerInstalled(m) ? 'Tracker installed' : 'Tracker taken out'
    case 'share': return shareAdded(m) ? 'Also shown in' : 'No longer shown in'
    case 'rename': return 'Renamed'
    case 'merge': return 'Merged in'
    case 'archive': return 'Archived'
    default: return MOVED[m?.level] ?? m?.level ?? ''
  }
}

/** From and to as the report's columns show them; a tracker row names the tracker. */
export function moveFromTo(m) {
  if (m?.level === 'device') {
    return trackerInstalled(m) ? { from: '—', to: `IMEI ${m.imei}` } : { from: `IMEI ${m.imei}`, to: '—' }
  }
  return { from: m?.fromName || '—', to: m?.toName || '—' }
}

/** One line for the Vehicle information dialog. */
export function moveSentence(m) {
  switch (m?.level) {
    case 'device': return trackerInstalled(m) ? `Tracker ${m.imei} installed` : `Tracker ${m.imei} taken out`
    case 'rename': return `Renamed ${m.fromName || '—'} → ${m.toName || '—'}`
    case 'merge': return `${m.fromName} merged into ${m.toName}`
    case 'archive': return `${m.fromName} archived`
    case 'share': return shareAdded(m) ? `Also shown in ${m.toName}` : `No longer shown in ${m.fromName}`
    default: return `${MOVED[m?.level] ?? m?.level}: ${m?.fromName || '—'} → ${m?.toName || '—'}`
  }
}

/** The colour the event is printed in: green in, red out, amber for a merge or archive. */
export function moveTone(m) {
  if (m?.level === 'device') return trackerInstalled(m) ? '#15803d' : '#b91c1c'
  if (m?.level === 'merge' || m?.level === 'archive') return '#b45309'
  if (m?.level === 'share') return shareAdded(m) ? 'var(--ft-accent)' : '#b45309'
  return null
}

/** Does the row match what was typed in the search box (vehicle, either IMEI, place, user, note)? */
export function moveMatches(m, q) {
  const s = String(q ?? '').trim().toLowerCase()
  if (!s) return true
  const digits = s.replace(/\D/g, '')
  // An IMEI typed with spaces or dashes: the tracker, or a change that names it in its note.
  if (digits.length >= 3 && (String(m?.imei ?? '').includes(digits) || String(m?.note ?? '').includes(digits))) return true
  return [m?.vehicleLabel, m?.imei, m?.fromName, m?.toName, m?.bg?.name, m?.movedByName, m?.note]
    .some(x => String(x ?? '').toLowerCase().includes(s))
}
