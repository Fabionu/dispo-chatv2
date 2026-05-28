import { useState } from 'react'
import { Download, Eye, ImageOff, Loader2 } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import { DocIcon, formatBytes } from './attachmentUtils'

type Props = {
  attachment: Attachment
  // The owning message is an optimistic send still uploading.
  uploading?: boolean
  onActivate: (a: Attachment) => void
  onImageLoad: () => void
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
export default function AttachmentBlock({
  attachment,
  uploading = false,
  onActivate,
  onImageLoad,
}: Props) {
  const isImage = attachment.mimeType.startsWith('image/')
  const isPdf = attachment.mimeType === 'application/pdf'
  const hasUrl = Boolean(attachment.url)
  // The server URL couldn't be loaded either (old upload whose file was lost).
  const [imgFailed, setImgFailed] = useState(false)
  // The local blob preview failed — fall back to the server URL.
  const [blobFailed, setBlobFailed] = useState(false)

  const localPreview = attachment.localPreviewUrl
  const imageSrc = !blobFailed && localPreview ? localPreview : attachment.url

  if (isImage && !imgFailed) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => onActivate(attachment)}
          aria-label={`Open ${attachment.originalName}`}
          className="block p-0 border-0 bg-transparent cursor-zoom-in"
        >
          <img
            src={imageSrc}
            alt={attachment.originalName}
            loading={uploading ? 'eager' : 'lazy'}
            onLoad={onImageLoad}
            onError={() => {
              // A broken local blob → retry with the server URL; a broken
              // server URL → genuinely unavailable.
              if (imageSrc === localPreview && attachment.url && attachment.url !== localPreview) {
                setBlobFailed(true)
              } else {
                setImgFailed(true)
              }
            }}
            className="max-w-full max-h-[320px] rounded-card border border-white/[0.08] object-contain bg-bg"
          />
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
