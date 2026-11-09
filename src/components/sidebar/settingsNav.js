import {
  Layers, Users, Car, Bell, IdCard,
  Database, MapPinned, ListChecks, Receipt, BellRing,
} from 'lucide-react'
import { filterMenu, ancestorIdsIn, labelForPathIn } from './navTree'

/**
 * The Settings navigation tree (Phase 1 — shell only).
 *
 * Shape mirrors the AI Revofleet menu. A node is a *branch* when it has
 * `children` and a *leaf* when it has a `path`; nothing has both, which is what
 * lets the renderer stay a single recursive function.
 *
 * Eight leaves have real pages — GGB, Group, BG, Branch, User, Company
 * Subuser, Vehicle, Alerts. The rest keep their own distinct path (so the
 * sidebar can still highlight exactly one row) but all resolve to the shared
 * ComingSoon placeholder in App.jsx. When a real page lands, only the route
 * changes; this file does not.
 */
export const SETTINGS_MENU = [
  {
    id: 'general',
    label: 'General',
    icon: Layers,
    children: [
      // Client, 2026-11-02: one row, not a nested list. GGB / Group / BG /
      // Branch are tabs across the top of those pages (pages/settings/OrgTabs.jsx).
      // `path` is rewritten per user to the first of them they may open
      // (SettingsMenu.jsx); `matchPaths` keeps this row lit on all of them, and on
      // the two account pages that are reached from their Users panels.
      {
        id: 'users',
        label: 'Users',
        icon: Users,
        path: '/settings/reseller',
        matchPaths: [
          '/settings/reseller', '/settings/group', '/settings/company', '/settings/branch',
          '/settings/user', '/settings/company-subuser',
        ],
      },
      // One row as well (client, 2026-11-02): Object has a single page, Vehicle.
      // The id stays 'vehicle' so role and permission checks still find it.
      { id: 'vehicle', label: 'Object', icon: Car, path: '/settings/vehicle' },
      { id: 'alerts', label: 'Alerts', icon: Bell,   path: '/settings/alerts' },
      { id: 'driver', label: 'Driver', icon: IdCard, path: '/settings/driver' },
    ],
  },
  // Master, as in the reference (Settings › Master). Expense is its first page
  // (client, 2026-11-09); the reference's others are not built yet.
  {
    id: 'master',
    label: 'Master',
    icon: Database,
    children: [
      { id: 'reminder-rule', label: 'Reminder Rule', icon: BellRing, path: '/settings/reminder-rule' },
      { id: 'expense', label: 'Expense', icon: Receipt, path: '/settings/expense' },
    ],
  },
  { id: 'geofence',   label: 'Address - Geofence', icon: MapPinned,  path: '/settings/geofence' },
  { id: 'bulk',       label: 'Bulk Action',        icon: ListChecks, path: '/settings/bulk-action' },
]

/** Id of the root row, so callers can expand/collapse the whole tree. */
export const SETTINGS_ROOT_ID = 'settings'

/**
 * The tree with the leaves this role cannot use pruned out.
 *
 * `canSee(leafId)` is data/permissions.js canSeePage. This file stays free of any
 * knowledge of roles: it owns the shape of the tree, and the caller owns who may
 * see what. In mock mode canSee answers true for everything and the tree comes
 * back untouched.
 *
 * The three walks below are the generic ones from navTree.js, bound to this tree.
 * Kept as named exports with their original signatures so every existing caller
 * — SettingsMenu, ComingSoon — is untouched by the extraction.
 */
export const filterSettingsMenu = filterMenu

/**
 * Leaves kept in the tree but not shown in the sidebar.
 *
 * Client, 2026-11-02: User and Company Subuser are no longer needed in the
 * menu — BG users are managed from each BG's "Users" panel, and sub-users from
 * the BG and Branch panels, which open the Company Subuser form. The pages and
 * routes stay (that form is still used, and old links keep working), and so do
 * the tree entries, so a deep link still expands Users and titles itself.
 * Remove an id here to bring its row back.
 */
export const HIDDEN_SETTINGS_PAGES = new Set(['user', 'company-subuser'])

export const ancestorIds = pathname => ancestorIdsIn(SETTINGS_MENU, SETTINGS_ROOT_ID, pathname)

/** Human label for a settings path — lets ComingSoon title itself. */
export const labelForPath = pathname => labelForPathIn(SETTINGS_MENU, pathname)
