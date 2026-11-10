import { Link, useLocation } from 'react-router-dom'
import { FileText, Fuel } from 'lucide-react'
import { REPORTS_HUB_PATH, OIL_GAS_HUB_PATH, hubForReport } from './reportsNav'

/**
 * The sidebar's Reports entry: one link to the "Run a Report" hub.
 *
 * Client, 2026-11-02: reports are picked from the hub's category cards, not
 * from a long nested list here, so this is a plain row. It stays highlighted
 * on every report page so the sidebar still shows where you are — unless the
 * report belongs to Oil & Gas (OilGasMenu below), which then lights instead.
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

/** On the Oil & Gas hub, or on a report opened from it. */
function inOilGas(pathname, state) {
  return pathname === OIL_GAS_HUB_PATH
    || (pathname.startsWith(`${REPORTS_HUB_PATH}/`) && hubForReport(pathname, state) === OIL_GAS_HUB_PATH)
}

export default function ReportsMenu() {
  const { pathname, state } = useLocation()
  const onReports = pathname === REPORTS_HUB_PATH || pathname.startsWith(`${REPORTS_HUB_PATH}/`)
  const active = onReports && !inOilGas(pathname, state)
  return <HubLink to={REPORTS_HUB_PATH} icon={FileText} label="Reports" active={active} current={pathname === REPORTS_HUB_PATH} />
}

/** Client, 2026-11-10: the Oil & Gas reports have their own menu entry. */
export function OilGasMenu() {
  const { pathname, state } = useLocation()
  return <HubLink to={OIL_GAS_HUB_PATH} icon={Fuel} label="Oil & Gas" active={inOilGas(pathname, state)} current={pathname === OIL_GAS_HUB_PATH} />
}
