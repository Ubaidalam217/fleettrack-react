import { useLocation } from 'react-router-dom'

/**
 * The title a report shows, prints and exports under: the name the menu that
 * opened it gave it, else its own. The Oil & Gas menu (client, 2026-11-10)
 * opens existing reports under the client's names — the GYR Report as "Road
 * Safety RAG Report" — and passes that name in the link's state.
 */
export function useReportTitle(own) {
  const { state } = useLocation()
  return withReport(typeof state?.title === 'string' && state.title ? state.title : own)
}

/**
 * Every report heading ends in "Report" (client, 2026-11-12: "Trip Details
 * Report"), whichever menu opened it.
 */
export const withReport = title => (/report$/i.test(title.trim()) ? title : `${title} Report`)

/** "Road Safety RAG Report" → "Road_Safety_RAG_Report", for export file names. */
export const fileNameOf = title => title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
