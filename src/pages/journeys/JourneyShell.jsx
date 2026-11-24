import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Route, Radio, CirclePlus, ShieldCheck, BellRing, BookMarked, Wand2, Settings2 } from 'lucide-react'
import Sidebar from '../../components/Sidebar'
import Header from '../../components/Header'
import { useCanOpen, useScreenLevel, atLeast } from '../../data/screens'
import { activeTabKey, visibleTabs } from '../../utils/journeyTabs'
import './jms.css'

const TAB_ICON = { journeys: Route, live: Radio, new: CirclePlus, approvals: ShieldCheck, alerts: BellRing, checkpoints: BookMarked, optimize: Wand2, settings: Settings2 }

/**
 * Every Journey Management screen in one bar (client 2026-11-24): the tab
 * for the page you are on is lit, the others one tap away. Same rights as the
 * sidebar: a screen you may not open is not shown. Scrolls sideways on a phone.
 */
function JourneyTabs() {
  const { pathname } = useLocation()
  const canOpen = useCanOpen()
  const level = useScreenLevel()
  const tabs = visibleTabs({ canOpen, journeysAtLeast: need => atLeast(level('journeys'), need) })
  const active = activeTabKey(pathname)
  const bar = useRef(null)
  // A phone shows the first tabs; bring the lit one into view.
  useEffect(() => {
    bar.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [active])
  if (!tabs.length) return null
  return (
    <nav className="j-nav" aria-label="Journey Management" ref={bar}>
      {tabs.map(t => {
        const Icon = TAB_ICON[t.key]
        return (
          <Link key={t.key} to={t.path} className="j-tab" aria-current={active === t.key ? 'page' : undefined}>
            {Icon && <Icon size={14} />}{t.label}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * The frame every Journey Management page sits in: the app's sidebar and top
 * bar, and a main area in the module's own theme (.jms-theme, jms.css —
 * the client's steel-blue glass look of 2026-11-17, scoped to this module).
 */
export default function JourneyShell({ isDark, toggleTheme, themeMode, setTheme, crumb, title, subtitle, actions, children, wide = false }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-page)' }}>
      <Sidebar sidebarOpen={sidebarOpen} />
      <div className="relative flex flex-col flex-1 overflow-hidden min-w-0">
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSidebarOpen(false)} />
        )}
        <Header isDark={isDark} toggleTheme={toggleTheme} themeMode={themeMode} setTheme={setTheme} onMenuClick={() => setSidebarOpen(s => !s)} />
        <main className="flex-1 overflow-y-auto no-scrollbar jms-theme">
          <div className="j-page" style={wide ? { maxWidth: 'none' } : undefined}>
            <JourneyTabs />
            {(title || actions) && (
              <div className="j-head">
                <div style={{ minWidth: 0 }}>
                  <div className="j-crumb">Journey Management{crumb ? ` · ${crumb}` : ''}</div>
                  {title && <h1 className="j-title">{title}</h1>}
                  {subtitle && <p className="j-sub">{subtitle}</p>}
                </div>
                {actions && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
