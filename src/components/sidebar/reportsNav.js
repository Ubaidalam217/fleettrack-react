import {
  Route, Car, FileBarChart, FileText, Navigation, AlertTriangle,
  Clock, UserRound, MapPinned, CalendarClock, IdCard, Gauge,
} from 'lucide-react'
import { ancestorIdsIn, labelForPathIn } from './navTree'

/**
 * The Reports navigation tree (step 1 — menu and placeholders only).
 *
 * Order is the client's, verbatim. Flat on purpose: twelve siblings under one
 * root, no sub-branches, because the client's list has no grouping and
 * inventing one would put a row somewhere they did not ask for.
 *
 * Movement Report is the only leaf with a real page — the existing
 * pages/Reports.jsx, which was already a complete Movement Report (filters,
 * PDF/Excel/Print). It keeps that page; /reports redirects here so older links
 * and bookmarks still land somewhere real. The other eleven resolve to the
 * shared ReportPlaceholder in App.jsx, each on its own path so the sidebar can
 * highlight exactly one row. When a real page lands, only the route changes;
 * this file does not.
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
export const REPORTS_MENU = [
  { id: 'movement',      label: 'Movement Report',       icon: Route,         path: '/reports/movement' },
  { id: 'vehicle-list',  label: 'List of Vehicles',      icon: Car,           path: '/reports/vehicles' },
  { id: 'usage-full',    label: 'Full Usage Report',     icon: FileBarChart,  path: '/reports/usage-full' },
  { id: 'usage-summary', label: 'Summary Usage Report',  icon: FileText,      path: '/reports/usage-summary' },
  { id: 'trip',          label: 'Trip Report',           icon: Navigation,    path: '/reports/trip' },
  // Excess Idle, Speed Violation, Harsh Braking, Harsh Acceleration, etc. —
  // one page with an event-type filter rather than four sibling rows, per the
  // client's own parenthetical.
  { id: 'event',         label: 'Event Report',          icon: AlertTriangle, path: '/reports/event' },
  { id: 'working-hour',  label: 'Working Hour Report',   icon: Clock,         path: '/reports/working-hour' },
  { id: 'private-usage', label: 'Private Usage Report',  icon: UserRound,     path: '/reports/private-usage' },
  { id: 'geo-zone',      label: 'Geo Zone Visit Report', icon: MapPinned,     path: '/reports/geo-zone' },
  { id: 'time-sheet',    label: 'Time Sheet Report',     icon: CalendarClock, path: '/reports/time-sheet' },
  { id: 'driver-list',   label: 'List of Drivers',       icon: IdCard,        path: '/reports/drivers' },
  { id: 'gyr',           label: 'GYR Report',            icon: Gauge,         path: '/reports/gyr' },
]

/** Id of the root row, so callers can expand/collapse the whole tree. */
export const REPORTS_ROOT_ID = 'reports'

/** The one leaf that has a real page; /reports redirects to it. */
export const REPORTS_DEFAULT_PATH = '/reports/movement'

export const ancestorIds = pathname => ancestorIdsIn(REPORTS_MENU, REPORTS_ROOT_ID, pathname)

/** Human label for a reports path — lets ReportPlaceholder title itself. */
export const labelForPath = pathname => labelForPathIn(REPORTS_MENU, pathname)
