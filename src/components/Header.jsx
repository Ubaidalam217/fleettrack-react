import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Moon, Sun } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import NotificationDropdown from './topbar/NotificationDropdown'
import UserDropdown         from './topbar/UserDropdown'

// ── Mock search data ───────────────────────────────────────────────────────
const MOCK_VEHICLES = [
  { id: 'm1', name: 'TRK-001', desc: 'Isuzu NQR, Running, Port Qasim Route' },
  { id: 'm2', name: 'TRK-002', desc: 'Hino 300, Running, DHA Phase 5' },
  { id: 'm3', name: 'TRK-003', desc: 'FAW Truck, Idle, Korangi Industrial' },
  { id: 'm4', name: 'TRK-004', desc: 'Isuzu ELF, Stopped, SITE Area' },
  { id: 'm5', name: 'TRK-005', desc: 'Hino 500, Running, North Nazimabad' },
]
const MOCK_DRIVERS = [
  { id: 'd1', name: 'Ahmed Raza',   desc: 'Assigned to TRK-001, Active' },
  { id: 'd2', name: 'Muhammad Ali', desc: 'Assigned to TRK-002, Active' },
  { id: 'd3', name: 'Fahad Khan',   desc: 'Assigned to TRK-003, On Break' },
  { id: 'd4', name: 'Zaid Hamid',   desc: 'Assigned to TRK-004, Active' },
  { id: 'd5', name: 'Hassan Ahmed', desc: 'Unassigned' },
]
const MOCK_TRIPS = [
  { id: 't1', name: 'KHI-PORT-2024-001',   desc: 'North Hub to Port Qasim, Today' },
  { id: 't2', name: 'DHA-AIRPORT-24-012',  desc: 'DHA Phase 5 to Airport, Yesterday' },
  { id: 't3', name: 'SITE-KORANGI-24-033', desc: 'SITE Area to Korangi, 2 days ago' },
]

function getResults(q, searchVehicles) {
  const lq = q.toLowerCase()
  const vehicleList = searchVehicles?.length
    ? searchVehicles.map(v => ({ id: v.id, name: v.name, desc: `${v.status}, ${v.ident || 'Unknown IMEI'}` }))
    : MOCK_VEHICLES
  return {
    vehicles: vehicleList.filter(v => v.name.toLowerCase().includes(lq) || v.desc.toLowerCase().includes(lq)).slice(0, 4),
    drivers:  MOCK_DRIVERS.filter(d => d.name.toLowerCase().includes(lq) || d.desc.toLowerCase().includes(lq)).slice(0, 3),
    trips:    MOCK_TRIPS.filter(t => t.name.toLowerCase().includes(lq) || t.desc.toLowerCase().includes(lq)).slice(0, 3),
  }
}

// ── Appearance-only panel style (positioning is applied by portal wrapper) ─
const PANEL_APPEARANCE = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-border)',
  borderRadius: 10,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  overflow: 'hidden',
}

