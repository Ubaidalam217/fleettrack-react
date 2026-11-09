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
import OrgTabs from './OrgTabs'
import NodeUsersPanel, { UsersButton, useNodeUserCount, PermissionsButton, NodePermissionsDialog, useCanSetPermissions, NewNodeUsers, emptyNewUser, validateNewUsers, createNodeUsers, useMayAddNodeUsers } from './NodeUsersPanel'
import { useSession } from '../../data/session'
import { sessionLevel as usersLevel } from '../../data/screens'

// Top of the org hierarchy below Super Admin: a GGB owns groups, which own
// BGs. Stored as `reseller` rows — see the vocabulary note in mockData.js.

const COLUMNS = [
  { key: 'name',  label: 'Group Global Admin Name', bold: true },
  { key: 'email', label: 'Email' },
]

const FIELDS = [
  { name: 'name',  label: 'Group Global Admin Name', required: true, placeholder: 'FleetmaX Solutions' },
  { name: 'email', label: 'Email',         type: 'email',  placeholder: 'partners@fleetmax.ae' },
]

export default function Reseller(props) {
  const resellers = useResellers()
  const { toasts, push, dismiss } = useToasts()
  const access = usePageAccess('reseller')
  const mayAddUsers = useMayAddNodeUsers('ggb', access.roleKey)
  // Client, 2026-11-02: each row manages its own login accounts.
  const session = useSession()
  const countUsers = useNodeUserCount('ggb')
  const [usersOf, setUsersOf] = useState(null)
  const [permsFor, setPermsFor] = useState(null)
  const mayPerms = useCanSetPermissions()
  const showUsers = access.roleKey !== 'SUB_USER' && usersLevel(session.user, 'users') !== 'none'

  const [draft,   setDraft]   = useState(null)

  // The logins created with a new GGB (client: at least one main user).

  const [newUsers, setNewUsers] = useState([emptyNewUser()])
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

  const openAdd   = ()  => { setNewUsers([emptyNewUser()]); setErrors({}); setDraft(emptyReseller()) }
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
    if (!draft.name.trim()) next.name = 'Group Global Admin Name is required'
    if (!draft.id && mayAddUsers) Object.assign(next, validateNewUsers(newUsers))
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
        const row = await addReseller(clean)
        const { created, failed } = mayAddUsers ? await createNodeUsers('ggb', row.id, newUsers) : { created: [], failed: [] }
        if (failed.length) {
          push(`${clean.name} added, but ${failed.map(x => x.email).join(', ')} could not be created (${failed[0].message}). Add it from Users.`, { tone: 'error' })
        } else {
          push(`${clean.name} added${created.length ? ` with ${created.length} user${created.length > 1 ? 's' : ''}` : ''}`, { tone: 'success' })
        }
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

  const title = !editing ? 'Group Global Admin' : draft.id ? 'Edit Group Global Admin' : 'Add Group Global Admin'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Group Global Admin details' : 'New Group Global Admin'}
            subtitle="Fields marked with * are required."
          >
            <FormFields
              fields={FIELDS}
              values={draft}
              errors={errors}
              onChange={set}
              firstRef={firstRef}
            />
            {!draft.id && (
              <NewNodeUsers
                kind="ggb"
                users={newUsers}
                setUsers={setNewUsers}
                errors={errors}
                mayAdd={mayAddUsers}
                onEdit={() => setErrors(e => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('users.'))))}
              />
            )}
            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                if (!draft.id) setNewUsers([emptyNewUser()])
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
          <OrgTabs />
          <PageNotice {...access} />

          {!access.loading && (
            <>
              <TableToolbar count={resellers.length} noun="Group Global Admin" plural="Group Global Admins">
                {access.canAdd && (
                  <button type="button" style={PRIMARY_BTN} onClick={openAdd}>
                    <Plus size={14} strokeWidth={2.6} />
                    Add Group Global Admin
                  </button>
                )}
              </TableToolbar>

              <SettingsTable
                columns={showUsers ? [...COLUMNS, {
                  key: '__users', label: 'Manage',
                  render: row => (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <UsersButton count={countUsers(row)} onClick={() => setUsersOf(row)} />
                      {mayPerms && <PermissionsButton onClick={() => setPermsFor(row)} />}
                    </div>
                  ),
                }] : COLUMNS}
                rows={resellers}
                onEdit={openEdit}
                onDelete={access.canDelete ? setPending : null}
                canWrite={access.canWrite}
                emptyLabel={
                  access.canWrite
                    ? 'No Group Global Admins yet — use Add Group Global Admin to create one.'
                    : 'No Group Global Admins to show.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete Group Global Admin?"
          body={`${pending.name} will be removed from the list.`}
          note={modeNote(
            'Every group, Business Group, branch, vehicle, account and alert under this Group Global Admin is deleted with it. This cannot be undone.',
            'Groups and Business Groups under this Group Global Admin are left in place. This is mock data — nothing is sent to a server.'
          )}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      {permsFor && (
        <NodePermissionsDialog
          kind="ggb"
          node={permsFor}
          roleKey={access.roleKey}
          push={push}
          onOpenUsers={() => { setUsersOf(permsFor); setPermsFor(null) }}
          onClose={() => setPermsFor(null)}
        />
      )}

      {usersOf && (
        <NodeUsersPanel
          kind="ggb"
          node={usersOf}
          bgId={usersOf.companyId}
          roleKey={access.roleKey}
          push={push}
          onClose={() => setUsersOf(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
