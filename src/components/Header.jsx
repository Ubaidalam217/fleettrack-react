import { useState, useEffect } from 'react'
import { Moon, Sun } from 'lucide-react'
import NotificationDropdown from './topbar/NotificationDropdown'
import UserDropdown         from './topbar/UserDropdown'

// ── Connection badge ───────────────────────────────────────────────────────
function LiveBadge({ isConnected }) {
  return (
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
  )
}

function DateTime({ time, date }) {
  return (
    <div className="hidden md:flex flex-col leading-tight items-end">
      <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--c-text1)' }}>{time}</span>
      <span className="text-[10px]" style={{ color: 'var(--c-text3)' }}>{date}</span>
    </div>
  )
}

// ── Header ─────────────────────────────────────────────────────────────────
/**
 * The top bar, identical on every page.
 *
 * Left is the sidebar toggle and nothing else. Everything ambient or
 * interactive is one cluster on the right, in a fixed reading order:
 * Ask AI, connection, clock, theme, notifications, account.
 *
 * There is no search here. The sidebar owns navigation search and the Live Map
 * owns vehicle search; a third box in the header was a duplicate of one or the
 * other on every page it appeared on.
 */
export default function Header({ isDark, toggleTheme, themeMode, setTheme, onMenuClick, isConnected = true }) {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')

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

  return (
    <header
      className="sticky top-0 z-30 flex h-14 md:h-16 items-center justify-between px-3 md:px-4 lg:px-6"
      style={{ backgroundColor: 'var(--c-header)', borderBottom: '1px solid var(--c-border)' }}
    >
      {/* Left — sidebar toggle only */}
      <div className="flex items-center">
        <button
          onClick={onMenuClick}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          className="flex h-8 w-8 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors"
          style={{ color: 'var(--c-text3)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="5.5"   width="18" height="1.5" rx=".75"/>
            <rect x="3" y="11.25" width="18" height="1.5" rx=".75"/>
            <rect x="3" y="17"    width="12" height="1.5" rx=".75"/>
          </svg>
        </button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5">
        {/* Ask AI */}
        <button className="hidden sm:flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-2.5 md:px-3 py-2 text-[11px] md:text-[12px] font-semibold text-white transition-colors" style={{ boxShadow: '0 4px 12px color-mix(in srgb, var(--ft-accent) 20%, transparent)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="hidden lg:inline">Ask AI Assistant</span>
          <span className="lg:hidden">AI</span>
        </button>

        {/* MQTT connection status badge */}
        <LiveBadge isConnected={isConnected} />

        {/* Date/Time */}
        <DateTime time={time} date={date} />

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

        {/* User dropdown */}
        <UserDropdown themeMode={themeMode ?? 'light'} setTheme={setTheme ?? (() => {})} />
      </div>
    </header>
  )
}
