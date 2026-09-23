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
  useResellers, addReseller, updateReseller, removeReseller, emptyReseller,
} from './mockData'

// Top of the org hierarchy below Super Admin: a GGB owns groups, which own
// BGs. Stored as `reseller` rows — see the vocabulary note in mockData.js.

const COLUMNS = [
  { key: 'name',  label: 'GGB Name', bold: true },
  { key: 'email', label: 'Email' },
]

const FIELDS = [
  { name: 'name',  label: 'GGB Name', required: true, placeholder: 'FleetmaX Solutions' },
  { name: 'email', label: 'Email',         type: 'email',  placeholder: 'partners@fleetmax.ae' },
]

export default function Reseller(props) {
  const resellers = useResellers()
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

  const openAdd   = ()  => { setErrors({}); setDraft(emptyReseller()) }
  const openEdit  = row => { setErrors({}); setDraft({ ...row }) }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => ({ ...d, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const submit = e => {
    e.preventDefault()

    const next = {}
    if (!draft.name.trim()) next.name = 'GGB Name is required'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, name: draft.name.trim(), email: draft.email.trim() }
    if (draft.id) {
      updateReseller(draft.id, clean)
      push(`${clean.name} updated`, { tone: 'success' })
    } else {
      addReseller(clean)
      push(`${clean.name} added`, { tone: 'success' })
    }
    setDraft(null)
  }

  const confirmDelete = () => {
    removeReseller(pending.id)
    push(`${pending.name} deleted`, { tone: 'success' })
    setPending(null)
  }

  const title = !editing ? 'GGB (Group Global Admin)' : draft.id ? 'Edit GGB' : 'Add GGB'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'GGB details' : 'New GGB'}
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
                const saved = draft.id ? resellers.find(r => r.id === draft.id) : null
                setDraft(saved ? { ...saved } : emptyReseller())
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <TableToolbar count={resellers.length} noun="GGB" plural="GGBs">
            <button type="button" style={PRIMARY_BTN} onClick={openAdd}>
              <Plus size={14} strokeWidth={2.6} />
              Add GGB
            </button>
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={resellers}
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel="No GGBs yet — use Add GGB to create one."
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete GGB?"
          body={`${pending.name} will be removed from the list.`}
          note="Groups and BGs under this GGB are left in place. This is mock data — nothing is sent to a server."
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
