import { useEffect } from 'react'
import { FileText } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import DocumentCard from './DocumentCard'
import PreviewActionBar from './PreviewActionBar'
import { PdfDocumentView } from './PdfRender'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
  onOpenInTab?: () => void
}

// PDF preview rendered INLINE inside the chat pane — fills the area that
// would normally hold the message list + composer, leaving the conversation
// header (and the sidebar) untouched. Esc returns to messages.
export default function InlinePdfPreview({
  attachment,
  message,
  onReply,
  onForward,
  onClose,
  onOpenInTab,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Themed top bar: PDF glyph + filename on the left, icon-only actions on
          the right. Shorter than the chat header so the two read as a hierarchy,
          not a duplicate. */}
      <div className="h-12 flex items-center justify-between gap-3 px-4 border-b border-white/[0.06] bg-rail shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText size={15} strokeWidth={1.6} className="text-muted shrink-0" />
          <div className="text-[12.5px] text-text truncate min-w-0">
            {attachment.originalName}
          </div>
        </div>
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
      <div className="flex-1 min-h-0 bg-bg p-3">
        <div className="mx-auto h-full w-full max-w-[900px] rounded-card border border-white/[0.08] overflow-hidden bg-bg">
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
    </div>
  )
}
