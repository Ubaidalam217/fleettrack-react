import Sidebar from '../components/Sidebar'
import Header  from '../components/Header'

export default function Charts({ isDark, toggleTheme, themeMode, setTheme }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--c-page)' }}>
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Header
          isDark={isDark}
          toggleTheme={toggleTheme}
          themeMode={themeMode}
          setTheme={setTheme}
        />
        <main className="flex-1 overflow-y-auto flex items-center justify-center" style={{ padding: '48px 32px' }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px',
              background: 'color-mix(in srgb, var(--ft-accent) 10%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5ba354" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-text1)', margin: '0 0 8px' }}>
              Charts
            </h2>
            <p style={{ fontSize: 14, color: 'var(--c-text3)', lineHeight: 1.6, margin: 0 }}>
              Advanced analytics charts are coming in Phase 2. This page will include trend charts, heatmaps, and comparative fleet analytics.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
