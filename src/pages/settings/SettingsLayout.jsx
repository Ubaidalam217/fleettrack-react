import Sidebar from '../../components/Sidebar'
import Header  from '../../components/Header'

/**
 * Page chrome for every Settings leaf — the same Sidebar + Header + <main>
 * shell the rest of the app builds by hand (see pages/Charts.jsx), factored out
 * because Phase 1 adds six pages that would otherwise copy it six times.
 *
 * Phase 1 renders the title and nothing else. `children` is here so Phase 2 can
 * drop a table or form underneath without touching any of these page files.
 */
export default function SettingsLayout({ title, children, isDark, toggleTheme, themeMode, setTheme }) {
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
        <main className="flex-1 overflow-y-auto" style={{ padding: '24px 20px 40px' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text1)', margin: 0 }}>
            {title}
          </h1>
          {children}
        </main>
      </div>
    </div>
  )
}
