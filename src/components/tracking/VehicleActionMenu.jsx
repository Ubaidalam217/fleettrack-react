import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// The 3-dot action menu on each vehicle row, modelled on the Ctrack reference.
//
// Portalled to <body> rather than rendered inline. The list panel clips its
// children twice over — .track-panel-inner is overflow:hidden and the scroller
// inside it is overflow-y:auto — so an absolutely positioned popover would be
// cut off at the 320px panel edge, which is exactly where this menu is supposed
// to open. Portalling also keeps it clear of the row's own click handler, which
// toggles the accordion.

const MENU_WIDTH = 216
const GAP        = 6      // between the trigger and the menu
const MARGIN     = 8      // minimum breathing room against the viewport edge

/**
 * Place the menu to the right of the trigger, falling back to below it.
 *
 * Right is the preferred side because the list lives against the left edge of
 * the window, so there is normally a whole map's worth of room there. The
 * fallback matters on narrow/mobile viewports where the list spans most of the
 * screen and nothing fits beside it.
 */
function computePosition(rect, menuH) {
  const vw = window.innerWidth
  const vh = window.innerHeight

  const fitsRight = rect.right + GAP + MENU_WIDTH + MARGIN <= vw
  const left = fitsRight
    ? rect.right + GAP
    // Below: right-align to the trigger, then clamp so it cannot run off-screen.
    : Math.min(Math.max(MARGIN, rect.right - MENU_WIDTH), vw - MENU_WIDTH - MARGIN)

  const preferredTop = fitsRight ? rect.top : rect.bottom + GAP
  // Flip above the trigger when the menu would overflow the bottom, then clamp
  // so a menu taller than the viewport still starts on-screen.
  const top = preferredTop + menuH + MARGIN > vh
    ? Math.max(MARGIN, (fitsRight ? rect.bottom : rect.top) - menuH - (fitsRight ? 0 : GAP))
    : preferredTop

  return { top, left }
}

