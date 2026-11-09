import { useEffect, useRef } from 'react'
import { LEVEL_LABEL } from '../../utils/fleetTree'

/**
 * The tick box beside a group or a vehicle in the Live Map list: unticked
 * hides it from the map, half-ticked means some of a group's vehicles are hidden.
 */
export function MapCheck({ checked, indeterminate = false, onChange, label }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={e => e.stopPropagation()}
      aria-label={label}
      title={checked ? 'Shown on the map — untick to hide' : 'Hidden from the map — tick to show'}
      style={{ width: 14, height: 14, margin: 0, flexShrink: 0, accentColor: 'var(--ft-accent)', cursor: 'pointer' }}
    />
  )
}

/** One GGB / Group / BG row of the Live Map list tree. */
export default function FleetTreeHeader({ node, depth, collapsed, onToggle, checked, indeterminate, onCheck }) {
  const tag = LEVEL_LABEL[node.level]
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      onClick={onToggle}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: `8px 12px 8px ${8 + depth * 14}px`,
        background: depth === 0 ? 'var(--c-hover)' : 'color-mix(in srgb, var(--c-hover) 55%, transparent)',
        borderBottom: '1px solid var(--c-border)',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <svg
        width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--c-text3)" strokeWidth="3" strokeLinecap="round" aria-hidden="true"
        style={{ flexShrink: 0, transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
      <MapCheck checked={checked} indeterminate={indeterminate} onChange={onCheck} label={`Show ${node.label} on the map`} />
      <span style={{
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: depth === 0 ? 12.5 : 12, fontWeight: depth === 0 ? 800 : 700, color: 'var(--c-text1)',
      }} title={node.label}>
        {node.label}
      </span>
      {tag && (
        <span style={{
          flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', padding: '1px 5px', borderRadius: 4,
          color: 'var(--ft-accent)', background: 'color-mix(in srgb, var(--ft-accent) 12%, transparent)',
        }}>
          {tag}
        </span>
      )}
      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', fontVariantNumeric: 'tabular-nums' }}>
        [{node.count}]
      </span>
    </div>
  )
}
