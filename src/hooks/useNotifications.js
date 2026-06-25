import { useState, useEffect } from 'react'
import * as store from '../services/notificationStore'

export function useNotifications() {
  const [items, setItems] = useState(() => store.getAll())

  useEffect(() => {
    const refresh = () => setItems(store.getAll())
    window.addEventListener('notif-store-update', refresh)
    return () => window.removeEventListener('notif-store-update', refresh)
  }, [])

  const alerts       = items.filter(n => n.type === 'alert')
  const announcements = items.filter(n => n.type === 'announcement')

  return {
    items,
    alerts,
    announcements,
    unreadCount:         items.filter(n => !n.read).length,
    unreadAlerts:        alerts.filter(n => !n.read).length,
    unreadAnnouncements: announcements.filter(n => !n.read).length,
    markRead:    store.markRead,
    markAllRead: store.markAllRead,
    deleteOne:   store.deleteOne,
    clearAll:    store.clearAll,
    addMany:     store.addMany,
  }
}
