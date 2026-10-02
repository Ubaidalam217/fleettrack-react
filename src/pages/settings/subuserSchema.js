/**
 * Field catalogues for the Company Subuser form.
 *
 * Split out of CompanySubuser.jsx because the six tabs are mostly *data* — a
 * permission matrix and ~26 preference controls — and describing them as
 * arrays keeps the page to readable JSX instead of 900 lines of near-identical
 * markup. Plain .js, no components, so the page stays Fast-Refresh friendly.
 *
 * Everything here mirrors docs/aitracking-reference.md §3.2 (Company Subuser)
 * and its six tab screenshots. Where the reference shows a field FleetmaX has
 * no data for, it is called out in a comment rather than invented.
 */

// ── Tab 3: Screen Access ───────────────────────────────────────────────────

/**
 * The permission levels, in the reference's column order.
 *
 * `none` first because that is the column order on screen and because an
 * unknown value falling back to the *least* access is the safe direction.
 */
export const PERMISSION_LEVELS = [
  { value: 'none',      label: 'No Access' },
  { value: 'view',      label: 'View' },
  { value: 'modify',    label: 'Modify' },
  { value: 'addDelete', label: 'Add/Delete' },
  { value: 'customize', label: 'Customize' },
]

/** What an unset screen reads as. The reference opens with Dashboard on View. */
export const DEFAULT_PERMISSION = 'view'

/**
 * Project > Module > Sub Module > Screen, the reference's four-column
 * drill-down, filled with FleetmaX's actual navigable screens — the main
 * sidebar (Sidebar.jsx) plus the Settings tree (settingsNav.js).
 *
 * Only screens with a real page are listed. The Settings tree also carries
 * Driver, Master, Address-Geofence, Technician and Bulk Action, but those all
 * resolve to the shared ComingSoon placeholder, and a permission row governing
 * a placeholder governs nothing.
 *
 * Screen ids are the route paths: they are already unique, already stable, and
 * already what the router matches on, so a stored permissions map stays
 * readable and survives any amount of relabelling.
 */
export const ACCESS_TREE = {
  id: 'fleetmax',
  label: 'FleetmaX',
  modules: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      subModules: [
        { id: 'dashboard.default', label: 'Default', screens: [
          { id: '/dashboard', label: 'Dashboard' },
        ] },
      ],
    },
    {
      id: 'tracking',
      label: 'Tracking',
      subModules: [
        { id: 'tracking.default', label: 'Default', screens: [
          { id: '/tracking', label: 'Live Map' },
        ] },
      ],
    },
    {
      id: 'reports',
      label: 'Reports',
      subModules: [
        { id: 'reports.default', label: 'Default', screens: [
          { id: '/reports', label: 'Reports' },
        ] },
      ],
    },
    {
      id: 'charts',
      label: 'Charts',
      subModules: [
        { id: 'charts.default', label: 'Default', screens: [
          { id: '/charts', label: 'Charts' },
        ] },
      ],
    },
    {
      id: 'alerts',
      label: 'Alerts',
      subModules: [
        { id: 'alerts.default', label: 'Default', screens: [
          { id: '/notifications', label: 'Notifications' },
          { id: '/announcements', label: 'Announcements' },
        ] },
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      subModules: [
        { id: 'settings.users', label: 'Users', screens: [
          { id: '/settings/reseller',        label: 'GGB (Group Global Admin)' },
          { id: '/settings/group',           label: 'Group' },
          { id: '/settings/company',         label: 'BG (Business Group)' },
          { id: '/settings/branch',          label: 'Branch' },
          { id: '/settings/user',            label: 'User' },
          { id: '/settings/company-subuser', label: 'Company Subuser' },
        ] },
        { id: 'settings.object', label: 'Object', screens: [
          { id: '/settings/vehicle', label: 'Vehicle' },
        ] },
        { id: 'settings.alerts', label: 'Alerts', screens: [
          { id: '/settings/alerts', label: 'Alerts' },
        ] },
      ],
    },
  ],
}

/** Every screen in the tree, flattened — used for counts and bulk reads. */
export function allScreens() {
  return ACCESS_TREE.modules.flatMap(m =>
    m.subModules.flatMap(s => s.screens.map(sc => ({ ...sc, moduleId: m.id, subModuleId: s.id })))
  )
}

/** One screen's level, tolerant of a map written before the screen existed. */
export function permissionFor(permissions, screenId) {
  const v = permissions?.[screenId]
  return PERMISSION_LEVELS.some(p => p.value === v) ? v : DEFAULT_PERMISSION
}

/** How many of a module's screens are above No Access — the module's badge. */
export function grantedCount(permissions, moduleId) {
  return allScreens()
    .filter(s => s.moduleId === moduleId)
    .filter(s => permissionFor(permissions, s.id) !== 'none')
    .length
}

// ── Tab 4: User Setting ────────────────────────────────────────────────────

/**
 * Time zones. The reference's dropdown is the full IANA list; this is the
 * Gulf-and-neighbours slice the client's fleet actually operates in, plus UTC.
 * Add rows here when a deployment needs them — nothing else reads the shape.
 */
