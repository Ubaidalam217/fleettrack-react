import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Search, Star, X, FilePlus2, Fuel, Clock } from 'lucide-react'
import PageShell from '../../components/PageShell'
import {
  REPORT_CATEGORIES, REPORTS_MENU, OIL_GAS_CATEGORIES, OIL_GAS_MENU, REPORTS_HUB_PATH, OIL_GAS_HUB_PATH,
} from '../../components/sidebar/reportsNav'
import { useCurrentUser } from '../../services/authUser'
import { useCanOpen } from '../../data/screens'

/**
 * "Run a Report" — every report as a row in its category card.
 *
 * Client, 2026-11-02 ("Report structure.jpeg"): reports are picked from category
 * cards with a filter box on top, like Ctrack MaXx, not from a long list.
 * Favourites are per viewer and per user, so they live in localStorage; losing
 * them (private window, cleared data) only empties the Favourites tab.
 *
 * The same page is the Oil & Gas hub (`catalog="oilGas"`, client 2026-11-10):
 * the client's IVMS list, apart from the normal catalog. It is the third tab,
 * after New Report and Favourite Reports ("Oil & Gas will come inside Reports,
 * as its third menu"), and keeps its own URL so a report's back link and a
 * bookmark land on it. Favourites hold reports of both catalogs.
 */

const CATALOGS = {
  reports: {
    title: 'Run a Report',
    subtitle: 'Choose a report to set its vehicles, dates and filters.',
    categories: REPORT_CATEGORIES, menu: REPORTS_MENU, hub: REPORTS_HUB_PATH,
  },
  oilGas: {
    title: 'Oil & Gas Reports',
    subtitle: 'The IVMS reports for oil and gas operations. Choose one to set its vehicles, dates and filters.',
    categories: OIL_GAS_CATEGORIES, menu: OIL_GAS_MENU, hub: OIL_GAS_HUB_PATH,
    // Its reports open under the client's names (components/reports/useReportTitle.js).
    titles: true,
  },
}

const favKey = user => `ft-report-favs:${user?.id ?? user?.email ?? 'anon'}`

