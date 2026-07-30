import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, Image as ImageIcon, ImageOff, Loader2, RotateCw } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import { DocIcon, formatBytes } from './attachmentUtils'
import PdfThumb from './PdfThumb'
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
  // The owning message also has a text body: widen image thumbnails so the
  // picture aligns with the caption rather than floating narrow above it.
  captioned?: boolean
  onActivate: (a: Attachment) => void
  onImageLoad: () => void
}

// Backstop for a genuinely loading (on-screen) image that neither loads nor
// errors — a hung connection. Short enough that a missing/broken image resolves
// to the unavailable card quickly rather than appearing to load forever. Real
// 404s usually fire onError well before this; this only catches stalls.
const LOAD_TIMEOUT_MS = 6000

// ── Thumbnail bounds ────────────────────────────────────────────────────────
// An image attachment NEVER renders at its natural size. It is fitted into a
// bounded box that is big enough to read in the conversation and small enough
// that a 1170×2532 phone screenshot doesn't take over the chat window.
//
// The box is a pure CONTAIN fit: scale the image down until it fits both maxes,
// never scale it up, never crop. The previous version also lifted each axis to a
// minimum and covered the box, which is exactly what turned tall screenshots
// into a cropped column — the middle of the shot with the top and bottom gone.
// Now a tall image simply becomes short and narrow, whole, centred in whatever
// width the bubble gives it.
//
// Two profiles:
//   • plain   — image sent on its own: a readable desktop preview.
//   • caption — image sent WITH a text body: a wider max so the picture sits
//     visually with the caption below it instead of floating narrow above wide
//     text. The HEIGHT cap is what keeps portraits in check, and it is the same
//     in both profiles.
//
// The height caps are deliberately below the ~440px the old code allowed: at
// --chat-max-width 860 the message column is ~830px tall on a 1080p display, so
// 340px is well under half the visible thread — a tall screenshot leaves room
// for the messages around it.
const BOUNDS = {
  plain: { maxW: 380, maxH: 340 },
  caption: { maxW: 520, maxH: 340 },
} as const

// Below this width:height ratio an image counts as a "very tall" screenshot: it
// gets the tighter height cap AND is centred on its own backdrop, because the
// contain fit leaves visible letterboxing either side. 0.6 ≈ 3:5; a normal
// phone photo (3:4 = 0.75) stays on the regular path.
const VERY_TALL_RATIO = 0.6
const VERY_TALL_MAX_H = 300

// Box reserved before we know the image's dimensions (just-sent blobs, GIFs,
// and legacy images without stored width/height). Recomputed on load. A 4:3
// landscape guess — the most common case — so the usual image barely reflows.
const FALLBACK = {
  plain: { w: 320, h: 240 },
  caption: { w: 400, h: 300 },
} as const