export const TIME_ZONES = [
  'UTC+00:00 - UTC',
  'UTC+03:00 - Asia/Riyadh',
  'UTC+03:00 - Asia/Kuwait',
  'UTC+03:30 - Asia/Tehran',
  'UTC+04:00 - Asia/Dubai',
  'UTC+04:00 - Asia/Muscat',
  'UTC+05:00 - Asia/Karachi',
  'UTC+05:30 - Asia/Kolkata',
]

/**
 * The User Setting tab, as a spec. Types map to one renderer each:
 *   select   — <select> over `options`
 *   radio    — inline radio group over `options`
 *   checks   — inline checkbox group over `options`, value is a string[]
 *   checkbox — a single boolean
 */
export const USER_SETTING_FIELDS = [
  { key: 'timeZone',          label: 'Time Zone',          type: 'select', options: TIME_ZONES },
  { key: 'dateFormat',        label: 'Date Format',        type: 'select', options: ['dd-MM-yyyy', 'MM-dd-yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy'] },
  { key: 'timeFormat',        label: 'Time Format',        type: 'select', options: ['12 - Hour', '24 - Hour'] },
  { key: 'weekStartDay',      label: 'Week Start Day',     type: 'select', options: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
  { key: 'startupScreen',     label: 'Set Startup Screen', type: 'select', options: ['Dashboard', 'Live Tracking'] },
  { key: 'tirePressureUnit',  label: 'Tire Pressure Unit', type: 'select', options: ['Psi', 'bar', 'kPa', 'kgf/cm²', 'mmH₂O', 'mmHg'] },

  { key: 'userStatus',        label: 'User Status',             type: 'radio', options: ['Active', 'Inactive'] },
  { key: 'showDefaultFilter', label: 'Show Default Filter Option', type: 'radio', options: ['On', 'Off'] },

  { key: 'vehicleWithPath',       label: 'Vehicle With Path',                        type: 'checkbox' },
  { key: 'restrictChangePassword', label: 'Restrict Change Password',                type: 'checkbox' },
  { key: 'restrictExpenseSubType', label: 'Restrict Expense Sub Type Master Creation', type: 'checkbox' },
  { key: 'forceFirstLoginChange',  label: 'Forcefully First Login Password Change',  type: 'checkbox' },
  { key: 'immobilization',         label: 'Immobilization',                          type: 'checkbox' },
  { key: 'immobilizationParking',  label: 'Immobilization via parking mode',         type: 'checkbox' },
  { key: 'door',                   label: 'Door',                                    type: 'checkbox' },

  { key: 'notification',      label: 'Notification',          type: 'checks', options: ['Web', 'Mobile'] },
  { key: 'webNotifSound',     label: 'Web Notification Sound', type: 'radio', options: ['Recurring', 'On Time'] },
  { key: 'webAccess',         label: 'Web Access',            type: 'radio', options: ['All', 'None', 'Specific'] },
  { key: 'mobileAccess',      label: 'Mobile Access',         type: 'radio', options: ['All', 'None', 'Specific'] },

  { key: 'objectListSettings',    label: 'Object List Settings',    type: 'checkbox' },
  { key: 'objectTooltipSettings', label: 'Object Tooltip Settings', type: 'checkbox' },
  { key: 'allowMessaging',        label: 'Allow Messaging',         type: 'checkbox' },
  { key: 'showSosPopup',          label: 'Show SOS Popup',          type: 'checkbox' },
  { key: 'sosAcknowledgement',    label: 'SOS Acknowledgement',     type: 'checkbox' },
  { key: 'uploadObjectLogo',      label: 'Upload Object Logo',      type: 'checkbox' },

  { key: 'mobileDashboardType', label: 'Mobile Dashboard Type', type: 'select', options: ['Advanced', 'Standard'] },
]

/** Defaults, taken from how the reference form opens. */
export function defaultUserSetting() {
  return {
    timeZone:          'UTC+04:00 - Asia/Dubai',
    dateFormat:        'dd-MM-yyyy',
    timeFormat:        '12 - Hour',
    weekStartDay:      'Sunday',
    startupScreen:     'Dashboard',
    tirePressureUnit:  'Psi',
    userStatus:        'Active',
    showDefaultFilter: 'On',

    vehicleWithPath:        false,
    restrictChangePassword: false,
    restrictExpenseSubType: false,
    forceFirstLoginChange:  false,
    immobilization:         true,
    immobilizationParking:  false,
    door:                   false,

    notification:   ['Web', 'Mobile'],
    webNotifSound:  'Recurring',
    webAccess:      'All',
    mobileAccess:   'All',

    objectListSettings:    true,
    objectTooltipSettings: true,
    allowMessaging:        false,
    showSosPopup:          false,
    sosAcknowledgement:    false,
    uploadObjectLogo:      true,

    mobileDashboardType: 'Advanced',
  }
}

// ── Tab 5: Authentication ──────────────────────────────────────────────────

export const AUTH_REQUIRED_OPTIONS = ['User Login', 'Announcement', 'Delete Action']

/**
 * Which entities need step-up auth to delete. Only meaningful once
 * `Delete Action` is one of the AUTH_REQUIRED_OPTIONS, which is why the form
 * reveals it rather than showing it permanently greyed.
 */
export const DELETE_AUTH_OPTIONS = [
  'All', 'Vehicle', 'Alert', 'Driver', 'Reminder Rule',
  'Expense', 'Address', 'Geofence', 'Company Subuser',
]
