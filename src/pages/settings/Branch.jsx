import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { Field, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useBranches, useCompanies, useVehicles, addBranch, updateBranch, removeBranch,
  companyNameFor, emptyBranch,
  branchTreeForCompany, branchDescendantIds, branchOptionLabel,
} from './mockData'

/**
 * Branches, and sub-branches of those, to any depth.
 *
 * A branch carries `parentBranchId` ('' = top level) alongside the `companyId`
 * naming its BG. The page renders one tree per BG rather than a flat list,
 * because depth is the whole point of the screen and a flat list of names like
 * "Bay 2 — Night Shift" says nothing about what it sits under.
 *
 * Controls are hand-built from FormKit's Field plus formStyles' inputStyle —
 * the primitives FormFields composes internally, so they render identically —
 * because the Parent Branch dropdown depends on the chosen BG and has to
 * exclude the branch being edited along with everything beneath it.
 */

// One depth step in the table. Matches the 14px the assignment panel indents by
// so the same hierarchy reads at the same scale on both screens.
const INDENT_PX = 18

const COLUMNS = [
  {
    key: 'name',
    label: 'Branch Name',
    bold: true,
    render: row => (
      <span style={{ display: 'inline-flex', alignItems: 'center', paddingLeft: (row.depth ?? 0) * INDENT_PX }}>
        {row.depth > 0 && (
          <span style={{ color: 'var(--c-text3)', marginRight: 6, fontWeight: 400 }} aria-hidden="true">
            └
          </span>
        )}
        {row.name}
      </span>
    ),
  },
  { key: 'company', label: 'BG', render: row => companyNameFor(row.companyId) },
  {
    key: 'parent',
    label: 'Parent Branch',
    muted: true,
    // Named rather than implied by indentation alone: the guide shows *that*
    // a row is nested, this shows what it is nested under, which matters once
    // a tree is tall enough that the parent has scrolled out of view.
    render: row => row.parentName || '— (top level)',
  },
]

