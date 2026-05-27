import { useEffect } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'
import type { Attachment } from '../../lib/types'

type Props = {
  attachment: Attachment
  onClose: () => void
}

// PDF preview rendered INLINE inside the chat pane — fills the area that
// would normally hold the message list + composer, leaving the conversation
// header (and the sidebar) untouched. Esc returns to messages.
export default function InlinePdfPreview({ attachment, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Sub-toolbar: filename + actions. Shorter than the chat header so the
          two read as a hierarchy, not a duplicate. */}
      <div className="h-11 flex items-center justify-between gap-3 px-5 border-b border-white/[0.06] shrink-0">
        <div className="text-[12px] text-muted truncate flex-1 min-w-0">
          {attachment.originalName}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-btn border border-white/[0.14] text-text hover:bg-white/[0.04] text-[11.5px] transition-colors no-underline"
          >
            <ExternalLink size={13} strokeWidth={1.6} />
            Open
          </a>
          <a
            href={attachment.url}
            download={attachment.originalName}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-btn border border-white/[0.14] text-text hover:bg-white/[0.04] text-[11.5px] transition-colors no-underline"
          >
            <Download size={13} strokeWidth={1.6} />
            Download
          </a>
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="h-7 w-7 inline-flex items-center justify-center rounded-btn border border-white/[0.14] text-text hover:bg-white/[0.04] transition-colors"
          >
            <X size={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-bg">
        <iframe
          src={attachment.url}
          title={attachment.originalName}
          className="w-full h-full border-0 bg-bg"
        />
      </div>
    </div>
  )
}
