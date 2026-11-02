import { Link, useLocation } from 'react-router-dom'
import { SECONDARY_BTN } from './formStyles'
import { useSession } from '../../data/session'
import { IS_REAL } from '../../data/mode'
import { canSeePage } from '../../data/permissions'
import { screenForPath, sessionLevel } from '../../data/screens'

/**
 * GGB · Group · BG · Branch as tabs across the top of those four pages — the
 * same buttons the Address - Geofence page uses for All / Geofences / Addresses.
 *
 * Client, 2026-11-02: the four used to be a nested list under "Users" in the
 * sidebar, which ran the menu long; now the sidebar has one "Users" row
 * (settingsNav.js) and the choice lives here.
 */

export const ORG_PAGES = [
  { id: 'reseller', label: 'GGB',    path: '/settings/reseller' },
  { id: 'group',    label: 'Group',  path: '/settings/group' },
  { id: 'company',  label: 'BG',     path: '/settings/company' },
  { id: 'branch',   label: 'Branch', path: '/settings/branch' },
]

/** The org pages this user may open: role first, then their own permissions. */
export function visibleOrgPages(user) {
  const roleKey = IS_REAL ? (user?.role ?? null) : null
  return ORG_PAGES.filter(p => canSeePage(roleKey, p.id) && sessionLevel(user, screenForPath(p.path)) !== 'none')
}

/** The Object pages — one today; a second object type joins this list. */
export const OBJECT_PAGES = [
  { id: 'vehicle', label: 'Vehicle', path: '/settings/vehicle' },
]

/** Tabs for the Object pages (Settings > Object), in the same style. */
export function ObjectTabs() {
  return <PageTabs pages={OBJECT_PAGES} label="Objects" />
}

export default function OrgTabs() {
  const { user } = useSession()
  const pages = visibleOrgPages(user)
  if (pages.length < 2) return null
  return <PageTabs pages={pages} label="Organisation" />
}

function PageTabs({ pages, label }) {
  const { pathname } = useLocation()

  return (
    <nav aria-label={label} style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
      {pages.map(p => {
        const on = pathname === p.path
        return (
          <Link
            key={p.id}
            to={p.path}
            aria-current={on ? 'page' : undefined}
            style={{
              ...SECONDARY_BTN,
              ...(on ? { background: 'var(--ft-accent)', color: '#fff', border: '1px solid var(--ft-accent)' } : {}),
              padding: '7px 14px',
              textDecoration: 'none',
            }}
          >
            {p.label}
          </Link>
        )
      })}
    </nav>
  )
}
