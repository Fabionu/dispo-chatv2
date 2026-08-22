import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import DocumentCard from './DocumentCard'
import AttachmentPreviewShell from './previewChrome'
import { PdfDocumentView } from './PdfRender'

type Props = {
  attachment: Attachment
  message: LocalMessage
  currentUserId: string
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
  onOpenInTab?: () => void
  // Rendered inside a chat-window tab rather than opened from a bubble: no Esc
  // close (the tab's × owns dismissal) and no "Open in tab" action — it is one.
  embedded?: boolean
}

// PDF preview rendered INLINE inside the chat pane — it fills the area that
// would normally hold the message list + composer, leaving the conversation
// header (and the sidebar) untouched. Never a fullscreen dialog, so the shell
// is used in its pane-filling shape in both modes; Esc returns to messages.
export default function InlinePdfPreview({
  attachment,
  message,
  currentUserId,
  onReply,
  onForward,
  onClose,
  onOpenInTab,
  embedded = false,
}: Props) {
  return (
    <AttachmentPreviewShell
      attachment={attachment}
      message={message}
      currentUserId={currentUserId}
      onReply={onReply}
      onForward={onForward}
      onClose={onClose}
      onOpenInTab={onOpenInTab}
      closeOnEsc={!embedded}
    >
      {/* Page content rendered by pdf.js into a themed, scrollable surface — our
          own canvas + scrollbar, never the browser's PDF toolbar. Falls back to
          the themed document card only if rendering fails. */}
      <div className="flex-1 min-h-0 bg-bg p-3">
        <div className="mx-auto h-full w-full max-w-[56.25rem] rounded-card border border-line overflow-hidden bg-bg">
          <PdfDocumentView
            url={attachment.url}
            fallback={
              <DocumentCard
                name={attachment.originalName}
                mimeType={attachment.mimeType}
                byteSize={attachment.byteSize}
              />
            }
          />
        </div>
      </div>
    </AttachmentPreviewShell>
  )
}
