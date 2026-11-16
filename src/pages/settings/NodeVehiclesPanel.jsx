import { useEffect, useMemo, useState } from 'react'
import { vehicleLabel } from '../../utils/vehicleLabel'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, Plus, Car, ArrowRightLeft, Link2, Unlink, Search } from 'lucide-react'
import { PRIMARY_BTN, SECONDARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import VehicleMoveDialog from './VehicleMoveDialog'
import {
  useVehicles, useCompanies, useBranches, assignVehicleBranch, transferVehicle, branchNameFor,
  SHARING_AVAILABLE, shareVehicles, unshareVehicles,
} from '../../data/settings'
import { usePageAccess, handleApiError } from './pageChrome'
import SharedChip from '../../components/SharedChip'
import { isOwned, sharedFromText } from '../../utils/vehiclePlacement'

/**
 * Vehicles of a GGB, Group, Business Group or Branch, managed from its own row
 * (client, 2026-11-10: "add vehicles from BG, Group, GGB or Branch itself") —
 * the same side panel as the Users one (NodeUsersPanel.jsx).
 *
 *   Add new vehicle   the vehicle form, with the BG (and branch) filled in
 *   Assign vehicle    a vehicle already registered:
 *                       Branch  — one of its BG's vehicles into this branch
 *                                 (PUT /api/vehicles/:id/branch, Flespi untouched)
 *                       BG / Group / GGB — a vehicle of another BG moved here
 *                                 (POST /api/vehicles/:id/transfer)
 *   Each row          Branch: take it out of the branch; others: move it on
 *
 * One vehicle in several places (client, 2026-11-13): "Assign" offers both
 *   Also show here    a share — the vehicle keeps its own BG and branch and
 *                     also shows in this Group / BG / Branch (no Flespi call)
 *   Move here         the owner changes, as above
 * and a "Shared here" list with Remove (for the vehicle's owner side).
 *
 * Every change lands in the Reallocation History Report.
 */

const NOUN = { ggb: 'Group Global Admin', group: 'Group', bg: 'Business Group', branch: 'Branch' }

const label = v => vehicleLabel(v)

/** Which vehicles belong to a node — their home, not a share. */
function belongs(kind, node, v, companyOf) {
  if (!isOwned(v)) return false // shared in: its home is not this account's to see
  if (kind === 'branch') return v.branchId === node.id
  if (kind === 'bg') return v.companyId === node.id
  const c = companyOf(v.companyId)
  if (kind === 'group') return (c?.groupId || v.groupId) === node.id
  return c?.resellerId === node.id
}

/** The level a node takes a share at; a GGB takes none (its admins see its whole tree). */
const SHARE_LEVEL = { branch: 'branch', bg: 'bg', group: 'group' }

/**
 * The share that puts a vehicle in this node, if any: the node's own share,
 * else (on a BG or Group) a share to one of its branches or BGs.
 */
function shareHere(kind, node, v, companyOf) {
  const list = v.shares ?? []
  if (kind === 'branch') return list.find(s => s.level === 'branch' && s.branchId === node.id) ?? null
  if (kind === 'bg') return list.find(s => s.level === 'bg' && s.companyId === node.id) ?? list.find(s => s.level === 'branch' && s.companyId === node.id) ?? null
  if (kind === 'group') {
    return list.find(s => s.level === 'group' && s.groupId === node.id)
      ?? list.find(s => s.companyId && companyOf(s.companyId)?.groupId === node.id) ?? null
  }
  return list.find(s => s.companyId && companyOf(s.companyId)?.resellerId === node.id) ?? null
}

/** The "Vehicles (n)" button for a table row. */
export function VehiclesButton({ count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="See and add this level's vehicles"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
        border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text2)',
        fontSize: 11.5, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      <Car size={13} />
      Vehicles ({count})
    </button>
  )
}

/** `count(row)` for the Vehicles button of a page's rows. */
export function useNodeVehicleCount(kind) {
  const vehicles = useVehicles()
  const companies = useCompanies()
  return useMemo(() => {
    const byId = new Map(companies.map(c => [c.id, c]))
    const companyOf = id => byId.get(id)
    // Its own and those shared into it, each once.
    return node => vehicles.filter(v => belongs(kind, node, v, companyOf) || shareHere(kind, node, v, companyOf)).length
  }, [kind, vehicles, companies])
}

