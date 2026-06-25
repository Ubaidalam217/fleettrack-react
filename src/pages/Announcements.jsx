import { useState, useMemo, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import Header  from '../components/Header'
import { useNotifications } from '../hooks/useNotifications'

// Placeholder admin check — replace with real role check when backend auth is wired
const isAdmin = () => true

// ── Helpers ────────────────────────────────────────────────────────────────
function relTime(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000)         return 'Just now'
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)} hr ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} days ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const SEV_META = {
  info:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  label: 'Info' },
  warning: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Warning' },
  success: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  label: 'Update' },
  critical:{ color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  label: 'Urgent' },
}

const SEV_ICONS = {
  info:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  warning: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  success: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  critical:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
}

const PAGE_SIZE = 25

// ── Create Modal ───────────────────────────────────────────────────────────
function CreateModal({ onClose, onPublish }) {
  const [title,    setTitle]    = useState('')
  const [message,  setMessage]  = useState('')
  const [severity, setSeverity] = useState('info')

  const handleSubmit = e => {
    e.preventDefault()
    if (!title.trim() || !message.trim()) return
    onPublish({ title: title.trim(), message: message.trim(), severity })
    onClose()
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '9px 12px', borderRadius: 8, outline: 'none',
    border: '1px solid var(--c-border2)',
    background: 'var(--c-input)', color: 'var(--c-text1)',
    fontSize: 13, fontFamily: 'inherit',
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div style={{ position: 'fixed', zIndex: 101, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(460px, calc(100vw - 32px))', background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text1)' }}>Create Announcement</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text3)', display: 'flex', padding: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-text1)', marginBottom: 6 }}>Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              placeholder="Announcement title"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = '#3b82f6'}
              onBlur={e => e.target.style.borderColor = 'var(--c-border2)'}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-text1)', marginBottom: 6 }}>Message</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              required
              rows={4}
              placeholder="Write your announcement..."
              style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }}
              onFocus={e => e.target.style.borderColor = '#3b82f6'}
              onBlur={e => e.target.style.borderColor = 'var(--c-border2)'}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-text1)', marginBottom: 6 }}>Severity</label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="info">Info</option>
              <option value="success">Update / Success</option>
              <option value="warning">Warning</option>
              <option value="critical">Urgent / Critical</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text2)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              Cancel
            </button>
            <button type="submit" style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              Publish
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Row ────────────────────────────────────────────────────────────────────
function AnnouncementRow({ item, onMarkRead, onDelete }) {
  const [hover, setHover] = useState(false)
  const sev = SEV_META[item.severity] || SEV_META.info
  const icon = SEV_ICONS[item.severity] || SEV_ICONS.info

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        padding: '16px 20px',
        background: item.read ? 'none' : 'rgba(59,130,246,0.03)',
        borderBottom: '1px solid var(--c-border)',
        transition: 'background 0.1s',
        ...(hover ? { background: 'var(--c-hover)' } : {}),
      }}
    >
      <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, background: sev.bg, color: sev.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        {icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: item.read ? 500 : 700, color: 'var(--c-text1)' }}>
              {item.title}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: sev.color, background: sev.bg, borderRadius: 5, padding: '2px 7px' }}>
              {sev.label}
            </span>
            {!item.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />}
          </div>
          <span style={{ fontSize: 11, color: 'var(--c-text3)', flexShrink: 0 }}>{relTime(item.timestamp)}</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--c-text2)', margin: 0, lineHeight: 1.55 }}>{item.message}</p>
        {item.author && (
          <span style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 5, display: 'inline-block' }}>
            by {item.author}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, flexShrink: 0, opacity: hover ? 1 : 0, transition: 'opacity 0.15s', marginTop: 2 }}>
        <button
          onClick={() => onMarkRead(item.id)}
          disabled={item.read}
          title={item.read ? 'Already read' : 'Mark as read'}
          style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--c-border2)', background: 'var(--c-card)', cursor: item.read ? 'default' : 'pointer', color: item.read ? 'var(--c-border2)' : '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button
          onClick={() => onDelete(item.id)}
          title="Delete"
          style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--c-border2)', background: 'var(--c-card)', cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Announcements({ isDark, toggleTheme, themeMode, setTheme }) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  )
  const { announcements, unreadAnnouncements, markRead, markAllRead, deleteOne, clearAll, addMany } = useNotifications()

  const [tab,        setTab]        = useState('all')
  const [severity,   setSeverity]   = useState('all')
  const [search,     setSearch]     = useState('')
  const [page,       setPage]       = useState(0)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => { setPage(0) }, [tab, severity, search])

  const filtered = useMemo(() => {
    return announcements
      .filter(n => {
        if (tab === 'unread' && n.read)   return false
        if (tab === 'read'   && !n.read)  return false
        if (severity !== 'all' && n.severity !== severity) return false
        if (search.trim()) {
          const q = search.toLowerCase()
          return (n.title?.toLowerCase().includes(q) || n.message?.toLowerCase().includes(q) || n.author?.toLowerCase().includes(q))
        }
        return true
      })
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [announcements, tab, severity, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handlePublish = ({ title, message, severity: sev }) => {
    addMany([{
      id:        crypto.randomUUID(),
      type:      'announcement',
      severity:  sev,
      title,
      message,
      author:    'Admin',
      timestamp: Date.now(),
      read:      false,
    }])
  }

  const selectStyle = {
    padding: '6px 10px', borderRadius: 7, fontSize: 12,
    border: '1px solid var(--c-border2)',
    background: 'var(--c-input)', color: 'var(--c-text1)',
    cursor: 'pointer', outline: 'none',
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-page)' }}>
      <Sidebar sidebarOpen={sidebarOpen} />

      <div className="relative flex flex-col flex-1 overflow-hidden min-w-0">
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSidebarOpen(false)} />
        )}

        <Header
          isDark={isDark} toggleTheme={toggleTheme}
          themeMode={themeMode} setTheme={setTheme}
          onMenuClick={() => setSidebarOpen(s => !s)}
        />

        <main className="flex-1 overflow-y-auto no-scrollbar">
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 40px' }}>

            {/* ── Page header ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text1)', margin: 0 }}>Announcements</h1>
                {unreadAnnouncements > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#3b82f6', borderRadius: 20, padding: '2px 9px' }}>
                    {unreadAnnouncements} unread
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {unreadAnnouncements > 0 && (
                  <button
                    onClick={() => markAllRead('announcement')}
                    style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-card)', color: '#3b82f6', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Mark all read
                  </button>
                )}
                {isAdmin() && (
                  <button
                    onClick={() => setCreateOpen(true)}
                    style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Create announcement
                  </button>
                )}
              </div>
            </div>

            {/* ── Filter bar ── */}
            <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', background: 'var(--c-input)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--c-border2)' }}>
                {['all', 'unread', 'read'].map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      padding: '5px 12px', fontSize: 12, fontWeight: tab === t ? 700 : 500, border: 'none', cursor: 'pointer',
                      background: tab === t ? '#3b82f6' : 'transparent',
                      color: tab === t ? '#fff' : 'var(--c-text2)',
                      transition: 'all 0.15s', textTransform: 'capitalize',
                    }}
                  >{t}</button>
                ))}
              </div>

              <select value={severity} onChange={e => setSeverity(e.target.value)} style={selectStyle}>
                <option value="all">All types</option>
                <option value="critical">Urgent</option>
                <option value="warning">Warning</option>
                <option value="success">Update</option>
                <option value="info">Info</option>
              </select>

              <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
                <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', pointerEvents: 'none' }} width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" clipRule="evenodd" d="M9.375 3.042A6.333 6.333 0 003.042 9.375a6.333 6.333 0 006.333 6.333 6.333 6.333 0 006.333-6.333 6.333 6.333 0 00-6.333-6.333zm-7.833 6.333a7.833 7.833 0 1114.233 4.565l2.958 2.958a.75.75 0 11-1.06 1.06l-2.958-2.957A7.833 7.833 0 011.542 9.375z"/>
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  style={{ ...selectStyle, width: '100%', paddingLeft: 28, boxSizing: 'border-box' }}
                />
              </div>

              {(tab !== 'all' || severity !== 'all' || search) && (
                <button
                  onClick={() => { setTab('all'); setSeverity('all'); setSearch('') }}
                  style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--c-border2)', background: 'none', color: 'var(--c-text3)', fontSize: 11, cursor: 'pointer' }}
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* ── List ── */}
            <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, overflow: 'hidden' }}>
              {pageItems.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--c-border2)" strokeWidth="1.5" style={{ margin: '0 auto 12px', display: 'block' }}>
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                  </svg>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text2)', margin: '0 0 4px' }}>
                    {announcements.length === 0 ? 'No announcements yet' : 'No announcements match your filters'}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--c-text3)', margin: 0 }}>
                    {announcements.length === 0
                      ? isAdmin() ? 'Create your first announcement using the button above.' : 'Check back later.'
                      : 'Try clearing the filters above.'}
                  </p>
                </div>
              ) : (
                pageItems.map(item => (
                  <AnnouncementRow key={item.id} item={item} onMarkRead={markRead} onDelete={deleteOne} />
                ))
              )}
            </div>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>
                  Page {page + 1} of {totalPages} ({filtered.length} items)
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-card)', color: page === 0 ? 'var(--c-text3)' : 'var(--c-text1)', fontSize: 12, fontWeight: 600, cursor: page === 0 ? 'default' : 'pointer' }}>Previous</button>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-card)', color: page >= totalPages - 1 ? 'var(--c-text3)' : 'var(--c-text1)', fontSize: 12, fontWeight: 600, cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>Next</button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onPublish={handlePublish}
        />
      )}
    </div>
  )
}
