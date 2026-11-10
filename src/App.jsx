import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Login               from './pages/Login'
import Dashboard           from './pages/Dashboard'
import Tracking            from './pages/Tracking'
import Charts              from './pages/Charts'
import Reports             from './pages/Reports'
import SettingsPage        from './pages/Settings'
import Notifications       from './pages/Notifications'
import Announcements       from './pages/Announcements'
// Settings module (Phase 1 — navigation shell, placeholder pages only)
import SettingsReseller       from './pages/settings/Reseller'
import SettingsGroup          from './pages/settings/Group'
import SettingsUser           from './pages/settings/User'
import SettingsCompany        from './pages/settings/Company'
import SettingsCompanySubuser from './pages/settings/CompanySubuser'
import SettingsBranch         from './pages/settings/Branch'
import SettingsVehicle        from './pages/settings/Vehicle'
import SettingsAlerts         from './pages/settings/Alerts'
import SettingsGeofence       from './pages/settings/Geofence'
import SettingsDriver         from './pages/settings/Driver'
import SettingsExpense        from './pages/settings/Expense'
import SettingsReminderRule   from './pages/settings/ReminderRule'
import ReminderStatusReport   from './pages/reports/ReminderStatusReport'
import ReminderHistoryReport  from './pages/reports/ReminderHistoryReport'
import UtilizationReport      from './pages/reports/UtilizationReport'
import ViolationOverviewReport from './pages/reports/ViolationOverviewReport'
import PowerFailureReport     from './pages/reports/PowerFailureReport'
import TachoReport            from './pages/reports/TachoReport'
import ReallocationHistoryReport from './pages/reports/ReallocationHistoryReport'
import SettingsComingSoon     from './pages/settings/ComingSoon'
// Reports module — Movement Report, plus the two Daywise sheets (step 2)
import WorkingHourReport       from './pages/reports/WorkingHourReport'
import SummaryUsageReport      from './pages/reports/SummaryUsageReport'
import GeoZoneReport           from './pages/reports/GeoZoneReport'
import ReportsHub              from './pages/reports/ReportsHub'
import LocationPage            from './pages/LocationPage'
import SharedReplay            from './pages/SharedReplay'
import VehicleListReport       from './pages/reports/VehicleListReport'
import DriverListReport        from './pages/reports/DriverListReport'
import EventOccurrenceReport   from './pages/reports/EventOccurrenceReport'
import UsageReportPage         from './pages/reports/UsageReportPage'
import DriverPerformanceReport from './pages/reports/DriverPerformanceReport'
import PushPermissionModal from './components/PushPermissionModal'
import ErrorBoundary       from './components/ErrorBoundary'
import AuthGate            from './components/AuthGate'
import ScreenGate          from './components/ScreenGate'
import { useNotificationEngine } from './hooks/useNotificationEngine'
import { useReportWarmup } from './hooks/useReportWarmup'
import * as store from './services/notificationStore'
import { shouldShowPrompt } from './services/pushNotifications'
import { IS_REAL } from './data/mode'
import { PHASE, restore, useSession } from './data/session'
import { useSettingsData } from './data/settings'
import { useFleetScopeLoader } from './data/fleetScope'
import { useAlertEventsLoader } from './data/alertEvents'

// ── Seed announcements once on first load ──────────────────────────────────
const SEED_KEY = 'announcements_seeded'
function seedAnnouncements() {
  if (localStorage.getItem(SEED_KEY)) return
  const now = Date.now()
  store.addMany([
    {
      id:        crypto.randomUUID(),
      type:      'announcement',
      severity:  'success',
      title:     'FleetmaX Solutions v2.0 is live',
      message:   'We\'ve redesigned the dashboard with live telemetry, real-time map tracking, and a new notification engine. Enjoy the update!',
      author:    'FleetmaX Team',
      timestamp: now - 2 * 86_400_000,
      read:      false,
    },
    {
      id:        crypto.randomUUID(),
      type:      'announcement',
      severity:  'warning',
      title:     'Scheduled maintenance - Sunday 2 to 4 AM GST',
      message:   'The Flespi data pipeline will be briefly offline for infrastructure upgrades. Live tracking will resume automatically after the window.',
      author:    'Ops Team',
      timestamp: now - 5 * 86_400_000,
      read:      false,
    },
    {
      id:        crypto.randomUUID(),
      type:      'announcement',
      severity:  'info',
      title:     'Overspeed alerts now active',
      message:   'The notification engine is monitoring all 10 vehicles for overspeed (>80 km/h), idle time, GPS loss, and off-hours operation. Alerts appear in the bell icon in real time.',
      author:    'System',
      timestamp: now - 7 * 86_400_000,
      read:      false,
    },
  ])
  localStorage.setItem(SEED_KEY, '1')
}

