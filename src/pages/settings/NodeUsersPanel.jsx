import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, Plus, Pencil, Trash2, UserRound, Users, ShieldCheck } from 'lucide-react'
import { Field } from './FormKit'
import { PRIMARY_BTN, SECONDARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import {
  useAdmins, useUsers, useSubusers, ADMIN_ROLES, emptyAdmin, emptyUser,
  addAdmin, updateAdmin, removeAdmin, addUser, updateUser, removeUser,
  isLoginEmailTaken, DEFAULT_PASSWORD, updateSubuser,
} from '../../data/settings'
import PermissionsEditor from './PermissionsEditor'
import { useSession } from '../../data/session'
import { sessionLevel, atLeast, openCount, ALL_SCREENS } from '../../data/screens'
import { handleApiError } from './pageChrome'
import { IS_REAL } from '../../data/mode'

/**
 * The login accounts that belong to one GGB, Group, BG or Branch, managed
 * from that node's own row (client, 2026-11-02: "add the users right there").
 *
 *   GGB    → GGB Admins           (simple form here)
 *   Group  → Group Admins         (simple form here)
 *   BG     → BG Users             (simple form here) + Sub-users
 *   Branch → Sub-users assigned to that branch
 *
 * Sub-users keep their own form on the Company Subuser page; this panel lists
 * them and opens that page with the BG (and branch) already filled in.
 * Who may create what is the server's rule (only roles below your own); the
 * buttons below just hide what the server would refuse.
 */

const RANK = { SUPER_ADMIN: 0, GGB_ADMIN: 1, GROUP_ADMIN: 2, BG_USER: 3, SUB_USER: 4 }
const canCreate = (roleKey, role) => !IS_REAL || roleKey == null || RANK[roleKey] < RANK[role]

const KIND = {
  ggb:    { noun: 'Group Global Admin', role: ADMIN_ROLES.GGB_ADMIN, label: 'Group Global Admins' },
  group:  { noun: 'Group',  role: ADMIN_ROLES.GROUP_ADMIN, label: 'Group Admins' },
  bg:     { noun: 'Business Group', role: 'BG_USER', label: 'Business Group Users' },
  branch: { noun: 'Branch', role: null,                    label: null },
}

/** Rows and the account list a node shows. */
function useNodeAccounts(kind, node) {
  const admins = useAdmins()
  const users = useUsers()
  const subusers = useSubusers()
  const own =
    kind === 'ggb'   ? admins.filter(a => a.role === ADMIN_ROLES.GGB_ADMIN && a.ggbId === node.id) :
    kind === 'group' ? admins.filter(a => a.role === ADMIN_ROLES.GROUP_ADMIN && a.groupId === node.id) :
    kind === 'bg'    ? users.filter(u => u.companyId === node.id) : []
  const subs =
    kind === 'bg'     ? subusers.filter(s => s.companyId === node.id) :
    kind === 'branch' ? subusers.filter(s => (s.branchIds ?? []).includes(node.id)) : []
  return { own, subs }
}

/** How many accounts a node has — for the "Users (n)" button in each table. */
export function useNodeUserCount(kind) {
  const admins = useAdmins()
  const users = useUsers()
  const subusers = useSubusers()
  return node => {
    if (kind === 'ggb') return admins.filter(a => a.role === ADMIN_ROLES.GGB_ADMIN && a.ggbId === node.id).length
    if (kind === 'group') return admins.filter(a => a.role === ADMIN_ROLES.GROUP_ADMIN && a.groupId === node.id).length
    if (kind === 'bg') return users.filter(u => u.companyId === node.id).length + subusers.filter(s => s.companyId === node.id).length
    return subusers.filter(s => (s.branchIds ?? []).includes(node.id)).length
  }
}

/** The "Users (n)" button for a table row. */
export function UsersButton({ count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Manage this level's login accounts"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
        border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text2)',
        fontSize: 11.5, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      <Users size={13} />
      Users ({count})
    </button>
  )
}

