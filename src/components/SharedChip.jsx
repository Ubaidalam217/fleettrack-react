import { Link2 } from 'lucide-react'

/**
 * "Shared" — a vehicle that shows here through a share, not its home (client,
 * 2026-11-13: one vehicle in several Groups / BGs / Branches; see
 * utils/vehiclePlacement.js). `title` says whose it is.
 */
export default function SharedChip({ title = 'Shared with you', label = 'Shared', style }) {
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
        padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.02em',
        color: 'var(--ft-accent)',
        background: 'color-mix(in srgb, var(--ft-accent) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--ft-accent) 32%, transparent)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <Link2 size={10} strokeWidth={2.6} aria-hidden="true" />
      {label}
    </span>
  )
}
