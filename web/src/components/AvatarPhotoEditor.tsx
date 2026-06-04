import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, MoreVertical, Trash2, Upload } from 'lucide-react'
import ImageLightbox from './ImageLightbox'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

type Props = {
  /** Pixel diameter — must match the avatar passed as children. */
  size: number
  /** Whether an image is currently set (gates viewing + "Remove photo"). */
  hasImage: boolean
  /** Whether the viewer may change/remove the photo (e.g. group managers only).
   *  Viewing an existing photo does NOT require this. */
  canEdit: boolean
  /** Noun used in tooltips / aria, e.g. "group photo" or "profile photo". */
  noun: string
  /** The rendered Avatar / GroupAvatar, sized to `size`. */
  children: ReactNode
  /** Full-size image URL for the in-app preview (not the cropped thumbnail).
   *  When present and hasImage, the avatar becomes a "View photo" action. */
  viewSrc?: string
  /** Title shown in the preview header (defaults to the noun). */
  viewTitle?: string
  accept?: string
  maxBytes?: number
  /** A validated image File, ready for the crop step. */
  onFile: (file: File) => void
  /** "Remove photo" chosen from the menu. */
  onRemove: () => void
  /** Validation message (wrong type / too large) to surface in the panel. */
  onError?: (msg: string) => void
}

// The avatar/group image as the hero of a panel header. The image is for
// VIEWING: when a photo exists, hover/focus reveals a dark overlay + eye icon
// ("View photo") and clicking opens a themed in-app lightbox (zoom/pan) — never
// a new tab. Photo MANAGEMENT lives entirely in a small themed "More" menu
// beside it (Change photo / Remove photo) — no large form-style buttons.
//
// With no photo: just the placeholder (not clickable); uploading is done from
// the More menu. Keyboard: the view action is a focusable button (Enter/Space
// opens the preview); the More menu is a button + menu that closes on
// outside-click or Escape; the preview closes on Escape.
//
// NOTE: the "More" menu is absolutely positioned to the top-right of the nearest
// positioned ancestor — wrap the identity block in a `relative` container.
export default function AvatarPhotoEditor({
  size,
  hasImage,
  canEdit,
  noun,
  children,
  viewSrc,
  viewTitle,
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

  return (
    <>
      {canEdit && (
        <>
          <input ref={inputRef} type="file" accept={accept} onChange={onChange} className="hidden" />

          {/* More menu — top-right of the (relative) identity area. All photo
              management lives here (no buttons under the avatar). */}
          <div className="absolute top-0 right-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Photo options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Photo options"
              className="h-7 w-7 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
            >
              <MoreVertical size={16} strokeWidth={1.8} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+4px)] z-20 min-w-[150px] rounded-card border border-white/[0.1] bg-surface overflow-hidden py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
              >
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false)
                    openPicker()
                  }}
                >
                  <Upload size={13} strokeWidth={1.8} />
                  Change photo
                </MenuItem>
                <MenuItem
                  tone="danger"
                  disabled={!hasImage}
                  onClick={() => {
                    setMenuOpen(false)
                    onRemove()
                  }}
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                  Remove photo
                </MenuItem>
              </div>
            )}
          </div>
        </>
      )}

      {/* The image is the hero. With a photo, it's a "View photo" action that
          opens the lightbox; with no photo, it's just the placeholder. */}
      <div className="relative rounded-full" style={{ width: size, height: size }}>
        {children}
        {canView && (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label="View photo"
            title="View photo"
            className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50 text-white opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-active/60"
          >
            <Eye size={Math.max(16, Math.round(size * 0.22))} strokeWidth={1.6} />
          </button>
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
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-left whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent ${
        tone === 'danger' ? 'text-alert hover:bg-alert/10' : 'text-text hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  )
}
