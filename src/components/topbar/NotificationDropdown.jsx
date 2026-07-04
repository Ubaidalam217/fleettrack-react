import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../hooks/useNotifications'

// ── Severity display config ────────────────────────────────────────────────
const SEV = {
  info:     { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> },
  warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
  success:  { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
  // fallback for any legacy severity labels
  error:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
}

// ── Relative time ──────────────────────────────────────────────────────────
function relTime(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000)         return 'Just now'
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)} hr ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} days ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Time bucket grouping ───────────────────────────────────────────────────
const MAX_VISIBLE = 20

const BUCKETS = [
  { key: 'new',       label: 'New',           test: (ts, now) => now - ts < 3_600_000 },
  { key: 'earlier',   label: 'Earlier today', test: (ts, now) => now - ts < 86_400_000 },
  { key: 'this_week', label: 'This week',     test: (ts, now) => now - ts < 7 * 86_400_000 },
  { key: 'older',     label: 'Older',         test: () => true },
]

function groupItems(items) {
  const now = Date.now()
  const assigned = new Set()
  const groups = []
  for (const bucket of BUCKETS) {
    const group = items.filter(item => !assigned.has(item.id) && bucket.test(item.timestamp, now))
    if (group.length === 0) continue
    group.forEach(item => assigned.add(item.id))
    groups.push({ label: bucket.label, items: group })
  }
  return groups
}

