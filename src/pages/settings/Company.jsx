import { useState, useRef, useEffect } from 'react'
import { Plus, FileBadge } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { FormFields, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useCompanies, useResellers, useGroups,
  addCompany, updateCompany, removeCompany, emptyCompany,
  resellerNameFor, groupLabelForCompany, groupsForReseller, isCompanyEmailTaken,
} from '../../data/settings'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'
import { IS_REAL } from '../../data/mode'

// List and form live on one route. Settings' routing is Phase 1 work and the
// menu highlights a single leaf per page, so opening the form as a second URL
// would light up nothing in the sidebar; the page swaps its own body instead.

const COLUMNS = [
  { key: 'name',     label: 'BG Name', bold: true },
  { key: 'email',    label: 'Email' },
  { key: 'reseller', label: 'GGB', render: row => resellerNameFor(row.resellerId) },
  // A BG with no group is its own group — a real state, not missing data.
  { key: 'group',    label: 'Group', render: row => groupLabelForCompany(row) },
]

/**
 * GGB and Group options come from the live stores, so a GGB or group added on its
 * own page is selectable here without a reload. Group narrows to whichever GGB is
 * currently chosen.
 *
 * Two real-mode locks on the parent selectors, both matching what the API will
 * actually accept:
 *
 *  - editing: the API takes a BG's GGB only at creation time, since changing it
 *    would move every branch, vehicle and account under it into another tenant.
 *  - creating with no GGB visible: a Group Admin cannot see any GGB — the tier
 *    above its own node is not in its scope — so it has nothing to choose from.
 *    The server derives both the GGB and the group from who is asking, which is
 *    the only placement that keeps the new BG inside the creator's own scope. The
 *    two controls say so rather than sitting there empty and looking broken.
 */
function fieldsFor(resellers, { editing, derivedParent }) {
  const lockGgb = IS_REAL && (editing || derivedParent)
  return [
    {
      name: 'resellerId', label: 'GGB', type: 'select',
      options: resellers.map(r => ({ value: r.id, label: r.name })),
      disabled: lockGgb,
      hint: !IS_REAL ? undefined
        : editing ? 'A BG cannot be moved to another GGB.'
        : derivedParent ? 'Set automatically from your own scope.'
        : undefined,
    },
    {
      name: 'groupId', label: 'Group', type: 'select',
      options: v => groupsForReseller(v.resellerId).map(g => ({ value: g.id, label: g.name })),
      disabled: IS_REAL && derivedParent,
      hint: IS_REAL && derivedParent ? 'Set automatically from your own group.' : undefined,
    },
    { name: 'name',  label: 'BG Name', required: true, placeholder: 'Al Habtoor Logistics' },
    { name: 'email', label: 'Email',        required: true, type: 'email', placeholder: 'name@company.ae' },
  ]
}

export default function Company(props) {
  const companies = useCompanies()
  const resellers = useResellers()
  // Subscribed so the Group dropdown reacts to groups added on the Group page;
  // the per-reseller slice itself comes from groupsForReseller.
  useGroups()
  const { toasts, push, dismiss } = useToasts()
  const access = usePageAccess('company')

  // null = list view. Otherwise the record being edited, with id null for a new
  // one — which is also what tells Save whether to add or update.
  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)   // row queued for deletion
  const [saving,  setSaving]  = useState(false)
  const firstRef = useRef(null)
  const formRef  = useRef(null)

  const editing = draft !== null

  useEffect(() => {
    if (editing) firstRef.current?.focus()
  }, [editing])

  const openAdd   = ()  => { setErrors({}); setDraft(emptyCompany()) }
  const openEdit  = row => { setErrors({}); setDraft({ ...row }) }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      // A group belongs to exactly one GGB, so the old pick is not a valid
      // option under the new one.
      if (key === 'resellerId') next.groupId = ''
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!draft.name.trim())  next.name  = 'BG Name is required'
    if (!draft.email.trim()) next.email = 'Email is required'
    // The BG email is its login username, so it has to be unique. This local check
    // only sees the BGs in scope — the server's unique index is what catches a
    // clash with another tenant's BG, and lands in the same place via handleApiError.
    else if (isCompanyEmailTaken(draft.email, draft.id)) next.email = 'A Business Group with this email already exists.'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, name: draft.name.trim(), email: draft.email.trim() }
    setSaving(true)
    try {
      if (draft.id) {
        await updateCompany(draft.id, clean)
        push(`${clean.name} updated`, { tone: 'success' })
      } else {
        await addCompany(clean)
        push(`${clean.name} added`, { tone: 'success' })
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
      await removeCompany(row.id)
      push(`${row.name} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  // A creator who can see no GGB has its placement derived by the server — see
  // fieldsFor(). Only meaningful in real mode; mock mode always has the seeds.
  const derivedParent = IS_REAL && resellers.length === 0

  const title = !editing ? 'BG (Business Group)' : draft.id ? 'Edit BG' : 'Add BG'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Business Group details' : 'New Business Group'}
            subtitle="Fields marked with * are required. Leave Group blank if the BG is its own group."
          >
            <FormFields
              fields={fieldsFor(resellers, { editing: !!draft.id, derivedParent })}
              values={draft}
              errors={errors}
              onChange={set}
              firstRef={firstRef}
            />
            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                // Reset means "back to where this form opened": the saved row
                // for an edit, a blank record for a new one. The fallback
                // guards the row having vanished, which would otherwise spread
                // undefined into a shapeless draft and throw on the next save.
                const saved = draft.id ? companies.find(c => c.id === draft.id) : null
                setDraft(saved ? { ...saved } : emptyCompany())
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
              <TableToolbar count={companies.length} noun="BG" plural="BGs">
                {access.canWrite && (
                  <>
                    <button
                      type="button"
                      className="ft-btn"
                      onClick={() => push('Certificate import is not wired up yet — coming in a later phase.', { tone: 'info' })}
                    >
                      <FileBadge size={13} />
                      Import from Certificate
                    </button>
                    <button type="button" style={PRIMARY_BTN} onClick={openAdd}>
                      <Plus size={14} strokeWidth={2.6} />
                      Add BG
                    </button>
                  </>
                )}
              </TableToolbar>

              <SettingsTable
                columns={COLUMNS}
                rows={companies}
                onEdit={openEdit}
                onDelete={setPending}
                canWrite={access.canWrite}
                emptyLabel={
                  access.canWrite
                    ? 'No Business Groups yet — use Add BG to create one.'
                    : 'No Business Groups to show.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete Business Group?"
          body={`${pending.name} will be removed from the list.`}
          note={modeNote(
            'Every branch, vehicle, account and alert in this BG is deleted with it. This cannot be undone.',
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
