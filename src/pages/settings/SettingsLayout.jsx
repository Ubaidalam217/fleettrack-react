import PageShell from '../../components/PageShell'

/**
 * Page chrome for every Settings leaf.
 *
 * The chrome itself moved to components/PageShell.jsx when the Reports
 * placeholders needed the same shell. This stays as the name the nine Settings
 * pages already import, so the move cost them nothing.
 */
export default function SettingsLayout(props) {
  return <PageShell {...props} />
}