// ── Search results content ─────────────────────────────────────────────────
function SearchResults({ query, results, onClose }) {
  const navigate = useNavigate()
  const total = results.vehicles.length + results.drivers.length + results.trips.length

  if (total === 0) {
    return (
      <div style={PANEL_APPEARANCE}>
        <div style={{ padding: '20px 14px', textAlign: 'center' }}>
          <svg width="28" height="28" viewBox="0 0 20 20" fill="var(--c-border2)" style={{ margin: '0 auto 8px', display: 'block' }}>
            <path fillRule="evenodd" clipRule="evenodd" d="M9.375 3.042A6.333 6.333 0 003.042 9.375a6.333 6.333 0 006.333 6.333 6.333 6.333 0 006.333-6.333 6.333 6.333 0 00-6.333-6.333zm-7.833 6.333a7.833 7.833 0 1114.233 4.565l2.958 2.958a.75.75 0 11-1.06 1.06l-2.958-2.957A7.833 7.833 0 011.542 9.375z"/>
          </svg>
          <p style={{ fontSize: 12, color: 'var(--c-text3)', margin: 0 }}>
            No results for <strong style={{ color: 'var(--c-text2)' }}>"{query}"</strong>
          </p>
        </div>
      </div>
    )
  }

  const groups = [
    { label: 'Vehicles', items: results.vehicles, nav: () => { navigate('/tracking'); onClose() } },
    { label: 'Drivers',  items: results.drivers,  nav: () => { navigate('/dashboard'); onClose() } },
    { label: 'Trips',    items: results.trips,     nav: () => { navigate('/dashboard'); onClose() } },
  ].filter(g => g.items.length > 0)

  return (
    <div style={PANEL_APPEARANCE}>
      {groups.map((group, gi) => (
        <div key={group.label}>
          {gi > 0 && <div style={{ height: 1, background: 'var(--c-border)', margin: '2px 0' }} />}
          <div style={{ padding: '6px 14px 2px', fontSize: 10, fontWeight: 700, color: 'var(--c-text3)', letterSpacing: '0.06em' }}>
            {group.label.toUpperCase()}
          </div>
          {group.items.map(item => (
            <button
              key={item.id}
              onClick={group.nav}
              style={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%', padding: '7px 14px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text1)' }}>{item.name}</span>
              <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>{item.desc}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Header ─────────────────────────────────────────────────────────────────
export default function Header({ isDark, toggleTheme, themeMode, setTheme, onMenuClick, searchVehicles, isConnected = true }) {
  const [time,        setTime]        = useState('')
  const [date,        setDate]        = useState('')
  const [searchOpen,  setSearchOpen]  = useState(false)
  const [query,       setQuery]       = useState('')
  const [showResults, setShowResults] = useState(false)
  const [searchPos,   setSearchPos]   = useState({ top: 0, left: 0, width: 0 })

  const searchRef      = useRef(null)   // desktop search wrapper
  const searchPanelRef = useRef(null)   // portaled search results panel
  const mobileRef      = useRef(null)   // mobile search drawer

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Recalculate search dropdown position
  useEffect(() => {
    if (!showResults) return
    const calc = () => {
      if (!searchRef.current) return
      const rect = searchRef.current.getBoundingClientRect()
      setSearchPos({ top: rect.bottom + 6, left: rect.left, width: rect.width })
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [showResults])

  // Close search results on outside click — checks input wrapper AND portal panel
  useEffect(() => {
    if (!showResults) return
    const h = e => {
      const inSearch = searchRef.current?.contains(e.target)
      const inPanel  = searchPanelRef.current?.contains(e.target)
      if (!inSearch && !inPanel) setShowResults(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showResults])

  // Close search on Escape
  useEffect(() => {
    if (!showResults && !searchOpen) return
    const h = e => {
      if (e.key === 'Escape') { setQuery(''); setShowResults(false); setSearchOpen(false) }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [showResults, searchOpen])

  const handleQueryChange = v => {
    setQuery(v)
    setShowResults(v.trim().length >= 2)
  }

  const results = query.trim().length >= 2 ? getResults(query, searchVehicles) : null

  return (
    <>
      <header
        className="sticky top-0 z-30 flex h-14 md:h-16 items-center justify-between px-3 md:px-4 lg:px-6"
        style={{ backgroundColor: 'var(--c-header)', borderBottom: '1px solid var(--c-border)' }}
      >
        {/* Left */}
        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={onMenuClick}
            className="flex h-8 w-8 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--c-text3)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="5.5"   width="18" height="1.5" rx=".75"/>
              <rect x="3" y="11.25" width="18" height="1.5" rx=".75"/>
              <rect x="3" y="17"    width="12" height="1.5" rx=".75"/>
            </svg>
          </button>
          <div className="hidden sm:flex items-center">
            {/* Two files rather than one + a CSS filter: the wordmark is
                two-tone, so a filter that lifts "Solutions" for dark mode
                would drag the green with it.
                Switched off the isDark prop, not a `dark:` utility — this app's
                dark mode is a hand-rolled `.dark` class on a div, whereas
                Tailwind 4's `dark:` variant follows prefers-color-scheme, so
                the utility would track the OS and ignore the theme toggle. */}
            <img
              src={isDark ? '/logo/fleetmax-logo-white.png' : '/logo/fleetmax-logo.png'}
              alt="FleetmaX Solutions"
              style={{ height: 26, width: 'auto' }}
            />
          </div>
        </div>

        {/* Center: Search (desktop only) */}
        <div ref={searchRef} className="hidden md:flex flex-1 max-w-sm mx-4 lg:mx-6" style={{ position: 'relative' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="15" height="15" viewBox="0 0 20 20" fill="currentColor" style={{ color: 'var(--c-text3)', pointerEvents: 'none' }}>
              <path fillRule="evenodd" clipRule="evenodd" d="M9.375 3.042A6.333 6.333 0 003.042 9.375a6.333 6.333 0 006.333 6.333 6.333 6.333 0 006.333-6.333 6.333 6.333 0 00-6.333-6.333zm-7.833 6.333a7.833 7.833 0 1114.233 4.565l2.958 2.958a.75.75 0 11-1.06 1.06l-2.958-2.957A7.833 7.833 0 011.542 9.375z"/>
            </svg>
            <input
              type="text"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              onFocus={() => { if (query.trim().length >= 2) setShowResults(true) }}
              placeholder="Search vehicles, drivers, trips..."
              aria-expanded={showResults}
              aria-haspopup="listbox"
              className="w-full rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none transition-colors"
              style={{
                background: 'var(--c-input)',
                border: `1px solid ${showResults ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
                boxShadow: showResults ? '0 0 0 3px color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'none',
                color: 'var(--c-text1)',
              }}
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setShowResults(false) }}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text3)', display: 'flex', padding: 2 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5">
          {/* Mobile search icon */}
          <button
            className="md:hidden flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
            style={{ border: '1px solid var(--c-border2)', color: 'var(--c-text2)' }}
            onClick={() => { setSearchOpen(s => !s); setQuery(''); setShowResults(false) }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style={{ color: 'var(--c-text3)' }}>
              <path fillRule="evenodd" clipRule="evenodd" d="M9.375 3.042A6.333 6.333 0 003.042 9.375a6.333 6.333 0 006.333 6.333 6.333 6.333 0 006.333-6.333 6.333 6.333 0 00-6.333-6.333zm-7.833 6.333a7.833 7.833 0 1114.233 4.565l2.958 2.958a.75.75 0 11-1.06 1.06l-2.958-2.957A7.833 7.833 0 011.542 9.375z"/>
            </svg>
          </button>

          {/* Ask AI */}
          <button className="hidden sm:flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-2.5 md:px-3 py-2 text-[11px] md:text-[12px] font-semibold text-white transition-colors" style={{ boxShadow: '0 4px 12px color-mix(in srgb, var(--ft-accent) 20%, transparent)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="hidden lg:inline">Ask AI Assistant</span>
            <span className="lg:hidden">AI</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="flex h-8 w-8 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors"
            style={{ border: '1px solid var(--c-border2)', color: 'var(--c-text2)' }}
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* Notifications */}
          <NotificationDropdown />

          {/* Date/Time */}
          <div className="hidden md:flex flex-col items-end leading-tight">
            <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--c-text1)' }}>{time}</span>
            <span className="text-[10px]" style={{ color: 'var(--c-text3)' }}>{date}</span>
          </div>

          {/* MQTT connection status badge */}
          <div
            className="hidden sm:flex items-center gap-1.5 rounded-full px-2 md:px-2.5 py-1"
            style={{
              background: isConnected ? 'rgba(16,185,129,0.1)' : 'rgba(234,179,8,0.1)',
              border: `1px solid ${isConnected ? 'rgba(16,185,129,0.2)' : 'rgba(234,179,8,0.2)'}`,
            }}
          >
            <span className={`h-1.5 w-1.5 rounded-full live-blink ${isConnected ? 'bg-emerald-400' : 'bg-yellow-400'}`}></span>
            <span className={`text-[10px] md:text-[11px] font-bold tracking-wide ${isConnected ? 'text-emerald-400' : 'text-yellow-400'}`}>
              {isConnected ? 'LIVE' : 'Reconnecting...'}
            </span>
          </div>

          {/* User dropdown */}
          <UserDropdown themeMode={themeMode ?? 'light'} setTheme={setTheme ?? (() => {})} />
        </div>
      </header>

      {/* Mobile search drawer — inline (not portaled, lives below sticky header) */}
      {searchOpen && (
        <div
          ref={mobileRef}
          className="md:hidden px-3 pb-2 pt-1"
          style={{ backgroundColor: 'var(--c-header)', borderBottom: '1px solid var(--c-border)', position: 'relative' }}
        >
          <div style={{ position: 'relative' }}>
            <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style={{ color: 'var(--c-text3)', pointerEvents: 'none' }}>
              <path fillRule="evenodd" clipRule="evenodd" d="M9.375 3.042A6.333 6.333 0 003.042 9.375a6.333 6.333 0 006.333 6.333 6.333 6.333 0 006.333-6.333 6.333 6.333 0 00-6.333-6.333zm-7.833 6.333a7.833 7.833 0 1114.233 4.565l2.958 2.958a.75.75 0 11-1.06 1.06l-2.958-2.957A7.833 7.833 0 011.542 9.375z"/>
            </svg>
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              placeholder="Search vehicles, drivers, trips..."
              className="w-full rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none"
              style={{ background: 'var(--c-input)', border: '1px solid var(--c-border2)', color: 'var(--c-text1)' }}
            />
          </div>
          {/* Mobile search results — inline relative positioning, not portaled */}
          {showResults && results && (
            <div style={{ position: 'relative', marginTop: 6, zIndex: 9999 }}>
              <SearchResults query={query} results={results} onClose={() => { setShowResults(false); setQuery(''); setSearchOpen(false) }} />
            </div>
          )}
        </div>
      )}

      {/* Desktop search results portal — escapes all stacking contexts */}
      {showResults && results && createPortal(
        <div
          ref={searchPanelRef}
          style={{
            position: 'fixed',
            top: searchPos.top,
            left: searchPos.left,
            width: searchPos.width,
            minWidth: 280,
            zIndex: 9999,
          }}
        >
          <SearchResults
            query={query}
            results={results}
            onClose={() => { setShowResults(false); setQuery('') }}
          />
        </div>,
        document.body
      )}
    </>
  )
}
