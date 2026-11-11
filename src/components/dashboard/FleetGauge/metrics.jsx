import { ShieldIcon, PulseIcon, WrenchIcon, DropIcon, RocketIcon } from './icons'

/**
 * The five readings along the gauge, all recorded (hooks/useDashboardStats.js):
 *   Safety Score     this month's speeding / harsh-driving / idle alerts per 100 km
 *   Vehicle Uptime   share of vehicles that reported in the last 15 minutes
 *   Maintenance Due  vehicles with a due or overdue reminder (Reminders module)
 *   Fuel Efficiency  no tracker reports fuel yet (probe 2026-11-09) — "-"
 *   Trips Today      trips driven today, cut as the Trip reports cut them
 * A reading with nothing behind it shows "-", never a stand-in number.
 *
 * Order is left-to-right along the arc.
 */
export function buildFleetMetrics(stats) {
  const show = v => (Number.isFinite(v) ? String(v) : '-')
  // With no reminder rules there is nothing to be due — "-", not a reassuring 0.
  const due = stats?.maintenance?.rules ? stats.maintenance.dueVehicles : null
  return [
    { label: 'Safety Score',    value: show(stats?.safety),                   unit: '/100',  icon: <ShieldIcon /> },
    { label: 'Vehicle Uptime',  value: show(stats?.uptime),                   unit: '%',     icon: <PulseIcon />  },
    { label: 'Maintenance Due', value: show(due), unit: 'veh',   icon: <WrenchIcon /> },
    { label: 'Fuel Efficiency', value: '-',                                   unit: 'km/L',  icon: <DropIcon />   },
    { label: 'Trips Today',     value: show(stats?.today?.trips),             unit: 'trips', icon: <RocketIcon /> },
  ]
}

export const FLEET_GAUGE_FOOTNOTE =
  'Fleet score: this month’s safety score and vehicle use, averaged'
