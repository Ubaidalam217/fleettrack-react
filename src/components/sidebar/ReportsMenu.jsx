import { Link, useLocation } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { REPORTS_HUB_PATH } from './reportsNav'

/**
 * The sidebar's Reports entry: one link to the "Run a Report" hub.
 *
 * Client, 2026-11-02: reports are picked from the hub's category cards, not
 * from a long nested list here, so this is a plain row. It stays highlighted
 * on every report page, the Oil & Gas tab's included (client, 2026-11-10:
 * Oil & Gas sits inside Reports beside Favourites), so the sidebar still shows
 * where you are.
 */
function HubLink({ to, icon: Icon, label, active, current }) {
  return (
    <Link
      to={to}
      className="ft-sb-item"
      data-active={active ? 'true' : 'false'}
      aria-current={current ? 'page' : undefined}
    >
      <Icon size={16} strokeWidth={active ? 2.3 : 1.9} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </Link>
  )
}

export default function ReportsMenu() {
  const { pathname } = useLocation()
  const active = pathname === REPORTS_HUB_PATH || pathname.startsWith(`${REPORTS_HUB_PATH}/`)
  return <HubLink to={REPORTS_HUB_PATH} icon={FileText} label="Reports" active={active} current={pathname === REPORTS_HUB_PATH} />
}
