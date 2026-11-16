import { useMemo, useState } from 'react'
import { Link2, Search, X } from 'lucide-react'
import { Field } from './FormKit'
import { inputStyle } from './formStyles'
import { useBranches, useCompanies, useGroups, branchTreeForCompany } from '../../data/settings'

/**
 * "Also show in" — the other Groups, Business Groups and Branches a vehicle
 * shows in (client, 2026-11-13: "One vehicle can be assigned to multiple Group,
 * BG, Branch"). Visibility only: the vehicle keeps its own BG and branch, which
 * keep its tracker, its edits and its records (utils/vehiclePlacement.js).
 *
 * `value` is [{ level: 'group'|'bg'|'branch', id }]. Only the places this
 * account can see are offered; a share someone higher up made to a place out
 * of its sight is listed, fixed — the server keeps it whatever is saved here.
 * The vehicle's own BG, branch and Group are not offered: it is there already.
 */

const keyOf = t => `${t.level}:${t.id}`

export default function ShareTargetsField({ draft, value, fixed = [], onChange, error }) {
  const companies = useCompanies()
  const groups = useGroups()
  useBranches()
  const [query, setQuery] = useState('')

  const homeGroup = companies.find(c => c.id === draft.companyId)?.groupId || ''
  const picked = useMemo(() => new Set(value.map(keyOf)), [value])

  // Every place this account can see, as one indented list.
  const options = useMemo(() => {
    const out = []
    for (const g of [...groups].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ level: 'group', id: g.id, label: g.name, depth: 0, kind: 'Group', home: g.id === homeGroup })
    }
    for (const c of [...companies].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ level: 'bg', id: c.id, label: c.name, depth: 0, kind: 'Business Group', home: c.id === draft.companyId })
      for (const b of branchTreeForCompany(c.id)) {
        out.push({ level: 'branch', id: b.id, label: b.name, depth: 1 + (b.depth ?? 0), kind: 'Branch', bgName: c.name, home: b.id === draft.branchId && c.id === draft.companyId })
      }
    }
    return out
  }, [groups, companies, draft.companyId, draft.branchId, homeGroup])

  const q = query.trim().toLowerCase()
  const shown = q ? options.filter(o => `${o.label} ${o.bgName ?? ''}`.toLowerCase().includes(q)) : options
  const labelOf = t => {
    const o = options.find(x => x.level === t.level && x.id === t.id)
    if (!o) return t.id
    return o.level === 'branch' ? `${o.bgName} / ${o.label}` : o.label
  }

  const toggle = o => {
    if (o.home) return
    const k = keyOf(o)
    onChange(picked.has(k) ? value.filter(t => keyOf(t) !== k) : [...value, { level: o.level, id: o.id }])
  }

  return (
    <Field
      label="Also show in"
      error={error}
      hint="Other Groups, Business Groups or Branches that also see this vehicle — on the Live Map, in reports and for their own alerts. It stays this Business Group's vehicle: only here can it be edited."
    >
      <div style={{ border: '1px solid var(--c-border)', borderRadius: 10, background: 'var(--c-input)', overflow: 'hidden' }}>
        {(value.length > 0 || fixed.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--c-border)' }}>
            {value.map(t => (
              <span key={keyOf(t)} style={CHIP}>
                <Link2 size={11} aria-hidden="true" />
                {labelOf(t)}
                <button type="button" onClick={() => onChange(value.filter(x => keyOf(x) !== keyOf(t)))} aria-label={`Stop showing it in ${labelOf(t)}`} style={CHIP_X}>
                  <X size={11} />
                </button>
              </span>
            ))}
            {fixed.map(s => (
              <span key={s.id} style={{ ...CHIP, opacity: 0.7 }} title="Set by an administrator — not changed from here">
                <Link2 size={11} aria-hidden="true" />
                {s.label}
              </span>
            ))}
          </div>
        )}
        <div style={{ position: 'relative', borderBottom: '1px solid var(--c-border)' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--c-text3)' }} aria-hidden="true" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a Group, Business Group or Branch"
            aria-label="Find a place to also show this vehicle in"
            style={{ ...inputStyle(false), border: 0, borderRadius: 0, paddingLeft: 30, background: 'transparent' }}
          />
        </div>
        <div role="group" aria-label="Also show in" style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 0' }}>
          {shown.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--c-text3)' }}>
              {options.length ? 'Nothing matches.' : 'No other place to show it in.'}
            </div>
          )}
          {shown.map(o => {
            const on = picked.has(keyOf(o))
            return (
              <label
                key={keyOf(o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: `5px 12px 5px ${12 + o.depth * 16}px`,
                  fontSize: 12.5, cursor: o.home ? 'default' : 'pointer', color: o.home ? 'var(--c-text3)' : 'var(--c-text1)',
                }}
              >
                <input type="checkbox" checked={on || o.home} disabled={o.home} onChange={() => toggle(o)} />
                <span style={{ fontWeight: o.depth === 0 ? 650 : 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                <span style={{ fontSize: 10.5, color: 'var(--c-text3)', flexShrink: 0 }}>{o.home ? `its own ${o.kind.toLowerCase()}` : o.kind}</span>
              </label>
            )
          })}
        </div>
      </div>
    </Field>
  )
}

const CHIP = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 4px 3px 8px', borderRadius: 999,
  fontSize: 11.5, fontWeight: 650, color: 'var(--ft-accent)',
  background: 'color-mix(in srgb, var(--ft-accent) 11%, transparent)',
  border: '1px solid color-mix(in srgb, var(--ft-accent) 30%, transparent)',
}
const CHIP_X = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 17, height: 17, borderRadius: 999,
  border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0,
}
