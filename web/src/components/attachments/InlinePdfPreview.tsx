import { useEffect } from 'react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import DocumentCard from './DocumentCard'
import PreviewActionBar from './PreviewActionBar'
import { PreviewCaption, PreviewIdentity } from './PreviewChrome'
import { PdfDocumentView } from './PdfRender'

type Props = {
  attachment: Attachment
  message: LocalMessage
  currentUserId: string
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
  onOpenInTab?: () => void
  // Rendered inside a chat-window tab: drop the filename (the name is already in
  // the tab label) and no Esc close, but keep the sender line, the caption and
  // the action bar.
  embedded?: boolean
}

// PDF preview rendered INLINE inside the chat pane — fills the area that
// would normally hold the message list + composer, leaving the conversation
// header (and the sidebar) untouched. Esc returns to messages.
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
  useEffect(() => {
    if (embedded) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, embedded])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Top bar: WHO sent the PDF on the left, icon-only actions on the right.
          An inset, card-rounded strip in the TripBar language (the shared `card`
          radius, faint fill, no border/shadow) rather than an edge-to-edge band;
          in a tab the same row on a hairline, without the filename that the tab
          label already carries. */}
      <div
        className={`shrink-0 flex items-center justify-between gap-3 ${
          embedded
            ? 'border-b border-line bg-bg px-4 py-2'
            : 'mx-3 mt-2 rounded-card border border-line bg-bg px-3.5 py-2'
        }`}
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

      {/* Page content rendered by pdf.js into a themed, scrollable surface — our
          own canvas + scrollbar, never the browser's PDF toolbar. Falls back to
          the themed document card only if rendering fails. */}
      <div className={`flex-1 min-h-0 bg-bg ${embedded ? 'relative p-2' : 'p-3'}`}>
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

      {/* The note the PDF was sent with — a CMR or a rate confirmation almost
          always arrives with the sentence that says which run it belongs to. */}
      <PreviewCaption
        message={message}
        currentUserId={currentUserId}
        variant={embedded ? 'tab' : 'pane'}
      />
    </div>
  )
}
