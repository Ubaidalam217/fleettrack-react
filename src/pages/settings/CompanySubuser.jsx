import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Eye, EyeOff, Building2, KeyRound, ShieldCheck, Mail, MessageSquare, Lock, UserRound } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { PRIMARY_BTN, SECONDARY_BTN } from './formStyles'
import { DFM_CSS, ctl } from './alignedFormStyles'
import { DF, DSection, ReadOnly } from './AlignedForm'
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
import { openCount, ALL_SCREENS } from '../../data/screens'

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
  { key: 'company',  label: 'Business Group', render: row => companyNameFor(row.companyId) },
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
    // The same catalogue and reading the permission editor uses (data/screens.js).
    render: row => `${openCount(row.permissions)} of ${ALL_SCREENS.length}`,
  },
]

// The hero's initials: first letters of the first two words of the name.
const initialsOf = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')

const AVATAR = {
  width: 56, height: 56, borderRadius: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 19, fontWeight: 800, letterSpacing: 0.5, color: 'var(--ft-accent)',
  background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)',
}

/** An on / off chip in the aligned form's style (role="checkbox"). */
function Chip({ on, onChange, icon: Icon, children }) {
  return (
    <button type="button" className="dfm-chip" role="checkbox" aria-checked={on} onClick={() => onChange(!on)}>
      {Icon && <Icon size={14} />}{children}
    </button>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

/** A password input with a show / hide eye button. */
function PasswordBox({ shown, onToggle, invalid, ...input }) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        {...input}
        id={input.id}
        type={shown ? 'text' : 'password'}
        autoComplete="new-password"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        style={ctl(invalid, { paddingRight: 40 })}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
          width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 0, borderRadius: 6, background: 'transparent', color: 'var(--c-text3)', cursor: 'pointer',
        }}
      >
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

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
  // Client, 2026-11-10: whoever adds a sub-user sees the password being set,
  // not dots. An existing row starts hidden: what sits there is the default,
  // not the user's password, which is stored only as a hash.
  const [showPw, setShowPw] = useState(false)
  const draftId = draft?.id ?? null
  useEffect(() => { setShowPw(editing && !draftId) }, [editing, draftId])

  useEffect(() => {
    if (editing) firstRef.current?.focus()
  }, [editing])

  const openAdd = (prefill = {}) => {
    setErrors({})
    setTab(TABS[0].id)
    setDraft({ ...emptySubuser(), ...prefill })
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

  // Deep links from the Users panel on the BG and Branch pages:
  //   ?new=1&bg=<id>&branch=<id>  opens Add with the BG (and branch) filled in
  //   ?edit=<id>                  opens that sub-user once it has loaded
  // Each link is acted on once (`handledLink`), so a later store update — the
  // save itself — cannot reopen the form.
  const [params, setParams] = useSearchParams()
  const handledLink = useRef(null)
  useEffect(() => {
    const key = params.toString()
    if (!key || handledLink.current === key) return
    const editId = params.get('edit')
    if (params.get('new')) {
      const branch = params.get('branch')
      openAdd({ companyId: params.get('bg') || '', branchIds: branch ? [branch] : [] })
    } else if (editId) {
      const row = subusers.find(u => u.id === editId)
      if (!row) return // not loaded yet; runs again when the list arrives
      openEdit(row)
    } else return
    handledLink.current = key
    setParams({}, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, subusers])

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
    if (!draft.companyId)    next.companyId = 'Business Group is required'
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
  const fid = n => `su-${n}`
  const busyBtn = saving ? { opacity: 0.6, cursor: 'not-allowed' } : null
  const title = !editing ? 'Company Subuser' : draft.id ? 'Edit Subuser' : 'Add Subuser'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate className="dfm">
          <style>{DFM_CSS}</style>

          {/* ── Who ── */}
          <div className="dfm-hero">
            <div style={AVATAR} aria-hidden="true">{initialsOf(draft.name) || <UserRound size={24} />}</div>
            <div className="dfm-hero-main">
              <div className={`dfm-hero-name${draft.name.trim() ? '' : ' empty'}`}>{draft.name.trim() || 'New sub-user'}</div>
              <div className="dfm-hero-meta">
                <span className="dfm-code">Sub-user</span>
                {draft.companyId && <span>{companyNameFor(draft.companyId)}</span>}
                {draft.email.trim() && <span>{draft.email.trim()}</span>}
              </div>
            </div>
          </div>

          {/* The client kept only My Account (see TABS), so its fields are
              split into sections rather than shown behind a tab bar. */}
          <DSection icon={Building2} title="Account" desc="The Business Group this login belongs to, and the name it is shown under.">
            <div className="dfm-grid">
              <DF id={fid('companyId')} label="Business Group" required error={errors.companyId} span={6}>
                <select
                  ref={firstRef}
                  id={fid('companyId')}
                  name="companyId"
                  value={draft.companyId}
                  onChange={e => set('companyId', e.target.value)}
                  aria-invalid={!!errors.companyId || undefined}
                  style={ctl(!!errors.companyId)}
                >
                  <option value="">Select a Business Group</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </DF>

              <DF id={fid('name')} label="Short Name" required error={errors.name} span={6}>
                <input
                  id={fid('name')}
                  name="name"
                  value={draft.name}
                  onChange={e => set('name', e.target.value)}
                  aria-invalid={!!errors.name || undefined}
                  placeholder="Mussafah Dispatch"
                  style={ctl(!!errors.name)}
                />
              </DF>
            </div>
          </DSection>

          <DSection icon={KeyRound} title="Sign-in" desc="The email address is the username. The user changes the password at first sign-in.">
            <div className="dfm-grid">
              <DF id={fid('email')} label="User Name (email)" required error={errors.email} span={6}>
                <input
                  id={fid('email')}
                  name="email"
                  type="email"
                  value={draft.email}
                  onChange={e => set('email', e.target.value)}
                  aria-invalid={!!errors.email || undefined}
                  placeholder="name@company.ae"
                  autoComplete="off"
                  style={ctl(!!errors.email)}
                />
              </DF>

              <DF id={fid('confirmEmail')} label="Confirm User Name" required error={errors.confirmEmail} span={6}>
                <input
                  id={fid('confirmEmail')}
                  name="confirmEmail"
                  type="email"
                  value={confirm.username}
                  onChange={e => setConfirmField('username', e.target.value)}
                  aria-invalid={!!errors.confirmEmail || undefined}
                  placeholder="Repeat the email address"
                  autoComplete="off"
                  style={ctl(!!errors.confirmEmail)}
                />
              </DF>
            </div>

            {/* Write-only against the real API: the hash is never returned, so
                an existing row shows the default here. Leaving it alone keeps
                the current password; typing a new one resets it. */}
            <div className="dfm-grid">
              <DF
                id={fid('password')}
                label="Password"
                required
                error={errors.password}
                span={6}
                hint={draft.id ? 'Type a new password to reset it, or leave it as-is to keep the current one.' : 'Handed to the user for their first sign-in.'}
              >
                <PasswordBox
                  id={fid('password')}
                  name="password"
                  value={draft.password}
                  onChange={e => set('password', e.target.value)}
                  invalid={!!errors.password}
                  shown={showPw}
                  onToggle={() => setShowPw(v => !v)}
                />
              </DF>

              <DF id={fid('retypePassword')} label="Retype Password" required error={errors.retypePassword} span={6}>
                <PasswordBox
                  id={fid('retypePassword')}
                  name="retypePassword"
                  value={confirm.password}
                  onChange={e => setConfirmField('password', e.target.value)}
                  invalid={!!errors.retypePassword}
                  shown={showPw}
                  onToggle={() => setShowPw(v => !v)}
                />
              </DF>
            </div>

            <div className="dfm-grid">
              {/* Not stored — rendered from the email, same as the User page. */}
              <ReadOnly id={fid('username')} label="Login" value={draft.email.trim() || '—'} span={6} hint="Set by the User Name field." />

              <DF id={fid('shareVia')} label="Share Credentials Via" group span={6}>
                <div className="dfm-chips" role="group" aria-labelledby={`${fid('shareVia')}-label`}>
                  <Chip icon={Mail} on={draft.shareVia.email} onChange={v => set('shareVia', { ...draft.shareVia, email: v })}>Email</Chip>
                  <Chip icon={MessageSquare} on={draft.shareVia.sms} onChange={v => set('shareVia', { ...draft.shareVia, sms: v })}>SMS</Chip>
                </div>
              </DF>
            </div>
          </DSection>

          <DSection icon={ShieldCheck} title="Contact & security" desc="Where to reach the user, and how they recover a lost password.">
            <div className="dfm-grid">
              <DF id={fid('mobileNumber')} label="Mobile Number" span={6}>
                <input
                  id={fid('mobileNumber')}
                  name="mobileNumber"
                  type="tel"
                  value={draft.mobileNumber}
                  onChange={e => set('mobileNumber', e.target.value)}
                  placeholder="+971 50 000 0000"
                  style={ctl(false)}
                />
              </DF>

              <DF id={fid('passwordRecoveryEmail')} label="Password Recovery Email" span={6}>
                <input
                  id={fid('passwordRecoveryEmail')}
                  name="passwordRecoveryEmail"
                  type="email"
                  value={draft.passwordRecoveryEmail}
                  onChange={e => set('passwordRecoveryEmail', e.target.value)}
                  placeholder="recovery@company.ae"
                  style={ctl(false)}
                />
              </DF>

              <DF id={fid('enableSecurityPin')} label="Security PIN" group span={12}>
                <div className="dfm-chips" role="group" aria-labelledby={`${fid('enableSecurityPin')}-label`}>
                  <Chip icon={Lock} on={draft.enableSecurityPin} onChange={v => set('enableSecurityPin', v)}>Require a security PIN at login</Chip>
                </div>
              </DF>
            </div>
          </DSection>

          <div className="dfm-foot">
            <span className="dfm-foot-note"><span className="dfm-req" aria-hidden="true">*</span> Required</span>
            <button type="button" onClick={closeForm} style={{ ...SECONDARY_BTN, height: 40, ...busyBtn }} disabled={saving}>Back</button>
            <button type="button" onClick={resetForm} style={{ ...SECONDARY_BTN, height: 40, ...busyBtn }} disabled={saving}>Reset</button>
            <button type="submit" style={{ ...PRIMARY_BTN, height: 40, ...busyBtn }} disabled={saving}>
              {saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Save Sub-user'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <PageNotice {...access} />

          {!access.loading && (
            <>
              <TableToolbar count={subusers.length} noun="sub-user" plural="sub-users">
                {access.canAdd && (
                  <button
                    type="button"
                    style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
                    disabled={noCompanies}
                    title={noCompanies ? 'Add a Business Group first' : undefined}
                    onClick={() => openAdd()}
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
                onDelete={access.canDelete ? setPending : null}
                canWrite={access.canWrite}
                emptyLabel={
                  !access.canWrite
                    ? 'No sub-users to show.'
                    : noCompanies
                      ? 'No Business Groups on file — add one before creating sub-users.'
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
