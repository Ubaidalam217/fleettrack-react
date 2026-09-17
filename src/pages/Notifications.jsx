import { useState, useMemo, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import Header  from '../components/Header'
import { useNotifications } from '../hooks/useNotifications'

// ── Helpers ────────────────────────────────────────────────────────────────
function relTime(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000)        return 'Just now'
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)} hr ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} days ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const SEV_META = {
  info:     { color: '#5ba354', bg: 'rgba(91,163,84,0.1)',  label: 'Info',     icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> },
  warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Warning',   icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  label: 'Critical',  icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
  success:  { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  label: 'Success',   icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg> },
}

const PAGE_SIZE = 25

const RULE_LABELS = {
  overspeed:       'Overspeed',
  high_idle:       'High Idle',
  gps_lost:        'GPS Lost',
  off_hours_engine:'Off Hours',
  long_stop:       'Long Stop',
}

// ── Confirm Modal ──────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.45)' }} onClick={onCancel} />
      <div style={{ position: 'fixed', zIndex: 101, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(380px, calc(100vw - 32px))', background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <p style={{ fontSize: 14, color: 'var(--c-text1)', marginBottom: 20, lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text2)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Clear all</button>
        </div>
      </div>
    </>
  )
}

// ── Row ────────────────────────────────────────────────────────────────────
function NotifRow({ item, onMarkRead, onDelete }) {
  const [hover, setHover] = useState(false)
  const sev = SEV_META[item.severity] || SEV_META.info

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        padding: '14px 20px',
        background: item.read ? 'none' : 'color-mix(in srgb, var(--ft-accent) 3%, transparent)',
        borderBottom: '1px solid var(--c-border)',
        transition: 'background 0.1s',
        ...(hover ? { background: 'var(--c-hover)' } : {}),
      }}
    >
      {/* Severity icon */}
      <div style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: sev.bg, color: sev.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        {sev.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: item.read ? 500 : 700, color: 'var(--c-text1)', lineHeight: 1.4 }}>
            {item.title}
          </span>
          <span style={{ fontSize: 11, color: 'var(--c-text3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {relTime(item.timestamp)}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--c-text2)', margin: 0, lineHeight: 1.5 }}>{item.message}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          {item.vehicleName && (
            <span style={{ fontSize: 10, fontWeight: 700, color: sev.color, background: sev.bg, borderRadius: 5, padding: '2px 7px', letterSpacing: '0.03em' }}>
              {item.vehicleName}
            </span>
          )}
          {item.ruleId && (
            <span style={{ fontSize: 10, color: 'var(--c-text3)', background: 'var(--c-thead)', borderRadius: 5, padding: '2px 7px' }}>
              {RULE_LABELS[item.ruleId] || item.ruleId}
            </span>
          )}
          {!item.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ft-accent)', display: 'inline-block' }} />}
        </div>
      </div>

      {/* Hover actions */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, opacity: hover ? 1 : 0, transition: 'opacity 0.15s', marginTop: 2 }}>
        <button
          onClick={() => onMarkRead(item.id)}
          title={item.read ? 'Already read' : 'Mark as read'}
          disabled={item.read}
          style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--c-border2)', background: 'var(--c-card)', cursor: item.read ? 'default' : 'pointer', color: item.read ? 'var(--c-border2)' : 'var(--ft-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
export default function Notifications({ isDark, toggleTheme, themeMode, setTheme }) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  )
  const { alerts, unreadAlerts, markRead, markAllRead, deleteOne, clearAll } = useNotifications()

  const [tab,        setTab]        = useState('all')      // all | unread | read
  const [severity,   setSeverity]   = useState('all')
  const [vehicle,    setVehicle]    = useState('all')
  const [dateRange,  setDateRange]  = useState('all')      // all | today | week | month
  const [search,     setSearch]     = useState('')
  const [page,       setPage]       = useState(0)
  const [clearModal, setClearModal] = useState(false)

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [tab, severity, vehicle, dateRange, search])

  // Unique vehicle names from alerts
  const vehicleNames = useMemo(() => {
    const seen = new Set()
    return alerts.reduce((acc, n) => {
      if (n.vehicleName && !seen.has(n.vehicleName)) {
        seen.add(n.vehicleName)
        acc.push(n.vehicleName)
      }
      return acc
    }, []).sort()
  }, [alerts])

  const filtered = useMemo(() => {
    const now = Date.now()
    const DAY = 86_400_000
    return alerts
      .filter(n => {
        if (tab === 'unread' && n.read)   return false
        if (tab === 'read'   && !n.read)  return false
        if (severity !== 'all' && n.severity !== severity) return false
        if (vehicle  !== 'all' && n.vehicleName !== vehicle) return false
        if (dateRange === 'today' && now - n.timestamp > DAY)      return false
        if (dateRange === 'week'  && now - n.timestamp > 7 * DAY)  return false
        if (dateRange === 'month' && now - n.timestamp > 30 * DAY) return false
        if (search.trim()) {
          const q = search.toLowerCase()
          return (
            n.title?.toLowerCase().includes(q) ||
            n.message?.toLowerCase().includes(q) ||
            n.vehicleName?.toLowerCase().includes(q)
          )
        }
        return true
      })
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [alerts, tab, severity, vehicle, dateRange, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

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
                <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text1)', margin: 0 }}>Notifications</h1>
                {unreadAlerts > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#ef4444', borderRadius: 20, padding: '2px 9px' }}>
                    {unreadAlerts} unread
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {unreadAlerts > 0 && (
                  <button
                    onClick={() => markAllRead('alert')}
                    style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-card)', color: 'var(--ft-accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Mark all read
                  </button>
                )}
                {alerts.length > 0 && (
                  <button
                    onClick={() => setClearModal(true)}
                    style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {/* ── Filter bar ── */}
            <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Status tabs */}
              <div style={{ display: 'flex', background: 'var(--c-input)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--c-border2)' }}>
                {['all', 'unread', 'read'].map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      padding: '5px 12px', fontSize: 12, fontWeight: tab === t ? 700 : 500, border: 'none', cursor: 'pointer',
                      background: tab === t ? 'var(--ft-accent)' : 'transparent',
                      color: tab === t ? '#fff' : 'var(--c-text2)',
                      transition: 'all 0.15s', textTransform: 'capitalize',
                    }}
                  >{t}</button>
                ))}
              </div>

              {/* Severity */}
              <select value={severity} onChange={e => setSeverity(e.target.value)} style={selectStyle}>
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>

              {/* Vehicle */}
              <select value={vehicle} onChange={e => setVehicle(e.target.value)} style={selectStyle}>
                <option value="all">All vehicles</option>
                {vehicleNames.map(v => <option key={v} value={v}>{v}</option>)}
              </select>

              {/* Date range */}
              <select value={dateRange} onChange={e => setDateRange(e.target.value)} style={selectStyle}>
                <option value="all">All time</option>
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
              </select>

              {/* Search */}
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

              {/* Clear filters */}
              {(tab !== 'all' || severity !== 'all' || vehicle !== 'all' || dateRange !== 'all' || search) && (
                <button
                  onClick={() => { setTab('all'); setSeverity('all'); setVehicle('all'); setDateRange('all'); setSearch('') }}
                  style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--c-border2)', background: 'none', color: 'var(--c-text3)', fontSize: 11, cursor: 'pointer' }}
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* ── Stats row ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>
                {filtered.length} notification{filtered.length !== 1 ? 's' : ''} total
                {filtered.length !== alerts.length && ` (filtered from ${alerts.length})`}
              </span>
            </div>

            {/* ── List ── */}
            <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, overflow: 'hidden' }}>
              {pageItems.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 12px', display: 'block', opacity: 0.25 }}>
                    <path fillRule="evenodd" clipRule="evenodd" d="M10.75 2.29a.75.75 0 00-1.5 0v.54A6.92 6.92 0 003.62 9.17v5.29H3.33a.75.75 0 000 1.5h17.34a.75.75 0 000-1.5h-.29V9.17A6.92 6.92 0 0014.75 2.83v-.54a.75.75 0 00-1.5 0v.28c-.41-.07-.83-.11-1.25-.11-.42 0-.84.04-1.25.11v-.28zM5.12 9.17a5.38 5.38 0 0113.76 0v5.29H5.12V9.17zM8 18.46a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 018 18.46z" fill="var(--c-text3)"/>
                  </svg>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text2)', margin: '0 0 4px' }}>
                    {alerts.length === 0 ? 'No notifications yet' : 'No notifications match your filters'}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--c-text3)', margin: 0 }}>
                    {alerts.length === 0
                      ? 'Live alerts from your fleet will appear here within 60 seconds.'
                      : 'Try clearing the filters above.'}
                  </p>
                </div>
              ) : (
                pageItems.map(item => (
                  <NotifRow key={item.id} item={item} onMarkRead={markRead} onDelete={deleteOne} />
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
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-card)', color: page === 0 ? 'var(--c-text3)' : 'var(--c-text1)', fontSize: 12, fontWeight: 600, cursor: page === 0 ? 'default' : 'pointer' }}
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--c-border2)', background: 'var(--c-card)', color: page >= totalPages - 1 ? 'var(--c-text3)' : 'var(--c-text1)', fontSize: 12, fontWeight: 600, cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {clearModal && (
        <ConfirmModal
          message={`Clear all ${alerts.length} notification${alerts.length !== 1 ? 's' : ''}? This cannot be undone.`}
          onConfirm={() => { clearAll('alert'); setClearModal(false) }}
          onCancel={() => setClearModal(false)}
        />
      )}
    </div>
  )
}
