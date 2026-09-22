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
  useCompanies, addCompany, updateCompany, removeCompany, emptyCompany, RESELLERS,
} from './mockData'

// List and form live on one route. Settings' routing is Phase 1 work and the
// menu highlights a single leaf per page, so opening the form as a second URL
// would light up nothing in the sidebar; the page swaps its own body instead.

const COLUMNS = [
  { key: 'name',     label: 'Company Name', bold: true },
  { key: 'email',    label: 'Email' },
  { key: 'reseller', label: 'Reseller' },
]

const FIELDS = [
  { name: 'reseller', label: 'Reseller',     type: 'select', options: RESELLERS },
  { name: 'name',     label: 'Company Name', required: true, placeholder: 'Al Habtoor Logistics' },
  { name: 'email',    label: 'Email',        required: true, type: 'email', placeholder: 'name@company.ae' },
]

export default function Company(props) {
  const companies = useCompanies()
  const { toasts, push, dismiss } = useToasts()

  // null = list view. Otherwise the record being edited, with id null for a new
  // one — which is also what tells Save whether to add or update.
  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)   // row queued for deletion
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
    setDraft(d => ({ ...d, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const submit = e => {
    e.preventDefault()

    const next = {}
    if (!draft.name.trim())  next.name  = 'Company Name is required'
    if (!draft.email.trim()) next.email = 'Email is required'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, name: draft.name.trim(), email: draft.email.trim() }
    if (draft.id) {
      updateCompany(draft.id, clean)
      push(`${clean.name} updated`, { tone: 'success' })
    } else {
      addCompany(clean)
      push(`${clean.name} added`, { tone: 'success' })
    }
    setDraft(null)
  }

  const confirmDelete = () => {
    removeCompany(pending.id)
    push(`${pending.name} deleted`, { tone: 'success' })
    setPending(null)
  }

  const title = !editing ? 'Company' : draft.id ? 'Edit Company' : 'Add Company'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Company details' : 'New company'}
            subtitle="Fields marked with * are required."
          >
            <FormFields
              fields={FIELDS}
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
            />
          </FormCard>
        </form>
      ) : (
        <>
          <TableToolbar count={companies.length} noun="company" plural="companies">
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
              Add Company
            </button>
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={companies}
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel="No companies yet — use Add Company to create one."
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete company?"
          body={`${pending.name} will be removed from the list.`}
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
