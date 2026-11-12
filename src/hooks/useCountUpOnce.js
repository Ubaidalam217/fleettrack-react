import { useEffect, useRef, useState } from 'react'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * A KPI number that counts up from 0 the first time it has a value, then
 * simply follows it — a live update a minute later changes the figure without
 * replaying the count. Non-numbers pass straight through; reduced motion skips
 * the count.
 */
export function useCountUpOnce(target, duration = 700) {
  const done = useRef(false)
  const [shown, setShown] = useState(null)

  useEffect(() => {
    if (!Number.isFinite(target) || done.current) return undefined
    if (reducedMotion() || target === 0) { done.current = true; return undefined }
    let raf = 0
    const start = performance.now()
    const tick = now => {
      const p = Math.min((now - start) / duration, 1)
      const v = target * (1 - Math.pow(1 - p, 3))
      setShown(p < 1 ? v : null)
      if (p < 1) raf = requestAnimationFrame(tick)
      else done.current = true
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); setShown(null) }
  }, [target, duration])

  return shown == null ? target : Math.round(shown)
}
