import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRightLeft, X } from 'lucide-react'
import { Field } from './FormKit'
import { PRIMARY_BTN, SECONDARY_BTN, inputStyle } from './formStyles'
import {
  useResellers, useGroups, useCompanies, useBranches, useVehicles, useUsers, useSubusers,
  moveGroup, moveCompany,
} from '../../data/settings'
import { handleApiError } from './pageChrome'
import { IS_REAL } from '../../data/mode'

/**
 * "Move to…" for a Group (to another GGB) or a BG (into another group, or
 * straight under a GGB). Everything under it moves too — client, 2026-11-02:
 * "the whole structure, not only the one row". The dialog says exactly what
 * will move before anything happens. Server side: lib/moves.js.
 */

/** Who may move what — mirrors lib/moves.js. Mock mode (no role) may do both. */
export function canMove(roleKey, kind) {
  if (!IS_REAL || roleKey == null) return true
  if (kind === 'group') return roleKey === 'SUPER_ADMIN'
  return roleKey === 'SUPER_ADMIN' || roleKey === 'GGB_ADMIN'
}

/** The small "Move" button for a table row. */
export function MoveButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Move this, with everything under it"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
        border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text2)',
        fontSize: 11.5, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      <ArrowRightLeft size={13} />
      Move
    </button>
  )
}

export default function MoveDialog({ kind, node, onClose, push }) {
  const resellers = useResellers()
  const groups = useGroups()
  const companies = useCompanies()
  const branches = useBranches()
  const vehicles = useVehicles()
  const users = useUsers()
  const subusers = useSubusers()
  const [target, setTarget] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const ggbName = id => resellers.find(r => r.id === id)?.name ?? '—'

  // Where it can go. A group goes to a GGB; a BG to a group or under a GGB.
  const options = useMemo(() => {
    if (kind === 'group') {
      return resellers.filter(r => r.id !== node.resellerId).map(r => ({ value: `ggb:${r.id}`, label: r.name }))
    }
    const out = []
    for (const r of resellers) {
      if (!(r.id === node.resellerId && !node.groupId)) {
        out.push({ value: `ggb:${r.id}`, label: `${r.name} — no group` })
      }
      for (const g of groups.filter(x => x.resellerId === r.id && x.id !== node.groupId)) {
        out.push({ value: `group:${g.id}`, label: `${r.name} › ${g.name}` })
      }
    }
    return out
  }, [kind, node, resellers, groups])

  // What goes with it.
  const impact = useMemo(() => {
    const bgIds = new Set(kind === 'group' ? companies.filter(c => c.groupId === node.id).map(c => c.id) : [node.id])
    const inBg = r => bgIds.has(r.companyId)
    return {
      bgs: bgIds.size,
      branches: branches.filter(inBg).length,
      vehicles: vehicles.filter(inBg).length,
      users: users.filter(inBg).length + subusers.filter(inBg).length,
    }
  }, [kind, node, companies, branches, vehicles, users, subusers])

  const here = kind === 'group'
    ? ggbName(node.resellerId)
    : node.groupId ? `${ggbName(node.resellerId)} › ${groups.find(g => g.id === node.groupId)?.name ?? '—'}` : `${ggbName(node.resellerId)} — no group`
  const there = options.find(o => o.value === target)?.label

  const submit = async () => {
    if (!target) { setError('Choose where to move it'); return }
    const [type, id] = target.split(':')
    setSaving(true)
    try {
      if (kind === 'group') await moveGroup(node.id, id)
      else await moveCompany(node.id, type === 'group' ? { groupId: id } : { resellerId: id, groupId: '' })
      push?.(`${node.name} moved to ${there}`, { tone: 'success' })
      onClose()
    } catch (err) {
      handleApiError(err, { push })
      setSaving(false)
    }
  }

  const line = (n, one, many) => `${n} ${n === 1 ? one : many}`
  const items = [
    kind === 'group' && line(impact.bgs, 'BG', 'BGs'),
    line(impact.branches, 'branch', 'branches'),
    line(impact.vehicles, 'vehicle', 'vehicles'),
    line(impact.users, 'user account', 'user accounts'),
  ].filter(Boolean)

  return createPortal(
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        role="dialog" aria-modal="true" aria-label={`Move ${node.name}`}
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(480px, 100%)', borderRadius: 16, background: 'var(--c-card)', border: '1px solid var(--c-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)', padding: 20 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
            <ArrowRightLeft size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--c-text1)' }}>Move {kind === 'group' ? 'group' : 'BG'} “{node.name}”</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 3 }}>Now in: {here}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" disabled={saving}
            style={{ display: 'flex', padding: 6, borderRadius: 8, border: '1px solid var(--c-border2)', background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer' }}>
            <X size={15} />
          </button>
        </div>

        <Field label={kind === 'group' ? 'Move to GGB' : 'Move to'} required error={error}>
          <select value={target} onChange={e => { setTarget(e.target.value); setError(null) }} style={inputStyle(!!error)} disabled={saving}>
            <option value="">— Select —</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {options.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 8 }}>There is nowhere else to move it.</div>
        )}

        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--c-hover)', border: '1px solid var(--c-border2)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', marginBottom: 4 }}>Moves with it</div>
          <div style={{ fontSize: 12.5, color: 'var(--c-text1)', lineHeight: 1.5 }}>{items.join(' · ')}</div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text3)', marginTop: 6, lineHeight: 1.45 }}>
            Users keep their logins. Admins of the old {kind === 'group' ? 'GGB' : 'GGB / group'} stop seeing these vehicles; admins of the new one start.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" style={SECONDARY_BTN} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...PRIMARY_BTN, opacity: saving || !target ? 0.65 : 1 }} onClick={submit} disabled={saving || !target}>
            {saving ? 'Moving…' : there ? `Move to ${there}` : 'Move'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
