import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message || 'Unknown error' }
  }

  componentDidCatch(err, info) {
    console.error('[FleetmaX] Uncaught error:', err, info?.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100vh',
        background: 'var(--c-page)', color: 'var(--c-text1)',
        padding: 32, fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{
          maxWidth: 440, textAlign: 'center',
          background: 'var(--c-card)', border: '1px solid var(--c-border)',
          borderRadius: 16, padding: '40px 32px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: 'var(--c-text1)' }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 13, color: 'var(--c-text2)', margin: '0 0 24px', lineHeight: 1.6 }}>
            An unexpected error occurred. Refreshing the page should fix it. If the problem persists, contact support.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px', borderRadius: 9, border: 'none',
              background: 'var(--ft-accent)', color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Refresh page
          </button>
        </div>
      </div>
    )
  }
}
