import { useEffect } from 'react'
import { FileText } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import PreviewActionBar from './PreviewActionBar'

// Hash params understood by Chrome/Edge's built-in PDF viewer to suppress its
// Google-style toolbar, side panel, and scrollbar chrome — so only the page
// content shows inside our themed shell. Other engines ignore them gracefully.
const HIDE_NATIVE_CHROME = '#toolbar=0&navpanes=0&scrollbar=0&view=FitH'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
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
        />
      </div>

      {/* Page content in a themed, padded surface so the rendered PDF sits on
          our dark canvas rather than a raw full-bleed browser pane. */}
      <div className="flex-1 min-h-0 bg-bg p-3">
        <div className="mx-auto h-full w-full max-w-[900px] rounded-card border border-white/[0.08] overflow-hidden bg-bg">
          <iframe
            src={`${attachment.url}${HIDE_NATIVE_CHROME}`}
            title={attachment.originalName}
            className="w-full h-full border-0 bg-bg"
          />
        </div>
      </div>
    </div>
  )
}
