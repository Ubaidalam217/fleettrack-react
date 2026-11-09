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

/**
 * The Live Map list's Groups button: on, the list is grouped by Group / BG /
 * Branch; off, it is the plain list.
 */
export function GroupsToggle({ on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={on ? 'Hide groups — show a plain list' : 'Show groups — Group, Business Group, Branch'}
      style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '0 9px', borderRadius: 8,
        border: `1px solid ${on ? 'var(--ft-accent)' : 'var(--c-border)'}`,
        background: on ? 'color-mix(in srgb, var(--ft-accent) 10%, transparent)' : 'var(--c-input)',
        color: on ? 'var(--ft-accent)' : 'var(--c-text2)',
        fontSize: 12, fontWeight: 700, cursor: 'pointer',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="5" rx="1" /><path d="M6.5 8v9a1 1 0 0 0 1 1H14" /><path d="M6.5 12.5H14" />
        <rect x="14" y="10" width="7" height="5" rx="1" /><rect x="14" y="16" width="7" height="5" rx="1" />
      </svg>
      Groups
    </button>
  )
}

/**
 * One Group / BG / Branch bar of the Live Map list tree. Only a top-level bar
 * carries the map tick box (client's choice, option 3), so the list stays light.
 */
export default function FleetTreeHeader({ node, depth, collapsed, onToggle, checked, indeterminate, onCheck }) {
  const top = depth === 0
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
        padding: `${top ? 8 : 7}px 12px ${top ? 8 : 7}px ${8 + depth * 14}px`,
        background: top ? 'var(--c-hover)' : 'color-mix(in srgb, var(--c-hover) 45%, transparent)',
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
      {top && <MapCheck checked={checked} indeterminate={indeterminate} onChange={onCheck} label={`Show ${node.label} on the map`} />}
      <span style={{
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: top ? 12.5 : 12, fontWeight: top ? 800 : node.level === 'branch' ? 600 : 700,
        color: node.level === 'branch' ? 'var(--c-text2)' : 'var(--c-text1)',
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
