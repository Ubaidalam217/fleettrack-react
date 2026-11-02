import { Link, Navigate, useLocation } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import PageShell from './PageShell'
import { useSession } from '../data/session'
import { screenForPath, sessionLevel, firstOpenPath } from '../data/screens'

/**
 * Closes a screen the signed-in user has "No Access" to (data/screens.js).
 * Wraps every signed-in route, so a typed URL or an old bookmark lands on a
 * clear message instead of the page. The menus hide these screens too; this is
 * the second line. The server refuses the writes regardless.
 */
export default function ScreenGate({ children }) {
  const { pathname } = useLocation()
  const { user } = useSession()
  const screen = screenForPath(pathname)
  if (!screen || sessionLevel(user, screen) !== 'none') return children

  const home = firstOpenPath(user)
  // Sign-in lands on the dashboard; a user without it goes to their first open screen.
  if (pathname === '/dashboard' && home !== pathname) return <Navigate to={home} replace />
  return (
    <PageShell title="No access" {...(children?.props ?? {})}>
      <div style={{
        marginTop: 18, maxWidth: 520, padding: '22px 22px', borderRadius: 14,
        border: '1px solid var(--c-border)', background: 'var(--c-card)',
        display: 'flex', gap: 14, alignItems: 'flex-start',
      }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <ShieldOff size={20} />
        </div>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--c-text1)' }}>You don’t have access to this page</div>
          <p style={{ fontSize: 12.5, color: 'var(--c-text3)', margin: '6px 0 12px', lineHeight: 1.5 }}>
            Your administrator has not given your account permission for it. Ask them if you need it.
          </p>
          {home !== pathname && (
            <Link to={home} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ft-accent)', textDecoration: 'none' }}>
              Go to a page you can open →
            </Link>
          )}
        </div>
      </div>
    </PageShell>
  )
}
