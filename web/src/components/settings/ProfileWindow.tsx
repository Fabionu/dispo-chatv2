import { useEffect, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import ProfileSidebarPanel from './ProfileSidebarPanel'

type Props = Omit<ComponentProps<typeof ProfileSidebarPanel>, 'onBack' | 'backLabel' | 'inWindow'> & {
  onClose: () => void
}

// My profile in a window of its own (user, 2026-10-29 canvas: "open in a new
// window and not as a modal in the sidebar"). Opened from the account window;
// the sidebar keeps the conversation list underneath.
//
// Portalled to body for the same reason as Modal: the sidebar shell's
// transform would otherwise become the containing block for `fixed`.
// Escape closes it unless something inside (the photo crop dialog, a menu)
// already handled the key.
export default function ProfileWindow({ onClose, ...panel }: Props) {
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
        aria-label="My profile"
        className="panel-fade-in relative flex h-[min(46rem,calc(100vh-6rem))] w-full max-w-[40rem] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay"
      >
        <ProfileSidebarPanel {...panel} inWindow onBack={onClose} backLabel="Close" />
      </div>
    </div>,
    document.body,
  )
}
