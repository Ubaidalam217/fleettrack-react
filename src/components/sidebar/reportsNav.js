import {
  Route, Car, FileBarChart, FileText, Navigation, AlertTriangle,
  Clock, UserRound, MapPinned, CalendarClock, IdCard, Gauge, Sigma, ShieldCheck, Wrench, History,
  Activity, TrendingUp, TrendingDown, CircleParking, ListOrdered, PlugZap, ChartLine, Table2, Shuffle,
  MapPin, Trophy, Flame, ListChecks, Timer, BarChart3, Award, Moon, LayoutDashboard,
  Hourglass, UserRoundX, Users, GanttChartSquare, LineChart, ScrollText, HardDrive, Receipt,
} from 'lucide-react'
import { labelForPathIn } from './navTree'

/**
 * The Reports catalog: every report, grouped into the categories the
 * "Run a Report" hub (pages/reports/ReportsHub.jsx) shows as cards.
 *
 * Each report keeps its own path. A report without a real page resolves to the
 * shared ReportPlaceholder in App.jsx, which reads its title back from here.
 * When a real page lands, only its route and `ready` change.
 *
 * ── TODO (when the reports themselves are built) ────────────────────────────
 *
 * Every report must read ONLY the signed-in account's vehicles. In real mode
 * that list is GET /api/me/vehicles — the same scope rule the rest of the API
 * applies — surfaced on the client through data/fleetScope.js (useFleetScope /
 * allowedImeis) and already applied to the live MQTT feed by useScopedSnapshot.
 * A report that builds its own vehicle list from anywhere else — the Flespi
 * device list, a Settings query, a cached array — is a cross-tenant leak, since
 * one Flespi account carries every tenant's devices. Movement Report gets this
 * right today by taking its vehicles from useFlespiData(), which is scoped at
 * source; new reports must do the same.
 *
 * Roles: all five roles may OPEN every report, which is why there is no
 * permission filter here (unlike settingsNav). The scoping above, not the menu,
 * is what makes a sub-user's Trip Report differ from a Super Admin's.
 */

/**
 * Client, 2026-11-02 ("Report structure.jpeg"): reports are chosen from a
 * "Run a Report" page of category cards, the way Ctrack MaXx lays them out,
 * not from a long dropdown list. The categories follow that reference
 * (Activity, Risk & Safety, Time Card) plus Fleet Lists, its "Fleet
 * Management and Lists" group. The order inside each card keeps the client's
 * original order.
 *
 * `ready` marks a report that has a real page. The rest open the shared
 * placeholder and show "Soon" on the hub.
 */
