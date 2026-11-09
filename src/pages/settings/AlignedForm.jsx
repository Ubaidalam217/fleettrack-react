/**
 * Building blocks of the aligned Settings form; the styles and their notes
 * are in alignedFormStyles.js (kept apart so this file stays Fast Refresh friendly).
 */

/** One field: label line (with an optional chip on its right), control, then hint or error. */
export function DF({ id, label, required, error, hint, aside, span = 4, group = false, children }) {
  return (
    <div className={`dfm-c${span}`} style={{ minWidth: 0 }}>
      <div className="dfm-lrow">
        {group ? (
          <span id={`${id}-label`} className="dfm-label">{label}</span>
        ) : (
          <label htmlFor={id} className="dfm-label">
            {label}{required && <span className="dfm-req" aria-hidden="true">*</span>}
          </label>
        )}
        {aside}
      </div>
      {children}
      {error ? <span className="dfm-err" role="alert">{error}</span> : hint ? <span className="dfm-hint">{hint}</span> : null}
    </div>
  )
}

/** A grid cell for a row's action button: an empty label line keeps it level with the inputs. */
export function DAction({ span = 3, children }) {
  return (
    <div className={`dfm-c${span}`} style={{ minWidth: 0 }}>
      <div className="dfm-lrow" aria-hidden="true" />
      {children}
    </div>
  )
}


export function DSection({ icon: Icon, title, desc, children }) {
  return (
    <section className="dfm-sec" aria-label={title}>
      <div className="dfm-sec-head">
        <span className="dfm-sec-ico" aria-hidden="true"><Icon size={17} /></span>
        <div style={{ minWidth: 0 }}>
          <h3 className="dfm-sec-title">{title}</h3>
          {desc && <div className="dfm-sec-desc">{desc}</div>}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </section>
  )
}

/** A read-only value laid out like a control, so it sits in the grid with the inputs. */
export function ReadOnly({ id, label, value, span = 4, hint }) {
  return (
    <DF id={id} label={label} span={span} hint={hint}>
      <div id={id} className={`dfm-ro${value === '—' ? ' empty' : ''}`} aria-readonly="true">{value}</div>
    </DF>
  )
}
