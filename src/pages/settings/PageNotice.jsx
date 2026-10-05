import { CARD_SURFACE } from './formStyles'

/**
 * First-load skeleton, stale-data banner and read-only notice.
 *
 * One component so the three states cannot be rendered in contradictory
 * combinations — a page cannot show "loading" and a populated table at once.
 *
 * Its own file, and the only export, so Fast Refresh works — the hooks and helpers
 * it is used with live in pageChrome.js. Same split as FormKit.jsx / formStyles.js.
 */
export default function PageNotice({ loading, error, retry, readOnly }) {
  if (loading) {
    return (
      <div style={{ ...CARD_SURFACE, padding: '34px 16px', textAlign: 'center', margin: '14px 0' }}>
        <style>{`@keyframes pns { to { transform: rotate(360deg) } }`}</style>
        <div style={{
          width: 20, height: 20, margin: '0 auto 12px', borderRadius: '50%',
          border: '2.5px solid var(--c-border2)', borderTopColor: 'var(--ft-accent)',
          animation: 'pns 0.75s linear infinite',
        }} />
        <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Loading…</div>
      </div>
    )
  }

  return (
    <>
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          margin: '14px 0', padding: '11px 14px', borderRadius: 11,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)',
        }}>
          <span style={{ fontSize: 12.5, color: '#ef4444', fontWeight: 500, flex: 1, minWidth: 220 }}>
            {error.message || 'Could not load the latest data.'} What you see below may be out of date.
          </span>
          {retry && (
            <button
              type="button"
              onClick={() => retry().catch(() => {})}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: '1px solid rgba(239,68,68,0.35)', background: 'transparent',
                color: '#ef4444', cursor: 'pointer',
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {readOnly && (
        <div style={{
          margin: '14px 0', padding: '10px 14px', borderRadius: 11,
          background: 'var(--c-input)', border: '1px solid var(--c-border2)',
          fontSize: 12.5, color: 'var(--c-text2)',
        }}>
          {/* Said explicitly, because a page with no buttons otherwise reads as
              broken rather than as read-only. */}
          Your account has read-only access to this page.
        </div>
      )}
    </>
  )
}
