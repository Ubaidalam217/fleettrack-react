import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, Settings } from 'lucide-react'
// Named settingsNav, not settingsMenu: this folder is on a case-insensitive
// filesystem, and "./SettingsMenu" resolved to the config instead of the
// component when the two names differed only by case.
import { SETTINGS_MENU, SETTINGS_ROOT_ID, ancestorIds } from './settingsNav'

const EXPAND_KEY = 'ft-settings-menu'

function loadExpanded() {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPAND_KEY) || '[]')
    return new Set(Array.isArray(raw) ? raw : [])
  } catch {
    return new Set()
  }
}

// Scoped beside the markup for the same reason SIDEBAR_CSS is: the hover and
// active states are built on the --c-sb-* tokens and drift apart if they live
// somewhere else. Everything here deliberately mirrors .ft-sb-item, one step
// smaller, so a nested row reads as a child of the rail rather than a new UI.
const MENU_CSS = `
  .ft-sb-tree-row {
    display: flex; align-items: center; gap: 9px;
    width: 100%; box-sizing: border-box;
    padding: 8px 10px 8px 11px; margin: 1px 0;
    border: none; background: none; cursor: pointer;
    border-radius: 9px;
    font: inherit; font-size: 12.5px; font-weight: 550;
    color: var(--c-sb-inactive);
    text-align: left; text-decoration: none;
    transition: background .15s ease, color .15s ease;
  }
  .ft-sb-tree-row:hover {
    background: var(--c-sb-inactive-hover);
    color: var(--c-sb-inactive-hover-text);
  }
  .ft-sb-tree-row[data-active="true"] {
    background: var(--c-sb-active);
    color: var(--c-sb-active-text);
    font-weight: 700;
    box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--c-sb-active) 55%, transparent);
  }
  /* A branch holding the current page: brightened, but never the filled pill —
     that stays unique to the one row you are actually on. */
  .ft-sb-tree-row[data-trail="true"] { color: var(--c-sb-inactive-hover-text); }
  .ft-sb-tree-row:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }

  .ft-sb-tree-label {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .ft-sb-tree-chev { flex-shrink: 0; opacity: .7; transition: transform .2s ease; }
  .ft-sb-tree-row[aria-expanded="false"] .ft-sb-tree-chev { transform: rotate(-90deg); }

  /* Leaves deep enough to have no icon of their own get a bullet, so the label
     column stays aligned with its icon-bearing siblings. */
  .ft-sb-tree-dot {
    width: 4px; height: 4px; flex-shrink: 0;
    margin: 0 6px;
    border-radius: 50%;
    background: currentColor; opacity: .55;
  }

  .ft-sb-tree-kids {
    margin-left: 10px;
    padding-left: 3px;
    border-left: 1px solid var(--c-sb-divider);
  }
`

// ── One node, recursively ──────────────────────────────────────────────────
// Indentation comes from the .ft-sb-tree-kids wrapper compounding per level,
// not from a depth-times-N padding, so nothing here needs to know how deep it
// is and a new level can be added to settingsMenu.js with no change in here.
function MenuNode({ node, expanded, onToggle, pathname }) {
  const Icon      = node.icon
  const isBranch  = Array.isArray(node.children) && node.children.length > 0
  const isOpen    = expanded.has(node.id)
  const isActive  = node.path === pathname
  const onTrail   = isBranch && ancestorIds(pathname).includes(node.id)

  const glyph = Icon
    ? <Icon size={15} strokeWidth={isActive ? 2.3 : 1.9} style={{ flexShrink: 0 }} />
    : <span className="ft-sb-tree-dot" />

  if (!isBranch) {
    return (
      <Link
        to={node.path}
        className="ft-sb-tree-row"
        data-active={isActive ? 'true' : 'false'}
        aria-current={isActive ? 'page' : undefined}
      >
        {glyph}
        <span className="ft-sb-tree-label">{node.label}</span>
      </Link>
    )
  }

  return (
    <>
      <button
        type="button"
        className="ft-sb-tree-row"
        aria-expanded={isOpen}
        data-trail={onTrail ? 'true' : 'false'}
        onClick={() => onToggle(node.id)}
      >
        {glyph}
        <span className="ft-sb-tree-label">{node.label}</span>
        <ChevronDown size={11} strokeWidth={3} className="ft-sb-tree-chev" />
      </button>

      {isOpen && (
        <div className="ft-sb-tree-kids">
          {node.children.map(child => (
            <MenuNode
              key={child.id}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              pathname={pathname}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ── Settings tree ──────────────────────────────────────────────────────────
/**
 * The sidebar's Settings entry and its nested menu.
 *
 * Every page mounts its own <Sidebar />, so this remounts on each navigation —
 * which is why the open branches are persisted rather than held in memory, and
 * why the ancestors of the current route are force-opened on mount. Without
 * both, clicking Branch would collapse the tree you just clicked through.
 */
export default function SettingsMenu() {
  const location = useLocation()
  const pathname = location.pathname

  const [expanded, setExpanded] = useState(() => {
    const next = loadExpanded()
    for (const id of ancestorIds(pathname)) next.add(id)
    return next
  })

  const toggle = id => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(EXPAND_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }

  const rootOpen   = expanded.has(SETTINGS_ROOT_ID)
  // The legacy /settings page is still routed; treat it as part of the section.
  const inSettings = pathname === '/settings' || pathname.startsWith('/settings/')

  return (
    <>
      <style>{MENU_CSS}</style>

      <button
        type="button"
        className="ft-sb-tree-row"
        style={{ fontSize: 13, gap: 11 }}
        aria-expanded={rootOpen}
        data-trail={inSettings ? 'true' : 'false'}
        onClick={() => toggle(SETTINGS_ROOT_ID)}
      >
        <Settings size={16} strokeWidth={1.9} style={{ flexShrink: 0 }} />
        <span className="ft-sb-tree-label">Settings</span>
        <ChevronDown size={11} strokeWidth={3} className="ft-sb-tree-chev" />
      </button>

      {rootOpen && (
        <div className="ft-sb-tree-kids">
          {SETTINGS_MENU.map(node => (
            <MenuNode
              key={node.id}
              node={node}
              expanded={expanded}
              onToggle={toggle}
              pathname={pathname}
            />
          ))}
        </div>
      )}
    </>
  )
}
