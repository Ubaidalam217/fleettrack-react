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
import NodeLogoField from './NodeLogoField'
import { uploadStagedLogo } from './nodeLogo'
import OrgTabs from './OrgTabs'
import NodeUsersPanel, { UsersButton, useNodeUserCount, PermissionsButton, NodePermissionsDialog, useCanSetPermissions, NewNodeUsers, emptyNewUser, validateNewUsers, createNodeUsers, useMayAddNodeUsers } from './NodeUsersPanel'
import NodeVehiclesPanel, { VehiclesButton, useNodeVehicleCount } from './NodeVehiclesPanel'
import { useSession } from '../../data/session'
import { sessionLevel as usersLevel } from '../../data/screens'
import MoveDialog, { MoveButton, canMove } from './MoveDialog'
import { IS_REAL } from '../../data/mode'

// A group sits between a GGB and its BGs. A BG may skip it — one with no
// group acts as its own group.

const COLUMNS = [
  { key: 'name',     label: 'Group Name', bold: true },
  { key: 'reseller', label: 'Group Global Admin', render: row => resellerNameFor(row.resellerId) },
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
      name: 'resellerId', label: 'Group Global Admin', required: true, type: 'select',
      options: resellers.map(r => ({ value: r.id, label: r.name })),
      disabled: lockParent,
      hint: lockParent ? 'A group cannot be moved to another Group Global Admin.' : undefined,
    },
    { name: 'name', label: 'Group Name', required: true, placeholder: 'Abu Dhabi Operations' },
  ]
}

export default function Group(props) {
  const groups    = useGroups()
  const resellers = useResellers()
  const { toasts, push, dismiss } = useToasts()
  const access = usePageAccess('group')
  const mayAddUsers = useMayAddNodeUsers('group', access.roleKey)
  // Client, 2026-11-02: each row manages its own login accounts.
  const session = useSession()
  const countUsers = useNodeUserCount('group')
  const [usersOf, setUsersOf] = useState(null)
  // Client, 2026-11-10: "add vehicles from BG, Group, GGB or Branch itself".
  const countVehicles = useNodeVehicleCount('group')
  const [vehiclesOf, setVehiclesOf] = useState(null)
  const [permsFor, setPermsFor] = useState(null)
  const mayPerms = useCanSetPermissions()
  // …and can be moved, with everything under it, to another parent.
  const [moving, setMoving] = useState(null)
  const mayMove = canMove(access.roleKey, 'group') && access.canWrite
  const showUsers = access.roleKey !== 'SUB_USER' && usersLevel(session.user, 'users') !== 'none'

  const [draft,   setDraft]   = useState(null)
  // A new node's logo, uploaded once the save has given it an id.
  const [stagedLogo, setStagedLogo] = useState(null)

  // The logins created with a new GROUP (client: at least one main user).

  const [newUsers, setNewUsers] = useState([emptyNewUser()])
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)
  const [saving,  setSaving]  = useState(false)
  const firstRef = useRef(null)
  const formRef  = useRef(null)

  const editing = draft !== null

  useEffect(() => {
    if (editing) firstRef.current?.focus()
  }, [editing])

  const openAdd   = ()  => { setNewUsers([emptyNewUser()]); setErrors({}); setStagedLogo(null); setDraft(emptyGroup()) }
  const openEdit  = row => { setErrors({}); setStagedLogo(null); setDraft({ ...row }) }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => ({ ...d, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!draft.resellerId)  next.resellerId = 'Group Global Admin is required'
    if (!draft.name.trim()) next.name       = 'Group Name is required'
    if (!draft.id && mayAddUsers) Object.assign(next, validateNewUsers(newUsers))
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
        const row = await addGroup(clean)
        await uploadStagedLogo('group', row.id, stagedLogo, push)
        const { created, failed } = mayAddUsers ? await createNodeUsers('group', row.id, newUsers) : { created: [], failed: [] }
        if (failed.length) {
          push(`${clean.name} added, but ${failed.map(x => x.email).join(', ')} could not be created (${failed[0].message}). Add it from Users.`, { tone: 'error' })
        } else {
          push(`${clean.name} added${created.length ? ` with ${created.length} user${created.length > 1 ? 's' : ''}` : ''}`, { tone: 'success' })
        }
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
            <NodeLogoField kind="group" noun="Group" draft={draft} setDraft={setDraft} onStage={setStagedLogo} push={push} />
            <FormFields
              fields={fieldsFor(resellers, !!draft.id)}
              values={draft}
              errors={errors}
              onChange={set}
              firstRef={firstRef}
            />
            {!draft.id && (
              <NewNodeUsers
                kind="group"
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
                setStagedLogo(null)
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
          <OrgTabs />
          <PageNotice {...access} />

          {!access.loading && (
            <>
              <TableToolbar count={groups.length} noun="group" plural="groups">
                {access.canAdd && (
                  <button
                    type="button"
                    style={{ ...PRIMARY_BTN, opacity: noResellers ? 0.5 : 1, cursor: noResellers ? 'not-allowed' : 'pointer' }}
                    disabled={noResellers}
                    // A group belongs to a GGB, so with none on file the form would
                    // open with an unsatisfiable required dropdown.
                    title={noResellers ? 'Add a Group Global Admin first' : undefined}
                    onClick={openAdd}
                  >
                    <Plus size={14} strokeWidth={2.6} />
                    Add Group
                  </button>
                )}
              </TableToolbar>

              <SettingsTable
                columns={showUsers ? [...COLUMNS, {
                  key: '__users', label: 'Manage',
                  render: row => (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <UsersButton count={countUsers(row)} onClick={() => setUsersOf(row)} />
                      <VehiclesButton count={countVehicles(row)} onClick={() => setVehiclesOf(row)} />
                      {mayPerms && <PermissionsButton onClick={() => setPermsFor(row)} />}
                      {mayMove && <MoveButton onClick={() => setMoving(row)} />}
                    </div>
                  ),
                }] : COLUMNS}
                rows={groups}
                onEdit={openEdit}
                onDelete={access.canDelete ? setPending : null}
                canWrite={access.canWrite}
                emptyLabel={
                  !access.canWrite
                    ? 'No groups to show.'
                    : noResellers
                      ? 'No Group Global Admins on file — add a Group Global Admin before creating groups.'
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
            'Business Groups in this group are kept and fall back to acting as their own group. Any Group Admin account scoped to this group is deleted.',
            'Business Groups in this group are left in place and fall back to acting as their own group. This is mock data — nothing is sent to a server.'
          )}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      {moving && (
        <MoveDialog kind="group" node={moving} push={push} onClose={() => setMoving(null)} />
      )}

      {permsFor && (
        <NodePermissionsDialog
          kind="group"
          node={permsFor}
          roleKey={access.roleKey}
          push={push}
          onOpenUsers={() => { setUsersOf(permsFor); setPermsFor(null) }}
          onClose={() => setPermsFor(null)}
        />
      )}

      {vehiclesOf && (
        <NodeVehiclesPanel kind="group" node={vehiclesOf} push={push} onClose={() => setVehiclesOf(null)} />
      )}

      {usersOf && (
        <NodeUsersPanel
          kind="group"
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
