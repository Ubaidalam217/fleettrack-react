import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { Field, FormActions, FormCard, FormTabs } from './FormKit'
import { PRIMARY_BTN, SECONDARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useSubusers, useCompanies, useVehicles, useBranches,
  addSubuser, updateSubuser, removeSubuser,
  companyNameFor, vehiclesForCompany, branchesForCompany, branchTreeForCompany,
  vehicleLabel, vehicleSubLabel, emptySubuser, normalizeSubuser,
  isSubuserEmailTaken, DEFAULT_PASSWORD,
} from './mockData'
import {
  ACCESS_TREE, PERMISSION_LEVELS, permissionFor, grantedCount, allScreens,
  USER_SETTING_FIELDS, AUTH_REQUIRED_OPTIONS, DELETE_AUTH_OPTIONS,
} from './subuserSchema'

// A sub-user is a restricted login under a BG, scoped to the vehicles AND the
// branches assigned to it. The two scopes are independent lists.
//
// The form is six tabs, mirroring AI Revofleet's Company Subuser Detail — see
// docs/aitracking-reference.md §3.2. Field catalogues live in subuserSchema.js;
// this file is the form around them.

const TABS = [
  { id: 'account', label: 'My Account' },
  { id: 'data',    label: 'Data Access' },
  { id: 'screen',  label: 'Screen Access' },
  { id: 'setting', label: 'User Setting' },
  { id: 'auth',    label: 'Authentication' },
  { id: 'sso',     label: 'SSO (Single Sign On)' },
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
const RADIO = { width: 14, height: 14, accentColor: 'var(--ft-accent)', cursor: 'pointer', flexShrink: 0 }

const READONLY_INPUT = {
  background: 'var(--c-thead)',
  color: 'var(--c-text3)',
  cursor: 'not-allowed',
}

const NOTE = { fontSize: 11, color: 'var(--c-text3)', lineHeight: 1.6 }

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

function RadioGroup({ name, options, value, onChange, disabledValues = [], titleFor }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', paddingTop: 4 }}>
      {options.map(o => {
        const off = disabledValues.includes(o)
        return (
          <label
            key={o}
            title={titleFor?.(o)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              fontSize: 12.5, color: off ? 'var(--c-text3)' : 'var(--c-text1)',
              cursor: off ? 'not-allowed' : 'pointer',
            }}
          >
            <input
              type="radio"
              name={name}
              value={o}
              checked={value === o}
              disabled={off}
              onChange={() => onChange(o)}
              style={{ ...RADIO, cursor: off ? 'not-allowed' : 'pointer' }}
            />
            {o}
          </label>
        )
      })}
    </div>
  )
}

/** Inline checkbox group whose value is an array of the ticked labels. */
function ChecksGroup({ options, value, onChange }) {
  const toggle = o => onChange(
    value.includes(o) ? value.filter(x => x !== o) : [...value, o]
  )
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', paddingTop: 4 }}>
      {options.map(o => (
        <CheckRow key={o} label={o} checked={value.includes(o)} onChange={() => toggle(o)} />
      ))}
    </div>
  )
}

/**
 * A branch row inside the assignment panel, indented to its depth.
 *
 * Real margin rather than the non-breaking-space trick branchOptionLabel needs:
 * these are checkbox labels in normal flow, not <option> text, so CSS works
 * here and the guide character stays a separate muted element instead of being
 * baked into the name.
 */
function branchTreeLabel(branch) {
  const depth = branch.depth ?? 0
  if (!depth) return branch.name
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: depth * 14 }}>
      <span style={{ color: 'var(--c-text3)', marginRight: 5 }} aria-hidden="true">└</span>
      {branch.name}
    </span>
  )
}

// ── Assignment panel ───────────────────────────────────────────────────────
/**
 * "Assign all" plus one checkbox per item. The header box is tri-state: ticked
 * when everything is assigned, indeterminate when only some is — "some" and
 * "none" look identical on a plain checkbox, and that is exactly the state an
 * operator most needs to be able to tell apart at a glance.
 *
 * Generic over what is being assigned so vehicles and branches are the same
 * control rather than two copies that drift apart.
 */