export default function Branch(props) {
  const branches  = useBranches()
  const companies = useCompanies()
  // Subscribed so the delete dialog's vehicle count reacts to the fleet
  // changing under it; the per-branch slice comes from the store read.
  const vehicles = useVehicles()
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

  /**
   * Table rows: every BG's branches in tree order, BGs in list order.
   *
   * Built per BG rather than sorting one flat array, because a child has to
   * follow its own parent — interleaving two BGs' trees would put a sub-branch
   * under a row it does not belong to and the indentation would lie.
   */
  const rows = useMemo(() => {
    const byId = new Map(branches.map(b => [b.id, b]))
    return companies.flatMap(c =>
      branchTreeForCompany(c.id).map(b => ({
        ...b,
        parentName: b.parentBranchId ? byId.get(b.parentBranchId)?.name || '—' : '',
      }))
    )
    // `branches` is the dependency that matters — branchTreeForCompany reads the
    // store directly, so the array identity changing is what signals a rebuild.
  }, [branches, companies])

  // Parent options: this BG's tree, minus the branch being edited and
  // everything under it. Without that exclusion a branch could be made its own
  // ancestor, which the tree walk would then have to survive rather than avoid.
  const parentOptions = useMemo(() => {
    // `branches` is read here rather than only listed as a dependency: the tree
    // helpers go to the store themselves, so without touching the array this
    // memo would look dependency-free and keep serving a stale option list
    // after a branch was added or deleted.
    if (!editing || !draft.companyId || branches.length === 0) return []
    const blocked = new Set(draft.id ? [draft.id, ...branchDescendantIds(draft.id)] : [])
    return branchTreeForCompany(draft.companyId).filter(b => !blocked.has(b.id))
  }, [editing, draft, branches])

  const openAdd   = ()  => { setErrors({}); setDraft(emptyBranch()) }
  const openEdit  = row => {
    setErrors({})
    // Strip the derived fields the table added; the form edits the record, not
    // the row that was rendered from it. Saving `depth`/`parentName` back would
    // persist a snapshot of the tree that goes stale the moment it moves.
    const { depth: _depth, parentName: _parentName, ...record } = row
    setDraft({ ...record, parentBranchId: record.parentBranchId ?? '' })
  }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      // A parent belongs to exactly one BG, so the old pick is not a valid
      // option under the new one.
      if (key === 'companyId') next.parentBranchId = ''
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const submit = e => {
    e.preventDefault()

    const next = {}
    if (!draft.companyId)   next.companyId = 'BG is required'
    if (!draft.name.trim()) next.name      = 'Branch Name is required'
    // Defensive: the dropdown already filters these out, but a stale draft can
    // outlive the parent it points at — the BG can be switched, or the parent
    // deleted on another tab, between opening the form and pressing Save.
    if (draft.parentBranchId && !parentOptions.some(b => b.id === draft.parentBranchId)) {
      next.parentBranchId = 'That parent branch is no longer available — pick another.'
    }
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

  // What a delete would actually take with it, computed while the dialog is
  // open so the confirm text can say it before anything is removed.
  const doomed = pending ? branchDescendantIds(pending.id) : []
  const doomedVehicles = pending
    ? vehicles.filter(v => v.branchId === pending.id || doomed.includes(v.branchId)).length
    : 0

  const confirmDelete = () => {
    const { subBranches, vehiclesDetached } = removeBranch(pending.id)
    const parts = [`${pending.name} deleted`]
    if (subBranches)      parts.push(`${subBranches} sub-branch${subBranches === 1 ? '' : 'es'} removed`)
    if (vehiclesDetached) parts.push(`${vehiclesDetached} vehicle${vehiclesDetached === 1 ? '' : 's'} left unassigned`)
    push(parts.join(' · '), { tone: 'success' })
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
            subtitle="Fields marked with * are required. Leave Parent Branch blank for a top-level branch."
          >
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: '14px 16px',
            }}>
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

              <Field label="Branch Name" required error={errors.name}>
                <input
                  name="name"
                  value={draft.name}
                  onChange={e => set('name', e.target.value)}
                  aria-invalid={!!errors.name || undefined}
                  placeholder="Mussafah Depot"
                  style={inputStyle(!!errors.name)}
                />
              </Field>

              <Field label="Parent Branch" error={errors.parentBranchId}>
                <select
                  name="parentBranchId"
                  value={draft.parentBranchId}
                  onChange={e => set('parentBranchId', e.target.value)}
                  disabled={!draft.companyId || parentOptions.length === 0}
                  aria-invalid={!!errors.parentBranchId || undefined}
                  style={{
                    ...inputStyle(!!errors.parentBranchId),
                    opacity: !draft.companyId || parentOptions.length === 0 ? 0.6 : 1,
                  }}
                >
                  <option value="">
                    {!draft.companyId
                      ? '— Select a BG first —'
                      : parentOptions.length === 0
                        ? '— No other branches in this BG —'
                        : '— None (top-level branch) —'}
                  </option>
                  {parentOptions.map(b => (
                    <option key={b.id} value={b.id}>{branchOptionLabel(b)}</option>
                  ))}
                </select>
                {draft.id && (
                  <span style={{ display: 'block', marginTop: 3, fontSize: 10.5, color: 'var(--c-text3)' }}>
                    This branch and its own sub-branches are not listed — a branch cannot sit under itself.
                  </span>
                )}
              </Field>
            </div>

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                // Back to where the form opened; the fallback guards the row
                // having vanished rather than spreading undefined into a draft.
                const saved = draft.id ? branches.find(b => b.id === draft.id) : null
                setDraft(saved
                  ? { ...saved, parentBranchId: saved.parentBranchId ?? '' }
                  : emptyBranch())
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
              // A branch needs a BG, so with none on file the form would open
              // with an unsatisfiable required dropdown.
              title={noCompanies ? 'Add a BG first' : undefined}
              onClick={openAdd}
            >
              <Plus size={14} strokeWidth={2.6} />
              Add Branch
            </button>
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={rows}
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel={noCompanies
              ? 'No Business Groups on file — add a BG before creating branches.'
              : 'No branches yet — use Add Branch to create one.'}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title={doomed.length ? 'Delete branch and its sub-branches?' : 'Delete branch?'}
          body={
            doomed.length
              ? `${pending.name} will be removed from ${companyNameFor(pending.companyId)}, along with ${doomed.length} sub-branch${doomed.length === 1 ? '' : 'es'} beneath it.`
              : `${pending.name} will be removed from ${companyNameFor(pending.companyId)}.`
          }
          note={
            doomedVehicles
              ? `${doomedVehicles} vehicle${doomedVehicles === 1 ? '' : 's'} filed under ${doomedVehicles === 1 ? 'it' : 'them'} will keep their BG but lose their branch. Any sub-user scoped to a deleted branch is unassigned from it. This is mock data — nothing is sent to a server.`
              : 'Any sub-user scoped to a deleted branch is unassigned from it. This is mock data — nothing is sent to a server.'
          }
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
