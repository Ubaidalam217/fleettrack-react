import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, MapPin, FileText, BarChart2, Settings,
  MessageCircle, Bell, Megaphone, ChevronDown,
} from 'lucide-react'
import { useCurrentUser, initials, firstName } from '../services/authUser'

export const SIDEBAR_WIDTH = 260

// Grouped to match the Crystal reference's section model. Every item from the
// old flat list is still here; Notifications and Announcements are additions,
// not replacements — both are real routed pages (App.jsx) that the icon rail
// had no room for, so they were only ever reachable from the header bell.
const NAV_SECTIONS = [
  {
    id: 'general',
    title: 'General',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
      // Label only — the route stays /tracking so every existing link still works.
      { label: 'Live Map',  icon: MapPin,          path: '/tracking' },
      { label: 'Reports',   icon: FileText,        path: '/reports' },
      { label: 'Charts',    icon: BarChart2,       path: '/charts' },
    ],
  },
  {
    id: 'alerts',
    title: 'Alerts',
    items: [
      { label: 'Notifications', icon: Bell,      path: '/notifications' },
      { label: 'Announcements', icon: Megaphone, path: '/announcements' },
    ],
  },
  {
    id: 'fleet',
    title: 'Fleet Management',
    items: [
      { label: 'Settings', icon: Settings, path: '/settings' },
    ],
  },
]

const COLLAPSE_KEY = 'ft-sidebar-sections'

function loadCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')
    return new Set(Array.isArray(raw) ? raw : [])
  } catch {
    return new Set()
  }
}

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
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'color-mix(in srgb, var(--ft-accent) 10%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ft-accent)' }}>
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
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'color-mix(in srgb, var(--ft-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--ft-accent) 15%, transparent)', fontSize: 12, color: 'var(--c-text2)' }}>
            <strong style={{ color: 'var(--c-text1)' }}>Solves Inn</strong> provides 24/7 fleet support.
            Average response time: <strong style={{ color: 'var(--ft-accent)' }}>under 2 hours</strong>.
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
              onFocus={e => e.target.style.borderColor = 'var(--ft-accent)'}
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
              onFocus={e => e.target.style.borderColor = 'var(--ft-accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--c-border2)'}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={sending}
            style={{
              padding: '10px 0', borderRadius: 8, border: 'none',
              background: sending ? 'color-mix(in srgb, var(--ft-accent) 45%, #fff)' : 'var(--ft-accent)',
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

// The CSS lives here rather than in index.css because every rule is scoped to
// this component, and keeping it beside the markup is what stops the hover and
// active states drifting apart from the tokens they are built on.
const SIDEBAR_CSS = `
  .ft-sb-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.16) transparent; }
  .ft-sb-scroll::-webkit-scrollbar { width: 6px; }
  .ft-sb-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 3px; }
  .ft-sb-scroll::-webkit-scrollbar-track { background: transparent; }

  .ft-sb-item {
    display: flex; align-items: center; gap: 11px;
    padding: 9px 11px; margin: 1px 0;
    border-radius: 9px;
    font-size: 13px; font-weight: 550;
    color: var(--c-sb-inactive);
    text-decoration: none;
    transition: background .15s ease, color .15s ease;
  }
  .ft-sb-item:hover {
    background: var(--c-sb-inactive-hover);
    color: var(--c-sb-inactive-hover-text);
  }
  .ft-sb-item[data-active="true"] {
    background: var(--c-sb-active);
    color: var(--c-sb-active-text);
    font-weight: 700;
    box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--c-sb-active) 55%, transparent);
  }
  .ft-sb-item:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }

  .ft-sb-section {
    display: flex; align-items: center; gap: 6px;
    width: 100%; padding: 9px 11px 5px;
    background: none; border: none; cursor: pointer;
    font-size: 9.5px; font-weight: 800; letter-spacing: .09em;
    text-transform: uppercase;
    color: var(--c-sb-section);
    transition: color .15s ease;
  }
  .ft-sb-section:hover { color: rgba(255,255,255,.7); }
  .ft-sb-chev { transition: transform .2s ease; }
  .ft-sb-section[aria-expanded="false"] .ft-sb-chev { transform: rotate(-90deg); }
`

const DESKTOP_MIN = 1024

// ── Sidebar ────────────────────────────────────────────────────────────────
/**
 * @param {boolean} [sidebarOpen] Controlled open state. Charts and Settings
 *        render `<Sidebar />` with no props at all, so when this is undefined
 *        the component falls back to deciding for itself by viewport. The old
 *        72px rail treated undefined as falsy and collapsed to zero width,
 *        which is why those two pages had no sidebar; at 260px the same bug
 *        would instead park a panel across the whole phone screen with no
 *        control wired up to dismiss it.
 */
export default function Sidebar({ sidebarOpen }) {
  const location = useLocation()
  const [supportOpen, setSupportOpen] = useState(false)
  const [collapsed, setCollapsed]     = useState(loadCollapsed)
  const [autoOpen, setAutoOpen]       = useState(
    () => typeof window === 'undefined' || window.innerWidth >= DESKTOP_MIN
  )
  const user = useCurrentUser()

  // Only matters in the uncontrolled case, but it is cheap and keeps the
  // fallback honest across a resize.
  useEffect(() => {
    if (sidebarOpen !== undefined) return
    const onResize = () => setAutoOpen(window.innerWidth >= DESKTOP_MIN)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sidebarOpen])

  const isOpen = sidebarOpen ?? autoOpen

  const toggleSection = id => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }

  return (
    <>
      <style>{SIDEBAR_CSS}</style>

      <aside
        className="fixed lg:relative inset-y-0 left-0 flex-shrink-0 z-50"
        style={{
          width:    isOpen ? SIDEBAR_WIDTH : 0,
          minWidth: isOpen ? SIDEBAR_WIDTH : 0,
          overflow: 'hidden',
          transition: 'width 0.3s ease, min-width 0.3s ease',
          backgroundColor: 'var(--c-sb-bg)',
          height: '100vh',
        }}
      >
        {/* Fixed inner width so the contents do not reflow mid-animation. */}
        <div style={{
          width: SIDEBAR_WIDTH, height: '100%',
          display: 'flex', flexDirection: 'column',
        }}>

          {/* Logo */}
          <div style={{
            padding: '18px 16px 14px',
            borderBottom: '1px solid var(--c-sb-divider)',
          }}>
            <Link to="/dashboard" style={{ display: 'block', lineHeight: 0 }} aria-label="FleetmaX Solutions — go to dashboard">
              <img
                src="/logo/fleetmax-logo-white.png"
                alt="FleetmaX Solutions"
                style={{ height: 34, width: 'auto', display: 'block' }}
              />
            </Link>
          </div>

          {/* Nav — starts directly under the logo now that the search box is
              gone, so the sections gain its row back. */}
          <nav className="ft-sb-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 10px 10px', minHeight: 0 }}>
            {NAV_SECTIONS.map(section => {
              const open = !collapsed.has(section.id)
              return (
                <div key={section.id} style={{ marginBottom: 2 }}>
                  <button
                    className="ft-sb-section"
                    aria-expanded={open}
                    onClick={() => toggleSection(section.id)}
                  >
                    <ChevronDown size={11} strokeWidth={3} className="ft-sb-chev" />
                    {section.title}
                  </button>

                  {open && section.items.map(item => {
                    const active = location.pathname === item.path
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className="ft-sb-item"
                        data-active={active ? 'true' : 'false'}
                        aria-current={active ? 'page' : undefined}
                      >
                        <item.icon size={16} strokeWidth={active ? 2.3 : 1.9} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.label}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </nav>

          {/* Footer — pinned */}
          <div style={{ borderTop: '1px solid var(--c-sb-divider)', padding: '12px 14px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                display: 'flex', height: 34, width: 34, flexShrink: 0,
                alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
                background: 'var(--c-sb-active)',
                fontSize: 12, fontWeight: 700, color: '#fff',
              }}>
                {initials(user)}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {firstName(user)}
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.role}
                </div>
              </div>
            </div>

            <button
              onClick={() => setSupportOpen(true)}
              className="ft-sb-item"
              style={{ width: '100%', border: 'none', cursor: 'pointer', background: 'transparent', textAlign: 'left', font: 'inherit' }}
            >
              <MessageCircle size={16} strokeWidth={1.9} style={{ flexShrink: 0 }} />
              <span>Support</span>
            </button>
          </div>

        </div>
      </aside>

      {supportOpen && <SupportModal onClose={() => setSupportOpen(false)} />}
    </>
  )
}
