import { FIELD_LABEL, inputStyle, PRIMARY_BTN, SECONDARY_BTN, CARD_SURFACE } from './formStyles'

/**
 * Form primitives for the Settings module.
 *
 * Components only — the style objects they use live in formStyles.js so this
 * file stays Fast-Refresh friendly. Visually these are EditAssetModal's
 * controls in a page-width grid rather than a two-column modal.
 */

export function Field({ label, required, error, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={FIELD_LABEL}>
        {label}
        {required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {error && (
        <span style={{ fontSize: 10.5, color: '#ef4444', display: 'block', marginTop: 3 }}>
          {error}
        </span>
      )}
    </div>
  )
}

/**
 * Renders a whole form from a field spec. Both Settings forms are the same
 * address block with two or three fields swapped, so describing them as data
 * keeps the two pages to one readable array each instead of ~200 lines of
 * near-identical JSX.
 *
 * Spec entry: { name, label, required?, type?, placeholder?, options? }
 *   type    — 'text' (default) | 'email' | 'tel' | 'select'
 *   options — array of {value,label} or strings; may be a function of the
 *             current values, which is how State narrows when Country changes.
 */
export function FormFields({ fields, values, errors, onChange, firstRef }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
      gap: '14px 16px',
    }}>
      {fields.map((f, i) => {
        const invalid = !!errors[f.name]
        const common = {
          name: f.name,
          value: values[f.name] ?? '',
          onChange: e => onChange(f.name, e.target.value),
          style: inputStyle(invalid),
          'aria-invalid': invalid || undefined,
          ref: i === 0 ? firstRef : undefined,
        }

        return (
          <Field key={f.name} label={f.label} required={f.required} error={errors[f.name]}>
            {f.type === 'select' ? (
              <select {...common}>
                <option value="">— Select —</option>
                {normalizeOptions(f.options, values).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input {...common} type={f.type || 'text'} placeholder={f.placeholder || ''} />
            )}
          </Field>
        )
      })}
    </div>
  )
}

function normalizeOptions(options, values) {
  const list = typeof options === 'function' ? options(values) : (options || [])
  return list.map(o => (typeof o === 'string' ? { value: o, label: o } : o))
}

/**
 * Save / Back / Reset, in the app's button language: Save is the filled accent
 * button from EditAssetModal's footer, the other two are the bordered
 * secondary. Right-aligned, wrapping to a stack on a narrow screen.
 */
export function FormActions({ onBack, onReset, saveLabel = 'Save' }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 8,
      justifyContent: 'flex-end', alignItems: 'center',
      marginTop: 20, paddingTop: 16,
      borderTop: '1px solid var(--c-border2)',
    }}>
      <button type="button" onClick={onBack}  style={SECONDARY_BTN}>Back</button>
      <button type="button" onClick={onReset} style={SECONDARY_BTN}>Reset</button>
      <button type="submit" style={PRIMARY_BTN}>{saveLabel}</button>
    </div>
  )
}

export function FormCard({ title, subtitle, children }) {
  return (
    <div style={{ ...CARD_SURFACE, padding: 'var(--ft-pad)', marginTop: 16 }}>
      {(title || subtitle) && (
        <div style={{ marginBottom: 16 }}>
          {title    && <h2 className="ft-card-title">{title}</h2>}
          {subtitle && <p className="ft-card-sub">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  )
}