// Fit (w,h) inside the max box, preserving aspect ratio and never enlarging.
// Returns the px box the bubble reserves and the <img> is contained in.
function thumbBox(w: number, h: number, captioned: boolean): { w: number; h: number } | null {
  if (!w || !h) return null
  const b = captioned ? BOUNDS.caption : BOUNDS.plain
  // WIDTH ÷ height: a 1170×2532 phone screenshot is 0.46 and gets the tighter
  // cap; a 3:4 portrait photo is 0.75 and keeps the normal one.
  const maxH = w / h < VERY_TALL_RATIO ? Math.min(b.maxH, VERY_TALL_MAX_H) : b.maxH
  // `1` in the min() is what stops a small image from being blown up: a 90×90
  // avatar-sized attachment stays 90×90 instead of stretching to the max box.
  const scale = Math.min(b.maxW / w, maxH / h, 1)
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
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
  captioned = false,
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
  const box = useMemo(
    () => (dims ? thumbBox(dims.w, dims.h, captioned) : null),
    [dims?.w, dims?.h, captioned],
  )
  const fallback = captioned ? FALLBACK.caption : FALLBACK.plain

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
              that settles on load) and capped by BOUNDS. Expressed as
              max-width/max-height + aspect-ratio rather than fixed w/h, so the
              frame also shrinks with the bubble on a narrow pane and never
              overflows its column. */}
          <div
            ref={frameRef}
            className="relative overflow-hidden rounded-card border border-white/6 bg-bg"
            style={{
              width: box ? box.w : fallback.w,
              maxWidth: '100%',
              maxHeight: box ? box.h : fallback.h,
              aspectRatio: box ? `${box.w} / ${box.h}` : `${fallback.w} / ${fallback.h}`,
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
              // `contain`, never `cover`: the frame is already the image's own
              // aspect ratio, so contain simply fills it — but if the bubble cap
              // squeezes the frame on a narrow pane, contain letterboxes instead
              // of cropping. Screenshots and documents must never lose an edge.
              className={`w-full h-full object-contain block bg-bg transition-opacity duration-300 motion-reduce:transition-none ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/4 animate-pulse pointer-events-none">
                <ImageIcon size="1.375rem" strokeWidth={1.5} className="text-faint" />
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
                    <Loader2 size="1rem" strokeWidth={2} className="animate-spin text-pure-white/90" />
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
      <div className="flex items-center gap-2.5 rounded-card border border-white/8 bg-white/2 px-2.5 py-2 max-w-[22.5rem]">
        <div className="h-9 w-9 rounded-chip border border-white/10 bg-white/4 flex items-center justify-center shrink-0">
          <ImageOff size="0.9375rem" strokeWidth={1.6} className="text-faint" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-muted truncate">{attachment.originalName}</div>
          <div className="text-xs text-faint">Image unavailable</div>
        </div>
        <button
          type="button"
          onClick={retryImage}
          aria-label="Retry loading image"
          className="flex items-center gap-1 rounded-chip border border-white/10 px-1.5 py-1 text-xs text-muted hover:text-text hover:bg-white/4 transition-colors shrink-0"
        >
          <RotateCw size="0.75rem" strokeWidth={1.8} />
          Retry
        </button>
      </div>
    )
  }

  // Document / PDF thumbnail-card. A controlled, themed card (not a generic file
  // row): a compact preview band with the type glyph + a corner type badge, and
  // a footer with the filename and type · size. Kept to a bounded width like the
  // image thumbnails so documents never dominate the conversation. Clicking
  // opens the in-app preview (PDF shell / document modal) via onActivate.
  const docExt = attachment.originalName.includes('.')
    ? attachment.originalName.split('.').pop()!.toUpperCase()
    : isPdf
      ? 'PDF'
      : 'FILE'
  return (
    <button
      type="button"
      onClick={() => onActivate(attachment)}
      disabled={uploading || !hasUrl}
      aria-label={isPdf ? `Preview ${attachment.originalName}` : `Open ${attachment.originalName}`}
      className="block w-[20rem] max-w-full overflow-hidden rounded-card border border-white/6 bg-white/2 hover:bg-white/4 disabled:cursor-default transition-colors text-left"
    >
      {/* Preview band. The generic glyph always renders; for sent PDFs a
          lazily-rasterised first-page thumbnail (PdfThumb) layers over it once
          ready — if that render fails the glyph is simply what remains. The
          type badge and action icon render after the thumbnail layer so they
          stay on top of it. Non-PDF documents keep the glyph only (see
          lib/pdfThumbCache for the DOC/XLS thumbnail TODOs). */}
      <div className="relative h-[9rem] bg-bg border-b border-white/6 flex items-center justify-center">
        <div className="absolute inset-0 opacity-[0.04] bg-gradient-to-b from-white to-transparent pointer-events-none" />
        <div className="h-14 w-14 rounded-card border border-white/10 bg-white/4 flex items-center justify-center">
          <DocIcon mime={attachment.mimeType} size={28} />
        </div>
        {isPdf && hasUrl && !uploading && (
          <PdfThumb attachmentId={attachment.id} url={attachment.url} />
        )}
        {/* Opaque-enough pill + bright text so the label stays readable over a
            white page thumbnail as well as the dark placeholder band. */}
        <span className="absolute top-2 left-2 rounded-chip border border-pure-white/10 bg-black/65 backdrop-blur-[2px] px-1.5 py-0.5 text-2xs font-semibold tracking-wide text-pure-white/90">
          {docExt}
        </span>
        {uploading && (
          <span className="absolute top-2 right-2 flex items-center gap-1 rounded-chip bg-black/55 px-1.5 py-0.5 text-2xs text-pure-white/90">
            <Loader2 size="0.6875rem" strokeWidth={2} className="animate-spin" />
            Uploading…
          </span>
        )}
        {!uploading && hasUrl && (
          <span className="absolute bottom-2 right-2 text-muted">
            {isPdf ? <Eye size="0.875rem" strokeWidth={1.6} /> : <Download size="0.875rem" strokeWidth={1.6} />}
          </span>
        )}
      </div>
      {/* Footer */}
      <div className="px-2.5 py-2">
        <div className="text-sm text-text truncate">{attachment.originalName}</div>
        <div className="text-xs text-muted mt-0.5">
          {docExt} · {formatBytes(attachment.byteSize)}
        </div>
      </div>
    </button>
  )
}
