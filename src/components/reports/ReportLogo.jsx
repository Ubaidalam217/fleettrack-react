import { ImageIcon } from 'lucide-react'
import { useReportLogo, logoLabel, logoId, NO_LOGO } from '../../utils/reportLogo'

/**
 * The account's logo for the left of a paper header (utils/reportLogo.js), or
 * nothing: a Super Admin, an account with no logo above it, or Logo: None.
 */
export function AccountLogo({ height = 30, maxWidth = 150, style }) {
  const { choice } = useReportLogo()
  if (!choice) return null
  return (
    <img
      src={choice.url}
      alt={choice.name}
      style={{ height, width: 'auto', maxWidth, objectFit: 'contain', objectPosition: 'left center', flexShrink: 0, ...style }}
    />
  )
}

/**
 * The report's "Logo" option: which logo of the account's chain heads the
 * report, or None. Screen only, above the sheet, and only when the account has
 * a logo to choose — a Super Admin never sees it.
 */
export function ReportLogoPicker() {
  const { logos, pick, setPick } = useReportLogo()
  if (!logos.length) return null
  return (
    <div className="report-screen-only" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <label
        title="The logo at the left of this report's header"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: '100%',
          padding: '0 4px 0 12px', height: 34, borderRadius: 8,
          border: '1px solid var(--c-border2)', background: 'var(--c-card)',
          color: 'var(--c-text1)', fontSize: 12.5, fontWeight: 600,
        }}
      >
        <ImageIcon size={14} style={{ flexShrink: 0 }} />
        Logo
        <select
          value={pick}
          onChange={e => setPick(e.target.value)}
          style={{
            minWidth: 0, maxWidth: 260, height: 28, padding: '0 6px', borderRadius: 6,
            border: 0, background: 'var(--c-input)', color: 'var(--c-text1)',
            fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer', textOverflow: 'ellipsis',
          }}
        >
          {logos.map(l => <option key={logoId(l)} value={logoId(l)}>{logoLabel(l)}</option>)}
          <option value={NO_LOGO}>None</option>
        </select>
      </label>
    </div>
  )
}
