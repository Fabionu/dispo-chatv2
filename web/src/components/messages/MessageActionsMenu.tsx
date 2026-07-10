import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MENU_CONTAINER, MENU_SEPARATOR, menuIconClass, menuItemClass } from '../menuStyles'

export type MessageAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'alert'
  // Small leading Lucide icon. Inherits the item's text colour (muted by
  // default, brightening with the label on hover).
  icon?: ReactNode
  // Render a faint divider above this item — used to set the destructive
  // (delete) actions apart from the rest.
  separator?: boolean
}

type Props = {
  // Either anchor the menu to the chevron trigger (left-aligned under it) …
  anchorEl?: HTMLElement | null
  // … or open it at a cursor point (right-click). Exactly one is provided.
  anchorPoint?: { x: number; y: number }
  actions: MessageAction[]
  onClose: () => void
}

// Floating dropdown for a message's actions. Rendered through a portal so it can
// sit above scroll containers and use `fixed` coords for viewport-aware
// placement (flips above when there's no room below). Opens either anchored to
// the bubble's chevron trigger, or at the cursor for a right-click — both are
// clamped inside the chat pane (never under the sidebar) and the viewport.
export default function MessageActionsMenu({ anchorEl, anchorPoint, actions, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  // Start invisible: we don't know the menu's height until it renders once,
  // and we don't want a frame at (0, 0) before that.
  const [pos, setPos] = useState<{ top: number; left: number; visible: boolean }>({
    top: 0,
    left: 0,
    visible: false,
  })

  useLayoutEffect(() => {
    const m = menuRef.current
    if (!m) return
    const mRect = m.getBoundingClientRect()

    // Never extend left of the chat pane (i.e. under the sidebar).
    const sidebarW =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 0
    const minLeft = Math.max(8, sidebarW + 8)

    let left: number
    let top: number
    if (anchorPoint) {
      // Open at the cursor, opening downward then flipping up if needed.
      left = anchorPoint.x
      top = anchorPoint.y + 4
      if (top + mRect.height > window.innerHeight - 8) top = anchorPoint.y - mRect.height - 4
    } else if (anchorEl) {
      const a = anchorEl.getBoundingClientRect()
      // Anchor the menu's top-left corner under the chevron: align its left edge
      // with the chevron's left edge so it opens to the RIGHT. If that would run
      // off the right edge (e.g. the image/attachment chevron sits at the
      // bubble's right edge), flip to right-aligned — anchor the menu's right
      // edge to the chevron so it opens LEFT and stays adjacent to the trigger
      // instead of being clamped to the far corner.
      left = a.left
      if (left + mRect.width > window.innerWidth - 8) left = a.right - mRect.width
      top = a.bottom + 4
      if (top + mRect.height > window.innerHeight - 8) top = a.top - mRect.height - 4
    } else {
      return
    }

    if (left + mRect.width > window.innerWidth - 8) left = window.innerWidth - mRect.width - 8
    if (left < minLeft) left = minLeft
    if (top < 8) top = 8
    setPos({ top, left, visible: true })
  }, [anchorEl, anchorPoint?.x, anchorPoint?.y])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if (anchorEl?.contains(t)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorEl, onClose])

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 60,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
      className={`min-w-[9.5rem] ${MENU_CONTAINER}`}
    >
      {actions.map((a, i) => {
        const tone = a.tone === 'alert' ? 'danger' : 'default'
        return (
          <div key={i}>
            {a.separator && <div className={MENU_SEPARATOR} />}
            <button
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                if (a.disabled) return
                a.onClick()
                onClose()
              }}
              className={menuItemClass(tone)}
            >
              {a.icon && <span className={`inline-flex ${menuIconClass(tone)}`}>{a.icon}</span>}
              <span className="flex-1 text-left">{a.label}</span>
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