const ICON_BTN = {
  width: 32, height: 32, borderRadius: 9, border: '1px solid var(--c-border2)', background: 'transparent',
  color: 'var(--c-text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
const ROW_BTN = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 999, flexShrink: 0,
  border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text2)',
  fontSize: 11, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap',
}

function Section({ title, count, action, children, empty }) {
  return (
    <section style={{ border: '1px solid var(--c-border2)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', background: 'var(--c-thead)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text2)' }}>
          {title} <span style={{ color: 'var(--c-text3)' }}>({count})</span>
        </span>
        {action}
      </div>
      {count === 0 ? (
        <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--c-text3)', borderTop: '1px solid var(--c-border2)' }}>{empty}</div>
      ) : children}
    </section>
  )
}

function VehicleRow({ v, where, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: '1px solid var(--c-border2)' }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 12%, transparent)', color: 'var(--ft-accent)' }}>
        <Car size={14} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(v)}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.imei}{where ? ` · ${where}` : ''}
        </span>
      </span>
      {action}
    </div>
  )
}

export default function NodeVehiclesPanel({ kind, node, onClose, push }) {
  const navigate = useNavigate()
  const vehicles = useVehicles()
  const companies = useCompanies()
  useBranches()
  const access = usePageAccess('vehicle')
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [targetBg, setTargetBg] = useState('')
  const [pending, setPending] = useState(null) // { title, body, run }
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState(null)
  // "Also show here" (a share; the default where a node can take one) or "Move here".
  const canShareHere = SHARING_AVAILABLE && !!SHARE_LEVEL[kind]
  const [mode, setMode] = useState(canShareHere ? 'share' : 'move')

  const companyOf = useMemo(() => {
    const byId = new Map(companies.map(c => [c.id, c]))
    return id => byId.get(id)
  }, [companies])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !pending && !moving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, moving, onClose])

  const mine = useMemo(
    () => vehicles.filter(v => belongs(kind, node, v, companyOf)).sort((a, b) => label(a).localeCompare(label(b))),
    [vehicles, kind, node, companyOf]
  )
  // Shown here through a share (not its home).
  const sharedRows = useMemo(
    () => vehicles
      .filter(v => !belongs(kind, node, v, companyOf))
      .map(v => ({ v, share: shareHere(kind, node, v, companyOf) }))
      .filter(r => r.share)
      .sort((a, b) => label(a.v).localeCompare(label(b.v))),
    [vehicles, kind, node, companyOf]
  )
  // Move: a branch takes vehicles of its own BG; the higher levels take any
  // other BG's. Share: any vehicle of this account's own that is not here yet.
  // Only this account's own vehicles either way — one shared into it is not its to move or pass on.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sharedIds = new Set(sharedRows.filter(r => r.share.targetId === node.id).map(r => r.v.id))
    return vehicles
      .filter(isOwned)
      .filter(v => !belongs(kind, node, v, companyOf))
      .filter(v => (mode === 'share' ? !sharedIds.has(v.id) && !(kind === 'group' && companyOf(v.companyId)?.groupId === node.id) : kind === 'branch' ? v.companyId === node.companyId : true))
      .filter(v => !q || [label(v), v.imei, companyOf(v.companyId)?.name].some(x => String(x ?? '').toLowerCase().includes(q)))
      .sort((a, b) => label(a).localeCompare(label(b)))
  }, [vehicles, kind, node, companyOf, query, mode, sharedRows])
  // A Group or GGB holds vehicles through its Business Groups: choose which.
  const bgsHere = useMemo(() => (kind === 'group' || kind === 'ggb')
    ? companies.filter(c => (kind === 'group' ? c.groupId === node.id : c.resellerId === node.id)).sort((a, b) => a.name.localeCompare(b.name))
    : [], [kind, node, companies])
  const intoBg = kind === 'bg' ? node.id : kind === 'branch' ? node.companyId : targetBg

  const whereOf = v => {
    const bg = companyOf(v.companyId)?.name ?? '—'
    const branch = v.branchId ? branchNameFor(v.branchId) : null
    return kind === 'branch' ? null : kind === 'bg' ? (branch ?? 'No branch') : branch ? `${bg} / ${branch}` : bg
  }

  const run = async (fn, done) => {
    setBusy(true)
    try {
      await fn()
      push?.(done, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const assign = v => {
    if (kind === 'branch') {
      const from = v.branchId ? branchNameFor(v.branchId) : 'no branch'
      setPending({
        title: `Put ${label(v)} in ${node.name}?`,
        body: `It moves from ${from} to ${node.name}, inside the same Business Group. Its users, alerts and history stay as they are.`,
        run: () => run(() => assignVehicleBranch(v.id, node.id), `${label(v)} is now in ${node.name}`),
      })
      return
    }
    const to = companyOf(intoBg)?.name
    const from = companyOf(v.companyId)?.name ?? 'its Business Group'
    setPending({
      title: `Move ${label(v)} to ${to}?`,
      body: `It leaves ${from}: its sub-user access, its place in ${from}'s alert and reminder rules and its assigned driver stay behind. Trips and history recorded so far stay with ${from}.`,
      run: () => run(() => transferVehicle(v.id, { companyId: intoBg, branchId: '' }), `${label(v)} moved to ${to}`),
    })
  }

  // Also show here: a share. Nothing moves, so no confirmation.
  const shareHereNow = v => run(
    () => shareVehicles([v.id], SHARE_LEVEL[kind], node.id),
    `${label(v)} also shows in ${node.name} now`,
  )

  const unshare = (v, share) => setPending({
    title: `Stop showing ${label(v)} in ${node.name}?`,
    body: `It stays in ${v.ownerName || companyOf(v.companyId)?.name || 'its own Business Group'}. ${node.name}'s accounts stop seeing it, and its sub-users and alert rules there lose it.`,
    run: () => run(() => unshareVehicles([v.id], share.level, share.targetId), `${label(v)} no longer shows in ${node.name}`),
  })

  const takeOut = v => setPending({
    title: `Take ${label(v)} out of ${node.name}?`,
    body: `It stays in its Business Group with no branch — the Business Group counts as its branch.`,
    run: () => run(() => assignVehicleBranch(v.id, ''), `${label(v)} taken out of ${node.name}`),
  })

  const addNew = () => {
    const bg = kind === 'bg' ? node.id : kind === 'branch' ? node.companyId : bgsHere.length === 1 ? bgsHere[0].id : ''
    const params = new URLSearchParams({ new: '1', ...(bg ? { bg } : {}), ...(kind === 'branch' ? { branch: node.id } : {}) })
    navigate(`/settings/vehicle?${params}`)
  }

  const canPick = mode === 'share' ? access.canWrite : intoBg && access.canWrite

  return createPortal(
    <div onClick={() => !pending && !moving && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(5,20,28,0.45)' }}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Vehicles of ${node.name}`}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(480px, 100%)',
          background: 'var(--c-page)', borderLeft: '1px solid var(--c-border)', boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-text3)' }}>{NOUN[kind]} · Vehicles</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text1)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={ICON_BTN}><X size={16} /></button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {access.canWrite && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {access.canAdd && (
                <button type="button" onClick={addNew} style={{ ...PRIMARY_BTN, padding: '7px 13px', fontSize: 12 }}>
                  <Plus size={14} strokeWidth={2.6} /> Add new vehicle
                </button>
              )}
              <button type="button" onClick={() => setPicking(p => !p)} aria-expanded={picking} style={{ ...SECONDARY_BTN, padding: '7px 13px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Link2 size={14} /> Assign a registered vehicle
              </button>
            </div>
          )}

          {picking && access.canWrite && (
            <section style={{ border: '1px solid var(--ft-accent)', borderRadius: 12, padding: 12, marginBottom: 14, background: 'var(--c-card)' }}>
              {canShareHere && (
                <div role="radiogroup" aria-label="Assign how" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  {[['share', 'Also show here', Link2], ['move', 'Move here', ArrowRightLeft]].map(([key, text, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={mode === key}
                      onClick={() => setMode(key)}
                      style={{
                        ...ROW_BTN, padding: '6px 12px', fontSize: 12,
                        ...(mode === key ? { background: 'var(--ft-accent)', color: '#fff', borderColor: 'var(--ft-accent)' } : {}),
                      }}
                    >
                      <Icon size={13} /> {text}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--c-text2)', marginBottom: 8, lineHeight: 1.5 }}>
                {mode === 'share'
                  ? `It stays where it is and also shows in ${node.name} — on the Live Map, in reports and for its own alerts. Only its own Business Group can edit it.`
                  : kind === 'branch'
                    ? `Vehicles of this branch's Business Group that are not in ${node.name}.`
                    : `Vehicles of other Business Groups — choosing one moves it to ${kind === 'bg' ? node.name : 'the Business Group below'}.`}
              </div>
              {mode === 'move' && (kind === 'group' || kind === 'ggb') && (
                <select value={targetBg} onChange={e => setTargetBg(e.target.value)} aria-label="Into Business Group" style={{ ...inputStyle(false), marginBottom: 8 }}>
                  <option value="">{bgsHere.length ? '— Into which Business Group —' : '— No Business Groups here —'}</option>
                  {bgsHere.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <div style={{ position: 'relative', marginBottom: 6 }}>
                <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)' }} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Plate, IMEI or Business Group" aria-label="Find a vehicle" style={{ ...inputStyle(false), paddingLeft: 30 }} />
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--c-border2)', borderRadius: 10 }}>
                {candidates.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--c-text3)' }}>No vehicle to assign.</div>}
                {candidates.map(v => (
                  <VehicleRow key={v.id} v={v} where={companyOf(v.companyId)?.name + (v.branchId ? ` / ${branchNameFor(v.branchId)}` : '')}
                    action={(
                      <button type="button" style={{ ...ROW_BTN, opacity: canPick ? 1 : 0.5, cursor: canPick ? 'pointer' : 'not-allowed' }} disabled={!canPick || busy} onClick={() => (mode === 'share' ? shareHereNow(v) : assign(v))}>
                        {mode === 'share' ? <><Link2 size={12} /> Also show here</> : kind === 'branch' ? <><Link2 size={12} /> Assign</> : <><ArrowRightLeft size={12} /> Move here</>}
                      </button>
                    )}
                  />
                ))}
              </div>
            </section>
          )}

          <Section title="Vehicles" count={mine.length} empty={`No vehicles in ${node.name} yet.`}>
            {mine.map(v => (
              <VehicleRow key={v.id} v={v} where={whereOf(v)}
                action={access.canWrite && (kind === 'branch'
                  ? <button type="button" style={ROW_BTN} onClick={() => takeOut(v)} disabled={busy}><Unlink size={12} /> Take out</button>
                  : <button type="button" style={ROW_BTN} onClick={() => setMoving(v)} disabled={busy}><ArrowRightLeft size={12} /> Move</button>)}
              />
            ))}
          </Section>

          {sharedRows.length > 0 && (
            <Section title="Shared here" count={sharedRows.length} empty="">
              {sharedRows.map(({ v, share }) => {
                // The node's own share can be removed here, by the vehicle's owner side.
                const removable = access.canWrite && isOwned(v) && share.targetId === node.id
                return (
                  <VehicleRow
                    key={v.id}
                    v={v}
                    where={share.targetId === node.id ? sharedFromText(v) : `via ${share.label}`}
                    action={(
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <SharedChip title={`${sharedFromText(v)} — ${share.label}`} />
                        {removable && (
                          <button type="button" style={ROW_BTN} onClick={() => unshare(v, share)} disabled={busy}><Unlink size={12} /> Remove</button>
                        )}
                      </span>
                    )}
                  />
                )
              })}
            </Section>
          )}

          <p style={{ fontSize: 11.5, color: 'var(--c-text3)', margin: '0 2px', lineHeight: 1.5 }}>
            {kind === 'branch'
              ? 'A vehicle is in one branch of its Business Group, or in none (then the Business Group counts as its branch). It can also be shown in other places — those are shared, not moved.'
              : 'A vehicle belongs to one Business Group and can also be shown in others (shared). Every change here is kept in the Reallocation History Report.'}
          </p>
        </div>
      </aside>

      {pending && (
        <ConfirmDialog
          title={pending.title}
          body={pending.body}
          confirmLabel="Confirm"
          busy={busy}
          onConfirm={pending.run}
          onClose={() => !busy && setPending(null)}
        />
      )}
      {moving && <VehicleMoveDialog vehicle={moving} push={push} onClose={() => setMoving(null)} />}
    </div>,
    document.body,
  )
}
