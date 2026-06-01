import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, Image as ImageIcon, ImageOff, Loader2, RotateCw } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import { DocIcon, formatBytes } from './attachmentUtils'
import {
  clearImageFailed,
  isImageFailed,
  isImageLoaded,
  markImageFailed,
  markImageLoaded,
} from '../../lib/attachmentCache'

type Props = {
  attachment: Attachment
  // The owning message is an optimistic send still uploading.
  uploading?: boolean
  // This attachment belongs to a recent/near-bottom message: load its image
  // eagerly (and skip lazy deferral) so newest pictures appear with the text.
  priority?: boolean
  onActivate: (a: Attachment) => void
  onImageLoad: () => void
}

// Backstop for a genuinely loading (on-screen) image that neither loads nor
// errors — a hung connection. Short enough that a missing/broken image resolves
// to the unavailable card quickly rather than appearing to load forever. Real
// 404s usually fire onError well before this; this only catches stalls.
const LOAD_TIMEOUT_MS = 6000

// WhatsApp-style thumbnail bounds. Every image attachment renders inside a
// compact, fixed-bounded box rather than near-full size, so screenshots and
// high-resolution photos all collapse to a controlled chat thumbnail. The box
// is computed from the image's aspect ratio, clamped into [MIN, MAX] in both
// axes; the <img> fills it with object-cover, cropping only the extreme aspect
// ratios (very wide screenshots / very tall portraits) so they never turn into
// thin slivers. The full image is always one tap away in the lightbox.
const THUMB_MAX_W = 300
const THUMB_MAX_H = 320
const THUMB_MIN_W = 150
const THUMB_MIN_H = 120
// Box reserved before we know the image's dimensions (just-sent blobs, GIFs,
// and legacy images without stored width/height). Recomputed on load.
const THUMB_FALLBACK_W = 240
const THUMB_FALLBACK_H = 180

// Fit (w,h) into the max box preserving aspect ratio, then lift each axis to its
// minimum so extreme aspect ratios become a sensible cropped box instead of a
// sliver. Returns the px box the bubble reserves and the <img> covers.
function thumbBox(w: number, h: number): { w: number; h: number } | null {
  if (!w || !h) return null
  const scale = Math.min(THUMB_MAX_W / w, THUMB_MAX_H / h, 1)
  const dw = Math.min(Math.max(w * scale, THUMB_MIN_W), THUMB_MAX_W)
  const dh = Math.min(Math.max(h * scale, THUMB_MIN_H), THUMB_MAX_H)
  return { w: Math.round(dw), h: Math.round(dh) }
}