function AssignPanel({
  title, allLabel, items, selected, onToggle, onToggleAll,
  companyChosen, noCompanyText, noItemsText, primary, secondary,
}) {
  const allRef = useRef(null)
  const all  = items.length > 0 && selected.length === items.length
  const some = selected.length > 0 && !all

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some
  }, [some])

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 8,
      }}>
        <span className="ft-label">{title}</span>
        {companyChosen && items.length > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--c-text3)' }}>
            {selected.length} of {items.length} assigned
          </span>
        )}
      </div>

      <div style={{
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        background: 'var(--c-input)',
        overflow: 'hidden',
      }}>
        {!companyChosen ? (
          <p style={{ margin: 0, padding: '18px 12px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)' }}>
            {noCompanyText}
          </p>
        ) : items.length === 0 ? (
          <p style={{ margin: 0, padding: '18px 12px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)' }}>
            {noItemsText}
          </p>
        ) : (
          <>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '9px 12px', cursor: 'pointer',
              borderBottom: '1px solid var(--c-border2)',
              background: 'var(--c-thead)',
              fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)',
            }}>
              <input
                ref={allRef}
                type="checkbox"
                checked={all}
                onChange={e => onToggleAll(e.target.checked)}
                style={CHECK}
              />
              {allLabel}
            </label>

            <div style={{
              maxHeight: 220, overflowY: 'auto',
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            }}>
              {items.map(item => {
                const on = selected.includes(item.id)
                const sub = secondary ? secondary(item) : ''
                return (
                  <label
                    key={item.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      padding: '9px 12px', cursor: 'pointer', minWidth: 0,
                      fontSize: 12.5,
                      color: on ? 'var(--c-text1)' : 'var(--c-text2)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggle(item.id)}
                      style={CHECK}
                    />
                    <span style={{ fontWeight: on ? 650 : 500, whiteSpace: 'nowrap' }}>
                      {primary(item)}
                    </span>
                    {sub && (
                      <span style={{
                        fontSize: 11, color: 'var(--c-text3)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {sub}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Tab 3: the Screen Access matrix ────────────────────────────────────────

const DRILL_COL = {
  borderRight: '1px solid var(--c-border)',
  minHeight: 240,
}

function DrillHeader({ children }) {
  return (
    <div style={{
      padding: '8px 11px',
      background: 'var(--c-thead)',
      borderBottom: '1px solid var(--c-border)',
      fontSize: 11, fontWeight: 700, color: 'var(--c-text2)',
      textAlign: 'center',
    }}>
      {children}
    </div>
  )
}

function DrillRow({ label, badge, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '8px 11px',
        border: 'none',
        borderBottom: '1px solid var(--c-border2)',
        background: active ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'transparent',
        color: active ? 'var(--ft-accent)' : 'var(--c-text1)',
        fontSize: 12, fontWeight: active ? 750 : 600,
        textAlign: 'left', cursor: 'pointer',
      }}
    >
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {badge != null && (
        <span style={{
          flexShrink: 0, fontSize: 10, fontWeight: 700,
          padding: '1px 6px', borderRadius: 999,
          background: 'var(--c-border2)', color: 'var(--c-text3)',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
}

/**
 * Project > Module > Sub Module > Screen, the reference's four-column
 * drill-down, with a permission radio per screen per level.
 *
 * The reference's `Apply From Group` template dropdown above the grid is not
 * built: FleetmaX has no permission-template store, and a dropdown that can
 * only ever be empty is dead UI. Flagged in the handover instead.
 */
function ScreenAccess({ permissions, onSet }) {
  const [moduleId, setModuleId] = useState(ACCESS_TREE.modules[0].id)
  const module = ACCESS_TREE.modules.find(m => m.id === moduleId) ?? ACCESS_TREE.modules[0]

  const [subId, setSubId] = useState(module.subModules[0].id)
  const sub = module.subModules.find(s => s.id === subId) ?? module.subModules[0]

  const pickModule = id => {
    setModuleId(id)
    // The old sub-module belongs to the old module, so it cannot stay selected.
    const next = ACCESS_TREE.modules.find(m => m.id === id)
    setSubId(next.subModules[0].id)
  }

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <div style={{
          minWidth: 840,
          display: 'grid',
          gridTemplateColumns: '150px 160px 150px minmax(380px, 1fr)',
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--c-input)',
        }}>
          {/* Project — one app, so this column is a label rather than a list. */}
          <div style={DRILL_COL}>
            <DrillHeader>Project</DrillHeader>
            <DrillRow label={ACCESS_TREE.label} active onClick={() => {}} />
          </div>

          <div style={DRILL_COL}>
            <DrillHeader>Module</DrillHeader>
            {ACCESS_TREE.modules.map(m => (
              <DrillRow
                key={m.id}
                label={m.label}
                badge={grantedCount(permissions, m.id)}
                active={m.id === moduleId}
                onClick={() => pickModule(m.id)}
              />
            ))}
          </div>

          <div style={DRILL_COL}>
            <DrillHeader>Sub Module</DrillHeader>
            {module.subModules.map(s => (
              <DrillRow
                key={s.id}
                label={s.label}
                active={s.id === sub.id}
                onClick={() => setSubId(s.id)}
              />
            ))}
          </div>

          <div style={{ minHeight: 240 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `minmax(180px, 1.6fr) repeat(${PERMISSION_LEVELS.length}, minmax(62px, 1fr))`,
              background: 'var(--c-thead)',
              borderBottom: '1px solid var(--c-border)',
              fontSize: 10.5, fontWeight: 700, color: 'var(--c-text2)',
            }}>
              <div style={{ padding: '8px 11px' }}>Name</div>
              {PERMISSION_LEVELS.map(p => (
                <div key={p.value} style={{ padding: '8px 4px', textAlign: 'center' }}>{p.label}</div>
              ))}
            </div>

            {sub.screens.map(screen => {
              const level = permissionFor(permissions, screen.id)
              return (
                <div
                  key={screen.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `minmax(180px, 1.6fr) repeat(${PERMISSION_LEVELS.length}, minmax(62px, 1fr))`,
                    borderBottom: '1px solid var(--c-border2)',
                    alignItems: 'center',
                  }}
                >
                  <div style={{
                    padding: '9px 11px', fontSize: 12, fontWeight: 600, color: 'var(--c-text1)',
                    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {screen.label}
                  </div>
                  {PERMISSION_LEVELS.map(p => (
                    <label
                      key={p.value}
                      title={`${screen.label} — ${p.label}`}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '9px 4px', cursor: 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        name={`perm-${screen.id}`}
                        checked={level === p.value}
                        onChange={() => onSet(screen.id, p.value)}
                        style={RADIO}
                      />
                      <span style={{
                        position: 'absolute', width: 1, height: 1,
                        overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
                      }}>
                        {p.label}
                      </span>
                    </label>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <p style={{ ...NOTE, marginTop: 10 }}>
        Permission levels follow the reference: No Access, View, Modify, Add/Delete,
        Customize. The badge on each module counts its screens above No Access.
        Nothing enforces these yet — they are stored on the sub-user, ready for
        whatever reads them.
      </p>
    </>
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

  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)
  const [tab,     setTab]     = useState(TABS[0].id)

  // Confirmation inputs, held outside the draft so they can never be saved.
  // A stored second copy of a credential is how the two drift apart.
  const [confirm, setConfirm] = useState({ username: '', password: '' })

  const firstRef = useRef(null)
  const formRef  = useRef(null)
  const ssoSeq   = useRef(0)

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

  /** Patch one key inside the nested userSetting bag. */
  const setSetting = (key, value) => setDraft(d => ({
    ...d, userSetting: { ...d.userSetting, [key]: value },
  }))

  const setConfirmField = (key, value) => {
    setConfirm(c => ({ ...c, [key]: value }))
    const errKey = key === 'username' ? 'confirmEmail' : 'retypePassword'
    setErrors(e => (e[errKey] ? { ...e, [errKey]: null } : e))
  }

  const vehicles = editing ? vehiclesForCompany(draft.companyId) : []
  // Tree order with a depth per row. It is the same SET branchesForCompany
  // returns, so "All Branches" still means every branch of this BG at every
  // depth — only the order and the indentation come from the tree read.
  const branches = editing ? branchTreeForCompany(draft.companyId) : []

  const toggleIn = (key, id) => setDraft(d => ({
    ...d,
    [key]: d[key].includes(id) ? d[key].filter(x => x !== id) : [...d[key], id],
  }))

  const toggleAllIn = (key, on, all) => setDraft(d => ({
    ...d,
    [key]: on ? all.map(x => x.id) : [],
  }))

  const submit = e => {
    e.preventDefault()

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

    const clean = {
      ...draft,
      name:                  draft.name.trim(),
      email:                 draft.email.trim(),
      mobileNumber:          draft.mobileNumber.trim(),
      passwordRecoveryEmail: draft.passwordRecoveryEmail.trim(),
      ssoProviders: draft.ssoProviders
        .map(p => ({ ...p, provider: p.provider.trim() }))
        .filter(p => p.provider),
    }
    if (draft.id) {
      updateSubuser(draft.id, clean)
      push(`${clean.name} updated`, { tone: 'success' })
    } else {
      addSubuser(clean)
      push(`${clean.name} added`, { tone: 'success' })
    }
    setDraft(null)
  }

  const confirmDelete = () => {
    removeSubuser(pending.id)
    push(`${pending.name} deleted`, { tone: 'success' })
    setPending(null)
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
  const invalidTabs = [...new Set(Object.keys(errors).filter(k => errors[k]).map(k => ERROR_TAB[k]))]
    .filter(Boolean)

  const deleteAuthOn = draft?.authRequiredFor.includes('Delete Action')

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Company Subuser Detail' : 'New sub-user'}
            subtitle="Fields marked with * are required. The username is the email address."
          >
            <FormTabs tabs={TABS} active={tab} onChange={setTab} invalidIds={invalidTabs} />

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

            {/* ── Tab 2: Data Access ── */}
            {tab === 'data' && (
              <>
                <Field label="Selection">
                  <RadioGroup
                    name="selectionMode"
                    options={['Object', 'Object Group']}
                    value={draft.selectionMode === 'objectGroup' ? 'Object Group' : 'Object'}
                    onChange={v => set('selectionMode', v === 'Object Group' ? 'objectGroup' : 'object')}
                    // Object Group is an entity FleetmaX does not have yet; the
                    // choice is shown because the reference shows it, but there
                    // is nothing behind it to assign.
                    disabledValues={['Object Group']}
                    titleFor={o => (o === 'Object Group' ? 'Object Groups do not exist in FleetmaX yet' : undefined)}
                  />
                </Field>

                <p style={{ ...NOTE, marginTop: 8 }}>
                  Object Group is in the reference but has no entity in FleetmaX, so
                  assignment is by Object (vehicle) and Branch. Both scopes are
                  independent: a branch grants access to the branch, not to the
                  vehicles filed under it.
                </p>

                <AssignPanel
                  title="Object (Vehicle) Assignment"
                  allLabel="Assign All"
                  items={vehicles}
                  selected={draft.vehicleIds}
                  onToggle={id => toggleIn('vehicleIds', id)}
                  onToggleAll={on => toggleAllIn('vehicleIds', on, vehicles)}
                  companyChosen={!!draft.companyId}
                  noCompanyText="Select a Business Group on My Account to see its vehicles."
                  noItemsText="No vehicles registered for this BG."
                  primary={vehicleLabel}
                  secondary={vehicleSubLabel}
                />

                <AssignPanel
                  title="Branch Assignment"
                  allLabel="All Branches"
                  items={branches}
                  selected={draft.branchIds}
                  onToggle={id => toggleIn('branchIds', id)}
                  onToggleAll={on => toggleAllIn('branchIds', on, branches)}
                  companyChosen={!!draft.companyId}
                  noCompanyText="Select a Business Group on My Account to see its branches."
                  noItemsText="No branches registered for this BG."
                  // Ticking a parent deliberately does NOT tick its children: a
                  // sub-branch is a separate scope, and cascading here would hand
                  // out access nobody asked for the moment a child is added later.
                  primary={branchTreeLabel}
                />
              </>
            )}

            {/* ── Tab 3: Screen Access ── */}
            {tab === 'screen' && (
              <ScreenAccess
                permissions={draft.permissions}
                onSet={(screenId, level) => set('permissions', { ...draft.permissions, [screenId]: level })}
              />
            )}

            {/* ── Tab 4: User Setting ── */}
            {tab === 'setting' && (
              <div style={GRID}>
                {USER_SETTING_FIELDS.map(f => {
                  const value = draft.userSetting[f.key]
                  return (
                    <Field key={f.key} label={f.label}>
                      {f.type === 'select' ? (
                        <select
                          name={f.key}
                          value={value ?? ''}
                          onChange={e => setSetting(f.key, e.target.value)}
                          style={inputStyle(false)}
                        >
                          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'radio' ? (
                        <RadioGroup
                          name={f.key}
                          options={f.options}
                          value={value}
                          onChange={v => setSetting(f.key, v)}
                        />
                      ) : f.type === 'checks' ? (
                        <ChecksGroup
                          options={f.options}
                          value={Array.isArray(value) ? value : []}
                          onChange={v => setSetting(f.key, v)}
                        />
                      ) : (
                        <div style={{ paddingTop: 6 }}>
                          <CheckRow
                            label={value ? 'Enabled' : 'Disabled'}
                            checked={!!value}
                            onChange={v => setSetting(f.key, v)}
                          />
                        </div>
                      )}
                    </Field>
                  )
                })}
              </div>
            )}

            {/* ── Tab 5: Authentication ── */}
            {tab === 'auth' && (
              <>
                <Field label="Authentication Required For">
                  <ChecksGroup
                    options={AUTH_REQUIRED_OPTIONS}
                    value={draft.authRequiredFor}
                    onChange={v => set('authRequiredFor', v)}
                  />
                </Field>

                {/* The reference's companion field. Revealed rather than
                    permanently greyed: it only means anything once Delete
                    Action is one of the steps being protected. */}
                {deleteAuthOn && (
                  <div style={{ marginTop: 18 }}>
                    <Field label="Delete Authentication Required For">
                      <ChecksGroup
                        options={DELETE_AUTH_OPTIONS}
                        value={draft.deleteAuthFor}
                        onChange={v => set('deleteAuthFor', v)}
                      />
                    </Field>
                  </div>
                )}

                <p style={{ ...NOTE, marginTop: 14 }}>
                  {deleteAuthOn
                    ? 'Pick which records need a second authentication step before they can be deleted.'
                    : 'Tick Delete Action to choose which records need a second authentication step before deletion.'}
                </p>
              </>
            )}

            {/* ── Tab 6: SSO ── */}
            {tab === 'sso' && (
              <>
                <div style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    style={SECONDARY_BTN}
                    onClick={() => set('ssoProviders', [
                      ...draft.ssoProviders,
                      { id: `sso-${++ssoSeq.current}-${draft.ssoProviders.length}`, provider: '' },
                    ])}
                  >
                    <Plus size={13} strokeWidth={2.6} />
                    Add
                  </button>
                </div>

                <div style={{
                  border: '1px solid var(--c-border)', borderRadius: 8,
                  background: 'var(--c-input)', overflow: 'hidden',
                }}>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 90px',
                    background: 'var(--c-thead)',
                    borderBottom: '1px solid var(--c-border)',
                    fontSize: 11, fontWeight: 700, color: 'var(--c-text2)',
                  }}>
                    <div style={{ padding: '8px 11px' }}>Provider</div>
                    <div style={{ padding: '8px 11px', textAlign: 'center' }}>Edit</div>
                  </div>

                  {draft.ssoProviders.length === 0 ? (
                    <p style={{ margin: 0, padding: '18px 12px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)' }}>
                      No SSO providers configured.
                    </p>
                  ) : draft.ssoProviders.map((p, i) => (
                    <div
                      key={p.id}
                      style={{
                        display: 'grid', gridTemplateColumns: '1fr 90px',
                        alignItems: 'center', gap: 8,
                        padding: '8px 11px',
                        borderBottom: '1px solid var(--c-border2)',
                      }}
                    >
                      <input
                        value={p.provider}
                        onChange={e => set('ssoProviders', draft.ssoProviders.map(
                          (x, xi) => (xi === i ? { ...x, provider: e.target.value } : x)
                        ))}
                        placeholder="Provider name"
                        style={inputStyle(false)}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${p.provider || 'provider'}`}
                        onClick={() => set('ssoProviders', draft.ssoProviders.filter((_, xi) => xi !== i))}
                        style={{
                          justifySelf: 'center',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 28, height: 28, borderRadius: 7,
                          border: '1px solid var(--c-border2)', background: 'var(--c-card)',
                          color: 'var(--c-text3)', cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                <p style={{ ...NOTE, marginTop: 10 }}>
                  The reference shows this tab as an empty Provider/Edit grid with an
                  Add button and nothing configured, so the provider name is all there
                  is to go on. Rows are edited in place rather than through a sub-form
                  the reference never revealed.
                </p>
              </>
            )}

            <FormActions
              onBack={closeForm}
              onReset={resetForm}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <TableToolbar count={subusers.length} noun="sub-user" plural="sub-users">
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
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={subusers}
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel={noCompanies
              ? 'No BGs on file — add a Business Group before creating sub-users.'
              : 'No sub-users yet — use Add Subuser to create one.'}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete sub-user?"
          body={`${pending.name} will lose access to ${companyNameFor(pending.companyId)}.`}
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
