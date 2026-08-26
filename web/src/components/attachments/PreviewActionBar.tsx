import { Download, Forward, Plus, Reply, X } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import { IconButton, IconLink } from './IconAction'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
  // When provided, shows an "Open in tab" (+) action that pins this attachment
  // as a chat-window tab. Omitted when the surface IS already a tab (no point
  // re-opening itself).
  onOpenInTab?: () => void
}

// Compact, themed action bar shared by every attachment preview surface (image
// lightbox, PDF shell, document card). All actions are icon-only, uniform 36×36
// buttons with themed hover tooltips (see IconAction). Reply/Forward are
// message-level — they hand the parent message back to ChatView, which owns the
// actual logic.
//
// It used to have a second, FLOATING form: a pill hovering over the content in
// the tab previews, which existed only so a tab wouldn't have to reserve a
// header row for a filename it already showed in its label. Tabs now carry the
// sender and the time in that row (see PreviewChrome) — a header they genuinely
// need — so the actions sit in it like everywhere else, and the preview surfaces
// are one layout instead of two.
export default function PreviewActionBar({
  attachment,
  message,
  onReply,
  onForward,
  onClose,
  onOpenInTab,
}: Props) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <IconButton label="Reply" onClick={() => onReply(message)}>
        <Reply size="1.125rem" strokeWidth={1.8} />
      </IconButton>
      <IconButton label="Forward" onClick={() => onForward(message)}>
        <Forward size="1.125rem" strokeWidth={1.8} />
      </IconButton>
      {onOpenInTab && (
        <IconButton label="Open in tab" onClick={onOpenInTab}>
          <Plus size="1.125rem" strokeWidth={1.8} />
        </IconButton>
      )}
      <IconLink label="Download" href={attachment.url} download={attachment.originalName}>
        <Download size="1.125rem" strokeWidth={1.8} />
      </IconLink>
      <IconButton label="Close" onClick={onClose}>
        <X size="1.125rem" strokeWidth={1.8} />
      </IconButton>
    </div>
  )
}
