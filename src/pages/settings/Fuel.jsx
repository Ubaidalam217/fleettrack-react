import SettingsLayout from './SettingsLayout'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import { IS_REAL } from '../../data/mode'
import { CARD_SURFACE } from './formStyles'
import UffizioCard from './UffizioCard'

/**
 * Settings › Master › Fuel (client, 2026-11-24): the fuel vehicles' feed from
 * Uffizio, and (next) each vehicle's fuel calibration.
 */
export default function Fuel(props) {
  const { toasts, push, dismiss } = useToasts()
  return (
    <SettingsLayout title="Fuel" subtitle="Fuel sensors: where the readings come from, and how each vehicle’s reading turns into litres." {...props}>
      {!IS_REAL ? (
        <div style={{ ...CARD_SURFACE, padding: 24, marginTop: 16, fontSize: 13, color: 'var(--c-text2)' }}>
          Fuel readings are kept on the server, so this page needs the server and is not available in demo mode.
        </div>
      ) : (
        <UffizioCard push={push} />
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