// ── Inner component — needs BrowserRouter context for hooks + prompt ───────
function AppInner({ isDark, toggleTheme, themeMode, setTheme }) {
  useNotificationEngine()
  useReportWarmup()

  const location = useLocation()
  const session  = useSession()
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false)

  /**
   * Real mode: load the Settings data and the Live Map's visible-fleet allowlist
   * whenever a session becomes ready, and clear both on sign-out.
   *
   * Mounted here, once, rather than per page. The eight Settings pages share one
   * set of stores, so a per-page fetch would re-request everything on every
   * navigation between them; and the fleet allowlist has to be in place before the
   * Live Map renders, which is a different route entirely. Both are no-ops in mock
   * mode.
   */
  useSettingsData()
  useFleetScopeLoader()
  // The server's alert history for the bell and the Notifications page.
  useAlertEventsLoader()

  // Seed once on mount
  useEffect(() => {
    seedAnnouncements()
  }, [])

  // Real mode: validate any token left in sessionStorage before rendering a
  // protected route. AuthGate holds on a splash until this settles.
  useEffect(() => {
    restore()
  }, [])

  // Show push permission prompt on first authenticated page visit
  // Runs when location changes so it also fires if user navigates back after login
  useEffect(() => {
    // Real mode has a real session to ask; mock mode keeps reading the flag the
    // demo has always used. Asking for notification permission while the
    // change-password gate is up would be a second modal over a blocking screen.
    const isAuth = IS_REAL
      ? session.phase === PHASE.READY
      : !!localStorage.getItem('fleetAuth')
    if (!isAuth) return
    if (!shouldShowPrompt()) return

    const timer = setTimeout(() => setShowPermissionPrompt(true), 2000)
    return () => clearTimeout(timer)
  }, [location.pathname, session.phase])

  const themeProps = { isDark, toggleTheme, themeMode, setTheme }

  /**
   * Every route below except /login goes through the gate, so a route added later
   * is protected by default rather than by remembering to wrap it.
   */
  // AuthGate: signed in. ScreenGate: this user may open this screen (permissions).
  const guard = el => <AuthGate><ScreenGate>{el}</ScreenGate></AuthGate>

  return (
    <>
      <Routes>
        <Route path="/"               element={<Navigate to="/login" replace />} />
        <Route path="/login"          element={<Login />} />
        {/* Public: where a location link in an exported report opens (utils/mapLink.js). */}
        <Route path="/location"       element={<LocationPage />} />
        {/* Public: a shared replay, no sign-in; refused by the server once expired. */}
        <Route path="/share/replay/:token" element={<SharedReplay />} />
        <Route path="/dashboard"      element={guard(<Dashboard      {...themeProps} />)} />
        <Route path="/tracking"       element={guard(<Tracking       {...themeProps} />)} />
        <Route path="/charts"         element={guard(<Charts         {...themeProps} />)} />
        {/* "Run a Report": the category cards every report is opened from. */}
        <Route path="/reports"        element={guard(<ReportsHub {...themeProps} />)} />
        <Route path="/settings"       element={guard(<SettingsPage   {...themeProps} />)} />
        <Route path="/settings/profile" element={guard(<SettingsPage {...themeProps} />)} />
        <Route path="/notifications"  element={guard(<Notifications  {...themeProps} />)} />
        <Route path="/announcements"  element={guard(<Announcements  {...themeProps} />)} />

        {/* Settings module — the five leaves with real pages this phase… */}
        <Route path="/settings/reseller"        element={guard(<SettingsReseller       {...themeProps} />)} />
        <Route path="/settings/group"           element={guard(<SettingsGroup          {...themeProps} />)} />
        <Route path="/settings/user"            element={guard(<SettingsUser           {...themeProps} />)} />
        <Route path="/settings/company"         element={guard(<SettingsCompany        {...themeProps} />)} />
        <Route path="/settings/company-subuser" element={guard(<SettingsCompanySubuser {...themeProps} />)} />
        <Route path="/settings/branch"          element={guard(<SettingsBranch         {...themeProps} />)} />
        <Route path="/settings/vehicle"         element={guard(<SettingsVehicle        {...themeProps} />)} />
        <Route path="/settings/alerts"          element={guard(<SettingsAlerts         {...themeProps} />)} />
        <Route path="/settings/geofence"        element={guard(<SettingsGeofence       {...themeProps} />)} />
        <Route path="/settings/driver"          element={guard(<SettingsDriver         {...themeProps} />)} />
        <Route path="/settings/expense"         element={guard(<SettingsExpense        {...themeProps} />)} />
        <Route path="/settings/reminder-rule"   element={guard(<SettingsReminderRule   {...themeProps} />)} />
        {/* Master is a group now (Expense under it); old links land on its first page. */}
        <Route path="/settings/master"          element={<Navigate to="/settings/expense" replace />} />
        {/* …and the branches that share one placeholder until they get built. */}
        {/* Technician was removed from Settings (client, 2026-11-02); old links land on Settings. */}
        <Route path="/settings/technician"      element={<Navigate to="/settings" replace />} />
        <Route path="/settings/bulk-action"     element={guard(<SettingsComingSoon     {...themeProps} />)} />

        {/* Reports module — Movement Report is the page that already existed… */}
        <Route path="/reports/movement"      element={guard(<Reports            {...themeProps} />)} />
        {/* …the rest share one placeholder, each on its own path so the sidebar
            can highlight exactly the row that was clicked. Order matches
            components/sidebar/reportsNav.js, which is the client's order. */}
        <Route path="/reports/vehicles"      element={guard(<VehicleListReport  {...themeProps} />)} />
        <Route path="/reports/usage-full"    element={guard(<UsageReportPage variant="fullUsage" {...themeProps} />)} />
        <Route path="/reports/daywise-distance" element={guard(<SummaryUsageReport {...themeProps} />)} />
        {/* The client renamed "Summary Usage Report" to "Daywise Distance Report"; old links still land. */}
        <Route path="/reports/usage-summary" element={<Navigate to="/reports/daywise-distance" replace />} />
        <Route path="/reports/summary-usage" element={guard(<UsageReportPage variant="summary" {...themeProps} />)} />
        <Route path="/reports/trip"          element={guard(<UsageReportPage variant="trip" {...themeProps} />)} />
        <Route path="/reports/event"         element={guard(<EventOccurrenceReport {...themeProps} />)} />
        <Route path="/reports/reminder-status"  element={guard(<ReminderStatusReport  {...themeProps} />)} />
        <Route path="/reports/reminder-history" element={guard(<ReminderHistoryReport {...themeProps} />)} />
        <Route path="/reports/asset-utilization" element={guard(<UtilizationReport variant="asset" {...themeProps} />)} />
        <Route path="/reports/over-utilization"  element={guard(<UtilizationReport variant="over"  {...themeProps} />)} />
        <Route path="/reports/under-utilization" element={guard(<UtilizationReport variant="under" {...themeProps} />)} />
        <Route path="/reports/not-used-assets"   element={guard(<UtilizationReport variant="notUsed" {...themeProps} />)} />
        <Route path="/reports/violation-overview" element={guard(<ViolationOverviewReport {...themeProps} />)} />
        <Route path="/reports/power-failure"     element={guard(<PowerFailureReport {...themeProps} />)} />
        <Route path="/reports/tacho-graph"       element={guard(<TachoReport variant="graph" {...themeProps} />)} />
        <Route path="/reports/tacho-data"        element={guard(<TachoReport variant="data"  {...themeProps} />)} />
        <Route path="/reports/reallocation-history" element={guard(<ReallocationHistoryReport {...themeProps} />)} />
        <Route path="/reports/working-hour"  element={guard(<WorkingHourReport  {...themeProps} />)} />
        <Route path="/reports/private-usage" element={guard(<UsageReportPage variant="privateUsage" {...themeProps} />)} />
        <Route path="/reports/geo-zone"      element={guard(<GeoZoneReport      {...themeProps} />)} />
        <Route path="/reports/time-sheet"    element={guard(<UsageReportPage variant="timeSheet" {...themeProps} />)} />
        <Route path="/reports/drivers"       element={guard(<DriverListReport   {...themeProps} />)} />
        <Route path="/reports/gyr"           element={guard(<UsageReportPage variant="gyr" {...themeProps} />)} />
        <Route path="/reports/driver-performance" element={guard(<DriverPerformanceReport {...themeProps} />)} />

        <Route path="*"               element={<Navigate to="/login" replace />} />
      </Routes>

      {showPermissionPrompt && (
        <PushPermissionModal onClose={() => setShowPermissionPrompt(false)} />
      )}
    </>
  )
}

