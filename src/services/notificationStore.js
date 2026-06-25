const KEY = 'fleettrack_notifications'
const MAX = 500

function emit() {
  window.dispatchEvent(new CustomEvent('notif-store-update'))
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') }
  catch { return [] }
}

function write(items) {
  // Auto-prune oldest when over cap, keeping newest
  const pruned = items.length > MAX ? items.slice(items.length - MAX) : items
  try {
    localStorage.setItem(KEY, JSON.stringify(pruned))
  } catch {
    // Quota exceeded — keep only half to recover space
    try { localStorage.setItem(KEY, JSON.stringify(pruned.slice(-Math.floor(MAX / 2)))) }
    catch {}
  }
  emit()
}

export function addMany(arr) {
  if (!arr?.length) return
  const existing = read()
  const existingIds = new Set(existing.map(n => n.id))
  const fresh = arr.filter(n => !existingIds.has(n.id))
  if (!fresh.length) return
  write([...existing, ...fresh])
}

export function getAll() {
  return read()
}

export function getByType(type) {
  return read().filter(n => n.type === type)
}

export function getUnreadCount(type) {
  const items = read()
  return items.filter(n => !n.read && (!type || n.type === type)).length
}

export function markRead(id) {
  write(read().map(n => n.id === id ? { ...n, read: true } : n))
}

export function markAllRead(type) {
  write(read().map(n => (!type || n.type === type) ? { ...n, read: true } : n))
}

export function deleteOne(id) {
  write(read().filter(n => n.id !== id))
}

export function clearAll(type) {
  if (type) {
    write(read().filter(n => n.type !== type))
  } else {
    write([])
  }
}
