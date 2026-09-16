// Which fields the floating replay card can show, and the order it shows them
// in. The Customize gear in ReplayPanel renders a checkbox per entry, so adding
// a field here adds its toggle there too.
//
// Kept out of the component files so neither of them exports data alongside a
// component, which would cost React Fast Refresh in dev.
export const REPLAY_FIELDS = [
  { key: 'status',    label: 'Status' },
  { key: 'speed',     label: 'Speed' },
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'address',   label: 'Address' },
  { key: 'heading',   label: 'Heading' },
]

export const DEFAULT_REPLAY_FIELDS = {
  status: true, speed: true, timestamp: true, address: true, heading: true,
}
