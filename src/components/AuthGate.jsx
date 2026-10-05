import { Navigate, useLocation } from 'react-router-dom'
import { IS_REAL } from '../data/mode'
import { PHASE, useSession } from '../data/session'
import ChangePassword from '../pages/ChangePassword'

/**
 * Decides whether a protected route may render.
 *
 * Wraps every route except /login. Four outcomes:
 *
 *   mock mode            → render, always. The demo has never had route guards and
 *                          adding them would change its behaviour.
 *   session restoring    → a neutral splash. Rendering the app first and bouncing a
 *                          moment later is the flash-of-dashboard that makes a
 *                          refresh look broken.
 *   signed out           → /login, remembering where they were headed.
 *   first login pending  → the change-password screen, over the top of everything.
 *
 * Deliberately a wrapper rather than per-route logic: a route added later is
 * protected by default, which is the direction the mistake should point.
 */
export default function AuthGate({ children }) {
  const session = useSession()
  const location = useLocation()

  if (!IS_REAL) return children

  if (session.phase === PHASE.LOADING) return <Splash />

  if (session.phase === PHASE.ANON) {
    // `state.from` lets the login screen send them back where they were trying to
    // go, instead of always dumping them on the dashboard.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  /**
   * The gate. Rendered INSTEAD of the route, not as a modal over it: the account
   * cannot read any data yet (every endpoint answers 428), so the page behind it
   * would be a shell of empty tables and failed requests.
   */
  if (session.phase === PHASE.MUST_CHANGE_PASSWORD) return <ChangePassword />

  return children
}

/**
 * Shown for the one round trip it takes to validate a stored token.
 *
 * Intentionally almost empty — a spinner and the wordmark. A skeleton of the
 * dashboard would be a promise the session might not keep.
 */
function Splash() {
  return (
    <>
      <style>{`@keyframes gs { to { transform: rotate(360deg) } }`}</style>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 18, width: '100%', minHeight: '100vh', backgroundColor: 'var(--c-page)',
      }}>
        <img src="/logo/fleetmax-logo.png" alt="FleetmaX" style={{ height: 34, width: 'auto', opacity: 0.9 }} />
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          border: '2.5px solid var(--c-border2)',
          borderTopColor: 'var(--ft-accent)',
          animation: 'gs 0.75s linear infinite',
        }} />
      </div>
    </>
  )
}
