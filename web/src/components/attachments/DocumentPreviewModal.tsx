import { useEffect } from 'react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import DocumentCard from './DocumentCard'
import PreviewActionBar from './PreviewActionBar'
import { PreviewCaption, PreviewIdentity } from './PreviewChrome'

type Props = {
  attachment: Attachment
  message: LocalMessage
  currentUserId: string
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
  onOpenInTab?: () => void
  // Render INLINE inside a chat-window tab instead of as a fullscreen modal: no
  // backdrop and no Esc/click-away close, but the same sender line, caption,
  // action bar and document card.
  embedded?: boolean
}

// Preview modal for non-previewable documents (anything that isn't an image or
// PDF). Shows who sent it, a large document card, the message they sent with it,
// and the shared action bar so the same Reply/Forward/Download/Close actions are
// available as for images and PDFs.
// Esc closes; the backdrop is click-to-close (nothing to lose here).
export default function DocumentPreviewModal({
  attachment,
  message,
  currentUserId,
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
          : 'fixed inset-0 z-50 bg-black/95 flex flex-col p-4'
      }
      onClick={embedded ? undefined : onClose}
    >
      {/* Top bar: WHO sent the document on the left, actions on the right — an
          inset card-rounded strip in the modal (TripBar language — shared `card`
          radius, faint fill, no border/shadow) matching the image/PDF banners,
          and the same row on a hairline in a tab. The filename moves into the
          identity's meta line, and drops out entirely in a tab where it is
          already the tab's label. */}
      <div
        className={`shrink-0 flex items-center justify-between gap-3 ${
          embedded
            ? 'border-b border-line bg-bg px-4 py-2'
            : 'mb-2 rounded-card border border-line bg-bg px-3.5 py-2'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <PreviewIdentity attachment={attachment} message={message} showFile={!embedded} />
        <PreviewActionBar
          attachment={attachment}
          message={message}
          onReply={onReply}
          onForward={onForward}
          onClose={onClose}
          onOpenInTab={onOpenInTab}
        />
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div onClick={(e) => e.stopPropagation()}>
          <DocumentCard
            name={attachment.originalName}
            mimeType={attachment.mimeType}
            byteSize={attachment.byteSize}
          />
        </div>
      </div>

      {/* The message the document was sent with — for a file this is usually the
          only thing that says what it IS ("signed CMR for the Rotterdam run"). */}
      <PreviewCaption
        message={message}
        currentUserId={currentUserId}
        variant={embedded ? 'tab' : 'modal'}
      />
    </div>
  )
}
