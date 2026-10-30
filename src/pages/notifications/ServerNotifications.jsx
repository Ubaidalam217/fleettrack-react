import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, CheckCheck, Clock, MapPin, Truck, User, Building2, BellRing } from 'lucide-react'
import SeverityChip from '../../components/alerts/SeverityChip'
import { severityTone, alertTypeIcon } from '../../components/alerts/alertStyle'
import { uaeDateTime, relativeTime, eventVehicleName, eventDetail, mapsLink } from '../../components/alerts/alertFormat'
import {
  useAlertEvents, markAlertEventsRead, markAllAlertEventsRead,
  loadOlderAlertEvents, refreshAlertEvents,
} from '../../data/alertEvents'
import { ALERT_TYPES, ALERT_SEVERITIES, alertTypeLabel } from '../../data/settings'

/**
 * The Notifications page in real mode: the alert history the server's engine
 * recorded (data/alertEvents.js), newest first.
 *
 * The filters work on what is loaded, and "Load more" pages further back. The
 * list is already the account's newest events and a page is 50, so a filter
 * rarely runs short; when it does, Load more is right there under it.
 */

const SEVERITY_ORDER = [...ALERT_SEVERITIES].reverse()

const selectStyle = {
  padding: '6px 10px', borderRadius: 7, fontSize: 12,
  border: '1px solid var(--c-border2)',
  background: 'var(--c-input)', color: 'var(--c-text1)',
  cursor: 'pointer', outline: 'none',
}

const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', borderRadius: 8,
  border: '1px solid var(--c-border2)', background: 'var(--c-card)',
  color: 'var(--ft-accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

const meta = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: 11, color: 'var(--c-text3)', whiteSpace: 'nowrap',
}

/** Re-renders every minute so "5 min ago" keeps moving while the page is open. */
function useMinuteTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
}

function EventRow({ event }) {
  const [hover, setHover] = useState(false)
  const unread = !event.readAt
  const tone = severityTone(event.severity)
  const Icon = alertTypeIcon(event.type)
  const vehicle = eventVehicleName(event)
  const map = mapsLink(event)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        padding: '14px 18px 14px 15px',
        borderBottom: '1px solid var(--c-border)',
        // The left rule carries the severity colour on unread rows only, so the
        // unread ones stand out down the edge of the list at a glance.
        borderLeft: `3px solid ${unread ? tone.color : 'transparent'}`,
        background: hover
          ? 'var(--c-hover)'
          : unread ? 'color-mix(in srgb, var(--ft-accent) 4%, transparent)' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <div style={{
        flexShrink: 0, width: 36, height: 36, borderRadius: 10,
        background: tone.bg, color: tone.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
      }}>
        <Icon size={17} strokeWidth={2.2} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: unread ? 750 : 550, color: 'var(--c-text1)', lineHeight: 1.4 }}>
            {event.title}
          </span>
          <SeverityChip severity={event.severity} />
          <span style={{
            fontSize: 10, color: 'var(--c-text3)', background: 'var(--c-thead)',
            borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap',
          }}>
            {alertTypeLabel(event.type)}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text3)', whiteSpace: 'nowrap' }}>
            {relativeTime(event.occurredAt)}
          </span>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--c-text2)', margin: 0, lineHeight: 1.5 }}>
          {eventDetail(event)}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px 14px', marginTop: 7, flexWrap: 'wrap' }}>
          {vehicle && (
            <span style={{ ...meta, color: 'var(--c-text2)', fontWeight: 600 }}>
              <Truck size={12} /> {vehicle}
            </span>
          )}
          {event.driver?.name && (
            <span style={meta}><User size={12} /> {event.driver.name}</span>
          )}
          {event.bg?.name && (
            <span style={meta}><Building2 size={12} /> {event.bg.name}</span>
          )}
          <span style={meta} title="UAE time">
            <Clock size={12} /> {uaeDateTime(event.occurredAt)}
          </span>
          {map && (
            <a
              href={map}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...meta, color: 'var(--ft-accent)', fontWeight: 600, textDecoration: 'none' }}
            >
              <MapPin size={12} /> View on map
            </a>
          )}
        </div>
      </div>

      {unread && (
        <button
          type="button"
          onClick={() => markAlertEventsRead([event.id])}
          title="Mark as read"
          aria-label={`Mark ${event.title} as read`}
          style={{
            flexShrink: 0, width: 28, height: 28, borderRadius: 7, marginTop: 2,
            border: '1px solid var(--c-border2)', background: 'var(--c-card)',
            color: 'var(--ft-accent)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Check size={13} strokeWidth={2.6} />
        </button>
      )}
    </div>
  )
}