export const REPORT_CATEGORIES = [
  {
    id: 'activity',
    title: 'Activity',
    desc: 'Where your vehicles went and how far: movement, trips, zone visits and usage.',
    reports: [
      { id: 'movement',         label: 'Movement Report',         icon: Route,        path: '/reports/movement',         ready: true,
        desc: 'Every start-up, drive, idle and ignition-off with time, speed, odometer and location.' },
      { id: 'trip',             label: 'Trip Report',             icon: Navigation,   path: '/reports/trip',             ready: true,
        desc: 'Each trip from ignition on to off: start, end, distance and duration.' },
      { id: 'geo-zone',         label: 'Geo Zone Visit Report',   icon: MapPinned,    path: '/reports/geo-zone',         ready: true,
        desc: 'Visits to your geofences and addresses, with time inside and trips between zones.' },
      { id: 'daywise-distance', label: 'Daywise Distance Report', icon: FileText,     path: '/reports/daywise-distance', ready: true,
        desc: 'Distance driven per vehicle, day by day, with totals.' },
      { id: 'usage-full',       label: 'Full Usage Report',       icon: FileBarChart, path: '/reports/usage-full',       ready: true,
        desc: 'Every trip with drive, idle and stop time, distance and exceptions; 0 km trips can be skipped.' },
      // Client, 2026-11-06: the whole period summed up per vehicle. Daywise
      // Distance (the old "Summary Usage" path) stays the day-by-day report.
      { id: 'summary-usage',    label: 'Summary Usage Report',    icon: Sigma,        path: '/reports/summary-usage',    ready: true,
        desc: 'One line per vehicle summing the whole period: first start, last stop, time, distance and exceptions.' },
      { id: 'private-usage',    label: 'Private Usage Report',    icon: UserRound,    path: '/reports/private-usage',    ready: true,
        desc: 'Business and private use split by the hours you set.' },
      // Client, 2026-11-10: "the heatmap of vehicles presence or any event where occurred".
      { id: 'heat-map',         label: 'Heat Map',                icon: Flame,        path: '/reports/heat-map',         ready: true,
        desc: 'Where the vehicles spend their time, or where events keep happening, coloured on the map.' },
      // Built for Oil & Gas (2026-11-10); here too since the client's 2026-11-11
      // Oil & Gas list keeps only the graph.
      { id: 'tacho-data',       label: 'Tacho Data Report',       icon: Table2,       path: '/reports/tacho-data',       ready: true,
        desc: 'The tracker readings message by message: time, speed, odometer, ignition and RPM.' },
      { id: 'tacho-graph',      label: 'Tacho Graph Report',      icon: ChartLine,    path: '/reports/tacho-graph',      ready: true,
        desc: 'Speed, distance and trips on one timeline for a vehicle, with RPM where the tracker sends it.' },
    ],
  },
  {
    id: 'risk',
    title: 'Risk & Safety',
    desc: 'Exceptions that need attention: speeding, excess idling and driver rating.',
    reports: [
      // Client, 2026-11-02: "the same as Movement report but only show alerts",
      // each alert with the vehicle's tracking at that moment attached.
      { id: 'event',            label: 'Event Occurrence Report', icon: AlertTriangle, path: '/reports/event',        ready: true,
        desc: 'Every alert raised, in the Movement Report layout, with speed, status and location at that moment.' },
      // Client, 2026-11-06: Driver Management phases 3-4.
      { id: 'driver-performance', label: 'Driver Performance & Risk', icon: ShieldCheck, path: '/reports/driver-performance', ready: true,
        desc: 'Per driver: distance, hours, harsh driving, fatigue, incidents, safety score, trend and risk levels.' },
      { id: 'gyr',              label: 'GYR Report',              icon: Gauge,         path: '/reports/gyr',             ready: true,
        desc: 'Green / Yellow / Red rating of each vehicle or driver from its exceptions.' },
      { id: 'violation-overview', label: 'Violation Overview Report', icon: ListOrdered, path: '/reports/violation-overview', ready: true,
        desc: 'How many violations of each kind every vehicle and driver had in the period.' },
      { id: 'power-failure',    label: 'Power Failure Report',    icon: PlugZap,       path: '/reports/power-failure',   ready: true,
        desc: 'Each time a tracker lost its external power: when, for how long, the lowest voltage and where.' },
    ],
  },
  {
    // Client, 2026-11-10, after the reference system's Reports › Reminder.
    id: 'reminder',
    title: 'Reminder',
    desc: 'Maintenance and renewal reminders: what is due now and what was done.',
    reports: [
      { id: 'reminder-status',  label: 'Reminder Status',          icon: Wrench,  path: '/reports/reminder-status',  ready: true,
        desc: 'Every vehicle on every reminder: Overdue, Due, Upcoming or Completed, and Mark done.' },
      { id: 'reminder-history', label: 'Acknowledgement History',  icon: History, path: '/reports/reminder-history', ready: true,
        desc: 'Each reminder marked done, with the date, odometer, note and who did it.' },
    ],
  },
  {
    // Client, 2026-11-12, after the reference system's Reports › Expense.
    id: 'expense',
    title: 'Expense',
    desc: 'What each vehicle costs: every expense, cost per km, per day and per engine hour.',
    reports: [
      { id: 'expense-report', label: 'Expense Report', icon: Receipt, path: '/reports/expense', ready: true,
        desc: 'Every expense per vehicle in a period, the Vehicle Cost and the totals per category.' },
    ],
  },
  {
    id: 'time',
    title: 'Time Card',
    desc: 'Operating time and schedule: working hours and time sheets.',
    reports: [
      { id: 'working-hour',     label: 'Working Hour Report',     icon: Clock,         path: '/reports/working-hour',    ready: true,
        desc: 'Usage inside and outside the working hours you define.' },
      { id: 'time-sheet',       label: 'Time Sheet Report',       icon: CalendarClock, path: '/reports/time-sheet',      ready: true,
        desc: 'First start and last stop of each day, per vehicle.' },
      { id: 'asset-utilization', label: 'Asset Utilization Report', icon: Activity,     path: '/reports/asset-utilization', ready: true,
        desc: 'Per vehicle: expected and utilised time, driving and idling, distance and days used.' },
      { id: 'over-utilization', label: 'Over Utilization Report',  icon: TrendingUp,    path: '/reports/over-utilization', ready: true,
        desc: 'Vehicles used longer than expected in a day, with the days that went over.' },
      { id: 'under-utilization', label: 'Under Utilization Report', icon: TrendingDown, path: '/reports/under-utilization', ready: true,
        desc: 'Vehicles used less than expected.' },
      { id: 'not-used-assets',  label: 'Not Used Assets Report',   icon: CircleParking, path: '/reports/not-used-assets', ready: true,
        desc: 'Vehicles that did not move in the period: since when, and where they stand.' },
    ],
  },
  {
    id: 'lists',
    title: 'Fleet Lists',
    desc: 'Your fleet on paper: vehicles and drivers with their details.',
    reports: [
      { id: 'vehicle-list',     label: 'List of Vehicles',        icon: Car,           path: '/reports/vehicles',        ready: true,
        desc: 'Every vehicle with its group, device and last report.' },
      { id: 'driver-list',      label: 'List of Drivers',         icon: IdCard,        path: '/reports/drivers',         ready: true,
        desc: 'Every driver with licence details and assigned vehicle.' },
      { id: 'reallocation-history', label: 'Reallocation History Report', icon: Shuffle, path: '/reports/reallocation-history', ready: true,
        desc: 'Each time a vehicle moved to another Business Group or branch, or a tracker to another vehicle.' },
    ],
  },
]

