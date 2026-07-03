import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, MoreVertical, Trash2, Upload } from 'lucide-react'
import ImageLightbox from './ImageLightbox'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

type Props = {
  /** Pixel diameter — must match the avatar passed as children. */
  size: number
  /** Whether an image is currently set (gates viewing + "Remove"). */
  hasImage: boolean
  /** Whether the viewer may change/remove the photo (e.g. group managers only).
   *  Viewing an existing photo does NOT require this. */
  canEdit: boolean
  /** Noun used in tooltips / aria, e.g. "vehicle photo" or "logo". */
  noun: string
  /** The rendered Avatar / GroupAvatar / logo, sized to `size`. */
  children: ReactNode
  /** Full-size image URL for the in-app preview (not the cropped thumbnail).
   *  When present and hasImage, the avatar becomes a "View photo" action. */
  viewSrc?: string
  /** Title shown in the preview header (defaults to the noun). */
  viewTitle?: string
  /** Corner radius of the image slot + its overlays: a circle for avatars, a
   *  card for square logos. Defaults to a circle. */
  shape?: 'circle' | 'card'
  accept?: string
  maxBytes?: number
  /** A validated image File, ready for the crop/upload step. */
  onFile: (file: File) => void
  /** "Remove" chosen from the menu. */
  onRemove: () => void
  /** Validation message (wrong type / too large) to surface in the panel. */
  onError?: (msg: string) => void
}

// The avatar/group image/logo as the hero of a panel header. The image is for
// VIEWING: when a photo exists, hover/focus reveals a dark overlay + eye icon
// ("View photo") and clicking opens a themed in-app lightbox (zoom/pan) — never
// a new tab.
//
// Photo MANAGEMENT lives in a compact three-dots Options button tucked into the
// image's bottom-right corner. It stays hidden until the image is hovered or the
// button is focused (keyboard-accessible), then opens a small themed menu
// (Change / Remove) — no form-style buttons under the image. Remove is disabled
// while there's no image. Viewing is NOT duplicated here: it's the image's own
// hover action above. The menu closes on outside-click or Escape; the preview
// closes on Escape.
export default function AvatarPhotoEditor({
  size,
  hasImage,
  canEdit,
  noun,
  children,
  viewSrc,
  viewTitle,
  shape = 'circle',
  accept = 'image/png,image/jpeg,image/webp,image/gif',
  maxBytes = DEFAULT_MAX_BYTES,
  onFile,
  onRemove,
  onError,
}: Props) {
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

  function openPicker() {
    inputRef.current?.click()
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return onError?.('Please choose an image file.')
    if (file.size > maxBytes) return onError?.('Image too large (max 10MB).')
    onFile(file)
  }

  const canView = hasImage && Boolean(viewSrc)
  const roundedClass = shape === 'circle' ? 'rounded-full' : 'rounded-card'
  // Where the Options button sits. A circle's corner is its lower-right arc, so a
  // small positive inset lands the button on the edge. A square (logo) has a real
  // corner, so we tuck the button right into it (slight overhang) like a badge.
  const cornerOffset = shape === 'circle' ? 'bottom-1 right-1' : '-bottom-1.5 -right-1.5'

  return (
    <>
      {canEdit && (
        <input ref={inputRef} type="file" accept={accept} onChange={onChange} className="hidden" />
      )}

      {/* The image is the hero. With a photo it's a "View photo" action that opens
          the lightbox; editors also get a hover-revealed three-dots Options menu
          in the bottom-right corner. */}
      <div className={`group relative ${roundedClass}`} style={{ width: size, height: size }}>
        {children}

        {canView && (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label="View photo"
            title="View photo"
            className={`absolute inset-0 ${roundedClass} flex items-center justify-center bg-black/50 text-white opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-active/60`}
          >
            <Eye size={Math.max(16, Math.round(size * 0.22))} strokeWidth={1.6} />
          </button>
        )}

        {/* Photo management — a compact, circular Options button in the corner of
            the image. Hidden by default; revealed on hover or keyboard focus. */}
        {canEdit && (
          <div className={`absolute ${cornerOffset} z-10`} ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`${noun} options`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Options"
              className={`h-7 w-7 flex items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-[2px] transition-all duration-150 hover:bg-black/75 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-active/60 ${
                menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <MoreVertical size="0.9375rem" strokeWidth={1.9} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+4px)] z-20 min-w-[9.375rem] rounded-card border border-white/[0.1] bg-surface overflow-hidden py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
              >
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false)
                    openPicker()
                  }}
                >
                  <Upload size="0.8125rem" strokeWidth={1.8} />
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
                  <Trash2 size="0.8125rem" strokeWidth={1.8} />
                  Remove
                </MenuItem>
              </div>
            )}
          </div>
        )}
      </div>

      {previewOpen && viewSrc && (
        <ImageLightbox
          src={viewSrc}
          title={viewTitle ?? noun}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  )
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
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[0.75rem] text-left whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent ${
        tone === 'danger' ? 'text-alert hover:bg-alert/10' : 'text-text hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  )
}
