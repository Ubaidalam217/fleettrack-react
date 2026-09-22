import { useLocation } from 'react-router-dom'
import SettingsLayout from './SettingsLayout'
import { labelForPath } from '../../components/sidebar/settingsNav'

/**
 * Shared stand-in for the Settings branches that have no page yet — Driver,
 * Master, Address - Geofence, Technician, Bulk Action.
 *
 * Each of them keeps its own route rather than sharing one /settings/soon URL,
 * so the sidebar can highlight exactly the row you clicked; the title is read
 * back out of the menu config instead of being passed in, which keeps the
 * route table free of labels that would then exist in two places.
 */
export default function ComingSoon(props) {
  const { pathname } = useLocation()
  const label = labelForPath(pathname)

  return (
    <SettingsLayout title={label || 'Settings'} {...props}>
      <p style={{ fontSize: 14, color: 'var(--c-text3)', margin: '10px 0 0' }}>
        Coming soon.
      </p>
    </SettingsLayout>
  )
}
