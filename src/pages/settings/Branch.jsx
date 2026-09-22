import { useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { FormFields, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useBranches, useCompanies, addBranch, updateBranch, removeBranch,
  companyNameFor, emptyBranch,
} from './mockData'

const COLUMNS = [
  { key: 'name',    label: 'Branch Name', bold: true },
  { key: 'company', label: 'Company', render: row => companyNameFor(row.companyId) },
]

// Company options come from the live company list, so a company added on the
// Company page is selectable here without a reload.
function fieldsFor(companies) {
  return [
    {
      name: 'companyId', label: 'Company', required: true, type: 'select',
      options: companies.map(c => ({ value: c.id, label: c.name })),
    },
    { name: 'name', label: 'Branch Name', required: true, placeholder: 'Mussafah Depot' },
  ]
}

export default function Branch(props) {
  const branches  = useBranches()
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

  const openAdd   = ()  => { setErrors({}); setDraft(emptyBranch()) }
  const openEdit  = row => { setErrors({}); setDraft({ ...row }) }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => ({ ...d, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const submit = e => {
    e.preventDefault()

    const next = {}
    if (!draft.companyId)   next.companyId = 'Company is required'
    if (!draft.name.trim()) next.name      = 'Branch Name is required'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, name: draft.name.trim() }
    if (draft.id) {
      updateBranch(draft.id, clean)
      push(`${clean.name} updated`, { tone: 'success' })
    } else {
      addBranch(clean)
      push(`${clean.name} added`, { tone: 'success' })
    }
    setDraft(null)
  }

  const confirmDelete = () => {
    removeBranch(pending.id)
    push(`${pending.name} deleted`, { tone: 'success' })
    setPending(null)
  }

  const noCompanies = companies.length === 0
  const title = !editing ? 'Branch' : draft.id ? 'Edit Branch' : 'Add Branch'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Branch details' : 'New branch'}
            subtitle="Fields marked with * are required."
          >
            <FormFields
              fields={fieldsFor(companies)}
              values={draft}
              errors={errors}
              onChange={set}
              firstRef={firstRef}
            />
            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                // Back to where the form opened; the fallback guards the row
                // having vanished rather than spreading undefined into a draft.
                const saved = draft.id ? branches.find(b => b.id === draft.id) : null
                setDraft(saved ? { ...saved } : emptyBranch())
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <TableToolbar count={branches.length} noun="branch" plural="branches">
            <button
              type="button"
              style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
              disabled={noCompanies}
              // A branch needs a company, so with none on file the form would
              // open with an unsatisfiable required dropdown.
              title={noCompanies ? 'Add a company first' : undefined}
              onClick={openAdd}
            >
              <Plus size={14} strokeWidth={2.6} />
              Add Branch
            </button>
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={branches}
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel={noCompanies
              ? 'No companies on file — add a company before creating branches.'
              : 'No branches yet — use Add Branch to create one.'}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete branch?"
          body={`${pending.name} will be removed from ${companyNameFor(pending.companyId)}.`}
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
