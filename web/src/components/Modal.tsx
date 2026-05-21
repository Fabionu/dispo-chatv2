import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

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
        className="relative w-full max-w-[420px] rounded-modal border border-white/[0.08] bg-surface"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.65)' }}
      >
        <header className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-[-0.2px]">{title}</h2>
            {subtitle && <p className="text-[12px] text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-text transition-colors -mr-1 mt-0.5"
          >
            <X size={16} strokeWidth={1.8} />
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
