import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRightLeft, X } from 'lucide-react'
import { Field } from './FormKit'
import { PRIMARY_BTN, SECONDARY_BTN, inputStyle } from './formStyles'
import { useCompanies, useBranches, transferVehicle } from '../../data/settings'
import { handleApiError } from './pageChrome'

/**
 * "Move to another Business Group" for one vehicle (client, 2026-11-10:
 * "Reallocation will be … from Business Group change"). Unlike moving a whole
 * BG, the vehicle leaves behind what its old BG gave it, and the dialog says so
 * before anything happens. Server side: POST /api/vehicles/:id/transfer, which
 * also writes the Reallocation History row.
 */
export default function VehicleMoveDialog({ vehicle, onClose, push }) {
  const companies = useCompanies()
  const branches = useBranches()
  const [bgId, setBgId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const label = vehicle.vehicleNumber || vehicle.vehicleId || vehicle.imei
  const here = companies.find(c => c.id === vehicle.companyId)?.name ?? '—'
  const targets = useMemo(
    () => companies.filter(c => c.id !== vehicle.companyId).sort((a, b) => a.name.localeCompare(b.name)),
    [companies, vehicle.companyId]
  )
  const targetBranches = useMemo(
    () => branches.filter(b => b.companyId === bgId).sort((a, b) => a.name.localeCompare(b.name)),
    [branches, bgId]
  )
  const there = targets.find(c => c.id === bgId)?.name

  const submit = async () => {
    if (!bgId) { setError('Choose the Business Group'); return }
    setSaving(true)
    try {
      await transferVehicle(vehicle.id, { companyId: bgId, branchId })
      push?.(`${label} moved to ${there}`, { tone: 'success' })
      onClose()
    } catch (err) {
      handleApiError(err, { push })
      setSaving(false)
    }
  }

  return createPortal(
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        role="dialog" aria-modal="true" aria-label={`Move ${label}`}
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(480px, 100%)', borderRadius: 16, background: 'var(--c-card)', border: '1px solid var(--c-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)', padding: 20 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
            <ArrowRightLeft size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--c-text1)' }}>Move vehicle “{label}”</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 3 }}>Now in: {here}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" disabled={saving}
            style={{ display: 'flex', padding: 6, borderRadius: 8, border: '1px solid var(--c-border2)', background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Move to Business Group" required error={error}>
            <select value={bgId} onChange={e => { setBgId(e.target.value); setBranchId(''); setError(null) }} style={inputStyle(!!error)} disabled={saving}>
              <option value="">— Select —</option>
              {targets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Branch" hint="Optional. With none, the Business Group is its branch.">
            <select value={branchId} onChange={e => setBranchId(e.target.value)} style={inputStyle(false)} disabled={saving || !bgId || !targetBranches.length}>
              <option value="">{bgId && !targetBranches.length ? '— No branches —' : '— None —'}</option>
              {targetBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        {targets.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 8 }}>There is no other Business Group you can move it to.</div>
        )}

        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--c-hover)', border: '1px solid var(--c-border2)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', marginBottom: 4 }}>Stays with {here}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c-text1)', lineHeight: 1.5 }}>
            Its sub-user access, its place in the alert and reminder rules there, and its assigned driver. The trips, alerts and expenses recorded so far stay in that history.
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text3)', marginTop: 6, lineHeight: 1.45 }}>
            The tracker moves with the vehicle. The move is kept in the Reallocation History Report.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" style={SECONDARY_BTN} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...PRIMARY_BTN, opacity: saving || !bgId ? 0.65 : 1 }} onClick={submit} disabled={saving || !bgId}>
            {saving ? 'Moving…' : there ? `Move to ${there}` : 'Move'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
