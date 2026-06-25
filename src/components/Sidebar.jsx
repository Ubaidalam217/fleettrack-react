import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, MapPin, FileText, BarChart2, Settings, MessageCircle } from 'lucide-react'

const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Tracking',  icon: MapPin,           path: '/tracking' },
  { label: 'Reports',   icon: FileText,          path: '/reports' },
  { label: 'Charts',    icon: BarChart2,         path: '/charts' },
  { label: 'Settings',  icon: Settings,          path: '/settings' },
]

const SIDEBAR_BG   = '#1e3461'
const ACTIVE_BG    = 'rgba(59,130,246,0.22)'
const ACTIVE_COLOR = '#60a5fa'
const INACTIVE     = 'rgba(255,255,255,0.45)'
const DIVIDER      = 'rgba(255,255,255,0.08)'

// ── Support Modal ─────────────────────────────────────────────────────────
function SupportModal({ onClose }) {
  const [email,    setEmail]    = useState('')
  const [message,  setMessage]  = useState('')
  const [sending,  setSending]  = useState(false)
  const [toastOn,  setToastOn]  = useState(false)

  const handleSubmit = async e => {
    e.preventDefault()
    setSending(true)
    await new Promise(r => setTimeout(r, 900))
    setSending(false)
    setToastOn(true)
    setTimeout(() => { setToastOn(false); onClose() }, 2200)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.45)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', zIndex: 101,
        top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(420px, calc(100vw - 32px))',
        background: 'var(--c-card)',
        border: '1px solid var(--c-border)',
        borderRadius: 14,
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
        animation: 'scaleIn 0.18s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(59,130,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
              <MessageCircle size={16} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text1)' }}>Contact Support</div>
              <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>Powered by Solves Inn</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text3)', padding: 4, borderRadius: 6, display: 'flex' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Company info */}
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', fontSize: 12, color: 'var(--c-text2)' }}>
            <strong style={{ color: 'var(--c-text1)' }}>Solves Inn</strong> provides 24/7 fleet support.
            Average response time: <strong style={{ color: '#3b82f6' }}>under 2 hours</strong>.
          </div>

          {/* Email */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-text1)', marginBottom: 6 }}>
              Your Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '9px 12px', borderRadius: 8, outline: 'none',
                border: '1px solid var(--c-border2)',
                background: 'var(--c-input)', color: 'var(--c-text1)',
                fontSize: 13,
              }}
              onFocus={e => e.target.style.borderColor = '#3b82f6'}
              onBlur={e => e.target.style.borderColor = 'var(--c-border2)'}
            />
          </div>

          {/* Message */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-text1)', marginBottom: 6 }}>
              Message
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              required
              rows={4}
              placeholder="Describe your issue or question..."
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '9px 12px', borderRadius: 8, outline: 'none',
                border: '1px solid var(--c-border2)',
                background: 'var(--c-input)', color: 'var(--c-text1)',
                fontSize: 13, resize: 'vertical', minHeight: 90, fontFamily: 'inherit',
              }}
              onFocus={e => e.target.style.borderColor = '#3b82f6'}
              onBlur={e => e.target.style.borderColor = 'var(--c-border2)'}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={sending}
            style={{
              padding: '10px 0', borderRadius: 8, border: 'none',
              background: sending ? '#93c5fd' : '#3b82f6',
              color: '#fff', fontWeight: 700, fontSize: 13,
              cursor: sending ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background 0.15s',
            }}
          >
            {sending ? (
              <>
                <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', animation: 'db-spin 0.7s linear infinite' }} />
                Sending...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Submit Request
              </>
            )}
          </button>
        </form>
      </div>

      {/* Toast */}
      {toastOn && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 200,
          background: '#22c55e', color: '#fff',
          borderRadius: 10, padding: '10px 18px',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, fontWeight: 600,
          boxShadow: '0 6px 24px rgba(34,197,94,0.4)',
          animation: 'fadeInUp 0.3s ease',
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          Support request sent!
        </div>
      )}

      <style>{`
        @keyframes db-spin { to { transform: rotate(360deg) } }
      `}</style>
    </>
  )
}

// ── Sidebar ────────────────────────────────────────────────────────────────
export default function Sidebar({ sidebarOpen }) {
  const location = useLocation()
  const [supportOpen, setSupportOpen] = useState(false)

  return (
    <>
      <aside
        className="fixed lg:relative inset-y-0 left-0 flex-shrink-0 z-50"
        style={{
          width: sidebarOpen ? 72 : 0,
          minWidth: sidebarOpen ? 72 : 0,
          overflow: 'hidden',
          transition: 'width 0.3s ease, min-width 0.3s ease',
          backgroundColor: SIDEBAR_BG,
          height: '100vh',
        }}
      >
        <div style={{ width: 72, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

          {/* Logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '20px 0', borderBottom: `1px solid ${DIVIDER}` }}>
            <div style={{ display: 'flex', height: 36, width: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: '#3b82f6', boxShadow: '0 4px 12px rgba(59,130,246,0.4)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M20 8H4L2 14h20L20 8z" fill="white"/>
                <rect x="4" y="14" width="3" height="4" rx="1" fill="white"/>
                <rect x="17" y="14" width="3" height="4" rx="1" fill="white"/>
                <circle cx="7" cy="18" r="2" fill="white"/>
                <circle cx="17" cy="18" r="2" fill="white"/>
              </svg>
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginTop: 6, letterSpacing: '0.05em' }}>
              FleetTrack
            </span>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', padding: '12px 0', gap: 2 }}>
            {NAV.map(item => {
              const active = location.pathname === item.path
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    width: 52, height: 52, gap: 4, borderRadius: 12,
                    background: active ? ACTIVE_BG : 'transparent',
                    color: active ? ACTIVE_COLOR : INACTIVE,
                    textDecoration: 'none',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  <item.icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                  <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, lineHeight: 1 }}>
                    {item.label}
                  </span>
                </Link>
              )
            })}
          </nav>

          {/* Bottom */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', paddingBottom: 16, paddingTop: 12, gap: 12, borderTop: `1px solid ${DIVIDER}` }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'flex', height: 32, width: 32, alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#3b82f6', fontSize: 12, fontWeight: 700, color: 'white' }}>
                M
              </div>
              <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.75)', lineHeight: 1 }}>Musharof</span>
              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', lineHeight: 1 }}>Admin</span>
            </div>

            <button
              onClick={() => setSupportOpen(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: 0.7, transition: 'opacity 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
            >
              <MessageCircle size={16} color={INACTIVE} strokeWidth={1.8} />
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', lineHeight: 1 }}>Support</span>
            </button>
          </div>

        </div>
      </aside>

      {supportOpen && <SupportModal onClose={() => setSupportOpen(false)} />}
    </>
  )
}
