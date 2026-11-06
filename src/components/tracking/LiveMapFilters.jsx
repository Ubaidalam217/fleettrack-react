import { SlidersHorizontal } from 'lucide-react'
import { EMPTY_FILTERS, NOT_SET, activeFilterCount } from '../../utils/liveMapFilters'

/**
 * The Live Map's attribute filters: a toggle beside the search box and the
 * panel of six dropdowns it opens. The rules live in utils/liveMapFilters.js.
 */

const FIELDS = [
  { key: 'assetType',  label: 'Asset Type' },
  { key: 'assetGroup', label: 'Asset Group' },
  { key: 'deviceType', label: 'Device Type' },
  { key: 'company',    label: 'Company' },
  { key: 'branch',     label: 'Branch' },
  { key: 'validity',   label: 'Validity' },
]

export function FilterToggle({ filters, open, onClick }) {
  const n = activeFilterCount(filters)
  const on = open || n > 0
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title="Filter by asset type, group, device type, company, branch and validity"
      style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '0 10px', borderRadius: 8,
        border: `1px solid ${on ? 'var(--ft-accent)' : 'var(--c-border)'}`,
        background: on ? 'color-mix(in srgb, var(--ft-accent) 10%, transparent)' : 'var(--c-input)',
        color: on ? 'var(--ft-accent)' : 'var(--c-text2)',
        fontSize: 12, fontWeight: 700, cursor: 'pointer',
      }}
    >
      <SlidersHorizontal size={13} />
      Filters
      {n > 0 && (
        <span style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: 'var(--ft-accent)', color: '#fff', fontSize: 10, lineHeight: '16px', textAlign: 'center' }}>
          {n}
        </span>
      )}
    </button>
  )
}

export function FilterPanel({ filters, onChange, options, shown, total }) {
  const set = (key, value) => {
    const next = { ...filters, [key]: value }
    // A branch belongs to one company: changing the company resets it.
    if (key === 'company') next.branch = ''
    onChange(next)
  }
  const n = activeFilterCount(filters)

  return (
    <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 10px' }}>
      {FIELDS.map(f => (
        <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)' }}>{f.label}</span>
          <select
            value={filters[f.key]}
            onChange={e => set(f.key, e.target.value)}
            style={{
              width: '100%', minWidth: 0, padding: '6px 8px', borderRadius: 7,
              border: `1px solid ${filters[f.key] ? 'var(--ft-accent)' : 'var(--c-border)'}`,
              background: 'var(--c-input)', color: 'var(--c-text1)', fontSize: 11.5,
            }}
          >
            <option value="">All</option>
            {options[f.key].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            {f.key !== 'validity' && <option value={NOT_SET}>Not set</option>}
          </select>
        </label>
      ))}
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--c-text3)' }}>
        <span>{n ? `${shown} of ${total} vehicles match` : 'Showing all vehicles'}</span>
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          disabled={!n}
          style={{ border: 0, background: 'none', padding: 0, fontSize: 11.5, fontWeight: 700, color: n ? 'var(--ft-accent)' : 'var(--c-text3)', cursor: n ? 'pointer' : 'default' }}
        >
          Clear filters
        </button>
      </div>
    </div>
  )
}
