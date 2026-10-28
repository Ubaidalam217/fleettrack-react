import Sidebar from './Sidebar'
import Header  from './Header'

/**
 * Sidebar + Header + a titled <main> — the shell the rest of the app builds by
 * hand (see pages/Charts.jsx).
 *
 * Was settings/SettingsLayout, which every Settings leaf uses; moved up here
 * when the Reports placeholders needed exactly the same thing. SettingsLayout
 * still exists and still works — it now delegates — so none of the nine
 * Settings pages changed.
 *
 * `children` renders under the title, so a page that grows a table or a form
 * later needs no change here.
 */
export default function PageShell({ title, subtitle, children, isDark, toggleTheme, themeMode, setTheme }) {
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
          {subtitle && (
            <p style={{ fontSize: 12.5, color: 'var(--c-text3)', margin: '6px 0 0' }}>
              {subtitle}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
