// Single source of truth for how vehicle status is presented.
//
// useFlespiMQTT's vehicleStatus() produces the canonical values
// (Running | Idle | Stopped | Inactive | NoData). The Vehicle Tracking Module
// spec names and colours them differently — Running is shown as "Driving",
// Stopped as "Off", and NoData is red rather than grey. The Dashboard still
// renders the raw canonical values, so that mapping lives here instead of
// being baked into either page. Unifying the two vocabularies is a later
// cleanup; doing it now would mean editing seven Dashboard files.

// These are STATUS colours, not brand colours, and the rebrand deliberately
// leaves them alone: they have to stay mutually distinguishable on the map, and
// "Off" recoloured to the brand green would be all but indistinguishable from
// "Driving" at the size these dots actually render.
export const STATUS = {
  Running:  { label: 'Driving',  color: '#22c55e' },  // green
  Idle:     { label: 'Idle',     color: '#eab308' },  // yellow
  Stopped:  { label: 'Off',      color: '#3b82f6' },  // blue
  Inactive: { label: 'Inactive', color: '#6b7280' },  // gray
  NoData:   { label: 'No Data',  color: '#ef4444' },  // red
}

// Canonical keys in the order the spec lists its filters.
export const STATUS_KEYS = ['Running', 'Idle', 'Stopped', 'Inactive', 'NoData']

// Pseudo-filter meaning "no status filter applied".
export const ALL = 'All'
export const FILTERS = [ALL, ...STATUS_KEYS]

// "All" is the brand-neutral tab rather than a vehicle state, so this one does
// follow the accent. Read in a style prop, so the var resolves.
export const ALL_COLOR = 'var(--ft-accent)'

export function statusLabel(status) {
  return STATUS[status]?.label ?? STATUS.NoData.label
}

export function statusColor(status) {
  return STATUS[status]?.color ?? STATUS.NoData.color
}

// Label for a filter key, including the All pseudo-filter.
export function filterLabel(key) {
  return key === ALL ? 'All' : statusLabel(key)
}

export function filterColor(key) {
  return key === ALL ? ALL_COLOR : statusColor(key)
}

// Counts keyed by filter, including All. Single pass over the fleet.
export function countByFilter(vehicles) {
  const counts = { [ALL]: vehicles.length }
  for (const key of STATUS_KEYS) counts[key] = 0
  for (const v of vehicles) {
    if (counts[v.status] !== undefined) counts[v.status] += 1
  }
  return counts
}

export function matchesFilter(vehicle, filter) {
  return filter === ALL || vehicle.status === filter
}
