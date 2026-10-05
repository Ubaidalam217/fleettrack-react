import { useState } from 'react'
import { changePassword, useSession } from '../data/session'
import { errorMessage } from '../data/http'

/**
 * The first-login gate.
 *
 * Shown instead of the app whenever the signed-in account is still on the password
 * it was handed — either because the login response said so, or because any
 * request came back 428 PASSWORD_CHANGE_REQUIRED (see data/http.js). The server
 * enforces this independently: while the flag is set, every endpoint except
 * /api/auth/* answers 428, so this screen is the only way forward rather than a
 * suggestion.
 *
 * Styled to match Login.jsx deliberately — this is the same moment in the same
 * flow, and a differently-shaped card here reads as a different application.
 */
export default function ChangePassword() {
  const session = useSession()

  const [current, setCurrent]   = useState('')
  const [next,    setNext]      = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPw,  setShowPw]    = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error,   setError]     = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  const submit = async e => {
    e.preventDefault()
    setError('')
    setFieldErrors({})

    // Checked here rather than server-side because the server never sees the
    // confirmation field — a mistyped repeat is a local mistake, and sending it
    // would mean storing a second copy of a credential to compare against.
    if (next !== confirm) {
      setFieldErrors({ confirm: 'The two passwords do not match' })
      return
    }

    setLoading(true)
    try {
      await changePassword(current, next)
      // No navigate: clearing the flag moves the session to READY and AuthGate
      // swaps this screen out for whatever route the user was already on.
    } catch (err) {
      setFieldErrors(err?.details ?? {})
      setError(errorMessage(err, 'Could not change the password.'))
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes ls { to { transform: rotate(360deg) } }
        @keyframes shake {
          0%,100% { transform: translateX(0) }
          20%,60%  { transform: translateX(-6px) }
          40%,80%  { transform: translateX(6px) }
        }
        .cp-btn { transition: background .2s, transform .15s, box-shadow .2s; }
        .cp-btn:hover:not(:disabled) {
          background: var(--ft-accent-hover) !important;
          transform: translateY(-1px) scale(1.02);
        }
      `}</style>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', minHeight: '100vh',
        backgroundColor: 'var(--c-page)', padding: 24, boxSizing: 'border-box',
      }}>
        <div style={{
          width: '100%', maxWidth: 440,
          backgroundColor: 'var(--c-card)',
          borderRadius: 22,
          padding: 'clamp(24px, 5vw, 40px) clamp(20px, 6vw, 38px)',
          border: '1px solid var(--c-border2)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.09)',
        }}>
          <div style={{ marginBottom: 28 }}>
            <img
              src="/logo/fleetmax-logo.png"
              alt="FleetmaX Solutions"
              style={{ height: 38, width: 'auto', display: 'block', marginBottom: 22 }}
            />
            <h2 style={{ fontSize: 23, fontWeight: 800, color: 'var(--c-text1)', letterSpacing: '-0.025em', marginBottom: 8 }}>
              Choose a new password
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--c-text2)', lineHeight: 1.55 }}>
              This account is still using the password it was given. Set your own to
              continue.
            </p>
            {session.user?.email && (
              <div style={{
                marginTop: 14, padding: '8px 11px', borderRadius: 9,
                background: 'var(--c-input)', border: '1px solid var(--c-border2)',
                fontSize: 12.5, color: 'var(--c-text2)',
              }}>
                Signed in as <strong style={{ color: 'var(--c-text1)' }}>{session.user.email}</strong>
              </div>
            )}
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
            <PwField
              id="cp-current" label="Current password" value={current}
              onChange={setCurrent} show={showPw} error={fieldErrors.currentPassword}
              autoComplete="current-password"
            />
            <PwField
              id="cp-next" label="New password" value={next}
              onChange={setNext} show={showPw} error={fieldErrors.newPassword}
              hint="At least 8 characters." autoComplete="new-password"
            />
            <PwField
              id="cp-confirm" label="Repeat new password" value={confirm}
              onChange={setConfirm} show={showPw} error={fieldErrors.confirm}
              autoComplete="new-password"
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--c-text2)', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showPw}
                onChange={e => setShowPw(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--ft-accent)', cursor: 'pointer' }}
              />
              Show passwords
            </label>

            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '11px 14px', borderRadius: 11,
                backgroundColor: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.22)',
                animation: 'shake 0.4s ease',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 500 }}>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="cp-btn"
              disabled={loading}
              style={{
                width: '100%', padding: '13px 20px', marginTop: 2,
                borderRadius: 11, border: 'none',
                background: 'var(--ft-accent)', color: '#fff',
                fontSize: 15, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.85 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                boxShadow: '0 4px 18px color-mix(in srgb, var(--ft-accent) 32%, transparent)',
              }}
            >
              {loading ? (
                <>
                  <div style={{ width: 18, height: 18, border: '2.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'ls 0.75s linear infinite', flexShrink: 0 }} />
                  Saving…
                </>
              ) : 'Set password and continue'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}

function PwField({ id, label, value, onChange, show, error, hint, autoComplete }) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--c-text1)', marginBottom: 7 }}>
        {label}
      </label>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        required
        autoComplete={autoComplete}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '12px 14px', borderRadius: 11,
          border: `1.5px solid ${error ? '#ef4444' : focused ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
          boxShadow: focused && !error ? '0 0 0 3px color-mix(in srgb, var(--ft-accent) 14%, transparent)' : 'none',
          backgroundColor: 'var(--c-input)', color: 'var(--c-text1)',
          fontSize: 14, outline: 'none',
        }}
      />
      {(error || hint) && (
        <div style={{ fontSize: 11.5, marginTop: 6, color: error ? '#ef4444' : 'var(--c-text3)' }}>
          {error || hint}
        </div>
      )}
    </div>
  )
}
