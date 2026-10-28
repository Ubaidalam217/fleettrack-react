import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { Field, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN, SECONDARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import GeofenceMapEditor from '../../components/settings/GeofenceMapEditor'
import {
  useGeofences, useCompanies, addGeofence, updateGeofence, removeGeofence,
  companyNameFor, emptyGeofence, geofencesForCompany, GEOFENCE_CATEGORIES,
} from '../../data/settings'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'
import { IS_REAL } from '../../data/mode'

/**
 * Settings > Address - Geofence.
 *
 * The reference system (AI Revofleet) shows this as two sibling screens —
 * Address and Geofence — but the two differ only in which fields are
 * meaningful (a category Type vs a watched shape), not in what they fundamentally
 * are: a named polygon or circle owned by one BG. One page with a kind filter,
 * sharing the list, the form and the map editor, is the same information
 * architecture without duplicating the drawing tooling for a cosmetic split.
 * See the Geofence model's own comment in server/prisma/schema.prisma.
 */

const KIND_LABEL = { GEOFENCE: 'Geofence', ADDRESS: 'Address' }
const SHAPE_LABEL = { POLYGON: 'Polygon', CIRCLE: 'Circle' }

const KIND_TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'GEOFENCE', label: 'Geofences' },
  { id: 'ADDRESS', label: 'Addresses' },
]

const COLUMNS = [
  { key: 'name', label: 'Name', bold: true },
  { key: 'kind', label: 'Kind', render: row => KIND_LABEL[row.kind] ?? row.kind },
  { key: 'shape', label: 'Shape', render: row => SHAPE_LABEL[row.shape] ?? row.shape },
  { key: 'category', label: 'Category', muted: true, render: row => row.category || '—' },
  { key: 'company', label: 'BG', render: row => companyNameFor(row.companyId) },
]

