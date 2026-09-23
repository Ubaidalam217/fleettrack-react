import { useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { Field, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useUsers, useCompanies, addUser, updateUser, removeUser,
  companyNameFor, emptyUser, isUserEmailTaken,
} from './mockData'

// BG login accounts. Distinct from the BG page next door, which owns
// the organisation record (name, reseller, contact email); this owns the
// credential that signs in against one of those organisations.
//
// The controls are hand-built from FormKit's Field plus formStyles' inputStyle
// — the same primitives FormFields composes internally, so they render
// identically — because this form needs a read-only box and a checkbox, and
// FormFields supports neither.

// Mirrors the badge vocabulary in components/VehicleStatus.jsx.
const STATUS_TONE = {
  Active:   { color: '#16a34a', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' },
  Inactive: { color: 'var(--c-text3)', bg: 'var(--c-progress)', border: 'transparent' },
}

function StatusPill({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.Inactive
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: tone.color, background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
      {status}
    </span>
  )
}

const COLUMNS = [
  { key: 'company',  label: 'BG', bold: true, render: row => companyNameFor(row.companyId) },
  { key: 'email',    label: 'Username (email)' },
  { key: 'status',   label: 'Status', render: row => <StatusPill status={row.status} /> },
]

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px 16px',
}

export default function User(props) {
  const users     = useUsers()
  const companies = useCompanies()
  const { toasts, push, dismiss } = useToasts()

  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)
  const firstRef = useRef(null)
  const formRef  = useRef(null)

  const editing = draft !== null

  useEffect(() => {
    if (editing) firstRef.current?.focus()
  }, [editing])

  const openAdd   = ()  => { setErrors({}); setDraft(emptyUser()) }
  const openEdit  = row => { setErrors({}); setDraft({ ...row }) }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => ({ ...d, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const submit = e => {
    e.preventDefault()

    const next = {}
    if (!draft.companyId)    next.companyId = 'BG is required'
    if (!draft.email.trim()) next.email     = 'Email is required'
    // The email is the username, so this is the login-uniqueness check too.
    else if (isUserEmailTaken(draft.email, draft.id)) next.email = 'A user with this email already exists.'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, email: draft.email.trim() }
    if (draft.id) {
      updateUser(draft.id, clean)
      push(`${clean.email} updated`, { tone: 'success' })
    } else {
      addUser(clean)
      push(`${clean.email} added`, { tone: 'success' })
    }
    setDraft(null)
  }

  const confirmDelete = () => {
    removeUser(pending.id)
    push(`${pending.email} deleted`, { tone: 'success' })
    setPending(null)
  }

  const noCompanies = companies.length === 0
  const title = !editing ? 'User' : draft.id ? 'Edit User' : 'Add User'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'User details' : 'New user'}
            subtitle="Fields marked with * are required. The username is the email address."
          >
            <div style={GRID}>
              <Field label="BG (Business Group)" required error={errors.companyId}>
                <select
                  ref={firstRef}
                  name="companyId"
                  value={draft.companyId}
                  onChange={e => set('companyId', e.target.value)}
                  aria-invalid={!!errors.companyId || undefined}
                  style={inputStyle(!!errors.companyId)}
                >
                  <option value="">— Select —</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Email" required error={errors.email}>
                <input
                  name="email"
                  type="email"
                  value={draft.email}
                  onChange={e => set('email', e.target.value)}
                  aria-invalid={!!errors.email || undefined}
                  placeholder="name@company.ae"
                  style={inputStyle(!!errors.email)}
                />
              </Field>

              {/* Not stored — rendered from the email so the operator can see
                  exactly what they will be signing in with as they type. */}
              <Field label="Username">
                <input
                  name="username"
                  value={draft.email}
                  readOnly
                  tabIndex={-1}
                  aria-readonly="true"
                  placeholder="Set by the Email field"
                  style={{
                    ...inputStyle(false),
                    background: 'var(--c-thead)',
                    color: 'var(--c-text3)',
                    cursor: 'not-allowed',
                  }}
                />
              </Field>

              <Field label="Password">
                <input
                  name="password"
                  value={draft.password}
                  onChange={e => set('password', e.target.value)}
                  style={inputStyle(false)}
                />
              </Field>
            </div>

            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                marginTop: 16, cursor: 'pointer',
                fontSize: 12.5, color: 'var(--c-text2)',
              }}
            >
              <input
                type="checkbox"
                name="forceChange"
                checked={draft.forceChange}
                onChange={e => set('forceChange', e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--ft-accent)', cursor: 'pointer' }}
              />
              Force password change on first login
            </label>

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                const saved = draft.id ? users.find(u => u.id === draft.id) : null
                setDraft(saved ? { ...saved } : emptyUser())
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <TableToolbar count={users.length} noun="user" plural="users">
            <button
              type="button"
              style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
              disabled={noCompanies}
              // An account has to belong to a BG, so with none on file the
              // form would open with an unsatisfiable required dropdown.
              title={noCompanies ? 'Add a BG first' : undefined}
              onClick={openAdd}
            >
              <Plus size={14} strokeWidth={2.6} />
              Add User
            </button>
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={users}
            labelKey="email"
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel={noCompanies
              ? 'No BGs on file — add a Business Group before creating users.'
              : 'No users yet — use Add User to create one.'}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete user?"
          body={`${pending.email} will lose access to ${companyNameFor(pending.companyId)}.`}
          note="This is mock data — nothing is sent to a server."
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
