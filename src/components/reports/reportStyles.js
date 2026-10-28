/**
 * Shared field styling for the Reports pages.
 *
 * Its own file for the same reason settings/formStyles.js is split from
 * FormKit.jsx: a module that exports both components and plain constants breaks
 * React Fast Refresh, so the constants live next door.
 */

export const LABEL = {
  display: 'block', fontSize: 11, fontWeight: 700,
  color: 'var(--c-text2)', marginBottom: 6, letterSpacing: '0.02em',
}

export const FIELD = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px', borderRadius: 8, outline: 'none',
  border: '1px solid var(--c-border2)',
  background: 'var(--c-input)', color: 'var(--c-text1)',
  fontSize: 12.5, fontFamily: 'inherit',
}
