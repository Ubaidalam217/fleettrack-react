import { useLocation } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { REPORTS_MENU, REPORTS_ROOT_ID, ancestorIds } from './reportsNav'
import TreeMenu from './TreeMenu'

const EXPAND_KEY = 'ft-reports-menu'

/**
 * The sidebar's Reports entry and its nested menu.
 *
 * Same renderer as Settings (TreeMenu), different data. No permission filter:
 * every role may open every report — what differs per role is the vehicles a
 * report covers, which is enforced by scope rather than by the menu. See the
 * TODO at the top of reportsNav.js.
 */
export default function ReportsMenu() {
  const { pathname } = useLocation()

  return (
    <TreeMenu
      rootId={REPORTS_ROOT_ID}
      rootLabel="Reports"
      rootIcon={FileText}
      nodes={REPORTS_MENU}
      storageKey={EXPAND_KEY}
      pathname={pathname}
      // Bare /reports redirects into the tree, so it counts as inside the
      // section for the one render that happens before the redirect lands.
      inSection={pathname === '/reports' || pathname.startsWith('/reports/')}
      trail={ancestorIds(pathname)}
    />
  )
}
