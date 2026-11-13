import { useState } from 'react'
import {
  OTHER_TYPE, MAX_CUSTOM_TYPE, vehicleTypeLabel, canonicalVehicleType,
} from '../utils/vehicleTypes'

/**
 * The vehicle type select with "Other (custom)…" at the end: picking it opens
 * a box for the type's name, which is saved like any other type. `options`
 * comes from vehicleTypeOptions() over the types the fleet already uses; a
 * name typed here that matches one of them (ignoring case) takes its spelling.
 */
export default function VehicleTypeSelect({ value, options, onChange, style, inputStyle = style, disabled, name, ariaLabel }) {
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')

  const current = value ?? ''
  const list = current && !options.includes(current) ? [...options, current] : options

  const pick = v => {
    if (v === OTHER_TYPE) { setTyping(true); setDraft(''); return }
    setTyping(false)
    onChange(v)
  }

  const type = text => {
    setDraft(text)
    onChange(canonicalVehicleType(text, options))
  }

  // Stacked, so the name box sits under the list in a form field or a table cell.
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <select
        name={name}
        aria-label={ariaLabel}
        value={typing ? OTHER_TYPE : current}
        disabled={disabled}
        onChange={e => pick(e.target.value)}
        style={style}
      >
        {list.map(t => (
          <option key={t || 'none'} value={t}>{t ? vehicleTypeLabel(t) : '— Not set —'}</option>
        ))}
        <option value={OTHER_TYPE}>Other (custom)…</option>
      </select>
      {typing && (
        <input
          autoFocus
          name={name ? `${name}Custom` : undefined}
          aria-label="Custom vehicle type"
          value={draft}
          maxLength={MAX_CUSTOM_TYPE}
          placeholder="Type name, e.g. Tanker"
          disabled={disabled}
          onChange={e => type(e.target.value)}
          // Back to the list once named: the new type is one of its choices now.
          onBlur={() => { if (draft.trim()) setTyping(false) }}
          style={inputStyle}
        />
      )}
    </div>
  )
}
