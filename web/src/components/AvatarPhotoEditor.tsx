import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pencil, Trash2, Upload } from 'lucide-react'
import ImageLightbox from './ImageLightbox'
import { MENU_CONTAINER, MENU_GLYPH, menuIconClass, menuItemClass } from './menuStyles'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

type Options = {
  /** Whether an image is currently set (gates viewing + "Remove"). */
  hasImage: boolean
  /** Whether the viewer may change/remove the photo (e.g. group managers only).
   *  Viewing an existing photo does NOT require this. */
  canEdit: boolean
  /** Noun used in tooltips / aria, e.g. "vehicle photo" or "logo". */
  noun: string
  /** Full-size image URL for the in-app preview. When present and hasImage,
   *  the hero becomes a "View photo" action. */
  viewSrc?: string
  /** Title shown in the preview header (defaults to the noun). */
  viewTitle?: string
  accept?: string
  maxBytes?: number
  /** A validated image File, ready for the crop/upload step. */
  onFile: (file: File) => void
  /** "Remove" chosen from the menu. */
  onRemove: () => void
  /** Validation message (wrong type / too large) to surface in the panel. */
  onError?: (msg: string) => void
}

export type PhotoEditor = {
  /** Render once, anywhere in the panel: the hidden file input + the lightbox. */
  chrome: ReactNode
  /** The pinned Options control for ProfileHero's `overlay`; null for viewers. */
  optionsButton: ReactNode
  /** For ProfileHero's `onPhotoClick`; undefined when there is nothing to view. */
  openPreview?: () => void
}

// Photo viewing + management for a profile hero (profileChrome.ProfileHero).
//
// This used to be a component that WRAPPED a 168px avatar disc: hover revealed
// an eye over the picture, and a three-dots button hid in its corner until
// hovered. The hero is a full-bleed banner now (2026-09-14, the phone's
// design), so the two affordances moved with it: viewing is the whole banner
// (ProfileHero renders the click target itself) and management is a pencil
// pinned to the banner's bottom-right — always visible, as on the phone, since
// hover-reveal is undiscoverable on touch and invisible on a photo that is
// already dark. The menu (Change / Remove) opens UPWARD, over the picture,
// because the banner clips its overflow and the page content sits below.
//
// A hook rather than a component because the hero needs the two pieces in two
// different slots, on opposite sides of the text block, and the file input and
// the lightbox belong to neither.
export function usePhotoEditor({
  hasImage,
  canEdit,
  noun,
  viewSrc,
  viewTitle,
  accept = 'image/png,image/jpeg,image/webp,image/gif',
  maxBytes = DEFAULT_MAX_BYTES,
  onFile,
  onRemove,
  onError,
}: Options): PhotoEditor {
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return onError?.('Please choose an image file.')
    if (file.size > maxBytes) return onError?.('Image too large (max 10MB).')
    onFile(file)
  }

  const canView = hasImage && Boolean(viewSrc)

  const chrome = (
    <>
      {canEdit && (
        <input ref={inputRef} type="file" accept={accept} onChange={onChange} className="hidden" />
      )}
      {previewOpen && viewSrc && (
        <ImageLightbox src={viewSrc} title={viewTitle ?? noun} onClose={() => setPreviewOpen(false)} />
      )}
    </>
  )

  // The pencil: the phone's control, in the app's scrim-button dress (black
  // wash, hairline, white glyph) so it reads on any photo. `text-pure-white`
  // rather than the theme ink — it sits on a picture, not on the field.
  const optionsButton = canEdit ? (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={`${noun} options`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`Change ${noun}`}
        className={`h-10 w-10 flex items-center justify-center rounded-full border border-pure-white/15 bg-black/45 text-pure-white backdrop-blur-[2px] transition-colors hover:bg-black/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-active/60 ${
          menuOpen ? 'bg-black/65' : ''
        }`}
      >
        <Pencil size="1.0625rem" strokeWidth={1.7} />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className={`absolute right-0 bottom-[calc(100%+6px)] z-20 min-w-[9.375rem] ${MENU_CONTAINER}`}
        >
          <MenuItem
            onClick={() => {
              setMenuOpen(false)
              inputRef.current?.click()
            }}
          >
            <span className={menuIconClass()}>
              <Upload {...MENU_GLYPH} />
            </span>
            Change
          </MenuItem>
          <MenuItem
            tone="danger"
            disabled={!hasImage}
            onClick={() => {
              setMenuOpen(false)
              onRemove()
            }}
          >
            <span className={menuIconClass('danger')}>
              <Trash2 {...MENU_GLYPH} />
            </span>
            Remove
          </MenuItem>
        </div>
      )}
    </div>
  ) : null

  return {
    chrome,
    optionsButton,
    openPreview: canView ? () => setPreviewOpen(true) : undefined,
  }
}

function MenuItem({
  children,
  onClick,
  disabled,
  tone = 'default',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={menuItemClass(tone)}
    >
      {children}
    </button>
  )
}
