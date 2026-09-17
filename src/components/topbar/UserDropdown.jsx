import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, Link } from 'react-router-dom'
import { getPermissionState } from '../../services/pushNotifications'
import { useCurrentUser, initials, clearCurrentUser } from '../../services/authUser'

const THEME_OPTIONS = [
  {
    mode: 'light',
    label: 'Light',
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  },
  {
    mode: 'dark',
    label: 'Dark',
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
  },
  {
    mode: 'system',
    label: 'System',
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  },
]

const MENU_ITEMS = [
  {
    label: 'Profile',
    to: '/settings/profile',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  },
  {
    label: 'Settings',
    to: '/settings',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  },
]

const PUSH_STATUS = {
  granted:     { label: 'Enabled',  color: '#22c55e', bg: 'rgba(34,197,94,0.1)'  },
  denied:      { label: 'Blocked',  color: '#ef4444', bg: 'rgba(239,68,68,0.1)'  },
  default:     { label: 'Not set',  color: '#94a3b8', bg: 'rgba(148,163,184,0.1)'},
  unsupported: { label: 'N/A',      color: '#94a3b8', bg: 'rgba(148,163,184,0.1)'},
}

export default function UserDropdown({ themeMode, setTheme }) {
  const [open,      setOpen]      = useState(false)
  const [pos,       setPos]       = useState({ top: 0, right: 0, mobile: false })
  const [pushToast, setPushToast] = useState(null) // string | null

  const triggerRef = useRef(null)
  const panelRef   = useRef(null)
  const navigate   = useNavigate()
  const user       = useCurrentUser()
  const avatar     = initials(user)

  // Recalculate position anchored to the trigger button
  useEffect(() => {
    if (!open) return
    const calc = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const isMobile = window.innerWidth < 640
      setPos(
        isMobile
          ? { top: rect.bottom + 8, left: 16, right: 16, mobile: true }
          : { top: rect.bottom + 8, right: window.innerWidth - rect.right, mobile: false }
      )
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [open])

  // Close on outside mousedown — checks both trigger and portaled panel
  useEffect(() => {
    if (!open) return
    const h = e => {
      const inTrigger = triggerRef.current?.contains(e.target)
      const inPanel   = panelRef.current?.contains(e.target)
      if (!inTrigger && !inPanel) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const h = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open])

  // Auto-dismiss push toast after 4 seconds
  useEffect(() => {
    if (!pushToast) return
    const t = setTimeout(() => setPushToast(null), 4000)
    return () => clearTimeout(t)
  }, [pushToast])

  const handlePushClick = () => {
    const state = getPermissionState()
    if (state === 'granted') {
      setPushToast('Push notifications are enabled. Manage in browser settings.')
    } else if (state === 'denied') {
      setPushToast('Blocked by browser. Click the lock icon in the address bar to allow.')
    } else {
      setPushToast('Reload the page to set up push notifications.')
    }
  }

  const handleSignOut = () => {
    localStorage.removeItem('fleetAuth')
    localStorage.removeItem('fleetTheme')
    clearCurrentUser()
    setOpen(false)
    navigate('/login')
  }

  const panelStyle = pos.mobile
    ? { position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 9999 }
    : { position: 'fixed', top: pos.top, right: pos.right, width: 240, zIndex: 9999 }

  return (
    <>
      {/* Avatar trigger */}
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(s => !s)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}
        title="Account menu"
      >
        <div style={{
          display: 'flex', width: 28, height: 28,
          alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', background: 'var(--ft-accent)',
          fontSize: 12, fontWeight: 700, color: '#fff',
          border: open ? '2px solid color-mix(in srgb, var(--ft-accent) 55%, #fff)' : '2px solid transparent',
          transition: 'border-color 0.15s',
        }}>
          {avatar}
        </div>
      </button>

      {/* Portaled panel */}
      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            ...panelStyle,
            background: 'var(--c-card)',
            border: '1px solid var(--c-border)',
            borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
            overflow: 'hidden',
          }}
        >
          {/* User info */}
          <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--c-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'linear-gradient(135deg,var(--ft-accent),#1d4a63)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0,
              }}>{avatar}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.email}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ft-accent)', background: 'color-mix(in srgb, var(--ft-accent) 10%, transparent)', borderRadius: 5, padding: '2px 8px', letterSpacing: '0.04em' }}>
                {user.role.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Menu items */}
          <div style={{ padding: '6px 0' }}>
            {MENU_ITEMS.map(item => (
              <Link
                key={item.label}
                to={item.to}
                onClick={() => setOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 14px', textDecoration: 'none',
                  fontSize: 13, color: 'var(--c-text2)', fontWeight: 500,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <span style={{ color: 'var(--c-text3)' }}>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>

          {/* Theme picker */}
          <div style={{ padding: '8px 14px 10px', borderTop: '1px solid var(--c-border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--c-text3)', marginBottom: 7, letterSpacing: '0.06em' }}>
              APPEARANCE
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {THEME_OPTIONS.map(opt => {
                const active = themeMode === opt.mode
                return (
                  <button
                    key={opt.mode}
                    onClick={() => setTheme(opt.mode)}
                    style={{
                      flex: 1, padding: '5px 4px', borderRadius: 7,
                      border: `1px solid ${active ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
                      background: active ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'var(--c-input)',
                      color: active ? 'var(--ft-accent)' : 'var(--c-text3)',
                      cursor: 'pointer', fontSize: 10, fontWeight: active ? 700 : 500,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Push notifications row */}
          {getPermissionState() !== 'unsupported' && (() => {
            const ps = PUSH_STATUS[getPermissionState()] || PUSH_STATUS.default
            return (
              <div style={{ borderTop: '1px solid var(--c-border)', padding: '6px 0' }}>
                <button
                  onClick={handlePushClick}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '8px 14px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 13, color: 'var(--c-text2)', fontWeight: 500,
                    textAlign: 'left', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--c-text3)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path fillRule="evenodd" clipRule="evenodd" d="M10.75 2.29a.75.75 0 00-1.5 0v.54A6.92 6.92 0 003.62 9.17v5.29H3.33a.75.75 0 000 1.5h17.34a.75.75 0 000-1.5h-.29V9.17A6.92 6.92 0 0014.75 2.83v-.54a.75.75 0 00-1.5 0v.28c-.41-.07-.83-.11-1.25-.11-.42 0-.84.04-1.25.11v-.28zM5.12 9.17a5.38 5.38 0 0113.76 0v5.29H5.12V9.17zM8 18.46a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 018 18.46z" fill="currentColor"/>
                      </svg>
                    </span>
                    Push Notifications
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: ps.color, background: ps.bg, borderRadius: 5, padding: '2px 7px', letterSpacing: '0.03em' }}>
                    {ps.label}
                  </span>
                </button>
                {pushToast && (
                  <div style={{
                    margin: '0 14px 6px', padding: '8px 10px',
                    background: 'var(--c-thead)', borderRadius: 7,
                    fontSize: 11, color: 'var(--c-text2)', lineHeight: 1.5,
                    border: '1px solid var(--c-border)',
                  }}>
                    {pushToast}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Sign out */}
          <div style={{ borderTop: '1px solid var(--c-border)', padding: '6px 0 4px' }}>
            <button
              onClick={handleSignOut}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '8px 14px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: '#ef4444', fontWeight: 500,
                textAlign: 'left', transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign Out
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