/** A report the client listed that has no page yet: the shared placeholder. */
const soon = slug => `/reports/oil-gas/${slug}`

/**
 * Oil & Gas: the client's IVMS report list, under its own menu and in the
 * client's own words.
 *
 * 2026-11-10: "the last reports will be in a new menu of Oil & Gas, not in the
 * normal listing", in five cards ("only make 5 menu and mix them in those
 * only").
 *
 * 2026-11-11: the client sent the full Oil & Gas list as five columns — Basic,
 * Advanced, DMS, Miscellaneous and Graph Reports — with sample PDFs of Trip
 * Details, Trip Location, Trip Summary and Distance Driven. Those four follow
 * the samples (UsageReportPage's Ctrack variants). A name we already had under
 * another report opens that report under the client's name (Road Safety RAG is
 * the GYR Report, and so on). The names with no report yet are `ready: false`:
 * they show "Coming soon" on the hub and open the shared placeholder at
 * /reports/oil-gas/<slug> until the client sends their samples.
 *
 * Reports built for the 2026-11-10 list that this one leaves out (Tacho Data,
 * the utilization reports, Reallocation History) moved to the normal catalog.
 * Ids are prefixed so a favourite here is not one there.
 */
export const OIL_GAS_CATEGORIES = [
  {
    id: 'og-basic',
    title: 'Basic Reports',
    desc: 'Trips, violations and distance: what each vehicle did and where it broke the rules.',
    reports: [
      { id: 'og-trip-details',       label: 'Trip Details',            icon: Navigation,   path: '/reports/trip-details',       ready: true,
        desc: 'Every trip per vehicle: driver, start, end, duration, driving and standing time, distance and top speed.' },
      { id: 'og-trip-location',      label: 'Trip Location',           icon: MapPin,       path: '/reports/trip-locations',     ready: true,
        desc: 'Every trip per vehicle with its start and end location.' },
      { id: 'og-trip-summary',       label: 'Trip Summary',            icon: Sigma,        path: '/reports/trip-summary',       ready: true,
        desc: 'Each day, one line per vehicle and driver with the trips summed up.' },
      { id: 'og-violation-details',  label: 'Violation Details',       icon: ScrollText,   path: soon('violation-details'),     ready: false,
        desc: 'Every violation with its vehicle, driver, time and value.' },
      { id: 'og-violation-location', label: 'Violation Location',      icon: AlertTriangle, path: '/reports/event',             ready: true,
        desc: 'Every violation with where it happened and the vehicle’s speed and status then.' },
      { id: 'og-violations-summary', label: 'Violations Summary',      icon: ListChecks,   path: soon('violations-summary'),    ready: false,
        desc: 'The violations of the period summed up per vehicle and driver.' },
      { id: 'og-violation-duration', label: 'Violation Duration',      icon: Timer,        path: soon('violation-duration'),    ready: false,
        desc: 'How long each violation lasted.' },
      { id: 'og-violation-overview', label: 'Violation Overview',      icon: ListOrdered,  path: '/reports/violation-overview', ready: true,
        desc: 'How many violations of each kind every vehicle and driver had in the period.' },
      { id: 'og-violation-statistics', label: 'Violation Statistics',  icon: BarChart3,    path: soon('violation-statistics'),  ready: false,
        desc: 'Violation counts and rates across the fleet.' },
      { id: 'og-distance-driven',    label: 'Distance Driven',         icon: Route,        path: '/reports/distance-driven',    ready: true,
        desc: 'Distance driven each day per driver or vehicle, with graphs.' },
      { id: 'og-basic-scoring',      label: 'Basic Scoring',           icon: Award,        path: soon('basic-scoring'),         ready: false,
        desc: 'A driving score per vehicle and driver from its violations.' },
      { id: 'og-long-trip-rest',     label: 'Long Trip Rest Violation', icon: Hourglass,   path: soon('long-trip-rest-violation'), ready: false,
        desc: 'Long trips driven without the required rest.' },
      { id: 'og-asset-dashboard',    label: 'Asset Dashboard',         icon: LayoutDashboard, path: soon('asset-dashboard'),    ready: false,
        desc: 'One page of each vehicle’s key figures.' },
    ],
  },
  {
    id: 'og-advanced',
    title: 'Advanced Reports',
    desc: 'Fleet-wide views: dashboards, night driving, utilization and power cuts.',
    reports: [
      { id: 'og-reports-dashboard',  label: 'Reports Dashboard',       icon: LayoutDashboard, path: soon('reports-dashboard'),  ready: false,
        desc: 'The fleet’s key report figures on one page.' },
      { id: 'og-night-driving',      label: 'Night Driving',           icon: Moon,         path: soon('night-driving'),         ready: false,
        desc: 'Driving during the night hours, per vehicle and driver.' },
      { id: 'og-utilization-details', label: 'Utilization Details',    icon: Activity,     path: '/reports/asset-utilization',  ready: true,
        desc: 'Per vehicle: expected and utilised time, driving and idling, distance and days used.' },
      { id: 'og-power-failure',      label: 'Power Failure',           icon: PlugZap,      path: '/reports/power-failure',      ready: true,
        desc: 'Each time a tracker lost its external power: when, for how long, the lowest voltage and where.' },
    ],
  },
  {
    id: 'og-dms',
    title: 'DMS Reports',
    desc: 'Driver management: performance, scoring and road safety rating.',
    reports: [
      { id: 'og-driver-performance', label: 'Driver Performance',      icon: ShieldCheck,  path: '/reports/driver-performance', ready: true,
        desc: 'Per driver: distance, hours, harsh driving, fatigue, incidents, safety score and risk.' },
      { id: 'og-driver-scoring',     label: 'Driver Scoring',          icon: Award,        path: soon('driver-scoring'),        ready: false,
        desc: 'Each driver’s score and how it was reached.' },
      { id: 'og-best-drivers',       label: 'Best Drivers',            icon: Trophy,       path: '/reports/driver-performance', ready: true,
        desc: 'Drivers ranked by safety score: distance, hours, harsh driving and incidents.' },
      { id: 'og-risky-drivers',      label: 'Risky Drivers',           icon: UserRoundX,   path: soon('risky-drivers'),         ready: false,
        desc: 'The drivers with the most risk in the period.' },
      { id: 'og-driver-statistics',  label: 'Driver Statistics',       icon: Users,        path: soon('driver-statistics'),     ready: false,
        desc: 'Each driver’s driving time, distance and violations in figures.' },
      { id: 'og-road-safety-rag',    label: 'Road Safety RAG',         icon: Gauge,        path: '/reports/gyr',                ready: true,
        desc: 'Red / Amber / Green rating of each vehicle or driver from its violations.' },
    ],
  },
  {
    id: 'og-misc',
    title: 'Miscellaneous Reports',
    desc: 'Your fleet on paper: vehicles, drivers and where the trackers were installed.',
    reports: [
      { id: 'og-asset',              label: 'Asset',                   icon: Car,          path: '/reports/vehicles',           ready: true,
        desc: 'Every vehicle with its group, device, status and details.' },
      { id: 'og-drivers',            label: 'Drivers',                 icon: IdCard,       path: '/reports/drivers',            ready: true,
        desc: 'Every driver with licence details and assigned vehicle.' },
      // Reallocation History's per-tracker view: which vehicle each tracker was in, and when.
      { id: 'og-device-installation', label: 'Device Installation History', icon: HardDrive, path: '/reports/reallocation-history', ready: true,
        state: { per: 'device' },
        desc: 'Each time a tracker was installed in a vehicle or taken out of it.' },
    ],
  },
  {
    id: 'og-graph',
    title: 'Graph Reports',
    desc: 'A vehicle’s day on a timeline: activity, summaries and the tacho graph.',
    reports: [
      { id: 'og-activity-timeline',  label: 'Activity Timeline',       icon: GanttChartSquare, path: soon('activity-timeline'), ready: false,
        desc: 'Driving, idling and stops of each vehicle on a timeline.' },
      { id: 'og-timeline-summary',   label: 'Timeline Summary',        icon: LineChart,    path: soon('timeline-summary'),      ready: false,
        desc: 'The timeline of each vehicle summed up per day.' },
      { id: 'og-tacho-graph',        label: 'Tacho Graph',             icon: ChartLine,    path: '/reports/tacho-graph',        ready: true,
        desc: 'Speed, distance and trips on one timeline for a vehicle, with RPM where the tracker sends it.' },
    ],
  },
]

