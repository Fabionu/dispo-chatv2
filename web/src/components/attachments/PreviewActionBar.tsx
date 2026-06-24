import { Download, Forward, Reply, X } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import { IconButton, IconLink } from './IconAction'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
}

// Compact, themed action bar shared by every attachment preview surface (image
// lightbox, PDF shell, document card). All actions are icon-only, uniform 36×36
// buttons with themed hover tooltips (see IconAction). Reply/Forward are
// message-level — they hand the parent message back to ChatView, which owns the
// actual logic.
export default function PreviewActionBar({
  attachment,
  message,
  onReply,
  onForward,
  onClose,
}: Props) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <IconButton label="Reply" onClick={() => onReply(message)}>
        <Reply size={18} strokeWidth={1.8} />
      </IconButton>
      <IconButton label="Forward" onClick={() => onForward(message)}>
        <Forward size={18} strokeWidth={1.8} />
      </IconButton>
      <IconLink label="Download" href={attachment.url} download={attachment.originalName}>
        <Download size={18} strokeWidth={1.8} />
      </IconLink>
      <IconButton label="Close" onClick={onClose}>
        <X size={18} strokeWidth={1.8} />
      </IconButton>
    </div>
  )
}
