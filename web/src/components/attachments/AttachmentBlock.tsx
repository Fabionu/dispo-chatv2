import { useEffect, useRef, useState } from 'react'
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
  // Intrinsic dimensions (when known) let the browser reserve the box from the
  // image's aspect ratio, so the bubble doesn't reflow when the preview lands.
  const hasDims = Boolean(attachment.width && attachment.height)

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
          {/* Reserved, never-empty frame. Holds a minimum box while the image
              decodes so the bubble keeps its footprint; the cap lets the
              decoded image settle to its own (bounded) size. */}
          <div
            ref={frameRef}
            className="relative overflow-hidden rounded-card border border-white/[0.08] bg-bg"
            // With known dimensions the <img> reserves the box via its aspect
            // ratio; without them, hold a minimum box until the image lands.
            style={loaded || hasDims ? undefined : { minWidth: 200, minHeight: 150 }}
          >
            <img
              src={imageSrc}
              alt={attachment.originalName}
              {...(hasDims ? { width: attachment.width, height: attachment.height } : {})}
              // Recent/just-sent images load now; older ones defer until near
              // the viewport. async decode keeps the main thread responsive.
              loading={priority || uploading ? 'eager' : 'lazy'}
              decoding="async"
              onLoad={() => {
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
              className={`max-w-full max-h-[320px] h-auto w-auto object-contain block bg-bg transition-opacity duration-300 ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/[0.03] animate-pulse pointer-events-none">
                <ImageIcon size={22} strokeWidth={1.5} className="text-faint" />
              </div>
            )}
          </div>
        </button>
        {uploading && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-chip bg-black/55 px-1.5 py-0.5 text-[10px] text-text/90 pointer-events-none">
            <Loader2 size={11} strokeWidth={2} className="animate-spin" />
            Uploading…
          </div>
        )}
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