function loadFavs(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function saveFavs(key, ids) {
  try { localStorage.setItem(key, JSON.stringify(ids)) } catch { /* storage blocked: favourites just won't persist */ }
}

const matches = (report, q) =>
  !q || report.label.toLowerCase().includes(q) || report.desc.toLowerCase().includes(q)

function ReportRow({ report, hub, titled, fav, onToggleFav }) {
  const Icon = report.icon
  return (
    <div className="ft-report-row">
      {/* The hub rides along so the report's back link returns here. */}
      {/* A row's own `state` rides along too (Device Installation History opens per tracker). */}
      <Link to={report.path} state={{ ...report.state, hub, ...(titled ? { title: report.label } : {}) }} title={report.desc} className="ft-report-link">
        <Icon size={15} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--ft-accent)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>{report.label}</span>
        {!report.ready && (
          <span className="ft-report-soon">
            <Clock size={11} strokeWidth={2.4} aria-hidden="true" />
            Coming soon
          </span>
        )}
      </Link>
      <button
        type="button"
        className="ft-report-star"
        data-on={fav ? 'true' : 'false'}
        onClick={() => onToggleFav(report.id)}
        aria-pressed={fav}
        aria-label={fav ? `Remove ${report.label} from favourites` : `Add ${report.label} to favourites`}
        title={fav ? 'Remove from favourites' : 'Add to favourites'}
      >
        <Star size={14} strokeWidth={2} fill={fav ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}

function CategoryCard({ title, desc, reports, hub, titled, favs, onToggleFav }) {
  return (
    <section style={{
      borderRadius: 12, overflow: 'hidden', background: 'var(--c-card)',
      border: '1px solid var(--c-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}>
      <header style={{ background: 'var(--c-sb-bg)', padding: '12px 16px 13px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#fff', letterSpacing: 0.2 }}>{title}</h2>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>
            {reports.length} {reports.length === 1 ? 'report' : 'reports'}
          </span>
        </div>
        {desc && <p style={{ margin: '3px 0 0', fontSize: 12, lineHeight: 1.4, color: 'rgba(255,255,255,0.82)' }}>{desc}</p>}
      </header>
      <div style={{ padding: '6px 0' }}>
        {reports.map(r => (
          <ReportRow key={r.id} report={r} hub={r.hub ?? hub} titled={r.titled ?? titled} fav={favs.includes(r.id)} onToggleFav={onToggleFav} />
        ))}
      </div>
    </section>
  )
}

const TABS = [
  { id: 'all',    label: 'New Report',        icon: FilePlus2 },
  { id: 'favs',   label: 'Favourite Reports', icon: Star },
  { id: 'oilGas', label: 'Oil & Gas',         icon: Fuel },
]

// Starred reports of both catalogs, each opening the way its own tab opens it.
const FAV_SOURCES = [CATALOGS.reports, CATALOGS.oilGas]

export default function ReportsHub({ catalog = 'reports', ...props }) {
  const { state } = useLocation()
  const navigate = useNavigate()
  const C = catalog === 'oilGas' ? CATALOGS.oilGas : CATALOGS.reports
  const user = useCurrentUser()
  const key = favKey(user)
  const [favState, setFavState] = useState(() => ({ key, ids: loadFavs(key) }))
  // A different user signing in on the same tab gets their own list.
  const favs = favState.key === key ? favState.ids : loadFavs(key)
  // Oil & Gas is a route of its own; the other two tabs share /reports.
  const [localTab, setLocalTab] = useState(() => (state?.tab === 'favs' ? 'favs' : 'all'))
  const tab = catalog === 'oilGas' ? 'oilGas' : localTab
  const openTab = id => {
    if (id === 'oilGas') {
      if (catalog !== 'oilGas') navigate(OIL_GAS_HUB_PATH)
      return
    }
    setLocalTab(id)
    if (catalog === 'oilGas') navigate(REPORTS_HUB_PATH, { state: { tab: id } })
  }
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const toggleFav = id => {
    const next = favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id]
    saveFavs(key, next)
    setFavState({ key, ids: next })
  }

  // Permissions: reports this user has No Access to are not offered.
  const canOpen = useCanOpen()
  const cards = useMemo(() => {
    if (tab === 'favs') {
      const reports = FAV_SOURCES.flatMap(S => S.menu
        .filter(r => canOpen(r.path) && favs.includes(r.id) && matches(r, q))
        .map(r => ({ ...r, hub: S.hub, titled: S.titles })))
      return reports.length ? [{ id: 'favs', title: 'My Favourites', desc: 'Reports you starred, for quick access.', reports }] : []
    }
    return C.categories
      .map(c => ({ ...c, reports: c.reports.filter(r => canOpen(r.path) && matches(r, q)) }))
      .filter(c => c.reports.length)
  // canOpen changes with the session only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, favs, q, C])

  return (
    <PageShell title={C.title} subtitle={C.subtitle} {...props}>
      {/* Tabs */}
      <div role="tablist" className="ft-hub-tabs" style={{ display: 'flex', gap: 4, marginTop: 16, borderBottom: '1px solid var(--c-border)', overflowX: 'auto' }}>
        {TABS.map(t => {
          const on = tab === t.id
          const count = t.id === 'favs' ? favs.length : null
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => openTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 14px', flexShrink: 0, whiteSpace: 'nowrap',
                border: 0, background: 'transparent', cursor: 'pointer', marginBottom: -1,
                borderBottom: `2px solid ${on ? 'var(--ft-accent)' : 'transparent'}`,
                color: on ? 'var(--c-text1)' : 'var(--c-text3)',
                fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
              }}
            >
              <t.icon size={14} />
              {t.label}
              {count > 0 && (
                <span style={{
                  fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                  background: 'color-mix(in srgb, var(--ft-accent) 15%, transparent)', color: 'var(--ft-accent)',
                }}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Filter */}
      <div style={{ position: 'relative', margin: '14px 0 16px' }}>
        <Search size={16} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', pointerEvents: 'none' }} />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter reports"
          aria-label="Filter reports"
          style={{
            width: '100%', boxSizing: 'border-box', height: 42, padding: '0 38px 0 38px',
            borderRadius: 10, border: '1px solid var(--c-border)', background: 'var(--c-card)',
            color: 'var(--c-text1)', fontSize: 13.5, outline: 'none',
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear filter"
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', color: 'var(--c-text3)', cursor: 'pointer', padding: 4, display: 'flex' }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {cards.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, alignItems: 'start' }}>
          {cards.map(c => (
            <CategoryCard key={c.id} title={c.title} desc={c.desc} reports={c.reports} hub={C.hub} titled={C.titles} favs={favs} onToggleFav={toggleFav} />
          ))}
        </div>
      ) : (
        <div style={{
          padding: '44px 16px', textAlign: 'center', borderRadius: 12,
          border: '1px dashed var(--c-border)', color: 'var(--c-text3)', fontSize: 13,
        }}>
          {tab === 'favs' && !favs.length
            ? 'No favourites yet. Tap the star next to a report to pin it here.'
            : `No report matches “${query.trim()}”.`}
        </div>
      )}
    </PageShell>
  )
}
