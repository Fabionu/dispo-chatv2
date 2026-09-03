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
        // Undrawn: no box of its own. It used to carry a hairline, which put a
        // second rectangle inside the composer's own rectangle for a control
        // that is already unmistakably a `+`. The hover wash is the affordance,
        // exactly as it is for the schedule button beside it.
        className={`rounded-btn h-[var(--composer-size)] w-[var(--composer-size)] flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-default ${
          open ? 'text-text bg-white/10' : 'text-muted hover:text-text hover:bg-white/6'
        }`}
      >
        {/* The glyph ROTATES 45° into a close mark while the menu is open
            (user, 2026-09-03: "an animation when you action the button"). It is
            the one piece of feedback that says the same control closes what it
            opened, and it costs no second icon — a `+` turned an eighth of a
            turn IS an `×`. Same idiom as the rail's collapse button, which
            cross-fades its two chevrons through a rotate.
            `motion-reduce` drops it to a straight state swap, matching the
            reduced-motion handling everywhere else in the app. */}
        <Plus
          size="1.125rem"
          strokeWidth={1.8}
          className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${
            open ? 'rotate-45' : 'rotate-0'
          }`}
        />
      </button>
      {open && (
        <div
          role="menu"
          // Materialises UP out of the + it belongs to (user: "an animation when
          // the list appears?"). `action-strip-enter-up` is the app's existing
          // recipe for a popover that has to open above its trigger — 170ms,
          // four pixels of lift and a hair of scale — reused rather than
          // reinvented so this menu and the message action strip move
          // identically. `origin-bottom-left` anchors the scale to the corner
          // nearest the button, so it grows out of the control instead of out of
          // its own middle. Reduced motion is already handled by the class.
          className={`action-strip-enter-up origin-bottom-left absolute bottom-[calc(100%+6px)] left-0 w-[11.25rem] ${MENU_CONTAINER} z-20`}
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