function StatusPill({ status }) {
  const on = status !== 'Inactive'
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
      color: on ? '#16a34a' : 'var(--c-text3)',
      background: on ? 'rgba(16,185,129,0.1)' : 'var(--c-progress)',
    }}>{on ? 'Active' : 'Inactive'}</span>
  )
}

function AccountRow({ title, sub, status, onEdit, onDelete, onPermissions, access }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: '1px solid var(--c-border2)' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
        <UserRound size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--c-text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
      </div>
      <StatusPill status={status} />
      {onPermissions && (
        <button type="button" onClick={onPermissions} title="Permissions" aria-label={`Permissions for ${title}`}
          style={{ ...ICON_BTN, gap: 4, alignItems: 'center', fontSize: 10.5, fontWeight: 700, padding: '5px 7px' }}>
          <ShieldCheck size={13} />
          {access && Object.keys(access).length ? `${openCount(access)}/${ALL_SCREENS.length}` : 'All'}
        </button>
      )}
      {onEdit && <button type="button" onClick={onEdit} aria-label={`Edit ${title}`} title="Edit" style={ICON_BTN}><Pencil size={13} /></button>}
      {onDelete && <button type="button" onClick={onDelete} aria-label={`Delete ${title}`} title="Delete" style={{ ...ICON_BTN, color: '#ef4444' }}><Trash2 size={13} /></button>}
    </div>
  )
}

