/**
 * Settings › Master › Expense (client, 2026-11-09): what each vehicle costs.
 * Server only — routes/expenses.js — so there is no mock-mode store.
 */

import { API_URL } from './mode.js'
import { del, get, post, put } from './http.js'
import { getToken } from './session.js'

/** The reference's Type list for each Category; the server checks the same lists. */
export const EXPENSE_TYPES = Object.freeze({
  Variable: ['Accidents', 'Bonuses', 'Breakdown', 'Cease', 'Fines', 'Fuel', 'Maintenance', 'Other', 'Substance', 'Tire', 'Toll Roads'],
  Fix: ['Depreciation', 'Drivers', 'Financing', 'Insurance', 'Taxes and Rates'],
})
export const EXPENSE_CATEGORIES = Object.freeze([
  { value: 'Variable', label: 'Variable', hint: 'One cost on one day: fuel, a fine, a repair.' },
  { value: 'Fix', label: 'Fix', hint: 'A cost over a period: insurance, financing, depreciation.' },
])
/** Suggestions for a Fuel expense's source; any other text is accepted. */
export const FUEL_SOURCES = ['Fuel card', 'Cash', 'Company tank', 'Credit account']
export const MAX_BILLS = 3

export const listExpenses = (query = {}) => get('/api/expenses', query)
export const addExpense = body => post('/api/expenses', body)
export const updateExpense = (id, body) => put(`/api/expenses/${id}`, body)
export const deleteExpenses = ids => del(`/api/expenses?ids=${ids.map(encodeURIComponent).join(',')}`)
export const uploadExpenseBill = (id, body) => post(`/api/expenses/${id}/bills`, body)
export const deleteExpenseBill = (id, billId) => del(`/api/expenses/${id}/bills/${billId}`)

/** Open a bill in a new tab: fetched with the login token, shown from a blob. */
export async function openExpenseBill(id, billId) {
  const res = await fetch(`${API_URL}/api/expenses/${id}/bills/${billId}/file`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error(`Could not open the bill (${res.status})`)
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The date an expense is listed under: its day, or a Fix one's start. */
export const expenseDay = e => e.expenseDate || e.fromDate || ''

/** Whole days a Fix expense covers, both ends counted. */
export function periodDays(from, to) {
  if (!from || !to) return null
  const n = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000) + 1
  return n > 0 ? n : null
}
