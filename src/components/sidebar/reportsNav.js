import {
  Route, Car, FileBarChart, FileText, Navigation, AlertTriangle,
  Clock, UserRound, MapPinned, CalendarClock, IdCard, Gauge, Sigma, ShieldCheck,
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
    ],
  },
]

/** Every report, flat — what the title lookups walk. */
export const REPORTS_MENU = REPORT_CATEGORIES.flatMap(c => c.reports)

/** The "Run a Report" hub, where the sidebar's Reports entry goes. */
export const REPORTS_HUB_PATH = '/reports'

/** Human label for a reports path — lets ReportPlaceholder title itself. */
export const labelForPath = pathname => labelForPathIn(REPORTS_MENU, pathname)
