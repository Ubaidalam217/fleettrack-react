import { useLocation } from 'react-router-dom'
import PageShell from '../../components/PageShell'
import { labelForPath } from '../../components/sidebar/reportsNav'

/**
 * Shared stand-in for the eleven reports that have no page yet.
 *
 * Each keeps its own route rather than sharing one /reports/soon URL, so the
 * sidebar highlights exactly the row you clicked; the title is read back out of
 * reportsNav instead of being passed in, which keeps the route table free of
 * labels that would then exist in two places. Same arrangement as the Settings
 * ComingSoon placeholder.
 *
 * When a real report lands it replaces this component in App.jsx's route table
 * and nothing else moves. See reportsNav.js for the scoping rule every report
 * has to honour (vehicles from GET /api/me/vehicles, never a wider list).
 */
export default function ReportPlaceholder(props) {
  const { pathname } = useLocation()
  const label = labelForPath(pathname)

  return (
    <PageShell title={label || 'Report'} {...props}>
      <p style={{ fontSize: 14, color: 'var(--c-text3)', margin: '12px 0 0' }}>
        Report structure coming soon.
      </p>
    </PageShell>
  )
}
