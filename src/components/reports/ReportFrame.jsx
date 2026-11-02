import { useState } from 'react'
import Sidebar from '../Sidebar'
import Header from '../Header'
import ReportsBackLink from './ReportsBackLink'

/**
 * Page chrome shared by the simpler reports (the Vehicle and Driver lists, the
 * Event Occurrence Report): sidebar, header, the "All reports" link, a title,
 * and the print rules that send only `#report-paper` to the printer.
 */
export default function ReportFrame({ title, desc, children, isDark, toggleTheme, themeMode, setTheme }) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  )

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-page)' }}>
      <Sidebar sidebarOpen={sidebarOpen} />

      <div className="relative flex flex-col flex-1 overflow-hidden min-w-0">
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSidebarOpen(false)} />
        )}

        <Header
          isDark={isDark} toggleTheme={toggleTheme}
          themeMode={themeMode} setTheme={setTheme}
          onMenuClick={() => setSidebarOpen(s => !s)}
        />

        <main className="flex-1 overflow-y-auto no-scrollbar" id="report-frame-main">
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 16px 48px' }}>
            <div className="report-screen-only" style={{ marginBottom: 16 }}>
              <ReportsBackLink />
              <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text1)', margin: 0 }}>{title}</h1>
              {desc && <p style={{ fontSize: 12.5, color: 'var(--c-text3)', margin: '4px 0 0' }}>{desc}</p>}
            </div>
            {children}
          </div>
        </main>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          html, body, #root { height: auto !important; overflow: visible !important; background: #fff !important; }
          body * { visibility: hidden !important; }
          #report-paper, #report-paper * { visibility: visible !important; }
          #report-paper { position: absolute !important; left: 0; top: 0; width: 100%; border: 0 !important; }
          #report-frame-main { overflow: visible !important; }
          .report-screen-only { display: none !important; }
          aside, header { display: none !important; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}
