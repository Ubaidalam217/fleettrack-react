import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setCurrentUser } from '../services/authUser'

const VALID_CREDENTIALS = [
  { email: 'admin@fleettrack.com',   password: 'admin123' },
  { email: 'admin@gmail.com',        password: 'admin123' },
  { email: 'ubaidalam217@gmail.com', password: 'admin123' },
]

export default function Login() {
  const navigate = useNavigate()

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPw,       setShowPw]       = useState(false)
  const [remember,     setRemember]     = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [emailFocused, setEmailFocused] = useState(false)
  const [pwFocused,    setPwFocused]    = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    await new Promise(r => setTimeout(r, 1100))
    const valid = VALID_CREDENTIALS.some(c => c.email === email.trim() && c.password === password)
    if (valid) {
      // Store the profile so the dashboard greeting and account menu can
      // address the actual signed-in user.
      setCurrentUser(email.trim())
      navigate('/dashboard')
    } else {
      setError('Invalid email or password. Please try again.')
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
        .l-input { transition: border-color .2s, box-shadow .2s; }
        .l-btn   { transition: background .2s, transform .15s, box-shadow .2s; }
        .l-btn:hover:not(:disabled) {
          background: var(--ft-accent-hover) !important;
          transform: translateY(-1px) scale(1.02);
          box-shadow: 0 8px 24px color-mix(in srgb, var(--ft-accent) 45%, transparent) !important;
        }
        .l-btn:active:not(:disabled) { transform: translateY(0); }
        .l-fp:hover { text-decoration: underline; }
      `}</style>

      {/* Full-screen centered container */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--c-page)',
        padding: '24px',
        boxSizing: 'border-box',
      }}>

        {/* Login card — max 420px, centered */}
        <div style={{
          width: '100%',
          maxWidth: 420,
          backgroundColor: 'var(--c-card)',
          borderRadius: 22,
          padding: 'clamp(24px, 5vw, 40px) clamp(20px, 6vw, 38px)',
          border: '1px solid var(--c-border2)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.09)',
          animation: 'loginCardUp 0.65s cubic-bezier(0.22, 0.61, 0.36, 1) both',
        }}>

          {/* Logo — the real wordmark replaces the old icon-tile + text lockup,
              so the name is never set in a font that is not the brand's. */}
          <div style={{ marginBottom: 32 }}>
            <img
              src="/logo/fleetmax-logo.png"
              alt="FleetmaX Solutions"
              style={{ height: 44, width: 'auto', display: 'block' }}
            />
            <div style={{ fontSize: 11, color: 'var(--c-text3)', fontWeight: 500, marginTop: 8 }}>
              Fleet Management System
            </div>
          </div>

          {/* Heading */}
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: 'var(--c-text1)', letterSpacing: '-0.025em', marginBottom: 6 }}>
              Welcome Back
            </h2>
            <p style={{ fontSize: 14, color: 'var(--c-text2)', lineHeight: 1.5 }}>
              Sign in to your FleetmaX account to continue
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Email */}
            <div>
              <label htmlFor="login-email" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--c-text1)', marginBottom: 8 }}>
                Email Address
              </label>
              <div style={{ position: 'relative' }}>
                <svg
                  style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: emailFocused ? 'var(--ft-accent)' : 'var(--c-text3)', transition: 'color .2s' }}
                  width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
                <input
                  id="login-email"
                  type="email"
                  className="l-input"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  placeholder="admin@fleettrack.com"
                  required
                  autoComplete="email"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '12px 14px 12px 42px',
                    borderRadius: 11,
                    border: `1.5px solid ${emailFocused ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
                    boxShadow: emailFocused ? '0 0 0 3px color-mix(in srgb, var(--ft-accent) 14%, transparent)' : 'none',
                    backgroundColor: 'var(--c-input)',
                    color: 'var(--c-text1)',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label htmlFor="login-pw" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text1)' }}>
                  Password
                </label>
                <a
                  href="#"
                  className="l-fp"
                  style={{ fontSize: 12, color: 'var(--ft-accent)', fontWeight: 600, textDecoration: 'none' }}
                  onClick={e => e.preventDefault()}
                >
                  Forgot Password?
                </a>
              </div>
              <div style={{ position: 'relative' }}>
                <svg
                  style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: pwFocused ? 'var(--ft-accent)' : 'var(--c-text3)', transition: 'color .2s' }}
                  width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                <input
                  id="login-pw"
                  type={showPw ? 'text' : 'password'}
                  className="l-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setPwFocused(true)}
                  onBlur={() => setPwFocused(false)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '12px 44px 12px 42px',
                    borderRadius: 11,
                    border: `1.5px solid ${pwFocused ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
                    boxShadow: pwFocused ? '0 0 0 3px color-mix(in srgb, var(--ft-accent) 14%, transparent)' : 'none',
                    backgroundColor: 'var(--c-input)',
                    color: 'var(--c-text1)',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  tabIndex={-1}
                  style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--c-text3)', display: 'flex', alignItems: 'center' }}
                >
                  {showPw ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <input
                id="remember"
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--ft-accent)', cursor: 'pointer', flexShrink: 0 }}
              />
              <label htmlFor="remember" style={{ fontSize: 13, color: 'var(--c-text2)', cursor: 'pointer', userSelect: 'none' }}>
                Remember me for 30 days
              </label>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '11px 14px', borderRadius: 11,
                backgroundColor: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.22)',
                animation: 'shake 0.4s ease',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 500 }}>{error}</span>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              className="l-btn"
              disabled={loading}
              style={{
                width: '100%',
                padding: '13px 20px',
                marginTop: 2,
                borderRadius: 11,
                border: 'none',
                background: 'var(--ft-accent)',
                color: '#fff',
                fontSize: 15,
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.85 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                boxShadow: '0 4px 18px color-mix(in srgb, var(--ft-accent) 32%, transparent)',
                letterSpacing: '0.01em',
              }}
            >
              {loading ? (
                <>
                  <div style={{ width: 18, height: 18, border: '2.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'ls 0.75s linear infinite', flexShrink: 0 }} />
                  Signing in…
                </>
              ) : (
                <>
                  Sign In to FleetmaX
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 22px' }}>
            <div style={{ flex: 1, height: 1, backgroundColor: 'var(--c-border2)' }} />
            <span style={{ fontSize: 11, color: 'var(--c-text3)', fontWeight: 600, letterSpacing: '0.08em' }}>SECURED WITH TLS</span>
            <div style={{ flex: 1, height: 1, backgroundColor: 'var(--c-border2)' }} />
          </div>

          {/* Powered by */}
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--c-text3)' }}>Powered by </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ft-accent)', letterSpacing: '-0.01em' }}>FleetmaX</span>
          </div>

        </div>
      </div>
    </>
  )
}
