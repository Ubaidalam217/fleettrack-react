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
  useGroups, useResellers, addGroup, updateGroup, removeGroup,
  resellerNameFor, emptyGroup,
} from './mockData'

// A group sits between a reseller and its companies. Companies may skip it —
// one with no group acts as its own group.

const COLUMNS = [
  { key: 'name',     label: 'Group Name', bold: true },
  { key: 'reseller', label: 'Reseller', render: row => resellerNameFor(row.resellerId) },
]

// Reseller options come from the live store, so a reseller added next door is
// selectable here without a reload.
function fieldsFor(resellers) {
  return [
    {
      name: 'resellerId', label: 'Reseller', required: true, type: 'select',
      options: resellers.map(r => ({ value: r.id, label: r.name })),
    },
    { name: 'name', label: 'Group Name', required: true, placeholder: 'Abu Dhabi Operations' },
  ]
}

export default function Group(props) {
  const groups    = useGroups()
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

  const openAdd   = ()  => { setErrors({}); setDraft(emptyGroup()) }
  const openEdit  = row => { setErrors({}); setDraft({ ...row }) }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => ({ ...d, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const submit = e => {
    e.preventDefault()

    const next = {}
    if (!draft.resellerId)  next.resellerId = 'Reseller is required'
    if (!draft.name.trim()) next.name       = 'Group Name is required'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, name: draft.name.trim() }
    if (draft.id) {
      updateGroup(draft.id, clean)
      push(`${clean.name} updated`, { tone: 'success' })
    } else {
      addGroup(clean)
      push(`${clean.name} added`, { tone: 'success' })
    }
    setDraft(null)
  }

  const confirmDelete = () => {
    removeGroup(pending.id)
    push(`${pending.name} deleted`, { tone: 'success' })
    setPending(null)
  }

  const noResellers = resellers.length === 0
  const title = !editing ? 'Group' : draft.id ? 'Edit Group' : 'Add Group'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Group details' : 'New group'}
            subtitle="Fields marked with * are required."
          >
            <FormFields
              fields={fieldsFor(resellers)}
              values={draft}
              errors={errors}
              onChange={set}
              firstRef={firstRef}
            />
            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                const saved = draft.id ? groups.find(g => g.id === draft.id) : null
                setDraft(saved ? { ...saved } : emptyGroup())
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <TableToolbar count={groups.length} noun="group" plural="groups">
            <button
              type="button"
              style={{ ...PRIMARY_BTN, opacity: noResellers ? 0.5 : 1, cursor: noResellers ? 'not-allowed' : 'pointer' }}
              disabled={noResellers}
              // A group belongs to a reseller, so with none on file the form
              // would open with an unsatisfiable required dropdown.
              title={noResellers ? 'Add a reseller first' : undefined}
              onClick={openAdd}
            >
              <Plus size={14} strokeWidth={2.6} />
              Add Group
            </button>
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={groups}
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel={noResellers
              ? 'No resellers on file — add a reseller before creating groups.'
              : 'No groups yet — use Add Group to create one.'}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete group?"
          body={`${pending.name} will be removed from ${resellerNameFor(pending.resellerId)}.`}
          note="Companies in this group are left in place and fall back to acting as their own group. This is mock data — nothing is sent to a server."
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
