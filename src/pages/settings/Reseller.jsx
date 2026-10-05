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
} from '../../data/settings'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'

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
  const access = usePageAccess('reseller')

  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)
  // Guards against a double submit while the request is in flight — in real mode
  // the Save button is no longer instant, and two clicks would create two GGBs.
  const [saving,  setSaving]  = useState(false)
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

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!draft.name.trim()) next.name = 'GGB Name is required'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, name: draft.name.trim(), email: draft.email.trim() }
    setSaving(true)
    try {
      if (draft.id) {
        await updateReseller(draft.id, clean)
        push(`${clean.name} updated`, { tone: 'success' })
      } else {
        await addReseller(clean)
        push(`${clean.name} added`, { tone: 'success' })
      }
      // Only on success. Closing the form first would throw away what the user
      // typed the moment the server rejected it.
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
      await removeReseller(row.id)
      push(`${row.name} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
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
              saving={saving}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <PageNotice {...access} />

          {!access.loading && (
            <>
              <TableToolbar count={resellers.length} noun="GGB" plural="GGBs">
                {access.canWrite && (
                  <button type="button" style={PRIMARY_BTN} onClick={openAdd}>
                    <Plus size={14} strokeWidth={2.6} />
                    Add GGB
                  </button>
                )}
              </TableToolbar>

              <SettingsTable
                columns={COLUMNS}
                rows={resellers}
                onEdit={openEdit}
                onDelete={setPending}
                canWrite={access.canWrite}
                emptyLabel={
                  access.canWrite
                    ? 'No GGBs yet — use Add GGB to create one.'
                    : 'No GGBs to show.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete GGB?"
          body={`${pending.name} will be removed from the list.`}
          note={modeNote(
            'Every group, BG, branch, vehicle, account and alert under this GGB is deleted with it. This cannot be undone.',
            'Groups and BGs under this GGB are left in place. This is mock data — nothing is sent to a server.'
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
