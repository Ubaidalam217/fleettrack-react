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
  useSubusers, useCompanies, useVehicles, useBranches,
  addSubuser, updateSubuser, removeSubuser,
  companyNameFor, vehiclesForCompany, branchesForCompany,
  emptySubuser, normalizeSubuser,
  isSubuserEmailTaken, DEFAULT_PASSWORD,
} from '../../data/settings'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'
import { IS_REAL } from '../../data/mode'
import { permissionFor, allScreens } from './subuserSchema'

// A sub-user is a restricted login under a BG, scoped to the vehicles AND the
// branches assigned to it. The two scopes are independent lists.
//
// The form mirrored AI Revofleet's six-tab Company Subuser Detail (see
// docs/aitracking-reference.md §3.2); the client has since kept only My Account.
// The field catalogues still live in subuserSchema.js.

// The client asked (2026-10-30) for Data Access, Screen Access, User Setting,
// Authentication and SSO to be removed from this form, so My Account is the only
// section and no tab bar is shown. Their fields keep their saved or default
// values: screens default to DEFAULT_PERMISSION ('view'), and the vehicle scope
// is the sub-user's whole BG — see allOfBg() in submit.
const TABS = [
  { id: 'account', label: 'My Account' },
]

// Which tab owns each validated field, so a failed save can land the user on
// the tab holding the problem rather than silently refusing to submit.
const ERROR_TAB = {
  companyId:      'account',
  name:           'account',
  email:          'account',
  confirmEmail:   'account',
  password:       'account',
  retypePassword: 'account',
}

const COLUMNS = [
  { key: 'name',     label: 'Sub-user Name', bold: true },
  { key: 'company',  label: 'BG', render: row => companyNameFor(row.companyId) },
  {
    key: 'vehicles',
    label: 'Assigned Vehicles',
    render: row => {
      const total = vehiclesForCompany(row.companyId).length
      const n = row.vehicleIds.length
      return n === 0 ? 'None' : `${n} of ${total}`
    },
  },
  {
    key: 'branches',
    label: 'Assigned Branches',
    render: row => {
      const total = branchesForCompany(row.companyId).length
      // Rows written before branch scoping existed have no list at all.
      const n = row.branchIds?.length ?? 0
      return n === 0 ? 'None' : `${n} of ${total}`
    },
  },
  {
    key: 'access',
    label: 'Screen Access',
    render: row => {
      const total = allScreens().length
      const open = allScreens().filter(s => permissionFor(row.permissions, s.id) !== 'none').length
      return `${open} of ${total}`
    },
  },
]

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px 16px',
}

const CHECK = { width: 15, height: 15, accentColor: 'var(--ft-accent)', cursor: 'pointer', flexShrink: 0 }

const READONLY_INPUT = {
  background: 'var(--c-thead)',
  color: 'var(--c-text3)',
  cursor: 'not-allowed',
}

// ── Small shared controls ──────────────────────────────────────────────────

