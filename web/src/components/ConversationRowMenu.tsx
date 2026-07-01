import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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

// Imperative handle so a row can open the SAME menu from a right-click, anchored
// at the cursor instead of the ⋮ trigger.
export type ConversationRowMenuHandle = {
  openAt: (x: number, y: number) => void
}

// Compact "more actions" menu for a sidebar conversation row. The ⋮ trigger is
// meant to live in an on-hover overlay on the row's right edge; the menu itself
// is a FIXED-position popover anchored to the trigger (or to the cursor when
// opened via right-click), so it never clips inside the sidebar's scroll
// container and never disturbs the row's own layout. Closes on outside click,
// Escape, or scroll. Matches the app's other dark menus.
const ConversationRowMenu = forwardRef<
  ConversationRowMenuHandle,
  {
    actions: RowMenuAction[]
    ariaLabel: string
    // Notifies the parent row when the menu opens/closes so it can keep its
    // "actions active" state (button visible, metadata hidden) while open, even
    // after the cursor leaves the row.
    onOpenChange?: (open: boolean) => void
  }
>(function ConversationRowMenu({ actions, ariaLabel, onOpenChange }, ref) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left?: number; right?: number; top?: number; bottom?: number } | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  // Cursor anchor when opened via right-click; null means anchor to the trigger.
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // The menu sizes to its content (w-max); this is only the upper bound used for
  // off-screen clamping so a cursor-opened menu never overflows the right edge.
  const MENU_MAX = 220

  // Open at a cursor position (right-click on the row).
  useImperativeHandle(
    ref,
    () => ({
      openAt: (x: number, y: number) => {
        setContextPoint({ x, y })
        setOpen(true)
      },
    }),
    [],
  )

  // Mirror open state up to the row so it can hold its hover/active treatment.
  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  // Position the fixed popover, opening downward and flipping above when there
  // isn't room below. Anchored at the cursor when opened via right-click,
  // otherwise right-aligned to the ⋮ trigger's viewport rect.
  useLayoutEffect(() => {
    if (!open) return
    if (contextPoint) {
      const left = Math.max(8, Math.min(contextPoint.x, window.innerWidth - MENU_MAX - 8))
      const spaceBelow = window.innerHeight - contextPoint.y
      if (spaceBelow < 260) setPos({ left, bottom: window.innerHeight - contextPoint.y + 4 })
      else setPos({ left, top: contextPoint.y + 4 })
      return
    }
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    // Right-align the menu's right edge to the trigger so its (content-driven)
    // width can vary without leaving the alignment off.
    const right = Math.max(8, window.innerWidth - r.right)
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < 260) setPos({ right, bottom: window.innerHeight - r.top + 6 })
    else setPos({ right, top: r.bottom + 6 })
  }, [open, contextPoint])

  useEffect(() => {
    if (!open) {
      setConfirmKey(null)
      // Reset the cursor anchor so the next ⋮-click positions from the trigger.
      setContextPoint(null)
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
          style={{
            position: 'fixed',
            left: pos.left,
            right: pos.right,
            top: pos.top,
            bottom: pos.bottom,
            maxWidth: MENU_MAX,
          }}
          className="z-50 w-max rounded-card border border-white/[0.1] bg-surface overflow-hidden py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
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
})

export default ConversationRowMenu
