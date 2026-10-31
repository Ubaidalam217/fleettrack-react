import { useEffect, useState } from 'react'
import { User, Lock, Palette, Bell, Sun, Moon, Monitor, Check } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Header  from '../components/Header'
import ToastStack from '../components/tracking/Toasts'
import { useToasts } from '../hooks/useToasts'
import { Field } from './settings/FormKit'
import { inputStyle, PRIMARY_BTN, CARD_SURFACE } from './settings/formStyles'
import { IS_REAL } from '../data/mode'
import { useSession, changePassword, refreshMe, ROLE_LABELS } from '../data/session'
import { request, errorMessage } from '../data/http'
import { useCurrentUser } from '../services/authUser'
import { getPermissionState, requestPermission } from '../services/pushNotifications'

/**
 * Account Settings — the page behind the header menu's Profile and Settings.
 *
 * Only what belongs to the signed-in person: their name and mobile, their
 * password, how the app looks, and desktop notifications. Fleet configuration
 * (companies, vehicles, alerts, drivers) stays under the sidebar's Settings
 * tree, where it is scoped by role. The demo build (mock mode) has no server
 * account, so the two forms there explain that instead of pretending to save.
 */

const PASSWORD_MIN = 8 // server/src/lib/password.js PASSWORD_MIN_LENGTH

const SECTION_GAP = 18

function Section({ icon: Icon, title, subtitle, children, id }) {
  return (
    <section id={id} style={{ ...CARD_SURFACE, padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
          <Icon size={17} strokeWidth={2.2} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--c-text1)' }}>{title}</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--c-text3)' }}>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }
const READONLY = { ...inputStyle(false), background: 'var(--c-thead)', color: 'var(--c-text3)', cursor: 'not-allowed' }
const DEMO_NOTE = { fontSize: 12, color: 'var(--c-text3)', margin: '14px 0 0' }

function SaveRow({ saving, disabled, label = 'Save changes' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
      <button type="submit" disabled={saving || disabled} style={{ ...PRIMARY_BTN, opacity: saving || disabled ? 0.6 : 1, cursor: saving || disabled ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : label}
      </button>
    </div>
  )
}

// ── Profile ─────────────────────────────────────────────────────────────────

/**
 * A picked image as a 320 px square JPEG (centre-cropped), base64 without the
 * data: prefix. Resizing here keeps the upload to a few tens of KB whatever the
 * camera produced, the same as the mobile app does.
 */
function squareJpegBase64(file, size = 320) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1])
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read')) }
    img.src = url
  })
}

/** The profile photo: shown here, in the header, and in the mobile app. */
function PhotoRow({ push }) {
  const shown = useCurrentUser()
  const [busy, setBusy] = useState(false)

  const upload = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      await request('/api/me/avatar', { method: 'PUT', body: { image: await squareJpegBase64(file) } })
      await refreshMe()
      push('Photo updated', { tone: 'success' })
    } catch (err) {
      push(errorMessage(err, 'Could not upload the photo'), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await request('/api/me/avatar', { method: 'DELETE' })
      await refreshMe()
      push('Photo removed', { tone: 'success' })
    } catch (err) {
      push(errorMessage(err, 'Could not remove the photo'), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const initial = (shown.name || '?').trim().slice(0, 2).toUpperCase()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--ft-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800 }}>
        {shown.photo ? <img src={shown.photo} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initial}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ ...PRIMARY_BTN, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Saving…' : shown.photo ? 'Change photo' : 'Upload photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={busy} style={{ display: 'none' }} />
          </label>
          {shown.photo ? (
            <button type="button" onClick={remove} disabled={busy} style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text2)', fontWeight: 600, cursor: 'pointer' }}>
              Remove
            </button>
          ) : null}
        </div>
        <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>JPEG, PNG or WebP. Also shows in the FleetmaX mobile app.</span>
      </div>
    </div>
  )
}

