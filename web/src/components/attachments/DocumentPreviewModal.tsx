import { useEffect } from 'react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import { DocIcon, formatBytes } from './attachmentUtils'
import PreviewActionBar from './PreviewActionBar'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
}

// Preview modal for non-previewable documents (anything that isn't an image or
// PDF). Shows a large document card plus the shared action bar so the same
// Reply/Forward/Download/Close actions are available as for images and PDFs.
// Esc closes; the backdrop is click-to-close (nothing to lose here).
export default function DocumentPreviewModal({
  attachment,
  message,
  onReply,
  onForward,
  onClose,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const ext = attachment.originalName.includes('.')
    ? attachment.originalName.split('.').pop()!.toUpperCase()
    : 'FILE'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.originalName}
      className="fixed inset-0 z-50 bg-black/85 flex flex-col p-4"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-end px-2 py-1.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <PreviewActionBar
          attachment={attachment}
          message={message}
          onReply={onReply}
          onForward={onForward}
          onClose={onClose}
        />
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[360px] rounded-card border border-white/[0.10] bg-surface px-6 py-8 flex flex-col items-center text-center"
        >
          <div className="h-16 w-16 rounded-card border border-white/[0.10] bg-white/[0.03] flex items-center justify-center mb-4">
            <DocIcon mime={attachment.mimeType} size={30} className="text-muted" />
          </div>
          <div className="text-[13px] text-text font-medium truncate max-w-full">
            {attachment.originalName}
          </div>
          <div className="text-[11.5px] text-muted mt-1">
            {ext} · {formatBytes(attachment.byteSize)}
          </div>
        </div>
      </div>
    </div>
  )
}
