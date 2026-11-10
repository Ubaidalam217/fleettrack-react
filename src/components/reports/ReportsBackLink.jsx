import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { OIL_GAS_HUB_PATH, hubForReport } from '../sidebar/reportsNav'

/**
 * "All reports" — the way back to the hub the report was opened from: Run a
 * Report, or Oil & Gas for its reports.
 */
export default function ReportsBackLink() {
  const { pathname, state } = useLocation()
  const hub = hubForReport(pathname, state)
  return (
    <Link
      to={hub}
      className="report-screen-only"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, marginBottom: 6,
        fontSize: 12, fontWeight: 600, color: 'var(--ft-accent)', textDecoration: 'none',
      }}
    >
      <ChevronLeft size={14} strokeWidth={2.4} />
      {hub === OIL_GAS_HUB_PATH ? 'Oil & Gas reports' : 'All reports'}
    </Link>
  )
}
