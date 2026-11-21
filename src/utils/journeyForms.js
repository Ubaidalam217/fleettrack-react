/**
 * Custom stop forms (client 2026-11-21, after Uffizio's checkpoint "Form"):
 * a Business Group defines forms once (text, number, yes/no, dropdown, photo);
 * a stop asks one, and the driver (driver link) or the office fills it there.
 * Shared by the web and the server so both check the same way.
 */

export const FIELD_TYPES = Object.freeze(['TEXT', 'NUMBER', 'YESNO', 'DROPDOWN', 'PHOTO'])
export const FIELD_TYPE_LABEL = Object.freeze({ TEXT: 'Text', NUMBER: 'Number', YESNO: 'Yes / No', DROPDOWN: 'Dropdown', PHOTO: 'Photo' })
export const MAX_FIELDS = 30

/** A field's key from its label: "Seal number" → "seal_number". */
export const keyOf = label => String(label ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field'

/**
 * A form definition cleaned up: keys unique, dropdowns with options.
 * Returns { fields, errors } — errors keyed `${index}.label` / `${index}.options`.
 */
export function cleanFormFields(raw) {
  const errors = {}
  const seen = new Set()
  const fields = []
  ;(Array.isArray(raw) ? raw : []).slice(0, MAX_FIELDS).forEach((f, i) => {
    const label = String(f?.label ?? '').trim().slice(0, 80)
    if (!label) { errors[`${i}.label`] = 'Name this field'; return }
    const type = FIELD_TYPES.includes(f?.type) ? f.type : 'TEXT'
    let key = keyOf(f?.key || label)
    while (seen.has(key)) key = `${key}_2`
    seen.add(key)
    const field = { key, label, type, required: Boolean(f?.required) }
    if (type === 'DROPDOWN') {
      const options = [...new Set((Array.isArray(f?.options) ? f.options : String(f?.options ?? '').split(','))
        .map(o => String(o).trim().slice(0, 60)).filter(Boolean))].slice(0, 40)
      if (options.length < 2) errors[`${i}.options`] = 'Give at least two choices'
      field.options = options
    }
    fields.push(field)
  })
  if (!fields.length && !Object.keys(errors).length) errors.fields = 'Add at least one field'
  return { fields, errors }
}

/**
 * Answers checked against the fields. Photo fields are answered by uploading
 * a photo (its id), so here they only need to be present when required.
 * Returns { answers, errors } — errors keyed by field key.
 */
export function checkAnswers(fields, raw) {
  const answers = {}
  const errors = {}
  const given = raw && typeof raw === 'object' ? raw : {}
  for (const f of fields ?? []) {
    let v = given[f.key]
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length)
    if (empty) {
      if (f.required) errors[f.key] = f.type === 'PHOTO' ? 'Take a photo' : 'Required'
      continue
    }
    switch (f.type) {
      case 'NUMBER': {
        const n = Number(v)
        if (!Number.isFinite(n)) { errors[f.key] = 'Enter a number'; continue }
        v = n
        break
      }
      case 'YESNO':
        if (v === 'yes' || v === 'Yes') v = true
        if (v === 'no' || v === 'No') v = false
        if (typeof v !== 'boolean') { errors[f.key] = 'Yes or no'; continue }
        break
      case 'DROPDOWN':
        if (!(f.options ?? []).includes(String(v))) { errors[f.key] = 'Pick one of the choices'; continue }
        v = String(v)
        break
      case 'PHOTO':
        v = String(v).slice(0, 60)
        break
      default:
        v = String(v).trim().slice(0, 1000)
        if (!v && f.required) { errors[f.key] = 'Required'; continue }
    }
    answers[f.key] = v
  }
  return { answers, errors }
}

/** An answer as text for the detail page and the reports. */
export function answerText(field, v) {
  if (v == null || v === '') return '—'
  if (field?.type === 'YESNO') return v ? 'Yes' : 'No'
  if (field?.type === 'PHOTO') return 'Photo'
  return String(v)
}
