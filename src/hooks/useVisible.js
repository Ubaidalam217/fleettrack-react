import { useState, useEffect, useRef } from 'react'

/**
 * True once the returned ref's element has been intersecting the viewport
 * continuously for `delayMs`. Debounces a fast scroll-past so it doesn't fire
 * a lookup (e.g. reverse geocoding) for a row nobody actually stopped to read.
 *
 * Once true, stays true — scrolling the element back off-screen shouldn't
 * discard whatever it already triggered.
 */
export function useVisible(delayMs = 300) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (visible) return
    const el = ref.current
    if (!el) return

    let timer = null
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        timer = setTimeout(() => setVisible(true), delayMs)
      } else if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }, { threshold: 0.2 })

    observer.observe(el)
    return () => { observer.disconnect(); if (timer) clearTimeout(timer) }
  }, [delayMs, visible])

  return [ref, visible]
}
