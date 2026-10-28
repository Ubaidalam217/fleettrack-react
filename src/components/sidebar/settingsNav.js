import {
  Layers, Users, Car, Bell, IdCard,
  Database, MapPinned, Wrench, ListChecks,
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
      {
        id: 'users',
        label: 'Users',
        icon: Users,
        // Ordered top-down through the org hierarchy — GGB > Group > BG >
        // Branch > the accounts that sit under a BG — so the menu reads the
        // same way the data nests.
        //
        // The ids and paths are the pre-rename names on purpose: they are what
        // the router, the sidebar highlight and every existing bookmark match
        // on, and none of them is ever shown to a user. Only `label` is.
        children: [
          { id: 'reseller',        label: 'GGB (Group Global Admin)', path: '/settings/reseller' },
          { id: 'group',           label: 'Group',                    path: '/settings/group' },
          { id: 'company',         label: 'BG (Business Group)',      path: '/settings/company' },
          { id: 'branch',          label: 'Branch',                   path: '/settings/branch' },
          { id: 'user',            label: 'User',                     path: '/settings/user' },
          { id: 'company-subuser', label: 'Company Subuser',          path: '/settings/company-subuser' },
        ],
      },
      {
        id: 'object',
        label: 'Object',
        icon: Car,
        children: [
          { id: 'vehicle', label: 'Vehicle', path: '/settings/vehicle' },
        ],
      },
      { id: 'alerts', label: 'Alerts', icon: Bell,   path: '/settings/alerts' },
      { id: 'driver', label: 'Driver', icon: IdCard, path: '/settings/driver' },
    ],
  },
  { id: 'master',     label: 'Master',             icon: Database,   path: '/settings/master' },
  { id: 'geofence',   label: 'Address - Geofence', icon: MapPinned,  path: '/settings/geofence' },
  { id: 'technician', label: 'Technician',         icon: Wrench,     path: '/settings/technician' },
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

export const ancestorIds = pathname => ancestorIdsIn(SETTINGS_MENU, SETTINGS_ROOT_ID, pathname)

/** Human label for a settings path — lets ComingSoon title itself. */
export const labelForPath = pathname => labelForPathIn(SETTINGS_MENU, pathname)
