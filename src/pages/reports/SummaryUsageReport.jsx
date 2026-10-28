import DaywisePage from './DaywisePage'

/**
 * /reports/usage-summary — the client's "Daywise Distance" sheet.
 *
 * Named for the menu entry it sits on (Summary Usage Report) while the page
 * titles itself Daywise Distance, which is what the reference calls it.
 */
export default function SummaryUsageReport(props) {
  return <DaywisePage variant="distance" {...props} />
}
