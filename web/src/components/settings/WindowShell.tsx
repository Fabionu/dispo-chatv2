import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from '../HeaderIconButton'

type Props = {
  title: string
  onClose: () => void
  /** `wide` for a two-pane window (Workspace settings). */
  size?: 'narrow' | 'wide'
  children: ReactNode
}

// The one frame every account window shares — My profile, Company, Members and
// Workspace settings (user, 2026-10-30 canvas: each opens "in a new window and
// not as a modal in the sidebar"). A centred sheet over a dimmed workspace:
// title and close on top, the content below fills and scrolls itself.
//
// Portalled to body for the same reason as Modal: the sidebar shell's transform
// would otherwise become the containing block for `fixed`. Escape closes it
// unless something inside (a menu, the photo crop dialog) already took the key.
export default function WindowShell({ title, onClose, size = 'narrow', children }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`panel-fade-in relative flex h-[min(46rem,calc(100vh-6rem))] w-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay ${
          size === 'wide' ? 'max-w-[55rem]' : 'max-w-[40rem]'
        }`}
      >
        <div className="flex h-[var(--tool-header-height)] shrink-0 items-center gap-1 pl-4 pr-2.5">
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
          >
            <X size="1.125rem" strokeWidth={1.8} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
