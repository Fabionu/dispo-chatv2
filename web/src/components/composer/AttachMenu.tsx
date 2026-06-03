import { useEffect, useRef, useState } from 'react'
import { FileText, Image as ImageIcon, Paperclip } from 'lucide-react'
import { DOC_ACCEPT, IMAGE_ACCEPT } from '../attachments/attachmentUtils'

type Props = {
  disabled?: boolean
  // Called when the user picks a category. The parent owns the hidden file
  // input and sets its `accept` attribute before triggering `.click()`.
  onPickKind: (accept: string) => void
}

// The paperclip trigger + popover that lets the user choose what kind of
// file the OS picker should filter to. Manages its own open state plus
// outside-click / Esc dismissal so the parent stays simple.
export default function AttachMenu({ disabled, onPickKind }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current && !ref.current.contains(t)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(accept: string) {
    setOpen(false)
    onPickKind(accept)
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="Attach"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`h-[var(--composer-size)] w-[var(--composer-size)] flex items-center justify-center rounded-full transition-colors disabled:opacity-30 disabled:cursor-default ${
          open
            ? 'text-text bg-white/[0.06]'
            : 'text-muted hover:text-text hover:bg-white/[0.04]'
        }`}
      >
        <Paperclip size={16} strokeWidth={1.8} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+6px)] left-0 w-[180px] rounded-card border border-white/[0.08] bg-surface overflow-hidden z-20 py-1"
        >
          <AttachMenuItem
            icon={<ImageIcon size={14} strokeWidth={1.6} />}
            onClick={() => pick(IMAGE_ACCEPT)}
          >
            Photos
          </AttachMenuItem>
          <AttachMenuItem
            icon={<FileText size={14} strokeWidth={1.6} />}
            onClick={() => pick(DOC_ACCEPT)}
          >
            Documents
          </AttachMenuItem>
        </div>
      )}
    </div>
  )
}

function AttachMenuItem({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] hover:bg-white/[0.03] transition-colors text-left"
    >
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  )
}
