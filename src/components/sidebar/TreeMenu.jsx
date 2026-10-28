import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'

/**
 * The sidebar's nested-menu renderer, used by Settings and Reports.
 *
 * Lifted out of SettingsMenu unchanged when Reports needed the same tree. The
 * two differ only in their data — the nodes, the root row's label and icon, the
 * localStorage key, and which pathnames count as "inside this section" — so all
 * of that is props and none of it is duplicated markup or CSS.
 *
 * Every page mounts its own <Sidebar />, so this remounts on each navigation —
 * which is why the open branches are persisted rather than held in memory, and
 * why the ancestors of the current route are force-opened on mount. Without
 * both, clicking a leaf would collapse the tree you just clicked through.
 */

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

function loadExpanded(storageKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return new Set(Array.isArray(raw) ? raw : [])
  } catch {
    return new Set()
  }
}

// ── One node, recursively ──────────────────────────────────────────────────
// Indentation comes from the .ft-sb-tree-kids wrapper compounding per level,
// not from a depth-times-N padding, so nothing here needs to know how deep it
// is and a new level can be added to a nav config with no change in here.
function MenuNode({ node, expanded, onToggle, pathname, trail }) {
  const Icon      = node.icon
  const isBranch  = Array.isArray(node.children) && node.children.length > 0
  const isOpen    = expanded.has(node.id)
  const isActive  = node.path === pathname
  const onTrail   = isBranch && trail.includes(node.id)

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
        {/* The row clips its label, and some are long enough to clip — "GGB
            (Group Global Admin)" and "Summary Usage Report" among them. The
            tooltip is what makes the hidden half reachable without widening
            the rail for one entry. */}
        <span className="ft-sb-tree-label" title={node.label}>{node.label}</span>
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
        <span className="ft-sb-tree-label" title={node.label}>{node.label}</span>
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
              trail={trail}
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * @param {string}   rootId      id of the collapsible root row
 * @param {string}   rootLabel   its label
 * @param {Function} rootIcon    lucide icon component for it
 * @param {object[]} nodes       the tree, already filtered for this role
 * @param {string}   storageKey  localStorage key for the open branches
 * @param {string}   pathname    current route
 * @param {boolean}  inSection   is `pathname` anywhere inside this section
 * @param {string[]} trail       ancestor ids of `pathname`, root included
 */
export default function TreeMenu({
  rootId, rootLabel, rootIcon: RootIcon,
  nodes, storageKey, pathname, inSection, trail,
}) {
  const [expanded, setExpanded] = useState(() => {
    const next = loadExpanded(storageKey)
    for (const id of trail) next.add(id)
    return next
  })

  const toggle = id => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }

  const rootOpen = expanded.has(rootId)

  return (
    <>
      <style>{MENU_CSS}</style>

      <button
        type="button"
        className="ft-sb-tree-row"
        style={{ fontSize: 13, gap: 11 }}
        aria-expanded={rootOpen}
        data-trail={inSection ? 'true' : 'false'}
        onClick={() => toggle(rootId)}
      >
        <RootIcon size={16} strokeWidth={1.9} style={{ flexShrink: 0 }} />
        <span className="ft-sb-tree-label">{rootLabel}</span>
        <ChevronDown size={11} strokeWidth={3} className="ft-sb-tree-chev" />
      </button>

      {rootOpen && (
        <div className="ft-sb-tree-kids">
          {nodes.map(node => (
            <MenuNode
              key={node.id}
              node={node}
              expanded={expanded}
              onToggle={toggle}
              pathname={pathname}
              trail={trail}
            />
          ))}
        </div>
      )}
    </>
  )
}
