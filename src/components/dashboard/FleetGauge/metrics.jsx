import { computeUptime } from '../../../utils/fleetAnalytics'
import { ShieldIcon, PulseIcon, WrenchIcon, DropIcon, RocketIcon } from './icons'

/**
 * Vehicle Uptime comes straight from live telemetry (% of fleet that sent
 * data in the last 15 min). Scheduled maintenance, fuel burn, safety events
 * and trip completion have no Flespi data source on this plan, so they are
 * flagged `estimated` — the gauge renders an asterisk and FOOTNOTE explains it.
 *
 * Order is left-to-right along the arc, matching the previous gauge's fixed
 * angles (safety 158deg, uptime 130, maintenance 90, fuel 50, trips 22).
 */
export function buildFleetMetrics(fleetData) {
  const vehicles = fleetData?.vehicles ?? []
  const uptime = vehicles.length > 0 ? String(computeUptime(vehicles)) : '-'

  return [
    { label: 'Safety Score',    value: '96.5', unit: '%',    icon: <ShieldIcon />, estimated: true  },
    { label: 'Vehicle Uptime',  value: uptime, unit: '%',    icon: <PulseIcon />,  estimated: false },
    { label: 'Maintenance Due', value: '2',    unit: 'veh',  icon: <WrenchIcon />, estimated: true  },
    { label: 'Fuel Efficiency', value: '17.3', unit: 'km/L', icon: <DropIcon />,   estimated: true  },
    { label: 'Trips On-time',   value: '83',   unit: '%',    icon: <RocketIcon />, estimated: true  },
  ]
}

export const FLEET_GAUGE_FOOTNOTE =
  '* Estimated: fuel, safety and trip telemetry require Phase 2 backend integration'
