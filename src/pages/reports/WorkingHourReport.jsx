import DaywisePage from './DaywisePage'

/**
 * /reports/working-hour — the client's "Daywise Work Hour" sheet.
 *
 * The whole page is DaywisePage; this file exists so the route table names the
 * report rather than a variant string, and so a future Working Hour variant
 * (shift windows, per-driver) has somewhere to diverge.
 */
export default function WorkingHourReport(props) {
  return <DaywisePage variant="workHour" {...props} />
}
