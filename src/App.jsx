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
import SettingsComingSoon     from './pages/settings/ComingSoon'
import PushPermissionModal from './components/PushPermissionModal'
import ErrorBoundary       from './components/ErrorBoundary'
import { useNotificationEngine } from './hooks/useNotificationEngine'
import * as store from './services/notificationStore'
import { shouldShowPrompt } from './services/pushNotifications'

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

  const location = useLocation()
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false)

  // Seed once on mount
  useEffect(() => {
    seedAnnouncements()
  }, [])

  // Show push permission prompt on first authenticated page visit
  // Runs when location changes so it also fires if user navigates back after login
  useEffect(() => {
    const isAuth = !!localStorage.getItem('fleetAuth')
    if (!isAuth) return
    if (!shouldShowPrompt()) return

    const timer = setTimeout(() => setShowPermissionPrompt(true), 2000)
    return () => clearTimeout(timer)
  }, [location.pathname])

  const themeProps = { isDark, toggleTheme, themeMode, setTheme }

  return (
    <>
      <Routes>
        <Route path="/"               element={<Navigate to="/login" replace />} />
        <Route path="/login"          element={<Login />} />
        <Route path="/dashboard"      element={<Dashboard      {...themeProps} />} />
        <Route path="/tracking"       element={<Tracking       {...themeProps} />} />
        <Route path="/charts"         element={<Charts         {...themeProps} />} />
        <Route path="/reports"        element={<Reports        {...themeProps} />} />
        <Route path="/settings"       element={<SettingsPage   {...themeProps} />} />
        <Route path="/notifications"  element={<Notifications  {...themeProps} />} />
        <Route path="/announcements"  element={<Announcements  {...themeProps} />} />

        {/* Settings module — the five leaves with real pages this phase… */}
        <Route path="/settings/reseller"        element={<SettingsReseller       {...themeProps} />} />
        <Route path="/settings/group"           element={<SettingsGroup          {...themeProps} />} />
        <Route path="/settings/user"            element={<SettingsUser           {...themeProps} />} />
        <Route path="/settings/company"         element={<SettingsCompany        {...themeProps} />} />
        <Route path="/settings/company-subuser" element={<SettingsCompanySubuser {...themeProps} />} />
        <Route path="/settings/branch"          element={<SettingsBranch         {...themeProps} />} />
        <Route path="/settings/vehicle"         element={<SettingsVehicle        {...themeProps} />} />
        <Route path="/settings/alerts"          element={<SettingsAlerts         {...themeProps} />} />
        {/* …and the branches that share one placeholder until they get built. */}
        <Route path="/settings/driver"          element={<SettingsComingSoon     {...themeProps} />} />
        <Route path="/settings/master"          element={<SettingsComingSoon     {...themeProps} />} />
        <Route path="/settings/geofence"        element={<SettingsComingSoon     {...themeProps} />} />
        <Route path="/settings/technician"      element={<SettingsComingSoon     {...themeProps} />} />
        <Route path="/settings/bulk-action"     element={<SettingsComingSoon     {...themeProps} />} />

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
