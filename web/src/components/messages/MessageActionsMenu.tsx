import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MessageAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'alert'
}

type Props = {
  anchorEl: HTMLElement
  actions: MessageAction[]
  onClose: () => void
}

// Floating dropdown anchored to a bubble's chevron trigger. Rendered through
// a portal so it can sit above scroll containers and use `fixed` coords for
// viewport-aware placement (flips above when there's no room below).
export default function MessageActionsMenu({ anchorEl, actions, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  // Start invisible: we don't know the menu's height until it renders once,
  // and we don't want a frame at (0, 0) before that.
  const [pos, setPos] = useState<{ top: number; left: number; visible: boolean }>({
    top: 0,
    left: 0,
    visible: false,
  })

  useLayoutEffect(() => {
    const a = anchorEl.getBoundingClientRect()
    const m = menuRef.current
    if (!m) return
    const mRect = m.getBoundingClientRect()
    // Right-align with the trigger; flip up if we'd overflow the viewport.
    let left = a.right - mRect.width
    let top = a.bottom + 4
    if (top + mRect.height > window.innerHeight - 8) {
      top = a.top - mRect.height - 4
    }
    if (left < 8) left = 8
    if (left + mRect.width > window.innerWidth - 8) {
      left = window.innerWidth - mRect.width - 8
    }
    setPos({ top, left, visible: true })
  }, [anchorEl])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if (anchorEl.contains(t)) return
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
      className="min-w-[200px] rounded-card border border-white/[0.08] bg-surface overflow-hidden py-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
    >
      {actions.map((a, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={a.disabled}
          onClick={() => {
            if (a.disabled) return
            a.onClick()
            onClose()
          }}
          className={`w-full text-left px-3 py-2 text-[12.5px] transition-colors disabled:opacity-30 disabled:cursor-default ${
            a.tone === 'alert'
              ? 'text-alert hover:bg-alert/10'
              : 'text-text hover:bg-white/[0.04]'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
