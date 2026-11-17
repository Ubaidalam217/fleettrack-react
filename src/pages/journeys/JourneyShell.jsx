import { useState } from 'react'
import Sidebar from '../../components/Sidebar'
import Header from '../../components/Header'
import './jms.css'

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
