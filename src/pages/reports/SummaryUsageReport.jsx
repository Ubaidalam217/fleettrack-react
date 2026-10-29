import DaywisePage from './DaywisePage'

/**
 * /reports/daywise-distance — the "Daywise Distance Report" (renamed by the
 * client from "Summary Usage Report"; the old path redirects here).
 */
export default function SummaryUsageReport(props) {
  return <DaywisePage variant="distance" {...props} />
}
