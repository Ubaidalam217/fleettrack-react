import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Which columns a report shows — the client (2026-11-06): "we can select the
 * column to generate the report", on every report.
 *
 * Each report keeps the keys of the columns the user switched off, per browser,
 * so a report opens the way it was last used. The choice applies to the
 * on-screen table and to the PDF, Excel and Print of that report alike.
 */

const STORE = 'fm.reportColumns.'

function read(reportId, defaults = []) {
  try {
    const raw = window.localStorage.getItem(STORE + reportId)
    // Never set: the report's own default (an optional column starts hidden).
    if (raw === null) return new Set(defaults)
    const keys = JSON.parse(raw)
    return new Set(Array.isArray(keys) ? keys.filter(k => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

function write(reportId, hidden, defaults = []) {
  try {
    // With defaults, "everything shown" must be stored too, or the default comes back.
    if (hidden.size || defaults.length) window.localStorage.setItem(STORE + reportId, JSON.stringify([...hidden]))
    else window.localStorage.removeItem(STORE + reportId)
  } catch {
    // Storage blocked (private window): the choice still holds for this visit.
  }
}

const NONE = []

/**
 * The hidden column keys of one report. `defaultHidden`: keys hidden until the
 * user first changes the columns (an optional column, e.g. Trip Summary's Excess Idle).
 * @returns {[Set<string>, (next: Set<string>) => void]}
 */
export function useHiddenColumns(reportId, defaultHidden = NONE) {
  const [state, setState] = useState(() => ({ reportId, hidden: read(reportId, defaultHidden) }))
  // One page serves several reports (the Usage variants): follow the id.
  useEffect(() => {
    if (state.reportId !== reportId) setState({ reportId, hidden: read(reportId, defaultHidden) })
  }, [reportId, state.reportId, defaultHidden])
  const hidden = state.reportId === reportId ? state.hidden : read(reportId, defaultHidden)
  const setHidden = useCallback(next => {
    write(reportId, next, defaultHidden)
    setState({ reportId, hidden: next })
  }, [reportId, defaultHidden])
  return [hidden, setHidden]
}

/** The columns still shown. Never empty while `columns` is not. */
export function visibleColumns(columns, hidden) {
  if (!hidden?.size) return columns
  const shown = columns.filter(c => !hidden.has(c.key))
  return shown.length ? shown : columns
}

/** `visibleColumns` for a page that lists the same columns on every render. */
export function useVisibleColumns(columns, hidden) {
  return useMemo(() => visibleColumns(columns, hidden), [columns, hidden])
}

/**
 * Every distinct column (by key) across several tables, in first-seen order —
 * for a report made of more than one table (an overview and its detail).
 */
export function columnChoices(...lists) {
  const seen = new Map()
  for (const list of lists) {
    for (const c of list ?? []) if (!seen.has(c.key)) seen.set(c.key, { key: c.key, label: c.label })
  }
  return [...seen.values()]
}