export default function VehicleActionMenu({ items, label = 'Vehicle actions' }) {
  const [open, setOpen]   = useState(false)
  const [pos, setPos]     = useState(null)
  const [active, setActive] = useState(-1)

  const btnRef  = useRef(null)
  const menuRef = useRef(null)
  const itemRefs = useRef([])

  // Separators carry no behaviour; the keyboard walker has to skip them.
  const enabledIdx = items
    .map((it, i) => (it.type === 'separator' || it.disabled ? -1 : i))
    .filter(i => i !== -1)

  const close = useCallback(({ restoreFocus = true } = {}) => {
    setOpen(false)
    setActive(-1)
    if (restoreFocus) btnRef.current?.focus()
  }, [])

  const reposition = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const menuH = menuRef.current?.offsetHeight ?? 0
    setPos(computePosition(btn.getBoundingClientRect(), menuH))
  }, [])

  // Measure after paint so the real menu height drives the flip decision —
  // guessing from item count breaks as soon as an item wraps to two lines.
  useLayoutEffect(() => {
    if (!open) return
    reposition()
  }, [open, reposition])

  // Keep the menu pinned to its row while the list scrolls underneath it.
  // `true` for capture, because the scroll happens on an ancestor container and
  // scroll events do not bubble.
  useEffect(() => {
    if (!open) return
    const onScroll = () => reposition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, reposition])

  // Outside click / Escape. Pointerdown rather than click so the menu closes
  // before the underlying row can act on the same gesture.
  useEffect(() => {
    if (!open) return

    const onPointerDown = e => {
      if (menuRef.current?.contains(e.target)) return
      if (btnRef.current?.contains(e.target)) return
      close({ restoreFocus: false })
    }
    const onKeyDown = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, close])

  // Move real DOM focus with the active index so screen readers follow along.
  useEffect(() => {
    if (open && active >= 0) itemRefs.current[active]?.focus()
  }, [open, active])

  const step = dir => {
    if (enabledIdx.length === 0) return
    const at   = enabledIdx.indexOf(active)
    const next = at === -1
      ? (dir > 0 ? enabledIdx[0] : enabledIdx[enabledIdx.length - 1])
      : enabledIdx[(at + dir + enabledIdx.length) % enabledIdx.length]
    setActive(next)
  }

  const openWith = (index) => {
    setOpen(true)
    setActive(index)
  }

  const onTriggerKeyDown = e => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openWith(enabledIdx[0] ?? -1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openWith(enabledIdx[enabledIdx.length - 1] ?? -1)
    }
  }

  const onMenuKeyDown = e => {
    if (e.key === 'ArrowDown')      { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); step(-1) }
    else if (e.key === 'Home')      { e.preventDefault(); setActive(enabledIdx[0]) }
    else if (e.key === 'End')       { e.preventDefault(); setActive(enabledIdx[enabledIdx.length - 1]) }
    // Tabbing away is a deliberate exit; let focus go where the user sent it.
    else if (e.key === 'Tab')       { close({ restoreFocus: false }) }
  }

  const run = item => {
    close()
    item.onSelect?.()
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={e => {
          // The row underneath toggles the accordion on click.
          e.stopPropagation()
          if (open) close()
          else openWith(-1)
        }}
        onKeyDown={e => { e.stopPropagation(); onTriggerKeyDown(e) }}
        style={{
          flexShrink: 0,
          width: 24, height: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 6,
          border: '1px solid transparent',
          background: open ? 'var(--c-border2)' : 'transparent',
          color: open ? 'var(--c-text1)' : 'var(--c-text3)',
          cursor: 'pointer',
          transition: 'background 0.12s, color 0.12s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--c-border2)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5"  r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>

      {open && createPortal(
        <>
          <style>{`
            @keyframes ft-menu-in {
              from { opacity: 0; transform: scale(0.96) translateY(-4px); }
              to   { opacity: 1; transform: scale(1)    translateY(0); }
            }
            .ft-menu { animation: ft-menu-in 0.13s ease-out both; transform-origin: top left; }
            .ft-menu-item:hover:not(:disabled) { background: var(--c-hover) !important; }
            .ft-menu-item:focus-visible {
              outline: 2px solid var(--ft-accent);
              outline-offset: -2px;
            }
          `}</style>

          <div
            ref={menuRef}
            className="ft-menu"
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width: MENU_WIDTH,
              zIndex: 9500,
              padding: 5,
              borderRadius: 11,
              border: '1px solid var(--c-border)',
              background: 'var(--c-card)',
              boxShadow: '0 12px 34px rgba(0,0,0,0.26)',
              // Until the first measurement lands the menu is parked off-screen;
              // revealing it only once positioned avoids a visible jump.
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {items.map((item, i) => {
              if (item.type === 'separator') {
                return (
                  <div
                    key={`sep-${i}`}
                    role="separator"
                    style={{ height: 1, background: 'var(--c-border2)', margin: '4px 6px' }}
                  />
                )
              }

              const on = !!item.active
              return (
                <button
                  key={item.key ?? i}
                  ref={el => { itemRefs.current[i] = el }}
                  type="button"
                  // Toggles announce their state through aria-checked; the
                  // ON/OFF pill is decorative reinforcement for sighted users.
                  role={item.toggle ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={item.toggle ? on : undefined}
                  className="ft-menu-item"
                  disabled={item.disabled}
                  // Only the active item is tabbable, so Tab leaves the menu
                  // instead of walking through every entry.
                  tabIndex={active === i ? 0 : -1}
                  onMouseEnter={() => !item.disabled && setActive(i)}
                  onClick={e => { e.stopPropagation(); run(item) }}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '8px 9px',
                    borderRadius: 7,
                    border: 'none',
                    background: 'transparent',
                    color: item.disabled
                      ? 'var(--c-text3)'
                      : on ? 'var(--ft-accent)' : 'var(--c-text1)',
                    fontSize: 12.5,
                    fontWeight: on ? 750 : 600,
                    textAlign: 'left',
                    cursor: item.disabled ? 'default' : 'pointer',
                    opacity: item.disabled ? 0.45 : 1,
                  }}
                >
                  <span style={{ display: 'flex', flexShrink: 0, width: 15 }}>{item.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>

                  {item.toggle && (
                    <span
                      aria-hidden="true"
                      style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
                        padding: '2px 5px', borderRadius: 4,
                        background: on ? 'color-mix(in srgb, var(--ft-accent) 14%, transparent)' : 'var(--c-border2)',
                        color: on ? 'var(--ft-accent)' : 'var(--c-text3)',
                      }}
                    >
                      {on ? 'ON' : 'OFF'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>,
        document.body
      )}
    </>
  )
}
