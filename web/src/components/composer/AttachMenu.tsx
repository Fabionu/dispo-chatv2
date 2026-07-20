import { useEffect, useRef, useState } from 'react'
import { FileText, Image as ImageIcon, Plus, Route } from 'lucide-react'
import { DOC_ACCEPT, IMAGE_ACCEPT } from '../attachments/attachmentUtils'
import { MENU_CONTAINER, MENU_GLYPH, menuIconClass, menuItemClass } from '../menuStyles'

type Props = {
  disabled?: boolean
  // Called when the user picks a file category. The parent owns the hidden file
  // input and sets its `accept` attribute before triggering `.click()`.
  onPickKind: (accept: string) => void
  // When provided, an "Add trip" item is shown. Scoped vehicle rooms open the
  // editor directly; other conversations let the parent choose a vehicle room.
  onAddTrip?: () => void
}

// The composer "add" trigger (a Plus button) + popover. Lets the user choose
// what to add: a photo/document (which picks the OS file filter the parent then
// opens) or a trip. Manages its own open state plus
// outside-click / Esc dismissal so the parent stays simple.
export default function AttachMenu({ disabled, onPickKind, onAddTrip }: Props) {
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

  function addTrip() {
    setOpen(false)
    onAddTrip?.()
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="Add"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`h-[var(--composer-size)] w-[var(--composer-size)] flex items-center justify-center rounded-full border transition-colors disabled:opacity-30 disabled:cursor-default ${
          open
            ? 'text-text bg-white/[0.09] border-white/[0.10]'
            : 'text-muted bg-white/[0.04] border-white/[0.05] hover:text-text hover:bg-white/[0.07] hover:border-white/[0.09]'
        }`}
      >
        <Plus size="1.125rem" strokeWidth={1.8} />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute bottom-[calc(100%+6px)] left-0 w-[11.25rem] ${MENU_CONTAINER} z-20`}
        >
          <AttachMenuItem
            icon={<ImageIcon {...MENU_GLYPH} />}
            onClick={() => pick(IMAGE_ACCEPT)}
          >
            Photo
          </AttachMenuItem>
          <AttachMenuItem
            icon={<FileText {...MENU_GLYPH} />}
            onClick={() => pick(DOC_ACCEPT)}
          >
            Document
          </AttachMenuItem>
          {onAddTrip && (
            <AttachMenuItem icon={<Route {...MENU_GLYPH} />} onClick={addTrip}>
              Add trip
            </AttachMenuItem>
          )}
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
    <button type="button" onClick={onClick} role="menuitem" className={menuItemClass()}>
      <span className={menuIconClass()}>{icon}</span>
      {children}
    </button>
  )
}