// ── Item row ───────────────────────────────────────────────────────────────
function NotifItem({ item, onRead }) {
  const sev = SEV[item.severity] || SEV.info
  return (
    <button
      onClick={() => onRead(item.id)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        width: '100%', padding: '10px 14px', textAlign: 'left',
        background: item.read ? 'none' : 'rgba(59,130,246,0.04)',
        border: 'none', cursor: 'pointer',
        borderBottom: '1px solid var(--c-border)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = item.read ? 'none' : 'rgba(59,130,246,0.04)'}
    >
      <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: sev.bg, color: sev.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        {sev.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: item.read ? 500 : 700, color: 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </span>
          <span style={{ fontSize: 10, color: 'var(--c-text3)', flexShrink: 0 }}>
            {relTime(item.timestamp)}
          </span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--c-text2)', margin: 0, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {item.message}
        </p>
        {(item.vehicleName || item.author) && (
          <span style={{ fontSize: 10, color: sev.color, fontWeight: 600, marginTop: 3, display: 'inline-block' }}>
            {item.vehicleName || item.author}
          </span>
        )}
      </div>
      {!item.read && (
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, marginTop: 4 }} />
      )}
    </button>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────
function EmptyState({ tab }) {
  return (
    <div style={{ padding: '32px 14px', textAlign: 'center' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 10px', display: 'block', opacity: 0.25 }}>
        <path fillRule="evenodd" clipRule="evenodd" d="M10.75 2.29a.75.75 0 00-1.5 0v.54A6.92 6.92 0 003.62 9.17v5.29H3.33a.75.75 0 000 1.5h17.34a.75.75 0 000-1.5h-.29V9.17A6.92 6.92 0 0014.75 2.83v-.54a.75.75 0 00-1.5 0v.28c-.41-.07-.83-.11-1.25-.11-.42 0-.84.04-1.25.11v-.28zM5.12 9.17a5.38 5.38 0 0113.76 0v5.29H5.12V9.17zM8 18.46a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 018 18.46z" fill="var(--c-text3)"/>
      </svg>
      <p style={{ fontSize: 12, color: 'var(--c-text3)', margin: 0, fontWeight: 500 }}>
        {tab === 'alerts' ? 'No alerts yet' : 'No announcements'}
      </p>
      <p style={{ fontSize: 11, color: 'var(--c-text3)', margin: '4px 0 0', opacity: 0.7 }}>
        {tab === 'alerts' ? 'Live fleet alerts appear here within 60 seconds.' : 'Check back later for updates.'}
      </p>
    </div>
  )
}

// ── Grouped list renderer ──────────────────────────────────────────────────
function GroupedList({ items, onRead, onViewAll }) {
  const total    = items.length
  const visible  = items.slice(0, MAX_VISIBLE)
  const overflow = total - MAX_VISIBLE
  const groups   = groupItems(visible)
  if (groups.length === 0) return null
  return (
    <>
      {groups.map(group => (
        <div key={group.label}>
          <div style={{
            padding: '6px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            color: 'var(--c-text3)', background: 'var(--c-thead)',
            borderBottom: '1px solid var(--c-border)',
            position: 'sticky', top: 0, zIndex: 1,
          }}>
            {group.label.toUpperCase()}
          </div>
          {group.items.map(item => (
            <NotifItem key={item.id} item={item} onRead={onRead} />
          ))}
        </div>
      ))}
      {overflow > 0 && (
        <button
          onClick={onViewAll}
          style={{ display: 'block', width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#3b82f6', fontWeight: 600, textAlign: 'center', borderTop: '1px solid var(--c-border)' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          View all ({total}) notifications
        </button>
      )}
    </>
  )
}

// ── Main dropdown ──────────────────────────────────────────────────────────
export default function NotificationDropdown() {
  const [open, setOpen] = useState(false)
  const [tab,  setTab]  = useState('alerts')
  const [pos,  setPos]  = useState({ top: 0, right: 0, mobile: false })

  const triggerRef = useRef(null)
  const panelRef   = useRef(null)
  const navigate   = useNavigate()

  const { alerts, announcements, unreadAlerts, unreadAnnouncements, markRead, markAllRead } = useNotifications()

  const totalUnread = unreadAlerts + unreadAnnouncements
  const items = tab === 'alerts' ? alerts : announcements

  // Recalculate position anchored to trigger
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

  // Close on outside mousedown
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

  const goViewAll = () => {
    setOpen(false)
    navigate(tab === 'alerts' ? '/notifications' : '/announcements')
  }

  const panelStyle = pos.mobile
    ? { position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 9999 }
    : { position: 'fixed', top: pos.top, right: pos.right, width: 'min(384px, calc(100vw - 32px))', zIndex: 9999 }

  return (
    <>
      <style>{`
        .notif-scroll::-webkit-scrollbar { width: 5px; }
        .notif-scroll::-webkit-scrollbar-track { background: transparent; }
        .notif-scroll::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 99px; }
        .notif-scroll::-webkit-scrollbar-thumb:hover { background: var(--c-border2); }
      `}</style>

      {/* Bell trigger */}
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(s => !s)}
        className="relative flex h-8 w-8 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors"
        style={{
          border: `1px solid ${open ? '#3b82f6' : 'var(--c-border2)'}`,
          color: 'var(--c-text2)',
          background: open ? 'rgba(59,130,246,0.08)' : 'transparent',
        }}
        title={totalUnread > 0 ? `${totalUnread} alert${totalUnread !== 1 ? 's' : ''} in last 24 hours` : 'Notifications'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path fillRule="evenodd" clipRule="evenodd" d="M10.75 2.29a.75.75 0 00-1.5 0v.54A6.92 6.92 0 003.62 9.17v5.29H3.33a.75.75 0 000 1.5h17.34a.75.75 0 000-1.5h-.29V9.17A6.92 6.92 0 0014.75 2.83v-.54a.75.75 0 00-1.5 0v.28c-.41-.07-.83-.11-1.25-.11-.42 0-.84.04-1.25.11v-.28zM5.12 9.17a5.38 5.38 0 0113.76 0v5.29H5.12V9.17zM8 18.46a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 018 18.46z" fill="currentColor"/>
        </svg>
        {totalUnread > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            minWidth: 14, height: 14, borderRadius: 7,
            background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
            border: '1.5px solid var(--c-header)',
          }}>
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
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
            boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header — outside scroll */}
          <div style={{ borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text1)' }}>Notifications</span>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: '#16a34a', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', padding: '2px 6px', borderRadius: 4, lineHeight: 1 }}>LIVE</span>
              </div>
              {totalUnread > 0 && (
                <button
                  onClick={() => markAllRead(tab === 'alerts' ? 'alert' : 'announcement')}
                  style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                >
                  Mark all as read
                </button>
              )}
            </div>
            <div style={{ display: 'flex', paddingTop: 6 }}>
              {[
                { key: 'alerts',        label: 'Alerts',         count: unreadAlerts },
                { key: 'announcements', label: 'Announcements',  count: unreadAnnouncements },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    padding: '6px 14px', fontSize: 12, fontWeight: tab === t.key ? 700 : 500,
                    color: tab === t.key ? 'var(--c-text1)' : 'var(--c-text3)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: tab === t.key ? '2px solid #3b82f6' : '2px solid transparent',
                    display: 'flex', alignItems: 'center', gap: 5,
                    transition: 'color 0.15s',
                  }}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span style={{ background: '#ef4444', color: '#fff', borderRadius: 8, padding: '1px 5px', fontSize: 9, fontWeight: 700 }}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable list */}
          <div
            className="notif-scroll"
            style={{ maxHeight: 400, overflowY: 'auto', scrollBehavior: 'smooth', flexShrink: 1 }}
          >
            {items.length === 0
              ? <EmptyState tab={tab} />
              : <GroupedList items={items} onRead={markRead} onViewAll={goViewAll} />
            }
          </div>

          {/* Footer — outside scroll */}
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--c-border)', textAlign: 'center', flexShrink: 0 }}>
            <button
              onClick={goViewAll}
              style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              View all {tab}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
