import { useState } from 'react'
import { Download, Eye, ImageOff } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import { DocIcon, formatBytes } from './attachmentUtils'

type Props = {
  attachment: Attachment
  onActivate: (a: Attachment) => void
  onImageLoad: () => void
}

// In-bubble attachment renderer. Every attachment is a themed button — the
// parent's `onActivate` callback decides what to do (image → lightbox,
// pdf → preview overlay, other → download). No raw <a target="_blank">
// anywhere, so attachments don't look like browser links.
//
// The optimistic path may pass a blob URL — that just works for images and
// renders a card without a working action for docs (button is disabled
// until the real URL arrives a beat later via the server reconcile).
export default function AttachmentBlock({ attachment, onActivate, onImageLoad }: Props) {
  const isImage = attachment.mimeType.startsWith('image/')
  const isPdf = attachment.mimeType === 'application/pdf'
  const hasUrl = Boolean(attachment.url)
  // True when the image bytes can't be fetched (e.g. an old upload whose file
  // was lost to ephemeral storage before the Supabase migration). We render a
  // calm placeholder instead of a broken-image glyph.
  const [imgFailed, setImgFailed] = useState(false)

  if (isImage && !imgFailed) {
    return (
      <button
        type="button"
        onClick={() => onActivate(attachment)}
        aria-label={`Open ${attachment.originalName}`}
        className="block p-0 border-0 bg-transparent cursor-zoom-in"
      >
        <img
          src={attachment.url}
          alt={attachment.originalName}
          onLoad={onImageLoad}
          onError={() => setImgFailed(true)}
          className="max-w-full max-h-[320px] rounded-card border border-white/[0.08] object-contain bg-bg"
        />
      </button>
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
      disabled={!hasUrl}
      aria-label={isPdf ? `Preview ${attachment.originalName}` : `Download ${attachment.originalName}`}
      className="flex items-center gap-2.5 rounded-card border border-white/[0.08] bg-white/[0.02] px-2.5 py-2 max-w-[360px] hover:bg-white/[0.04] disabled:opacity-50 disabled:cursor-default transition-colors text-left"
    >
      <div className="h-9 w-9 rounded-chip border border-white/[0.10] bg-white/[0.03] flex items-center justify-center shrink-0">
        <DocIcon mime={attachment.mimeType} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-text truncate">{attachment.originalName}</div>
        <div className="text-[10.5px] text-muted">{formatBytes(attachment.byteSize)}</div>
      </div>
      {hasUrl &&
        (isPdf ? (
          <Eye size={14} strokeWidth={1.6} className="text-muted shrink-0" />
        ) : (
          <Download size={14} strokeWidth={1.6} className="text-muted shrink-0" />
        ))}
    </button>
  )
}
