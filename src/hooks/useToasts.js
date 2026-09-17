import { useCallback, useEffect, useRef, useState } from 'react'

// Toast queue state. Split from the ToastStack component so that file exports
// only a component — mixing a hook in with it breaks React Fast Refresh.

const DEFAULT_MS = 4200

export function useToasts() {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)
  const timers = useRef(new Map())

  const dismiss = useCallback(id => {
    setToasts(list => list.filter(t => t.id !== id))
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
  }, [])

  /**
   * @param {string} message
   * @param {{tone?: 'success'|'error'|'pending'|'info', duration?: number}} opts
   *        duration 0 pins the toast until it is clicked.
   */
  const push = useCallback((message, { tone = 'info', duration = DEFAULT_MS } = {}) => {
    const id = nextId.current++
    setToasts(list => [...list, { id, message, tone }])
    if (duration > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), duration))
    }
    return id
  }, [dismiss])

  // Pending timers outlive the component without this, firing setState after
  // unmount the moment the user navigates away from the page.
  useEffect(() => {
    const map = timers.current
    return () => { map.forEach(clearTimeout); map.clear() }
  }, [])

  return { toasts, push, dismiss }
}
