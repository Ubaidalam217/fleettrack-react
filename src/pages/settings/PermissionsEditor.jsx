import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ShieldCheck, X } from 'lucide-react'
import { PRIMARY_BTN, SECONDARY_BTN } from './formStyles'
import { useSession } from '../../data/session'
import { SCREEN_MODULES, levelsFor, levelIn, grantCap, atLeast } from '../../data/screens'

/**
 * Which screens one account may open, and how far it may change things there.
 * Opened from an account row in the Users panel (NodeUsersPanel).
 *
 * One row per screen, one segmented control per row. A level above the
 * editor's own is disabled (the server clamps it anyway, lib/permissions.js),
 * and presets set every screen at once. An account nobody has touched shows
 * everything at Full — "no restriction" — which is how it behaved before.
 */

const ROLE_LABEL = { GGB_ADMIN: 'GGB Admin', GROUP_ADMIN: 'Group Admin', BG_USER: 'BG User', SUB_USER: 'Sub-user' }

/**
 * A full map: every screen with an explicit level, so presets are visible —
 * and none above what the editor may give, since saving clamps to that anyway
 * (lib/permissions.js). What the editor opens on is what Save would store.
 */
function fullMap(access, capOf) {
  const out = {}
  for (const m of SCREEN_MODULES) for (const s of m.screens) {
    const level = levelIn(access, s.id)
    const cap = capOf(s.id)
    out[s.id] = atLeast(cap, level) ? level : cap
  }
  return out
}

function Segmented({ options, value, onChange, cap }) {
  return (
    <div role="radiogroup" style={{ display: 'inline-flex', border: '1px solid var(--c-border2)', borderRadius: 9, overflow: 'hidden', flexShrink: 0 }}>
      {options.map((o, i) => {
        const on = value === o.value
        const allowed = atLeast(cap, o.value)
        const tone = o.value === 'none' ? '#ef4444' : 'var(--ft-accent)'
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!allowed}
            title={!allowed ? 'Above your own access' : o.hint || o.label}
            onClick={() => onChange(o.value)}
            style={{
              padding: '5px 11px', fontSize: 11.5, fontWeight: 650, border: 0,
              borderLeft: i ? '1px solid var(--c-border2)' : 0,
              background: on ? `color-mix(in srgb, ${tone} 16%, transparent)` : 'transparent',
              color: on ? tone : 'var(--c-text2)',
              cursor: allowed ? 'pointer' : 'not-allowed', opacity: allowed ? 1 : 0.4, whiteSpace: 'nowrap',
            }}
          >
            {o.short}
          </button>
        )
      })}
    </div>
  )
}

/**
 * @param {object} account   { email, shortName/name, role, permissions }
 * @param {(permissions) => Promise} onSave
 */
export default function PermissionsEditor({ account, onSave, onClose }) {
  const { user: editor } = useSession()
  const [map, setMap] = useState(() => fullMap(account.permissions, id => grantCap(editor, id)))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const cap = id => grantCap(editor, id)
  const set = (id, level) => setMap(m => ({ ...m, [id]: level }))
  const preset = kind => setMap(() => {
    const out = {}
    for (const m of SCREEN_MODULES) for (const s of m.screens) {
      const top = kind === 'full' ? 'addDelete' : kind === 'view' ? 'view' : 'none'
      // Never above what this screen offers or what the editor holds.
      const offered = levelsFor(s.kind).map(l => l.value)
      let want = offered.includes(top) ? top : offered[offered.length - 1]
      if (!atLeast(cap(s.id), want)) want = cap(s.id)
      out[s.id] = want
    }
    return out
  })
  const setModule = (m, level) => setMap(prev => {
    const out = { ...prev }
    for (const s of m.screens) {
      const offered = levelsFor(s.kind).map(l => l.value)
      let want = offered.includes(level) ? level : offered[offered.length - 1]
      if (!atLeast(cap(s.id), want)) want = cap(s.id)
      out[s.id] = want
    }
    return out
  })

  const open = useMemo(() => Object.values(map).filter(v => v !== 'none').length, [map])
  const total = Object.keys(map).length

  const save = async () => {
    setSaving(true)
    try {
      // Page screens store "view" for open; Full on a page screen means the same.
      const clean = {}
      for (const m of SCREEN_MODULES) for (const s of m.screens) {
        clean[s.id] = s.kind === 'page' && map[s.id] !== 'none' ? 'view' : map[s.id]
      }
      await onSave(clean)
      onClose()
    } catch {
      setSaving(false)
    }
  }

  const name = account.shortName || account.name || account.email

  return createPortal(
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 1700, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        role="dialog" aria-modal="true" aria-label={`Permissions for ${name}`}
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(680px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 16, background: 'var(--c-card)', border: '1px solid var(--c-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
            <ShieldCheck size={19} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--c-text1)' }}>Permissions</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name} · {ROLE_LABEL[account.role] ?? 'User'} · {open} of {total} screens open
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" disabled={saving}
            style={{ display: 'flex', padding: 6, borderRadius: 8, border: '1px solid var(--c-border2)', background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer' }}>
            <X size={15} />
          </button>
        </header>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--c-border)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', marginRight: 4 }}>Quick set</span>
          {[['full', 'Full access'], ['view', 'View only'], ['none', 'No access']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => preset(k)} className="ft-btn" style={{ padding: '6px 12px', fontSize: 12 }}>{l}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 14px' }}>
          {SCREEN_MODULES.map(m => (
            <section key={m.id} style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--c-text1)' }}>{m.label}</span>
                <span style={{ display: 'flex', gap: 10, fontSize: 11.5 }}>
                  <button type="button" onClick={() => setModule(m, 'addDelete')} style={LINK_BTN}>All on</button>
                  <button type="button" onClick={() => setModule(m, 'none')} style={{ ...LINK_BTN, color: '#ef4444' }}>All off</button>
                </span>
              </div>
              <div style={{ border: '1px solid var(--c-border2)', borderRadius: 12, overflow: 'hidden' }}>
                {m.screens.map((s, i) => {
                  const value = s.kind === 'page' && map[s.id] !== 'none' ? 'view' : map[s.id]
                  return (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderTop: i ? '1px solid var(--c-border2)' : 0, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: value === 'none' ? 'var(--c-text3)' : 'var(--c-text1)' }}>{s.label}</div>
                        {s.hint && <div style={{ fontSize: 10.5, color: 'var(--c-text3)' }}>{s.hint}</div>}
                      </div>
                      <Segmented
                        options={levelsFor(s.kind).map(l => (s.kind === 'page' && l.value === 'view' ? { ...l, short: 'Open' } : l))}
                        value={value}
                        cap={s.kind === 'page' && atLeast(cap(s.id), 'view') ? 'view' : cap(s.id)}
                        onChange={v => set(s.id, v)}
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          <p style={{ fontSize: 11.5, color: 'var(--c-text3)', lineHeight: 1.5, margin: '14px 0 0' }}>
            <strong>View</strong> shows a page without changes · <strong>Edit</strong> allows changes · <strong>Full</strong> also allows add and delete.
            These narrow what the account’s role already allows; they never add to it. A change applies the next time the user signs in or reloads.
          </p>
        </div>

        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--c-border)' }}>
          <button type="button" style={SECONDARY_BTN} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...PRIMARY_BTN, opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save permissions'}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

const LINK_BTN = { border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'var(--ft-accent)', fontWeight: 650 }
