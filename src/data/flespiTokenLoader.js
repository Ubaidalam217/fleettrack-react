/**
 * Keeps a per-user Flespi token present for as long as a real session is ready.
 *
 * Its own file rather than living in flespiToken.js for the reason FormKit.jsx and
 * formStyles.js are split: flespiToken.js is imported by hooks/flespiConfig.js,
 * which is imported by seven non-React modules (utils/replay.js, utils/usageData.js,
 * services/deviceCommands.js…). Putting a React hook in there would drag React into
 * all of them.
 */

import { useEffect } from 'react'
import { IS_REAL } from './mode.js'
import { PHASE, useSession } from './session.js'
import { clearLocal, ensureToken } from './flespiToken.js'

export function useFlespiTokenLoader() {
  const session = useSession()
  const ready = session.phase === PHASE.READY
  const userId = session.user?.id ?? null

  useEffect(() => {
    if (!IS_REAL) return
    if (!ready) {
      // Not signed in, or sitting behind the change-password gate. Clearing means
      // a token never outlives the session that justified it, and the gate case
      // matters specifically: /api/flespi/token answers 428 there anyway.
      clearLocal()
      return
    }
    // Keyed on the user id too, so switching accounts in one page life mints a
    // token for the new account rather than reusing the old one's.
    ensureToken().catch(() => {
      // Already recorded on the store as `error`; the Live Map shows an empty
      // state. Nothing useful to do here.
    })
  }, [ready, userId])
}
