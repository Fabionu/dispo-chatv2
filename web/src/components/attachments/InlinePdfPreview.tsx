import { useEffect } from 'react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import PreviewActionBar from './PreviewActionBar'

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
      {/* Sub-toolbar: filename + actions. Shorter than the chat header so the
          two read as a hierarchy, not a duplicate. */}
      <div className="h-11 flex items-center justify-between gap-3 px-5 border-b border-white/[0.06] shrink-0">
        <div className="text-[12px] text-muted truncate flex-1 min-w-0">
          {attachment.originalName}
        </div>
        <PreviewActionBar
          attachment={attachment}
          message={message}
          onReply={onReply}
          onForward={onForward}
          onClose={onClose}
        />
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
