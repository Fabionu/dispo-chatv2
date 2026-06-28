import { useEffect } from 'react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import DocumentCard from './DocumentCard'
import PreviewActionBar from './PreviewActionBar'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
  onOpenInTab?: () => void
  // Render INLINE inside a chat-window tab instead of as a fullscreen modal: no
  // backdrop and no Esc/click-away close, but the same action bar + document card.
  embedded?: boolean
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
  onOpenInTab,
  embedded = false,
}: Props) {
  useEffect(() => {
    if (embedded) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, embedded])

  return (
    <div
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={attachment.originalName}
      className={
        embedded
          ? 'flex-1 min-h-0 flex flex-col bg-bg relative'
          : 'fixed inset-0 z-50 bg-black/85 flex flex-col p-4'
      }
      onClick={embedded ? undefined : onClose}
    >
      {/* Modal-only top action row; in a tab the actions FLOAT (below) so no
          height is reserved and the card uses the full area. */}
      {!embedded && (
        <div
          className="flex items-center justify-end px-3 py-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <PreviewActionBar
            attachment={attachment}
            message={message}
            onReply={onReply}
            onForward={onForward}
            onClose={onClose}
            onOpenInTab={onOpenInTab}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div onClick={(e) => e.stopPropagation()}>
          <DocumentCard
            name={attachment.originalName}
            mimeType={attachment.mimeType}
            byteSize={attachment.byteSize}
          />
        </div>
      </div>

      {/* Floating action cluster (tab mode) — top-right over the card. */}
      {embedded && (
        <PreviewActionBar
          attachment={attachment}
          message={message}
          onReply={onReply}
          onForward={onForward}
          onClose={onClose}
          floating
        />
      )}
    </div>
  )
}
