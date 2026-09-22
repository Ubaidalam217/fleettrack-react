import {
  Layers, Users, Car, Bell, IdCard,
  Database, MapPinned, Wrench, ListChecks,
} from 'lucide-react'

/**
 * The Settings navigation tree (Phase 1 — shell only).
 *
 * Shape mirrors the AI Revofleet menu. A node is a *branch* when it has
 * `children` and a *leaf* when it has a `path`; nothing has both, which is what
 * lets the renderer stay a single recursive function.
 *
 * Only five leaves have real pages this phase — Company, Company Subuser,
 * Branch, Vehicle, Alerts. The rest keep their own distinct path (so the
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
        children: [
          { id: 'user',            label: 'User',            path: '/settings/user' },
          { id: 'company',         label: 'Company',         path: '/settings/company' },
          { id: 'company-subuser', label: 'Company Subuser', path: '/settings/company-subuser' },
          { id: 'branch',          label: 'Branch',          path: '/settings/branch' },
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
 * Ids of every branch on the way down to `pathname`, including the root.
 * Used to auto-open the tree so a deep link lands with its parents expanded.
 * Returns an empty array when the path is not in the tree.
 */
export function ancestorIds(pathname) {
  const walk = (nodes, trail) => {
    for (const node of nodes) {
      if (node.path === pathname) return trail
      if (node.children) {
        const hit = walk(node.children, [...trail, node.id])
        if (hit) return hit
      }
    }
    return null
  }
  return walk(SETTINGS_MENU, [SETTINGS_ROOT_ID]) || []
}

/** Human label for a settings path — lets ComingSoon title itself. */
export function labelForPath(pathname) {
  const walk = nodes => {
    for (const node of nodes) {
      if (node.path === pathname) return node.label
      if (node.children) {
        const hit = walk(node.children)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(SETTINGS_MENU)
}
