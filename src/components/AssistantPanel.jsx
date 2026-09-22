import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { askAssistant } from '../services/assistant'

// In-app help assistant. A guide only — it explains features, it never acts on
// the fleet, and it holds no state beyond this session (there is no backend to
// persist a transcript to).
//
// Built on the app's existing modal vocabulary: portal to body, backdrop,
// Escape to close, focus returned to whatever opened it — the same shape as
// EditAssetModal and ConfirmDialog.

const WELCOME =
  "Hi! I'm the FleetmaX Assistant. Ask me how to add a company, create a sub-user, set up an alert, and more."

const SUGGESTIONS = [
  'How do I add a sub-user?',
  'How do I set a temperature alert?',
  'How do I replay a trip?',
]

const PANEL_CSS = `
  @keyframes ft-ai-in  { from { transform: translateX(16px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
  @keyframes ft-ai-dot { 0%, 80%, 100% { opacity: .25 } 40% { opacity: 1 } }
  .ft-ai-panel { animation: ft-ai-in .22s cubic-bezier(.22,1,.36,1) both; }
  .ft-ai-dot   { animation: ft-ai-dot 1.2s infinite; }
  .ft-ai-dot:nth-child(2) { animation-delay: .15s }
  .ft-ai-dot:nth-child(3) { animation-delay: .30s }
  .ft-ai-scroll { scrollbar-width: thin; scrollbar-color: var(--c-border2) transparent; }
  .ft-ai-scroll::-webkit-scrollbar { width: 6px }
  .ft-ai-scroll::-webkit-scrollbar-thumb { background: var(--c-border2); border-radius: 3px }
  @media (prefers-reduced-motion: reduce) {
    .ft-ai-panel { animation: none } .ft-ai-dot { animation: none; opacity: .6 }
  }
`

function Sparkle({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

function Bubble({ role, text }) {
  const mine = role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '86%',
          padding: '9px 12px',
          borderRadius: 12,
          borderBottomRightRadius: mine ? 4 : 12,
          borderBottomLeftRadius:  mine ? 12 : 4,
          background: mine ? 'var(--ft-accent)' : 'var(--c-card2)',
          border: mine ? 'none' : '1px solid var(--c-border2)',
          color: mine ? '#fff' : 'var(--c-text1)',
          fontSize: 12.5,
          lineHeight: 1.6,
          // The model answers in numbered steps; without this they collapse
          // onto one line.
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </div>
    </div>
  )
}

export default function AssistantPanel({ onClose, isDark = false }) {
  const [messages, setMessages] = useState([{ role: 'assistant', text: WELCOME }])
  const [input, setInput]   = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState(null)

  const listRef  = useRef(null)
  const inputRef = useRef(null)
  const returnTo = useRef(typeof document !== 'undefined' ? document.activeElement : null)

  useEffect(() => {
    inputRef.current?.focus()
    const el = returnTo.current
    return () => { if (el instanceof HTMLElement) el.focus() }
  }, [])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Pin to the newest message, including while the typing indicator is up.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  const send = async (raw) => {
    const text = (raw ?? input).trim()
    if (!text || busy) return

    const next = [...messages, { role: 'user', text }]
    setMessages(next)
    setInput('')
    setError(null)
    setBusy(true)

    try {
      // The whole visible history goes up; the function decides how much of it
      // to actually bill for.
      const reply = await askAssistant(next)
      setMessages(m => [...m, { role: 'assistant', text: reply }])
    } catch (e) {
      // The question stays in the thread so it can be retried by asking again.
      setError(e.message)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const showSuggestions = messages.length === 1 && !busy

  return createPortal(
    // The theme class has to be re-applied here. App.jsx puts `dark` on a div
    // inside #root, but this portal mounts on <body> — outside it — so without
    // this wrapper every --c-* token falls back to its :root (light) value and
    // the panel renders white on a dark page. A plain div with no transform,
    // so the fixed children below still position against the viewport.
    <div className={isDark ? 'dark' : ''}>
      <style>{PANEL_CSS}</style>

      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 9900, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
      />

      <aside
        className="ft-ai-panel"
        role="dialog"
        aria-modal="true"
        aria-label="FleetmaX Assistant"
        style={{
          position: 'fixed', zIndex: 9901,
          top: 0, right: 0, bottom: 0,
          width: 'min(420px, 100vw)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--c-card)',
          borderLeft: '1px solid var(--c-border)',
          boxShadow: '-16px 0 48px rgba(0,0,0,0.28)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          padding: '14px 16px', borderBottom: '1px solid var(--c-border2)',
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--ft-accent) 12%, transparent)',
            color: 'var(--ft-accent)',
          }}>
            <Sparkle size={15} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--c-text1)' }}>FleetmaX Assistant</div>
            <div style={{ fontSize: 10.5, color: 'var(--c-text3)' }}>Answers questions about using the app</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            style={{
              width: 27, height: 27, borderRadius: 7, flexShrink: 0,
              border: '1px solid var(--c-border2)', background: 'var(--c-input)',
              color: 'var(--c-text3)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div
          ref={listRef}
          className="ft-ai-scroll"
          style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          {messages.map((m, i) => <Bubble key={i} role={m.role} text={m.text} />)}

          {busy && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div
                role="status"
                aria-label="Assistant is typing"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '11px 14px', borderRadius: 12, borderBottomLeftRadius: 4,
                  background: 'var(--c-card2)', border: '1px solid var(--c-border2)',
                }}
              >
                {[0, 1, 2].map(d => (
                  <span
                    key={d}
                    className="ft-ai-dot"
                    style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--c-text3)' }}
                  />
                ))}
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                padding: '9px 12px', borderRadius: 10,
                background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444', fontSize: 11.5, lineHeight: 1.55,
              }}
            >
              {error}
            </div>
          )}

          {showSuggestions && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  style={{
                    padding: '6px 11px', borderRadius: 999, cursor: 'pointer',
                    border: '1px solid var(--c-border)', background: 'var(--c-input)',
                    color: 'var(--c-text2)', fontSize: 11, fontWeight: 600,
                    textAlign: 'left',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{
          flexShrink: 0, padding: '12px 16px 14px',
          borderTop: '1px solid var(--c-border2)',
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask how to use FleetmaX…"
              aria-label="Your question"
              style={{
                flex: 1, minWidth: 0, boxSizing: 'border-box',
                padding: '9px 11px', borderRadius: 9, outline: 'none',
                border: '1px solid var(--c-border)',
                background: 'var(--c-input)', color: 'var(--c-text1)',
                fontSize: 12.5, fontFamily: 'inherit', lineHeight: 1.5,
                resize: 'none', maxHeight: 110,
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--ft-accent)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--c-border)' }}
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={busy || !input.trim()}
              aria-label="Send"
              style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0, border: 'none',
                background: busy || !input.trim() ? 'var(--c-progress)' : 'var(--ft-accent)',
                color: busy || !input.trim() ? 'var(--c-text3)' : '#fff',
                cursor: busy || !input.trim() ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background .15s',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p style={{ margin: '7px 0 0', fontSize: 10, color: 'var(--c-text3)', lineHeight: 1.45 }}>
            A guide only — it explains features, it cannot change your fleet.
          </p>
        </div>
      </aside>
    </div>,
    document.body
  )
}
