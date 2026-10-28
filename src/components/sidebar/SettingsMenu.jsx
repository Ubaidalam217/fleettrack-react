import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Settings } from 'lucide-react'
// Named settingsNav, not settingsMenu: this folder is on a case-insensitive
// filesystem, and "./SettingsMenu" resolved to the config instead of the
// component when the two names differed only by case.
import { SETTINGS_MENU, SETTINGS_ROOT_ID, ancestorIds, filterSettingsMenu } from './settingsNav'
import TreeMenu from './TreeMenu'
import { IS_REAL } from '../../data/mode'
import { useSession } from '../../data/session'
import { canSeePage } from '../../data/permissions'

const EXPAND_KEY = 'ft-settings-menu'

// ── Settings tree ──────────────────────────────────────────────────────────
/**
 * The sidebar's Settings entry and its nested menu.
 *
 * All the rendering, expand/collapse and persistence lives in TreeMenu, which
 * Reports uses too. What is specific to Settings and stays here: the permission
 * filter, which no other section has.
 */
export default function SettingsMenu() {
  const { pathname } = useLocation()
  const session = useSession()

  /**
   * The tree this role actually gets.
   *
   * useMemo on the role rather than on the session object: the session store
   * notifies on every change (a token refresh, a phase move), and rebuilding the
   * tree for those would discard nothing but waste a walk on every navigation.
   */
  const menu = useMemo(() => {
    const roleKey = IS_REAL ? (session.user?.role ?? null) : null
    return filterSettingsMenu(SETTINGS_MENU, id => canSeePage(roleKey, id))
  }, [session.user?.role])

  return (
    <TreeMenu
      rootId={SETTINGS_ROOT_ID}
      rootLabel="Settings"
      rootIcon={Settings}
      nodes={menu}
      storageKey={EXPAND_KEY}
      pathname={pathname}
      // The legacy /settings page is still routed; treat it as part of the section.
      inSection={pathname === '/settings' || pathname.startsWith('/settings/')}
      trail={ancestorIds(pathname)}
    />
  )
}