const ICON_BTN = {
  display: 'flex', padding: 6, borderRadius: 7, border: '1px solid var(--c-border2)',
  background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer',
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

// ── Main users on create (client, 2026-11-06) ────────────────────────────────
// "Create the main user for BG, Group, GGB while creating the account": the
// Add GGB / Group / BG forms carry at least one login, created right after the
// node, with "+ Add another user" for more.

export const emptyNewUser = () => ({ shortName: '', email: '', mobile: '', password: DEFAULT_PASSWORD })

/** Whether the signed-in user may add the node's own accounts (role below theirs, Full on User accounts). */
export function useMayAddNodeUsers(kind, roleKey) {
  const { user: me } = useSession()
  const role = KIND[kind]?.role
  return !!role && canCreate(roleKey, role) && atLeast(sessionLevel(me, 'users'), 'addDelete')
}

/** Field errors for the new users, keyed `users.<i>.<field>`; {} when they are fine. */
export function validateNewUsers(users) {
  const errors = {}
  const seen = new Set()
  users.forEach((u, i) => {
    const email = String(u.email ?? '').trim().toLowerCase()
    if (!email) errors[`users.${i}.email`] = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors[`users.${i}.email`] = 'Enter a valid email'
    else if (seen.has(email)) errors[`users.${i}.email`] = 'Listed twice'
    else if (isLoginEmailTaken(email)) errors[`users.${i}.email`] = 'This email already has an account'
    seen.add(email)
    if (u.password && u.password.length < 8) errors[`users.${i}.password`] = 'At least 8 characters'
  })
  return errors
}

/**
 * Create the node's accounts once the node exists. Each is created on its own;
 * one that fails does not stop the rest, and the caller is told which.
 * @returns {Promise<{ created: string[], failed: { email: string, message: string }[] }>}
 */
export async function createNodeUsers(kind, nodeId, users) {
  const created = []
  const failed = []
  for (const u of users) {
    const clean = { shortName: (u.shortName ?? '').trim(), email: u.email.trim(), mobile: (u.mobile ?? '').trim(), password: u.password || DEFAULT_PASSWORD }
    try {
      if (kind === 'ggb' || kind === 'group') await addAdmin({ ...emptyAdmin(KIND[kind].role, nodeId), ...clean })
      else await addUser({ ...emptyUser(), companyId: nodeId, ...clean })
      created.push(clean.email)
    } catch (err) {
      failed.push({ email: clean.email, message: err?.message || 'Could not be created' })
    }
  }
  return { created, failed }
}

/** The "Main user" section of the Add GGB / Group / BG form. */
export function NewNodeUsers({ kind, users, setUsers: setList, errors = {}, mayAdd, onEdit }) {
  const noun = KIND[kind]?.noun ?? ''
  const roleLabel = { ggb: 'Group Global Admin', group: 'Group Admin', bg: 'Business Group User' }[kind]
  const setUsers = fn => { setList(fn); onEdit?.() }
  const setField = (i, k, v) => setUsers(list => list.map((u, j) => (j === i ? { ...u, [k]: v } : u)))
  if (!mayAdd) {
    return (
      <div style={{ marginTop: 18, fontSize: 12, color: 'var(--c-text3)' }}>
        Your account cannot add {roleLabel} logins; an administrator can add them afterwards from Users.
      </div>
    )
  }
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', paddingBottom: 6, marginBottom: 12, borderBottom: '1px solid var(--c-border2)' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)' }}>Main user (login)<span style={{ color: '#ef4444', marginLeft: 3 }}>*</span></span>
        <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>
          At least one {roleLabel} account is created with this {noun}. They must change the password at first sign-in.
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {users.map((u, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px 12px', alignItems: 'start' }}>
            <Field label="Name" error={errors[`users.${i}.shortName`]}>
              <input value={u.shortName} onChange={e => setField(i, 'shortName', e.target.value)} placeholder="Full name" maxLength={120}
                style={inputStyle(!!errors[`users.${i}.shortName`])} />
            </Field>
            <Field label="Email (sign-in)" required error={errors[`users.${i}.email`]}>
              <input name={`users.${i}.email`} type="email" value={u.email} onChange={e => setField(i, 'email', e.target.value)}
                placeholder="name@company.com" style={inputStyle(!!errors[`users.${i}.email`])} />
            </Field>
            <Field label="Mobile">
              <input value={u.mobile} onChange={e => setField(i, 'mobile', e.target.value)} placeholder="+971 50 000 0000" maxLength={30} style={inputStyle(false)} />
            </Field>
            <Field label="Password" error={errors[`users.${i}.password`]}>
              <input value={u.password} onChange={e => setField(i, 'password', e.target.value)} style={inputStyle(!!errors[`users.${i}.password`])} />
            </Field>
            </div>
            <button
              type="button"
              aria-label="Remove this user"
              title={users.length === 1 ? 'At least one user is required' : 'Remove this user'}
              disabled={users.length === 1}
              onClick={() => setUsers(list => list.filter((_, j) => j !== i))}
              style={{ ...SECONDARY_BTN, padding: '9px 11px', marginBottom: 1, flexShrink: 0, opacity: users.length === 1 ? 0.4 : 1, cursor: users.length === 1 ? 'not-allowed' : 'pointer' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setUsers(list => [...list, emptyNewUser()])}
        style={{ ...SECONDARY_BTN, marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Plus size={14} /> Add another user
      </button>
    </div>
  )
}

/** Add / edit one GGB Admin, Group Admin or BG User. */
function AccountForm({ draft, setDraft, onCancel, onSave, saving, errors }) {
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSave() }}
      noValidate
      style={{ border: '1px solid var(--c-border2)', borderRadius: 12, padding: 14, marginBottom: 14, background: 'var(--c-card)' }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text1)', marginBottom: 12 }}>
        {draft.id ? 'Edit account' : 'New account'}
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label="Name" error={errors.shortName}>
          <input autoFocus value={draft.shortName ?? ''} onChange={e => set('shortName', e.target.value)} style={inputStyle(!!errors.shortName)} placeholder="Full name" />
        </Field>
        <Field label="Email (sign-in)" required error={errors.email} hint={draft.id ? 'The sign-in email cannot be changed.' : undefined}>
          <input type="email" value={draft.email} disabled={!!draft.id} onChange={e => set('email', e.target.value)} style={{ ...inputStyle(!!errors.email), opacity: draft.id ? 0.6 : 1 }} placeholder="name@company.com" />
        </Field>
        <Field label="Mobile" error={errors.mobile}>
          <input value={draft.mobile ?? ''} onChange={e => set('mobile', e.target.value)} style={inputStyle(!!errors.mobile)} placeholder="+971 50 000 0000" />
        </Field>
        <Field label="Password" error={errors.password} hint={draft.id ? 'Type a new one only to reset it.' : 'They must change it at first sign-in.'}>
          <input value={draft.password ?? ''} onChange={e => set('password', e.target.value)} style={inputStyle(!!errors.password)} />
        </Field>
        <Field label="Status">
          <div style={{ display: 'flex', gap: 6 }}>
            {['Active', 'Inactive'].map(s => (
              <button key={s} type="button" className={`ft-btn${draft.status === s ? ' ft-btn--active' : ''}`} aria-pressed={draft.status === s}
                onClick={() => set('status', s)} style={{ flex: 1, justifyContent: 'center', padding: '7px 10px' }}>{s}</button>
            ))}
          </div>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" style={SECONDARY_BTN} onClick={onCancel}>Cancel</button>
        <button type="submit" style={{ ...PRIMARY_BTN, opacity: saving ? 0.7 : 1 }} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

/**
 * @param {'ggb'|'group'|'bg'|'branch'} kind
 * @param {object} node      the GGB / Group / BG / Branch row
 * @param {string} [bgId]    for a branch, the BG it belongs to
 * @param {string|null} roleKey  the signed-in role (null in mock mode)
 */
export default function NodeUsersPanel({ kind, node, bgId, roleKey, onClose, push }) {
  const navigate = useNavigate()
  const meta = KIND[kind]
  const { own, subs } = useNodeAccounts(kind, node)
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState(null)
  const [permsOf, setPermsOf] = useState(null)   // { account, save }
  // "User accounts" permission: Edit to change accounts, Full to add or delete.
  const { user: me } = useSession()
  const accountsLevel = sessionLevel(me, 'users')
  const mayEditAccounts = atLeast(accountsLevel, 'modify')
  const mayAddAccounts = atLeast(accountsLevel, 'addDelete')

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !draft && !pending && !permsOf) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, pending, permsOf, onClose])

  const isAdmin = kind === 'ggb' || kind === 'group'
  const mayOwn = meta.role && canCreate(roleKey, meta.role)
  const maySub = (kind === 'bg' || kind === 'branch') && canCreate(roleKey, 'SUB_USER')
  const mayAddOwn = mayOwn && mayAddAccounts
  const mayAddSub = maySub && mayAddAccounts
  const mayEditOwn = mayOwn && mayEditAccounts
  const mayEditSub = maySub && mayEditAccounts

  const openPerms = (account, role, saveFn) => setPermsOf({ account: { ...account, role }, save: saveFn })
  const savePerms = async (fn, label) => {
    try {
      await fn()
      push?.(`Permissions saved for ${label}`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
      throw err
    }
  }
  const subBg = kind === 'bg' ? node.id : bgId

  const openAdd = () => {
    setErrors({})
    setDraft(isAdmin ? emptyAdmin(meta.role, node.id) : { ...emptyUser(), companyId: node.id, shortName: '', mobile: '' })
  }
  const openEdit = row => { setErrors({}); setDraft({ ...row, password: DEFAULT_PASSWORD }) }

  const save = async () => {
    const next = {}
    const email = draft.email.trim()
    if (!email) next.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Enter a valid email'
    else if (!draft.id && isLoginEmailTaken(email)) next.email = 'This email already has an account'
    if (draft.password && draft.password.length < 8) next.password = 'At least 8 characters'
    if (Object.keys(next).length) { setErrors(next); return }

    const clean = { ...draft, email, shortName: (draft.shortName ?? '').trim(), mobile: (draft.mobile ?? '').trim() }
    setSaving(true)
    try {
      if (isAdmin) await (draft.id ? updateAdmin(draft.id, clean) : addAdmin(clean))
      else await (draft.id ? updateUser(draft.id, clean) : addUser(clean))
      push?.(`${email} ${draft.id ? 'updated' : 'added'}`, { tone: 'success' })
      setDraft(null)
    } catch (err) {
      handleApiError(err, { push, setErrors })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    const row = pending
    setPending(null)
    try {
      await (isAdmin ? removeAdmin(row.id) : removeUser(row.id))
      push?.(`${row.email} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  const addSub = () => navigate(`/settings/company-subuser?new=1&bg=${encodeURIComponent(subBg ?? '')}${kind === 'branch' ? `&branch=${encodeURIComponent(node.id)}` : ''}`)
  const editSub = s => navigate(`/settings/company-subuser?edit=${encodeURIComponent(s.id)}`)

  return createPortal(
    <div onClick={() => !draft && !pending && !permsOf && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(5,20,28,0.45)' }}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Users of ${node.name}`}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(460px, 100%)',
          background: 'var(--c-page)', borderLeft: '1px solid var(--c-border)', boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-text3)' }}>{meta.noun} · Users</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text1)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={ICON_BTN}><X size={16} /></button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {draft && (
            <AccountForm draft={draft} setDraft={setDraft} errors={errors} saving={saving}
              onCancel={() => { setDraft(null); setErrors({}) }} onSave={save} />
          )}

          {meta.label && (
            <Section
              title={meta.label}
              count={own.length}
              empty={`No ${meta.label} yet.`}
              action={mayAddOwn && !draft && (
                <button type="button" onClick={openAdd} style={{ ...PRIMARY_BTN, padding: '6px 12px', fontSize: 11.5 }}>
                  <Plus size={13} strokeWidth={2.6} /> Add
                </button>
              )}
            >
              {own.map(a => (
                <AccountRow
                  key={a.id}
                  title={a.shortName || a.email}
                  sub={a.shortName ? a.email : a.mobile}
                  status={a.status}
                  access={a.permissions}
                  onEdit={mayEditOwn ? () => openEdit(a) : null}
                  onDelete={mayAddOwn ? () => setPending(a) : null}
                  onPermissions={mayEditOwn ? () => openPerms(a, isAdmin ? a.role : 'BG_USER', perms =>
                    savePerms(() => (isAdmin ? updateAdmin(a.id, { ...a, permissions: perms }) : updateUser(a.id, { ...a, permissions: perms })), a.email)) : null}
                />
              ))}
            </Section>
          )}

          {(kind === 'bg' || kind === 'branch') && (
            <Section
              title="Sub-users"
              count={subs.length}
              empty={kind === 'branch' ? 'No sub-users assigned to this branch.' : 'No sub-users yet.'}
              action={mayAddSub && !draft && (
                <button type="button" onClick={addSub} style={{ ...PRIMARY_BTN, padding: '6px 12px', fontSize: 11.5 }}>
                  <Plus size={13} strokeWidth={2.6} /> Add
                </button>
              )}
            >
              {subs.map(s => (
                <AccountRow
                  key={s.id}
                  title={s.name || s.email}
                  sub={s.name ? s.email : null}
                  status={s.status}
                  access={s.permissions}
                  onEdit={mayEditSub ? () => editSub(s) : null}
                  onPermissions={mayEditSub ? () => openPerms(s, 'SUB_USER', perms =>
                    savePerms(() => updateSubuser(s.id, { ...s, permissions: perms }), s.email)) : null}
                />
              ))}
            </Section>
          )}

          {(kind === 'bg' || kind === 'branch') && mayAddSub && (
            <p style={{ fontSize: 11.5, color: 'var(--c-text3)', margin: '0 2px', lineHeight: 1.5 }}>
              {kind === 'branch'
                ? 'Add opens the sub-user form with this Business Group filled in. A sub-user added here sees only this branch’s vehicles.'
                : 'Add opens the sub-user form with this Business Group filled in. That sub-user sees every vehicle of the Business Group.'}
            </p>
          )}
        </div>
      </aside>

      {permsOf && (
        <PermissionsEditor account={permsOf.account} onSave={permsOf.save} onClose={() => setPermsOf(null)} />
      )}

      {pending && (
        <ConfirmDialog
          title="Delete account?"
          body={`${pending.email} will no longer be able to sign in.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}
    </div>,
    document.body,
  )
}

// ── Row shortcut: straight to an account's permissions ─────────────────────
// Client, 2026-11-02: a "Permissions" button beside Users and Move on every
// row, so giving access does not mean opening the panel first. One account
// goes straight to its editor; several show a short picker first.

/** The "Permissions" button for a table row. */
export function PermissionsButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Set what this level's accounts may open and change"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
        border: '1px solid var(--c-border2)', background: 'var(--c-input)', color: 'var(--c-text2)',
        fontSize: 11.5, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      <ShieldCheck size={13} />
      Permissions
    </button>
  )
}

const ROLE_NAME = { GGB_ADMIN: 'Group Global Admin', GROUP_ADMIN: 'Group Admin', BG_USER: 'Business Group User', SUB_USER: 'Sub-user' }

/** Whether the signed-in user may set permissions at all (User accounts: Edit). */
export function useCanSetPermissions() {
  const { user } = useSession()
  return atLeast(sessionLevel(user, 'users'), 'modify')
}

export function NodePermissionsDialog({ kind, node, roleKey, onClose, onOpenUsers, push }) {
  const { own, subs } = useNodeAccounts(kind, node)
  const [editing, setEditing] = useState(null)
  const isAdmin = kind === 'ggb' || kind === 'group'
  const ownRole = KIND[kind].role

  // Only accounts the signed-in role may manage (strictly below its own rank).
  const accounts = [
    ...(ownRole && canCreate(roleKey, ownRole) ? own.map(a => ({
      account: { ...a, role: isAdmin ? a.role : 'BG_USER' },
      title: a.shortName || a.email,
      sub: a.shortName ? a.email : null,
      save: perms => (isAdmin ? updateAdmin(a.id, { ...a, permissions: perms }) : updateUser(a.id, { ...a, permissions: perms })),
    })) : []),
    ...(canCreate(roleKey, 'SUB_USER') ? subs.map(s => ({
      account: { ...s, role: 'SUB_USER' },
      title: s.name || s.email,
      sub: s.name ? s.email : null,
      save: perms => updateSubuser(s.id, { ...s, permissions: perms }),
    })) : []),
  ]

  const target = editing ?? (accounts.length === 1 ? accounts[0] : null)

  // Esc closes the picker (the editor handles its own Esc).
  useEffect(() => {
    if (target) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, onClose])

  const save = async perms => {
    try {
      await target.save(perms)
      push?.(`Permissions saved for ${target.account.email}`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
      throw err
    }
  }

  if (target) {
    return <PermissionsEditor account={target.account} onSave={save} onClose={onClose} />
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        role="dialog" aria-modal="true" aria-label={`Permissions for ${node.name}`}
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(460px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', borderRadius: 16, background: 'var(--c-card)', border: '1px solid var(--c-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-text3)' }}>{KIND[kind].noun} · Permissions</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--c-text1)', marginTop: 2 }}>{node.name}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={ICON_BTN}><X size={15} /></button>
        </header>
        <div style={{ overflowY: 'auto', padding: accounts.length ? '6px 0' : 18 }}>
          {accounts.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--c-text3)', lineHeight: 1.5 }}>
              No accounts here yet. Add one first, then give it permissions.
              {onOpenUsers && (
                <div style={{ marginTop: 12 }}>
                  <button type="button" onClick={onOpenUsers} style={{ ...PRIMARY_BTN, padding: '7px 14px', fontSize: 12 }}>
                    <Plus size={13} strokeWidth={2.6} /> Add a user
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ padding: '6px 18px 8px', fontSize: 12, color: 'var(--c-text3)' }}>Choose an account:</div>
              {accounts.map(a => (
                <button
                  key={a.account.id}
                  type="button"
                  onClick={() => setEditing(a)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 18px', border: 0, borderTop: '1px solid var(--c-border2)', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                >
                  <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
                    <UserRound size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{ROLE_NAME[a.account.role]}{a.sub ? ` · ${a.sub}` : ''}</div>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--c-text2)' }}>
                    <ShieldCheck size={13} />
                    {a.account.permissions && Object.keys(a.account.permissions).length ? `${openCount(a.account.permissions)}/${ALL_SCREENS.length}` : 'All'}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
