import { Link, useLocation } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { REPORTS_HUB_PATH } from './reportsNav'

/**
 * The sidebar's Reports entry: one link to the "Run a Report" hub.
 *
 * Client, 2026-11-02: reports are picked from the hub's category cards, not
 * from a long nested list here, so this is a plain row. It stays highlighted
 * on every report page so the sidebar still shows where you are.
 */
export default function ReportsMenu() {
  const { pathname } = useLocation()
  const active = pathname === REPORTS_HUB_PATH || pathname.startsWith(`${REPORTS_HUB_PATH}/`)

  return (
    <Link
      to={REPORTS_HUB_PATH}
      className="ft-sb-item"
      data-active={active ? 'true' : 'false'}
      aria-current={pathname === REPORTS_HUB_PATH ? 'page' : undefined}
    >
      <FileText size={16} strokeWidth={active ? 2.3 : 1.9} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Reports
      </span>
    </Link>
  )
}