// In-bubble attachment renderer. Every attachment is a themed button — the
// parent's `onActivate` callback decides what to do (image → lightbox,
// pdf → preview overlay, other → download). No raw <a target="_blank">
// anywhere, so attachments don't look like browser links.
//
// Images prefer a local blob preview (`localPreviewUrl`) when present: a
// just-sent image keeps showing the already-decoded local bytes across the
// optimistic→server reconcile, so there's no flicker and no refetch. If that
// blob is gone (e.g. revoked after a fast group switch) we fall back to the
// authenticated server URL; if that also fails we show an "unavailable" card.
//
// Missing/broken images resolve fast and predictably: the server flags rows
// whose object is gone (`attachment.missing`) so the card shows immediately,
// real load errors short-circuit to the card, and a per-mount timeout catches
// stalls. Failures are cached for the session (attachmentCache) so revisiting
// the conversation renders the card straight away instead of replaying the
// skeleton — and a retry action clears that and tries again.
//
// While the image is still decoding, the bubble reserves space and shows a
// subtle skeleton (dark box + image glyph) so the row never flashes empty and
// finishing the load doesn't shove the conversation around. The decoded image
// fades in.
export default function AttachmentBlock({
  attachment,
  uploading = false,
  priority = false,
  onActivate,
  onImageLoad,
}: Props) {
  const isImage = attachment.mimeType.startsWith('image/')
  const isPdf = attachment.mimeType === 'application/pdf'
  const hasUrl = Boolean(attachment.url)

  const localPreview = attachment.localPreviewUrl
  // Chat bubbles render the lightweight preview (when the server generated one)
  // rather than the full original; the original is reserved for the lightbox
  // modal. Falls back to the original for GIFs / pre-preview images.
  const serverImageSrc = attachment.previewUrl ?? attachment.url

  // The server URL couldn't be loaded (old upload whose file was lost, or a
  // stall). Seed from the server's missing flag and the session failed-cache so
  // a known-bad image renders the card immediately — no skeleton, no refetch.
  const [imgFailed, setImgFailed] = useState(
    () => attachment.missing === true || isImageFailed(attachment.id),
  )
  // The local blob preview failed — fall back to the server URL.
  const [blobFailed, setBlobFailed] = useState(false)
  // A just-sent image renders from already-decoded local bytes, so treat it as
  // loaded from the first frame (no skeleton). Otherwise seed from the session
  // cache so revisited images skip the skeleton entirely.
  const [loaded, setLoaded] = useState(
    () => Boolean(localPreview) || isImageLoaded(attachment.id),
  )
  // Bumped on manual retry to force the <img> to refetch (the failed URL isn't
  // cached, but a nonce also restarts the load timeout cleanly).
  const [retryNonce, setRetryNonce] = useState(0)
  // Whether the image is actually on screen and thus genuinely loading. Eager/
  // uploading images count immediately; lazy ones flip true via the observer.
  // The load timeout only runs while this is true, so an offscreen lazy image
  // is never marked failed just for sitting there undecoded.
  const [inView, setInView] = useState(priority || uploading)
  const frameRef = useRef<HTMLDivElement>(null)

  const rawSrc = !blobFailed && localPreview ? localPreview : serverImageSrc
  const isBlobSrc = rawSrc === localPreview
  // Cache-bust server URLs on retry so the browser re-requests rather than
  // replaying a previous failure; never touch the blob URL.
  const imageSrc =
    !isBlobSrc && retryNonce > 0 && rawSrc
      ? `${rawSrc}${rawSrc.includes('?') ? '&' : '?'}retry=${retryNonce}`
      : rawSrc
  // Intrinsic dimensions drive the reserved thumbnail box. Prefer the server's
  // stored dimensions (known before the image loads → zero reflow); otherwise
  // capture the decoded image's natural size on load (blobs, GIFs, legacy
  // images) and recompute the box once.
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null)
  const dims =
    attachment.width && attachment.height
      ? { w: attachment.width, h: attachment.height }
      : naturalDims
  const box = useMemo(() => (dims ? thumbBox(dims.w, dims.h) : null), [dims?.w, dims?.h])

  // Mark the image in-view once it (nearly) reaches the viewport. Eager/
  // uploading images are already considered in-view, so they skip the observer.
  useEffect(() => {
    if (!isImage || priority || uploading) return
    const el = frameRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true)
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [isImage, priority, uploading])

  // Stall backstop: only while the image is genuinely loading on screen. A
  // timeout marks the bubble failed locally (with retry) but is NOT written to
  // the session failed-cache — it may be a transient slow network, so a revisit
  // tries again. Real onError failures are the ones that get cached.
  useEffect(() => {
    if (!isImage || loaded || imgFailed || !inView) return
    const t = window.setTimeout(() => setImgFailed(true), LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [isImage, loaded, imgFailed, inView, imageSrc])

  // When the reserved box settles to its real size after load (the natural-dims
  // path), the row height changes a frame later than onLoad — notify the parent
  // again so a just-sent image stays pinned to the bottom across that shift.
  // The parent only re-pins if the reader was already at the bottom, so this
  // never yanks the view when scrolled up reading history.
  useEffect(() => {
    if (loaded) onImageLoad()
    // onImageLoad is stable (useCallback in the hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box?.w, box?.h, loaded])

  function retryImage() {
    clearImageFailed(attachment.id)
    setBlobFailed(false)
    setLoaded(false)
    setImgFailed(false)
    setInView(true)
    setRetryNonce((n) => n + 1)
  }

  if (isImage && !imgFailed) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => onActivate(attachment)}
          aria-label={`Open ${attachment.originalName}`}
          className="block p-0 border-0 bg-transparent cursor-zoom-in"
        >
          {/* Fixed-bounds thumbnail frame. The box is reserved from the image's
              aspect ratio (known dims → zero reflow; unknown → a fallback box
              that settles on load), capped to WhatsApp-style bounds. aspect-
              ratio keeps it proportional when the bubble cap shrinks it on
              narrow screens, so it never exceeds its column. */}
          <div
            ref={frameRef}
            className="relative overflow-hidden rounded-card border border-white/[0.08] bg-bg"
            style={{
              width: box ? box.w : THUMB_FALLBACK_W,
              aspectRatio: box ? `${box.w} / ${box.h}` : `${THUMB_FALLBACK_W} / ${THUMB_FALLBACK_H}`,
              maxWidth: '100%',
            }}
          >
            <img
              src={imageSrc}
              alt={attachment.originalName}
              // Recent/just-sent images load now; older ones defer until near
              // the viewport. async decode keeps the main thread responsive.
              loading={priority || uploading ? 'eager' : 'lazy'}
              decoding="async"
              onLoad={(e) => {
                // Capture natural size for images without server-stored dims so
                // the box settles to the right aspect ratio (and crop) once.
                if (!attachment.width || !attachment.height) {
                  const el = e.currentTarget
                  if (el.naturalWidth && el.naturalHeight) {
                    setNaturalDims({ w: el.naturalWidth, h: el.naturalHeight })
                  }
                }
                setLoaded(true)
                markImageLoaded(attachment.id)
                onImageLoad()
              }}
              onError={() => {
                // A broken local blob → retry with the server URL; a broken
                // server URL → genuinely unavailable (cache it for the session).
                if (imageSrc === localPreview && attachment.url && attachment.url !== localPreview) {
                  setBlobFailed(true)
                } else {
                  markImageFailed(attachment.id)
                  setImgFailed(true)
                }
              }}
              className={`w-full h-full object-cover block bg-bg transition-opacity duration-300 ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/[0.03] animate-pulse pointer-events-none">
                <ImageIcon size={22} strokeWidth={1.5} className="text-faint" />
              </div>
            )}
            {/* Pending overlay: a subtle dark gradient + centered spinner while
                the upload is in flight, removed once the server message lands
                (the thumbnail size is unchanged across that swap). */}
            {uploading && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/20" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 backdrop-blur-[1px]">
                    <Loader2 size={16} strokeWidth={2} className="animate-spin text-white/90" />
                  </span>
                </div>
              </div>
            )}
          </div>
        </button>
      </div>
    )
  }

  if (isImage && imgFailed) {
    return (
      <div className="flex items-center gap-2.5 rounded-card border border-white/[0.08] bg-white/[0.02] px-2.5 py-2 max-w-[360px]">
        <div className="h-9 w-9 rounded-chip border border-white/[0.10] bg-white/[0.03] flex items-center justify-center shrink-0">
          <ImageOff size={15} strokeWidth={1.6} className="text-faint" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-muted truncate">{attachment.originalName}</div>
          <div className="text-[10.5px] text-faint">Image unavailable</div>
        </div>
        <button
          type="button"
          onClick={retryImage}
          aria-label="Retry loading image"
          className="flex items-center gap-1 rounded-chip border border-white/[0.10] px-1.5 py-1 text-[10.5px] text-muted hover:text-text hover:bg-white/[0.04] transition-colors shrink-0"
        >
          <RotateCw size={12} strokeWidth={1.8} />
          Retry
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onActivate(attachment)}
      disabled={uploading || !hasUrl}
      aria-label={isPdf ? `Preview ${attachment.originalName}` : `Download ${attachment.originalName}`}
      className="flex items-center gap-2.5 rounded-card border border-white/[0.08] bg-white/[0.02] px-2.5 py-2 max-w-[360px] hover:bg-white/[0.04] disabled:cursor-default transition-colors text-left"
    >
      <div className="h-9 w-9 rounded-chip border border-white/[0.10] bg-white/[0.03] flex items-center justify-center shrink-0">
        <DocIcon mime={attachment.mimeType} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-text truncate">{attachment.originalName}</div>
        <div className="text-[10.5px] text-muted">{formatBytes(attachment.byteSize)}</div>
      </div>
      {uploading ? (
        <span className="flex items-center gap-1 text-[10.5px] text-muted shrink-0">
          <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          Uploading…
        </span>
      ) : (
        hasUrl &&
        (isPdf ? (
          <Eye size={14} strokeWidth={1.6} className="text-muted shrink-0" />
        ) : (
          <Download size={14} strokeWidth={1.6} className="text-muted shrink-0" />
        ))
      )}
    </button>
  )
}