export default function Geofence(props) {
  const geofences = useGeofences()
  const companies = useCompanies()
  const { toasts, push, dismiss } = useToasts()
  const access = usePageAccess('geofence')

  const [kindFilter, setKindFilter] = useState('ALL')
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

  const rows = useMemo(() => {
    const filtered = kindFilter === 'ALL' ? geofences : geofences.filter(g => g.kind === kindFilter)
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [geofences, kindFilter])

  // The selected BG's other shapes, for the editor map's context layer.
  const contextGeofences = useMemo(
    () => (draft?.companyId ? geofencesForCompany(draft.companyId) : []),
    [geofences, draft?.companyId]
  )

  const openAdd = () => {
    setErrors({})
    setDraft({ ...emptyGeofence(), kind: kindFilter === 'ADDRESS' ? 'ADDRESS' : 'GEOFENCE' })
  }
  const openEdit  = row  => { setErrors({}); setDraft({ ...row, points: [...(row.points ?? [])] }) }
  const closeForm = ()   => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => ({ ...d, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const onShapeChange = patch => {
    setDraft(d => ({ ...d, ...patch }))
    setErrors(e => (e.points || e.radius || e.centerLat ? { ...e, points: null, radius: null, centerLat: null } : e))
  }

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!draft.companyId)   next.companyId = 'BG is required'
    if (!draft.name.trim()) next.name      = 'Name is required'
    if (draft.shape === 'POLYGON') {
      if ((draft.points ?? []).length < 3) {
        next.points = 'Draw a polygon with at least 3 points'
      }
    } else if (!draft.radius || Number(draft.radius) <= 0 || draft.centerLat == null) {
      next.radius = 'Draw a circle on the map'
    }
    if (Object.keys(next).length) {
      setErrors(next)
      return
    }

    const clean = { ...draft, name: draft.name.trim() }
    setSaving(true)
    try {
      if (draft.id) {
        await updateGeofence(draft.id, clean)
        push(`${clean.name} updated`, { tone: 'success' })
      } else {
        await addGeofence(clean)
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
      await removeGeofence(row.id)
      push(`${row.name} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  const noCompanies = companies.length === 0
  const title = !editing ? 'Address - Geofence' : draft.id ? 'Edit Geofence' : 'Add Geofence'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Geofence details' : 'New geofence'}
            subtitle="Fields marked with * are required. Draw the shape on the map before saving."
          >
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: '14px 16px',
            }}>
              <Field
                label="BG (Business Group)"
                required
                error={errors.companyId}
                hint={IS_REAL && draft.id ? 'A geofence cannot be moved to another BG.' : undefined}
              >
                <select
                  ref={firstRef}
                  name="companyId"
                  value={draft.companyId}
                  onChange={e => set('companyId', e.target.value)}
                  disabled={IS_REAL && !!draft.id}
                  aria-invalid={!!errors.companyId || undefined}
                  style={
                    IS_REAL && draft.id
                      ? { ...inputStyle(!!errors.companyId), opacity: 0.6, cursor: 'not-allowed' }
                      : inputStyle(!!errors.companyId)
                  }
                >
                  <option value="">— Select —</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Name" required error={errors.name}>
                <input
                  name="name"
                  value={draft.name}
                  onChange={e => set('name', e.target.value)}
                  aria-invalid={!!errors.name || undefined}
                  placeholder="Kizad Industrial Zone"
                  style={inputStyle(!!errors.name)}
                />
              </Field>

              <Field label="Kind">
                <select
                  name="kind"
                  value={draft.kind}
                  onChange={e => set('kind', e.target.value)}
                  style={inputStyle(false)}
                >
                  <option value="GEOFENCE">Geofence</option>
                  <option value="ADDRESS">Address</option>
                </select>
              </Field>

              <Field label="Shape">
                <select
                  name="shape"
                  value={draft.shape}
                  onChange={e => set('shape', e.target.value)}
                  style={inputStyle(false)}
                >
                  <option value="POLYGON">Polygon</option>
                  <option value="CIRCLE">Circle</option>
                </select>
              </Field>

              <Field label="Category">
                <input
                  name="category"
                  list="geofence-category-options"
                  value={draft.category}
                  onChange={e => set('category', e.target.value)}
                  placeholder="Factory, Depot, Warehouse…"
                  style={inputStyle(false)}
                />
                <datalist id="geofence-category-options">
                  {GEOFENCE_CATEGORIES.map(c => <option key={c} value={c} />)}
                </datalist>
              </Field>

              <Field label="Color">
                <input
                  type="color"
                  name="color"
                  value={draft.color || '#2563eb'}
                  onChange={e => set('color', e.target.value)}
                  style={{ ...inputStyle(false), padding: 3, height: 36, cursor: 'pointer' }}
                />
              </Field>

              <Field label="Active">
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, height: 36, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={e => set('active', e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: 'var(--ft-accent)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
                    {draft.active ? 'Active' : 'Inactive'}
                  </span>
                </label>
              </Field>
            </div>

            <div style={{ marginTop: 14 }}>
              <Field label="Description">
                <textarea
                  name="description"
                  value={draft.description}
                  onChange={e => set('description', e.target.value)}
                  rows={2}
                  style={{ ...inputStyle(false), resize: 'vertical', fontFamily: 'inherit' }}
                />
              </Field>
            </div>

            <div style={{ marginTop: 18 }}>
              <span className="ft-label" style={{ display: 'block', marginBottom: 8 }}>
                Shape
                {(errors.points || errors.radius || errors.centerLat) && (
                  <span style={{ color: '#ef4444', fontWeight: 600, marginLeft: 8 }}>
                    {errors.points || errors.radius || errors.centerLat}
                  </span>
                )}
              </span>
              {!draft.companyId ? (
                <p style={{ fontSize: 12, color: 'var(--c-text3)' }}>Pick a BG first.</p>
              ) : (
                <GeofenceMapEditor
                  draft={draft}
                  onChange={onShapeChange}
                  contextGeofences={contextGeofences}
                  resetKey={draft.id ?? 'new'}
                />
              )}
            </div>

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                const saved = draft.id ? geofences.find(g => g.id === draft.id) : null
                setDraft(saved ? { ...saved, points: [...(saved.points ?? [])] } : emptyGeofence())
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
              <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
                {KIND_TABS.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setKindFilter(t.id)}
                    style={{
                      ...SECONDARY_BTN,
                      ...(kindFilter === t.id
                        ? { background: 'var(--ft-accent)', color: '#fff', border: '1px solid var(--ft-accent)' }
                        : {}),
                      padding: '7px 14px',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <TableToolbar count={rows.length} noun="geofence" plural="geofences">
                {access.canWrite && (
                  <button
                    type="button"
                    style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
                    disabled={noCompanies}
                    title={noCompanies ? 'Add a BG first' : undefined}
                    onClick={openAdd}
                  >
                    <Plus size={14} strokeWidth={2.6} />
                    Add Geofence
                  </button>
                )}
              </TableToolbar>

              <SettingsTable
                columns={COLUMNS}
                rows={rows}
                onEdit={openEdit}
                onDelete={setPending}
                canWrite={access.canWrite}
                emptyLabel={
                  !access.canWrite
                    ? 'No geofences to show.'
                    : noCompanies
                      ? 'No Business Groups on file — add a BG before creating geofences.'
                      : 'No geofences yet — use Add Geofence to create one.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete geofence?"
          body={`${pending.name} will be removed from ${companyNameFor(pending.companyId)}.`}
          note={modeNote(null, 'This is mock data — nothing is sent to a server.')}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