/** Every report of the normal catalog, flat. */
export const REPORTS_MENU = REPORT_CATEGORIES.flatMap(c => c.reports)
/** Every Oil & Gas report, flat. */
export const OIL_GAS_MENU = OIL_GAS_CATEGORIES.flatMap(c => c.reports)
/**
 * Every report page once, whichever menu lists it — what permissions and the
 * title lookups walk. A page in both menus keeps its normal name here.
 */
export const ALL_REPORTS = [...REPORTS_MENU, ...OIL_GAS_MENU]
  .filter((r, i, all) => all.findIndex(x => x.path === r.path) === i)

/** The "Run a Report" hub, where the sidebar's Reports entry goes. */
export const REPORTS_HUB_PATH = '/reports'
/** The Oil & Gas hub, the sidebar's Oil & Gas entry. */
export const OIL_GAS_HUB_PATH = '/reports/oil-gas'

const NORMAL_PATHS = new Set(REPORTS_MENU.map(r => r.path))

/**
 * The hub a report page goes back to: the one it was opened from (a link from
 * a hub says so in its state), else Oil & Gas for a report only it lists.
 */
export function hubForReport(pathname, state) {
  if (state?.hub === OIL_GAS_HUB_PATH || state?.hub === REPORTS_HUB_PATH) return state.hub
  return !NORMAL_PATHS.has(pathname) && OIL_GAS_MENU.some(r => r.path === pathname) ? OIL_GAS_HUB_PATH : REPORTS_HUB_PATH
}

/** Human label for a reports path — lets ReportPlaceholder title itself. */
export const labelForPath = pathname => labelForPathIn(ALL_REPORTS, pathname)