// ── Root ───────────────────────────────────────────────────────────────────
function App() {
  const [themeMode, setThemeMode] = useState(() => {
    const saved = localStorage.getItem('fleetTheme')
    if (saved === 'dark' || saved === 'true') return 'dark'
    if (saved === 'system') return 'system'
    return 'light'
  })

  const systemDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemDark)

  const setTheme = mode => {
    setThemeMode(mode)
    localStorage.setItem('fleetTheme', mode)
  }

  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark')

  // The theme class also goes on <html>, not just on the wrapper below.
  //
  // Every dialog in the app — the vehicle Console, ConfirmDialog, the nearest-
  // assets modal, the action menu, the toast stack, the AI panel — is portalled
  // to document.body so the panels that clip them cannot. That puts them
  // *outside* the wrapper div, where the custom properties are declared, so
  // they inherited the light :root values no matter what the theme was set to.
  // Both carry the class: the wrapper keeps working exactly as before and the
  // portalled subtree finally resolves the same variables as the page.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', isDark)
    return () => root.classList.remove('dark')
  }, [isDark])

  return (
    <ErrorBoundary>
      <div className={isDark ? 'dark' : ''} style={{ minHeight: '100vh', backgroundColor: 'var(--c-page)', overflowX: 'hidden' }}>
        <BrowserRouter>
          <AppInner
            isDark={isDark}
            toggleTheme={toggleTheme}
            themeMode={themeMode}
            setTheme={setTheme}
          />
        </BrowserRouter>
      </div>
    </ErrorBoundary>
  )
}

export default App
