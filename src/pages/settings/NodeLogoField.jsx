import { useRef, useState } from 'react'
import { ImageIcon, ImagePlus, Trash2 } from 'lucide-react'
import { SECONDARY_BTN } from './formStyles'
import { handleApiError } from './pageChrome'
import { setNodeLogo, removeNodeLogo } from '../../data/settings'
import { logoPngBase64 } from '../../utils/imageUpload'

/**
 * The logo of a GGB, Group, Business Group or Branch (client, 2026-11-13),
 * shown at the left of the report headers of the accounts below it. Laid out
 * like the driver form's photo header, as the client asked.
 *
 * An existing node saves the logo at once. A new one has no id yet, so the
 * logo is staged (onStage) and the page uploads it after the save, with
 * uploadStagedLogo() (nodeLogo.js).
 */
export default function NodeLogoField({ kind, noun, draft, setDraft, onStage, push }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const url = draft.logoUrl || ''
  const name = String(draft.name ?? '').trim()

  const pick = async file => {
    if (!file) return
    setBusy(true)
    try {
      const b64 = await logoPngBase64(file)
      if (draft.id) {
        await setNodeLogo(kind, draft.id, b64)
        push('Logo updated', { tone: 'success' })
      } else {
        onStage(b64)
      }
      setDraft(d => ({ ...d, logoUrl: `data:image/png;base64,${b64}` }))
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const drop = async () => {
    setBusy(true)
    try {
      if (draft.id) await removeNodeLogo(kind, draft.id)
      onStage(null)
      setDraft(d => ({ ...d, logoUrl: '' }))
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
      padding: '16px 18px', marginBottom: 18, borderRadius: 12,
      border: '1px solid var(--c-border)', background: 'color-mix(in srgb, var(--ft-accent) 4%, var(--c-card))',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 12, flexShrink: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // White behind a logo, as on the report it is made for.
        background: url ? '#fff' : 'color-mix(in srgb, var(--ft-accent) 10%, transparent)',
        border: url ? '1px solid var(--c-border2)' : '1px dashed color-mix(in srgb, var(--ft-accent) 45%, transparent)',
        color: 'var(--ft-accent)',
      }}>
        {url
          ? <img src={url} alt={`${name || noun} logo`} style={{ maxWidth: '100%', maxHeight: '100%', padding: 6, boxSizing: 'border-box', objectFit: 'contain' }} />
          : <ImageIcon size={26} strokeWidth={1.8} />}
      </div>
      <div style={{ minWidth: 160, flex: 1 }}>
        <div style={{
          fontSize: 18, fontWeight: 800, lineHeight: 1.25, color: name ? 'var(--c-text1)' : 'var(--c-text3)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {name || `New ${noun}`}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--c-text3)' }}>
          Logo for the left of report headers · PNG, JPEG or WebP, up to 5 MB
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => pick(e.target.files?.[0])} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={{ ...SECONDARY_BTN, height: 38, opacity: busy ? 0.6 : 1 }}>
          <ImagePlus size={14} /> {url ? 'Change logo' : 'Add logo'}
        </button>
        {url && (
          <button type="button" disabled={busy} onClick={drop} style={{ ...SECONDARY_BTN, height: 38, opacity: busy ? 0.6 : 1 }}>
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>
    </div>
  )
}
