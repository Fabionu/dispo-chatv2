import { useEffect, type ReactNode } from 'react'
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
export default function Modal({ title, subtitle, onClose, children, footer }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-[26.25rem] rounded-modal border border-white/[0.08] bg-surface"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.65)' }}
      >
        <header className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-semibold tracking-[-0.2px]">{title}</h2>
            {subtitle && <p className="text-[0.75rem] text-muted mt-0.5">{subtitle}</p>}
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
          <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
