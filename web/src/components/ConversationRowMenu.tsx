import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

// One entry in a conversation row's hover-actions menu.
export type RowMenuAction = {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  // Destructive styling (alert colour).
  danger?: boolean
  // When set, the FIRST click swaps this item to a confirm state (this label +
  // danger styling) and a second click runs onSelect — an inline confirmation
  // for destructive actions, no separate modal. Reset when the menu closes.
  confirmLabel?: string
}

// Compact "more actions" menu for a sidebar conversation row. The ⋮ trigger is
// meant to live in an on-hover overlay on the row's right edge; the menu itself
// is a FIXED-position popover anchored to the trigger, so it never clips inside
// the sidebar's scroll container and never disturbs the row's own layout. Closes
// on outside click, Escape, or scroll. Matches the app's other dark menus.
export default function ConversationRowMenu({
  actions,
  ariaLabel,
}: {
  actions: RowMenuAction[]
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const MENU_W = 188

  // Position the fixed popover from the trigger's viewport rect: right-aligned to
  // the trigger, opening downward, flipping above when there isn't room below.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8))
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < 260) setPos({ left, bottom: window.innerHeight - r.top + 6 })
    else setPos({ left, top: r.bottom + 6 })
  }, [open])

  useEffect(() => {
    if (!open) {
      setConfirmKey(null)
      return
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    // A fixed popover would detach from its row on scroll, so close instead.
    function onScroll() {
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  function select(a: RowMenuAction) {
    // Two-step inline confirm for destructive actions.
    if (a.confirmLabel && confirmKey !== a.key) {
      setConfirmKey(a.key)
      return
    }
    setOpen(false)
    a.onSelect()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          // Never let the click fall through to the row (which opens the chat).
          e.stopPropagation()
          e.preventDefault()
          setOpen((v) => !v)
        }}
        className={`h-8 w-8 flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
          open ? 'bg-white/[0.08] text-text' : 'text-muted hover:text-text hover:bg-white/[0.06]'
        }`}
      >
        <MoreHorizontal size={16} strokeWidth={1.8} />
      </button>

      {open &&
        pos &&
        // Portal to <body> so the fixed popover is never affected by an ancestor's
        // opacity (the row's hover overlay) or clipped by the sidebar's overflow.
        createPortal(
        <div
          ref={menuRef}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_W }}
          className="z-50 rounded-card border border-white/[0.1] bg-surface overflow-hidden py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
        >
          {actions.map((a) => {
            const confirming = confirmKey === a.key
            const danger = a.danger || confirming
            return (
              <button
                key={a.key}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  select(a)
                }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[12px] text-left whitespace-nowrap transition-colors ${
                  danger ? 'text-alert hover:bg-alert/10' : 'text-text hover:bg-white/[0.04]'
                }`}
              >
                {a.icon && (
                  <span className={`shrink-0 ${danger ? 'text-alert' : 'text-muted'}`}>{a.icon}</span>
                )}
                <span className="flex-1">{confirming ? a.confirmLabel : a.label}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
