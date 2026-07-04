import Sidebar from '../components/Sidebar'
import Header  from '../components/Header'

export default function Reports({ isDark, toggleTheme, themeMode, setTheme }) {
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
              background: 'rgba(168,85,247,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-text1)', margin: '0 0 8px' }}>
              Reports
            </h2>
            <p style={{ fontSize: 14, color: 'var(--c-text3)', lineHeight: 1.6, margin: 0 }}>
              Fleet reports and exportable summaries are coming in Phase 2. This page will include PDF exports, scheduled reports, and driver performance breakdowns.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