function ProfileSection({ push }) {
  const session = useSession()
  const shown = useCurrentUser()
  const account = session.user
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  // Seeded once the session has the account; a later save re-seeds from the reply.
  useEffect(() => {
    if (!account) return
    setName(account.shortName ?? '')
    setMobile(account.mobile ?? '')
  }, [account?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = IS_REAL && account && (name.trim() !== (account.shortName ?? '') || mobile.trim() !== (account.mobile ?? ''))

  const submit = async e => {
    e.preventDefault()
    if (!IS_REAL || saving) return
    if (!name.trim()) { setErrors({ shortName: 'Enter the name to show in the app' }); return }
    setErrors({})
    setSaving(true)
    try {
      await request('/api/me', { method: 'PATCH', body: { shortName: name.trim(), mobile: mobile.trim() } })
      await refreshMe()
      push('Profile updated', { tone: 'success' })
    } catch (err) {
      setErrors(err?.details ?? {})
      push(errorMessage(err, 'Could not save your profile'), { tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section id="profile" icon={User} title="Profile" subtitle="Your photo and name, as they appear on the dashboard, the header and the mobile app.">
      {IS_REAL ? <PhotoRow push={push} /> : null}
      <form onSubmit={submit} noValidate>
        <div style={GRID}>
          <Field label="Display name" required error={errors.shortName}>
            <input value={IS_REAL ? name : shown.name} onChange={e => setName(e.target.value)} disabled={!IS_REAL} style={IS_REAL ? inputStyle(!!errors.shortName) : READONLY} placeholder="e.g. Hassan" maxLength={120} />
          </Field>
          <Field label="Mobile" error={errors.mobile}>
            <input value={IS_REAL ? mobile : ''} onChange={e => setMobile(e.target.value)} disabled={!IS_REAL} style={IS_REAL ? inputStyle(!!errors.mobile) : READONLY} placeholder="+971 50 000 0000" maxLength={40} />
          </Field>
          <Field label="Email (sign-in)" hint="Your username; ask an administrator to change it.">
            <input value={account?.email ?? shown.email ?? ''} readOnly style={READONLY} />
          </Field>
          <Field label="Role">
            <input value={account ? (ROLE_LABELS[account.role] ?? account.role) : shown.role} readOnly style={READONLY} />
          </Field>
        </div>
        {IS_REAL ? <SaveRow saving={saving} disabled={!dirty} /> : <p style={DEMO_NOTE}>The demo account cannot be edited.</p>}
      </form>
    </Section>
  )
}

// ── Password ────────────────────────────────────────────────────────────────

function PasswordSection({ push }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const set = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setErrors(x => ({ ...x, [k]: null })) }

  const submit = async e => {
    e.preventDefault()
    if (!IS_REAL || saving) return
    const next = {}
    if (!form.current) next.current = 'Enter your current password'
    if (form.next.length < PASSWORD_MIN) next.next = `At least ${PASSWORD_MIN} characters`
    else if (form.next === form.current) next.next = 'Choose a password different from the current one'
    if (form.confirm !== form.next) next.confirm = 'Does not match the new password'
    if (Object.keys(next).length) { setErrors(next); return }
    setSaving(true)
    try {
      await changePassword(form.current, form.next)
      setForm({ current: '', next: '', confirm: '' })
      push('Password changed', { tone: 'success' })
    } catch (err) {
      const d = err?.details ?? {}
      setErrors({ current: d.currentPassword, next: d.newPassword })
      push(errorMessage(err, 'Could not change the password'), { tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section id="security" icon={Lock} title="Password" subtitle={`Use at least ${PASSWORD_MIN} characters. You stay signed in on this device.`}>
      <form onSubmit={submit} noValidate>
        <div style={GRID}>
          <Field label="Current password" required error={errors.current}>
            <input type="password" autoComplete="current-password" value={form.current} onChange={set('current')} disabled={!IS_REAL} style={IS_REAL ? inputStyle(!!errors.current) : READONLY} />
          </Field>
          <Field label="New password" required error={errors.next}>
            <input type="password" autoComplete="new-password" value={form.next} onChange={set('next')} disabled={!IS_REAL} style={IS_REAL ? inputStyle(!!errors.next) : READONLY} />
          </Field>
          <Field label="Confirm new password" required error={errors.confirm}>
            <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} disabled={!IS_REAL} style={IS_REAL ? inputStyle(!!errors.confirm) : READONLY} />
          </Field>
        </div>
        {IS_REAL ? <SaveRow saving={saving} disabled={!form.current || !form.next || !form.confirm} label="Change password" /> : <p style={DEMO_NOTE}>The demo account has no password to change.</p>}
      </form>
    </Section>
  )
}

// ── Appearance ──────────────────────────────────────────────────────────────

const THEMES = [
  { value: 'light',  label: 'Light',  icon: Sun },
  { value: 'dark',   label: 'Dark',   icon: Moon },
  { value: 'system', label: 'System', icon: Monitor, note: 'Follows this device' },
]

function AppearanceSection({ themeMode, setTheme }) {
  return (
    <Section id="appearance" icon={Palette} title="Appearance" subtitle="How FleetmaX looks on this device.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {THEMES.map(t => {
          const on = themeMode === t.value
          const Icon = t.icon
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTheme?.(t.value)}
              aria-pressed={on}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                border: `1.5px solid ${on ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
                background: on ? 'color-mix(in srgb, var(--ft-accent) 10%, var(--c-card))' : 'var(--c-input)',
                color: 'var(--c-text1)',
              }}
            >
              <Icon size={16} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 650 }}>{t.label}</span>
                {t.note && <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text3)' }}>{t.note}</span>}
              </span>
              {on && <Check size={15} color="var(--ft-accent)" />}
            </button>
          )
        })}
      </div>
    </Section>
  )
}

// ── Notifications ───────────────────────────────────────────────────────────

const PERMISSION_TEXT = {
  granted:     { label: 'On',            color: '#16a34a', text: 'Alerts appear as desktop notifications on this device, even when the tab is in the background.' },
  default:     { label: 'Off',           color: '#64748b', text: 'Turn on to see alerts as desktop notifications on this device.' },
  denied:      { label: 'Blocked',       color: '#dc2626', text: 'Blocked in this browser. Allow notifications for this site from the padlock icon in the address bar, then reload.' },
  unsupported: { label: 'Not available', color: '#64748b', text: 'This browser does not support desktop notifications.' },
}

function NotificationsSection({ push }) {
  const [perm, setPerm] = useState(getPermissionState)
  const info = PERMISSION_TEXT[perm] ?? PERMISSION_TEXT.unsupported

  const enable = async () => {
    const result = await requestPermission()
    setPerm(result)
    if (result === 'granted') push('Desktop notifications turned on', { tone: 'success' })
  }

  return (
    <Section id="notifications" icon={Bell} title="Notifications" subtitle="Alerts always appear under the bell and on the Notifications page.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--c-border2)', background: 'var(--c-input)' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--c-text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Desktop notifications
            <span style={{ fontSize: 11, fontWeight: 700, color: info.color, background: `color-mix(in srgb, ${info.color} 12%, transparent)`, padding: '2px 8px', borderRadius: 999 }}>{info.label}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 4 }}>{info.text}</div>
        </div>
        {perm === 'default' && (
          <button type="button" onClick={enable} style={PRIMARY_BTN}>Turn on</button>
        )}
      </div>
      <p style={{ ...DEMO_NOTE, marginTop: 12 }}>Who receives alert emails is set per alert, in Settings › Alerts.</p>
    </Section>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Settings({ isDark, toggleTheme, themeMode, setTheme }) {
  const { toasts, push, dismiss } = useToasts()

  // /settings/profile opens the same page at its Profile card.
  useEffect(() => {
    if (window.location.pathname.endsWith('/profile')) document.getElementById('profile')?.scrollIntoView()
  }, [])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--c-page)' }}>
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Header isDark={isDark} toggleTheme={toggleTheme} themeMode={themeMode} setTheme={setTheme} />
        <main className="flex-1 overflow-y-auto no-scrollbar" style={{ padding: '24px clamp(16px, 3vw, 32px) 40px' }}>
          <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: SECTION_GAP }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--c-text1)' }}>Account Settings</h1>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--c-text3)' }}>Your profile, password and preferences.</p>
            </div>
            <ProfileSection push={push} />
            <PasswordSection push={push} />
            <AppearanceSection themeMode={themeMode} setTheme={setTheme} />
            <NotificationsSection push={push} />
          </div>
        </main>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
