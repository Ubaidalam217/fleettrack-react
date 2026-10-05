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
  companyNameFor, emptyUser, isUserEmailTaken, DEFAULT_PASSWORD,
} from '../../data/settings'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'
import { IS_REAL } from '../../data/mode'

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
  const access = usePageAccess('user')

  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)
  const [saving,  setSaving]  = useState(false)
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

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!draft.companyId)    next.companyId = 'BG is required'
    if (!draft.email.trim()) next.email     = 'Email is required'
    // The email is the username, so this is the login-uniqueness check too. Only
    // the accounts in scope are visible here; the server's case-insensitive unique
    // index catches the rest and comes back as a 409 on the same field.
    else if (isUserEmailTaken(draft.email, draft.id)) next.email = 'A user with this email already exists.'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, email: draft.email.trim() }
    const customPassword = clean.password && clean.password !== DEFAULT_PASSWORD

    setSaving(true)
    try {
      if (draft.id) {
        await updateUser(draft.id, clean)
        push(
          IS_REAL && customPassword
            ? `${clean.email} updated · password reset, they must change it at next sign-in`
            : `${clean.email} updated`,
          { tone: 'success' }
        )
      } else {
        await addUser(clean)
        // Worth saying in real mode: the operator has to hand this over, and the
        // account cannot use the API at all until it is changed.
        push(
          IS_REAL
            ? `${clean.email} added · first password "${clean.password || DEFAULT_PASSWORD}", must be changed at first sign-in`
            : `${clean.email} added`,
          { tone: 'success' }
        )
      }
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
      await removeUser(row.id)
      push(`${row.email} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
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

              {/* Write-only against the real API: the hash is never returned, so
                  this shows the default on an existing row. Leaving it alone changes
                  nothing; typing in it triggers a password reset (which also
                  re-arms the first-login requirement). */}
              <Field
                label="Password"
                hint={
                  IS_REAL
                    ? draft.id
                      ? 'Type a new password to reset it, or leave it as-is to keep the current one.'
                      : 'Handed to the user for their first sign-in.'
                    : undefined
                }
              >
                <input
                  name="password"
                  value={draft.password}
                  onChange={e => set('password', e.target.value)}
                  style={inputStyle(false)}
                />
              </Field>
            </div>

            {/*
              Always on in real mode, and locked.

              The server sets mustChangePassword on every account it creates and
              offers no way to clear it other than the account changing its own
              password — which is the right behaviour: a password somebody else
              chose and typed into a form is not a secret. An editable checkbox
              here would be a setting that silently did nothing.
            */}
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                marginTop: 16, cursor: IS_REAL ? 'default' : 'pointer',
                fontSize: 12.5, color: 'var(--c-text2)',
              }}
            >
              <input
                type="checkbox"
                name="forceChange"
                checked={IS_REAL ? (draft.id ? draft.forceChange : true) : draft.forceChange}
                onChange={e => set('forceChange', e.target.checked)}
                disabled={IS_REAL}
                style={{
                  width: 15, height: 15, accentColor: 'var(--ft-accent)',
                  cursor: IS_REAL ? 'not-allowed' : 'pointer',
                  opacity: IS_REAL ? 0.65 : 1,
                }}
              />
              Force password change on first login
              {IS_REAL && (
                <span style={{ fontSize: 10.5, color: 'var(--c-text3)' }}>
                  — always required for a password set here
                </span>
              )}
            </label>

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                const saved = draft.id ? users.find(u => u.id === draft.id) : null
                setDraft(saved ? { ...saved } : emptyUser())
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
              saving={saving}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <PageNotice {...access} />

          {!access.loading && (
            <>
              <TableToolbar count={users.length} noun="user" plural="users">
                {access.canWrite && (
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
                )}
              </TableToolbar>

              <SettingsTable
                columns={COLUMNS}
                rows={users}
                labelKey="email"
                onEdit={openEdit}
                onDelete={setPending}
                canWrite={access.canWrite}
                emptyLabel={
                  !access.canWrite
                    ? 'No users to show.'
                    : noCompanies
                      ? 'No BGs on file — add a Business Group before creating users.'
                      : 'No users yet — use Add User to create one.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete user?"
          body={`${pending.email} will lose access to ${companyNameFor(pending.companyId)}.`}
          note={modeNote(
            'The account is deleted and can no longer sign in. This cannot be undone.',
            'This is mock data — nothing is sent to a server.'
          )}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
