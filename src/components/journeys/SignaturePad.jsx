import { useEffect, useRef, useState } from 'react'

/**
 * "Sign here" on a stop (client 2026-11-17, proof of delivery). A plain canvas
 * with pointer events, so it works with a mouse, a pen and a finger on a phone
 * browser. Saves a PNG; the driver app will post the same endpoint (phase 2).
 */
export default function SignaturePad({ onSave, onCancel, busy }) {
  const ref = useRef(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)
  const [name, setName] = useState('')

  useEffect(() => {
    const c = ref.current
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    const ctx = c.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#13232b'
  }, [])

  const pos = e => {
    const r = ref.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const down = e => {
    e.preventDefault()
    ref.current.setPointerCapture?.(e.pointerId)
    drawing.current = true
    const ctx = ref.current.getContext('2d')
    const [x, y] = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 0.1, y + 0.1)
    ctx.stroke()
    setEmpty(false)
  }
  const move = e => {
    if (!drawing.current) return
    const ctx = ref.current.getContext('2d')
    const [x, y] = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  const up = () => { drawing.current = false }
  const clear = () => {
    const c = ref.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }

  return (
    <div>
      <canvas
        ref={ref}
        className="j-sigpad"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        aria-label="Signature pad: sign with the mouse or a finger"
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="j-input" style={{ flex: 1, minWidth: 160 }} value={name} onChange={e => setName(e.target.value)} placeholder="Name of the person signing" aria-label="Signed by" />
        <button type="button" className="j-btn j-btn--sm" onClick={clear} disabled={empty}>Clear</button>
        <button type="button" className="j-btn j-btn--sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={empty || busy} onClick={() => onSave({ data: ref.current.toDataURL('image/png'), signedByName: name.trim() || null })}>
          {busy ? 'Saving…' : 'Save signature'}
        </button>
      </div>
    </div>
  )
}