function CheckRow({ label, checked, onChange, disabled, title }) {
  return (
    <label
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        fontSize: 12.5, color: disabled ? 'var(--c-text3)' : 'var(--c-text1)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        style={{ ...CHECK, cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      {label}
    </label>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CompanySubuser(props) {
  const subusers  = useSubusers()
  const companies = useCompanies()
  // Subscribed so both panels re-render when the fleet or the branch list
  // changes under them; the per-BG slices come from the *ForCompany reads.
  useVehicles()
  useBranches()

  const { toasts, push, dismiss } = useToasts()
  const access = usePageAccess('company-subuser')

  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [tab,     setTab]     = useState(TABS[0].id)

  // Confirmation inputs, held outside the draft so they can never be saved.
  // A stored second copy of a credential is how the two drift apart.
  const [confirm, setConfirm] = useState({ username: '', password: '' })

  const firstRef = useRef(null)
  const formRef  = useRef(null)

  const editing = draft !== null

  useEffect(() => {
    if (editing) firstRef.current?.focus()
  }, [editing])

  const openAdd = () => {
    setErrors({})
    setTab(TABS[0].id)
    setDraft(emptySubuser())
    // The password field opens prefilled with the default, so the retype does
    // too — making the operator copy a value the form just filled in for them
    // is friction without a safety gain.
    setConfirm({ username: '', password: DEFAULT_PASSWORD })
  }

  const openEdit = row => {
    setErrors({})
    setTab(TABS[0].id)
    const full = normalizeSubuser(row)
    setDraft(full)
    // Seeded from the saved row: an edit is not a reason to retype a username
    // and password that are already on file.
    setConfirm({ username: full.email, password: full.password })
  }

  const closeForm = () => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      // Vehicle and branch ids belong to the old BG and mean nothing under the
      // new one, so switching BG starts both scopes over.
      if (key === 'companyId') { next.vehicleIds = []; next.branchIds = [] }
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const setConfirmField = (key, value) => {
    setConfirm(c => ({ ...c, [key]: value }))
    const errKey = key === 'username' ? 'confirmEmail' : 'retypePassword'
    setErrors(e => (e[errKey] ? { ...e, [errKey]: null } : e))
  }

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!draft.companyId)    next.companyId = 'BG is required'
    if (!draft.name.trim())  next.name      = 'Short Name is required'

    if (!draft.email.trim()) next.email = 'User Name is required'
    // The email is the username, so this is the login-uniqueness check too.
    else if (isSubuserEmailTaken(draft.email, draft.id)) next.email = 'A sub-user with this email already exists.'

    if (!confirm.username.trim()) next.confirmEmail = 'Confirm Username is required'
    else if (confirm.username.trim() !== draft.email.trim()) next.confirmEmail = 'Does not match the User Name.'

    if (!draft.password) next.password = 'Password is required'
    if (!confirm.password) next.retypePassword = 'Retype Password is required'
    else if (confirm.password !== draft.password) next.retypePassword = 'Does not match the Password.'

    if (Object.keys(next).length) {
      setErrors(next)
      const firstKey = Object.keys(next)[0]
      // Validation spans every tab, so land on the one holding the problem
      // before trying to focus the field — focusing an unmounted input is a
      // save that silently does nothing.
      const target = ERROR_TAB[firstKey] ?? TABS[0].id
      setTab(target)
      requestAnimationFrame(() => {
        formRef.current?.querySelector(`[name="${firstKey}"]`)?.focus()
      })
      return
    }

    // With no Data Access section, a sub-user that has no vehicles or branches —
    // a new one, or one whose BG was just changed (set() clears both) — gets
    // every vehicle and branch of its BG, so it is never created seeing nothing.
    // Branch assignment also covers vehicles added to those branches later.
    const allOfBg = draft.vehicleIds.length === 0 && draft.branchIds.length === 0
    const clean = {
      ...draft,
      ...(allOfBg && {
        vehicleIds: vehiclesForCompany(draft.companyId).map(v => v.id),
        branchIds: branchesForCompany(draft.companyId).map(b => b.id),
      }),
      name:                  draft.name.trim(),
      email:                 draft.email.trim(),
      mobileNumber:          draft.mobileNumber.trim(),
      passwordRecoveryEmail: draft.passwordRecoveryEmail.trim(),
      ssoProviders: draft.ssoProviders
        .map(p => ({ ...p, provider: p.provider.trim() }))
        .filter(p => p.provider),
    }
    const customPassword = clean.password && clean.password !== DEFAULT_PASSWORD

    setSaving(true)
    try {
      if (draft.id) {
        // In real mode this is three or five calls — the row, then the vehicle and
        // branch assignment sets, in the order the server's own rules allow. See
        // updateSubuser in data/settings.js.
        await updateSubuser(draft.id, clean)
        push(`${clean.name} updated`, { tone: 'success' })
      } else {
        await addSubuser(clean)
        push(
          IS_REAL
            ? `${clean.name} added · first password "${customPassword ? clean.password : DEFAULT_PASSWORD}", must be changed at first sign-in`
            : `${clean.name} added`,
          { tone: 'success' }
        )
      }
      setDraft(null)
    } catch (err) {
      // Field errors land on My Account, the only section left; an assignment
      // failure (vehicleIds / branchIds) has no field and shows as the toast.
      const fields = handleApiError(err, { push, setErrors })
      const firstKey = fields && Object.keys(fields)[0]
      if (firstKey && ERROR_TAB[firstKey]) setTab(ERROR_TAB[firstKey])
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    const row = pending
    setPending(null)
    try {
      await removeSubuser(row.id)
      push(`${row.name} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  const resetForm = () => {
    setErrors({})
    // Back to where the form opened; the fallback guards the row having
    // vanished rather than spreading undefined into a draft.
    const saved = draft.id ? subusers.find(s => s.id === draft.id) : null
    if (saved) {
      const full = normalizeSubuser(saved)
      setDraft(full)
      setConfirm({ username: full.email, password: full.password })
    } else {
      setDraft(emptySubuser())
      setConfirm({ username: '', password: DEFAULT_PASSWORD })
    }
  }

  const noCompanies = companies.length === 0
  const title = !editing ? 'Company Subuser' : draft.id ? 'Edit Subuser' : 'Add Subuser'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Company Subuser Detail' : 'New sub-user'}
            subtitle="Fields marked with * are required. The username is the email address."
          >
            {/* ── Tab 1: My Account ── */}
            {tab === 'account' && (
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

                <Field label="Short Name" required error={errors.name}>
                  <input
                    name="name"
                    value={draft.name}
                    onChange={e => set('name', e.target.value)}
                    aria-invalid={!!errors.name || undefined}
                    placeholder="Mussafah Dispatch"
                    style={inputStyle(!!errors.name)}
                  />
                </Field>

                <Field label="User Name" required error={errors.email}>
                  <input
                    name="email"
                    type="email"
                    value={draft.email}
                    onChange={e => set('email', e.target.value)}
                    aria-invalid={!!errors.email || undefined}
                    placeholder="Use Email Address as Username."
                    style={inputStyle(!!errors.email)}
                  />
                </Field>

                <Field label="Confirm Username" required error={errors.confirmEmail}>
                  <input
                    name="confirmEmail"
                    type="email"
                    value={confirm.username}
                    onChange={e => setConfirmField('username', e.target.value)}
                    aria-invalid={!!errors.confirmEmail || undefined}
                    placeholder="Repeat the email address"
                    style={inputStyle(!!errors.confirmEmail)}
                  />
                </Field>

                {/* Not stored — rendered from the email, same as the User page. */}
                <Field label="Username (login)">
                  <input
                    name="username"
                    value={draft.email}
                    readOnly
                    tabIndex={-1}
                    aria-readonly="true"
                    placeholder="Set by the User Name field"
                    style={{ ...inputStyle(false), ...READONLY_INPUT }}
                  />
                </Field>

                <Field label="Share Credentials Via">
                  <div style={{ display: 'flex', gap: 16, paddingTop: 4 }}>
                    <CheckRow
                      label="Email"
                      checked={draft.shareVia.email}
                      onChange={v => set('shareVia', { ...draft.shareVia, email: v })}
                    />
                    <CheckRow
                      label="SMS"
                      checked={draft.shareVia.sms}
                      onChange={v => set('shareVia', { ...draft.shareVia, sms: v })}
                    />
                  </div>
                </Field>

                <Field label="Password" required error={errors.password}>
                  <input
                    name="password"
                    type="password"
                    value={draft.password}
                    onChange={e => set('password', e.target.value)}
                    aria-invalid={!!errors.password || undefined}
                    style={inputStyle(!!errors.password)}
                  />
                </Field>

                <Field label="Retype Password" required error={errors.retypePassword}>
                  <input
                    name="retypePassword"
                    type="password"
                    value={confirm.password}
                    onChange={e => setConfirmField('password', e.target.value)}
                    aria-invalid={!!errors.retypePassword || undefined}
                    style={inputStyle(!!errors.retypePassword)}
                  />
                </Field>

                <Field label="Mobile Number">
                  <input
                    name="mobileNumber"
                    type="tel"
                    value={draft.mobileNumber}
                    onChange={e => set('mobileNumber', e.target.value)}
                    placeholder="+971 50 000 0000"
                    style={inputStyle(false)}
                  />
                </Field>

                <Field label="Enable Security Pin">
                  <div style={{ paddingTop: 6 }}>
                    <CheckRow
                      label="Require a security PIN at login"
                      checked={draft.enableSecurityPin}
                      onChange={v => set('enableSecurityPin', v)}
                    />
                  </div>
                </Field>

                <Field label="Password Recovery Email">
                  <input
                    name="passwordRecoveryEmail"
                    type="email"
                    value={draft.passwordRecoveryEmail}
                    onChange={e => set('passwordRecoveryEmail', e.target.value)}
                    placeholder="recovery@company.ae"
                    style={inputStyle(false)}
                  />
                </Field>
              </div>
            )}

            <FormActions
              onBack={closeForm}
              onReset={resetForm}
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
              <TableToolbar count={subusers.length} noun="sub-user" plural="sub-users">
                {access.canWrite && (
                  <button
                    type="button"
                    style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
                    disabled={noCompanies}
                    title={noCompanies ? 'Add a BG first' : undefined}
                    onClick={openAdd}
                  >
                    <Plus size={14} strokeWidth={2.6} />
                    Add Subuser
                  </button>
                )}
              </TableToolbar>

              <SettingsTable
                columns={COLUMNS}
                rows={subusers}
                onEdit={openEdit}
                onDelete={setPending}
                canWrite={access.canWrite}
                emptyLabel={
                  !access.canWrite
                    ? 'No sub-users to show.'
                    : noCompanies
                      ? 'No BGs on file — add a Business Group before creating sub-users.'
                      : 'No sub-users yet — use Add Subuser to create one.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete sub-user?"
          body={`${pending.name} will lose access to ${companyNameFor(pending.companyId)}.`}
          note={modeNote(
            'The account is deleted along with its vehicle and branch assignments. This cannot be undone.',
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
