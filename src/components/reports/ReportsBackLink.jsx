import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { REPORTS_HUB_PATH } from '../sidebar/reportsNav'

/** "All reports" — the way back to the Run a Report hub from any report page. */
export default function ReportsBackLink() {
  return (
    <Link
      to={REPORTS_HUB_PATH}
      className="report-screen-only"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, marginBottom: 6,
        fontSize: 12, fontWeight: 600, color: 'var(--ft-accent)', textDecoration: 'none',
      }}
    >
      <ChevronLeft size={14} strokeWidth={2.4} />
      All reports
    </Link>
  )
}
