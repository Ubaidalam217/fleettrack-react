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
} from '../../data/settings'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'
import { IS_REAL } from '../../data/mode'

// A group sits between a GGB and its BGs. A BG may skip it — one with no
// group acts as its own group.

const COLUMNS = [
  { key: 'name',     label: 'Group Name', bold: true },
  { key: 'reseller', label: 'GGB', render: row => resellerNameFor(row.resellerId) },
]

// GGB options come from the live store, so a GGB added next door is selectable
// here without a reload.
//
// `editing` locks the GGB on an existing group: the API accepts a group's GGB only
// at creation time, because changing it would move every BG, branch, vehicle and
// account beneath the group into a different tenant in one request.
function fieldsFor(resellers, editing) {
  const lockParent = IS_REAL && editing
  return [
    {
      name: 'resellerId', label: 'GGB', required: true, type: 'select',
      options: resellers.map(r => ({ value: r.id, label: r.name })),
      disabled: lockParent,
      hint: lockParent ? 'A group cannot be moved to another GGB.' : undefined,
    },
    { name: 'name', label: 'Group Name', required: true, placeholder: 'Abu Dhabi Operations' },
  ]
}

export default function Group(props) {
  const groups    = useGroups()
  const resellers = useResellers()
  const { toasts, push, dismiss } = useToasts()
  const access = usePageAccess('group')

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

  const openAdd   = ()  => { setErrors({}); setDraft(emptyGroup()) }
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
    if (!draft.resellerId)  next.resellerId = 'GGB is required'
    if (!draft.name.trim()) next.name       = 'Group Name is required'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, name: draft.name.trim() }
    setSaving(true)
    try {
      if (draft.id) {
        await updateGroup(draft.id, clean)
        push(`${clean.name} updated`, { tone: 'success' })
      } else {
        await addGroup(clean)
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
      await removeGroup(row.id)
      push(`${row.name} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
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
              fields={fieldsFor(resellers, !!draft.id)}
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
              saving={saving}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <PageNotice {...access} />

          {!access.loading && (
            <>
              <TableToolbar count={groups.length} noun="group" plural="groups">
                {access.canWrite && (
                  <button
                    type="button"
                    style={{ ...PRIMARY_BTN, opacity: noResellers ? 0.5 : 1, cursor: noResellers ? 'not-allowed' : 'pointer' }}
                    disabled={noResellers}
                    // A group belongs to a GGB, so with none on file the form would
                    // open with an unsatisfiable required dropdown.
                    title={noResellers ? 'Add a GGB first' : undefined}
                    onClick={openAdd}
                  >
                    <Plus size={14} strokeWidth={2.6} />
                    Add Group
                  </button>
                )}
              </TableToolbar>

              <SettingsTable
                columns={COLUMNS}
                rows={groups}
                onEdit={openEdit}
                onDelete={setPending}
                canWrite={access.canWrite}
                emptyLabel={
                  !access.canWrite
                    ? 'No groups to show.'
                    : noResellers
                      ? 'No GGBs on file — add a GGB before creating groups.'
                      : 'No groups yet — use Add Group to create one.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete group?"
          body={`${pending.name} will be removed from ${resellerNameFor(pending.resellerId)}.`}
          note={modeNote(
            'BGs in this group are kept and fall back to acting as their own group. Any Group Admin account scoped to this group is deleted.',
            'BGs in this group are left in place and fall back to acting as their own group. This is mock data — nothing is sent to a server.'
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
