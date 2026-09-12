import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from './HeaderIconButton'

type Props = {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

// Shared modal shell. The overlay carries the one shadow the design system
// permits (0 32px 80px rgba(0,0,0,0.65)). Esc and backdrop click both close.
//
// PORTALLED to document.body, like every viewport overlay in the app
// (ImageLightbox, AvatarCropModal, ModalLoader). `position: fixed` is only
// viewport-relative when no ancestor has a transform, filter or containment —
// and the sidebar shell has `transform: translateX(0)` for its collapse slide,
// which makes it the containing block for anything fixed inside it. A dialog
// opened from a sidebar panel (Profile → change photo, a confirm) was therefore
// centred in the 393px rail instead of the page (user, 2026-09-12). Rendering
// into body makes "where the overlay was opened from" irrelevant.
export default function Modal({ title, subtitle, onClose, children, footer }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // `panel` — the one base tone every modal and workspace panel shares.
        // The dialog is told apart from what it covers by its edge, its shadow
        // and the dimmed backdrop, never by a different fill.
        className="relative w-full max-w-[26.25rem] rounded-modal border border-line bg-panel"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.65)' }}
      >
        <header className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-[-0.2px]">{title}</h2>
            {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            // Circular icon button like the rest of the app. Negative vertical
            // margins let the 36px control sit inside the header's existing
            // padding so it never grows the header — including title-only dialogs
            // (e.g. ConfirmDialog) where the button is taller than the title line.
            className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0 -my-2 -mr-1.5`}
          >
            <X size="1.125rem" strokeWidth={1.8} />
          </button>
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <div className="px-5 py-3 border-t border-line flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
