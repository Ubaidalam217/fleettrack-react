import { LABEL, FIELD, MultiSelect, CheckRow } from './controls'
import { driverFilterLabel } from '../../utils/driverAtTime'

/**
 * The driver filter and the Vehicle / Driver grouping switch the Movement,
 * Event Occurrence, Geo Zone, Daywise and Heat Map reports share (client,
 * 2026-11-12). `value` null means every driver.
 */
export function DriverFilter({ options, value, onChange, disabled }) {
  const all = value == null
  const toggle = key => {
    const cur = value ?? new Set(options.map(o => o.key))
    const next = new Set(cur)
    if (next.has(key)) next.delete(key); else next.add(key)
    onChange(next.size === options.length ? null : next)
  }
  return (
    <MultiSelect label="DRIVERS" summary={driverFilterLabel(value, options)} disabled={disabled}>
      <CheckRow checked={all} onChange={() => onChange(all ? new Set() : null)}>
        <strong>All drivers</strong>
      </CheckRow>
      <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
      {options.map(o => (
        <CheckRow key={o.key} checked={all || value.has(o.key)} onChange={() => toggle(o.key)}>
          {o.label}
        </CheckRow>
      ))}
    </MultiSelect>
  )
}

export function GroupBySelect({ value, onChange, id = 'report-group-by' }) {
  return (
    <div>
      <label style={LABEL} htmlFor={id}>GROUPED BY</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} style={FIELD}>
        <option value="vehicle">Vehicle</option>
        <option value="driver">Driver</option>
      </select>
    </div>
  )
}
