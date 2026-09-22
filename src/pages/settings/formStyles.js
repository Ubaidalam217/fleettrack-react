/**
 * Style objects shared by the Settings forms and tables.
 *
 * Split out of FormKit.jsx for the reason useToasts.js is split out of
 * Toasts.jsx: a module that exports anything other than components drops out
 * of React Fast Refresh, so the constants live in their own plain .js file and
 * FormKit stays refreshable while you are editing a form.
 *
 * The input and label values are lifted from EditAssetModal so a Settings form
 * and the Live Map's Edit Asset dialog render the same control set.
 */

export const FIELD_LABEL = {
  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--c-text3)',
  display: 'block', marginBottom: 4,
}

export function inputStyle(invalid) {
  return {
    width: '100%', boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${invalid ? '#ef4444' : 'var(--c-border)'}`,
    background: 'var(--c-input)',
    color: 'var(--c-text1)',
    fontSize: 12.5,
    outline: 'none',
  }
}

/** Filled accent button — same recipe as EditAssetModal's Save. */
export const PRIMARY_BTN = {
  padding: '9px 22px', borderRadius: 9, border: 'none',
  background: 'var(--ft-accent)', color: '#fff',
  fontSize: 12.5, fontWeight: 750, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
}

/** Bordered button — same recipe as EditAssetModal's Cancel. */
export const SECONDARY_BTN = {
  padding: '9px 16px', borderRadius: 9,
  border: '1px solid var(--c-border2)', background: 'var(--c-input)',
  color: 'var(--c-text2)', fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
}

/**
 * The .ft-card surface tokens without the class, because .ft-card:hover lifts
 * the card 2px — right for a dashboard widget you click into, wrong for a
 * page-width table or form that would then twitch under the cursor the whole
 * time you are filling it in.
 */
export const CARD_SURFACE = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-border2)',
  borderRadius: 'var(--ft-radius)',
  boxShadow: 'var(--ft-shadow)',
}