function Empty({ title, body, action }) {
  return (
    <div style={{ padding: '56px 20px', textAlign: 'center' }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14, margin: '0 auto 14px',
        background: 'var(--c-thead)', color: 'var(--c-text3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <BellRing size={22} />
      </div>
      <p style={{ fontSize: 14, fontWeight: 650, color: 'var(--c-text1)', margin: '0 0 5px' }}>{title}</p>
      <p style={{ fontSize: 12, color: 'var(--c-text3)', margin: '0 auto', maxWidth: 380, lineHeight: 1.55 }}>{body}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

export default function ServerNotifications() {
  const navigate = useNavigate()
  const { events, unreadCount, loaded, hasMore, loadingMore, error } = useAlertEvents()
  useMinuteTick()

  const [tab,      setTab]      = useState('all')   // all | unread
  const [severity, setSeverity] = useState('all')
  const [type,     setType]     = useState('all')

  const filtered = useMemo(() => events.filter(e => {
    if (tab === 'unread' && e.readAt) return false
    if (severity !== 'all' && e.severity !== severity) return false
    if (type !== 'all' && e.type !== type) return false
    return true
  }), [events, tab, severity, type])

  const filtering = tab !== 'all' || severity !== 'all' || type !== 'all'
  const clearFilters = () => { setTab('all'); setSeverity('all'); setType('all') }

  let body
  if (!loaded) {
    body = <Empty title="Loading alerts…" body="Your latest alerts will appear here in a moment." />
  } else if (events.length === 0 && error) {
    body = (
      <Empty
        title="Alerts are not available right now"
        body="This page will try again on its own shortly."
        action={<button type="button" style={ghostBtn} onClick={refreshAlertEvents}>Try again</button>}
      />
    )
  } else if (events.length === 0) {
    body = (
      <Empty
        title="No alerts yet"
        body="Alerts appear here when a rule in Settings > Alerts fires — for example a vehicle going over its speed limit or leaving a geofence."
        action={<button type="button" style={ghostBtn} onClick={() => navigate('/settings/alerts')}>Open Settings › Alerts</button>}
      />
    )
  } else if (filtered.length === 0) {
    body = (
      <Empty
        title="No alerts match these filters"
        body={hasMore ? 'Older alerts may match — load more, or clear the filters.' : 'Try clearing the filters above.'}
        action={<button type="button" style={ghostBtn} onClick={clearFilters}>Clear filters</button>}
      />
    )
  } else {
    body = filtered.map(e => <EventRow key={e.id} event={e} />)
  }

  return (
    <>
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text1)', margin: 0 }}>Notifications</h1>
          {unreadCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#ef4444', borderRadius: 20, padding: '2px 9px' }}>
              {unreadCount} unread
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button type="button" style={ghostBtn} onClick={markAllAlertEventsRead}>
            <CheckCheck size={14} /> Mark all as read
          </button>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12,
        padding: '12px 16px', marginBottom: 16,
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', background: 'var(--c-input)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--c-border2)' }}>
          {[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }].map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              style={{
                padding: '5px 14px', fontSize: 12, fontWeight: tab === t.key ? 700 : 500, border: 'none', cursor: 'pointer',
                background: tab === t.key ? 'var(--ft-accent)' : 'transparent',
                color: tab === t.key ? '#fff' : 'var(--c-text2)',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select value={severity} onChange={e => setSeverity(e.target.value)} style={selectStyle} aria-label="Severity">
          <option value="all">All severities</option>
          {SEVERITY_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={type} onChange={e => setType(e.target.value)} style={selectStyle} aria-label="Alert type">
          <option value="all">All alert types</option>
          {ALERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {filtering && (
          <button
            type="button"
            onClick={clearFilters}
            style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--c-border2)', background: 'none', color: 'var(--c-text3)', fontSize: 11, cursor: 'pointer' }}
          >
            Clear filters
          </button>
        )}

        {loaded && events.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text3)' }}>
            {filtered.length} alert{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── List ── */}
      <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, overflow: 'hidden' }}>
        {body}
      </div>

      {/* ── Older ── */}
      {loaded && hasMore && events.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button
            type="button"
            onClick={loadOlderAlertEvents}
            disabled={loadingMore}
            style={{ ...ghostBtn, opacity: loadingMore ? 0.6 : 1, cursor: loadingMore ? 'default' : 'pointer' }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </>
  )
}
