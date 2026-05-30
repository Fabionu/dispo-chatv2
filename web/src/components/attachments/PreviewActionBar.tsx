import type { ReactNode } from 'react'
import { Download, Forward, Reply, X } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
}

// Compact, themed action bar shared by every attachment preview surface (image
// lightbox, inline PDF, document card). Reply/Forward are message-level — they
// hand the parent message back to ChatView, which owns the actual logic. Keeps
// the four actions consistent and avoids overcrowding.
export default function PreviewActionBar({
  attachment,
  message,
  onReply,
  onForward,
  onClose,
}: Props) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <ActionButton label="Reply" onClick={() => onReply(message)}>
        <Reply size={14} strokeWidth={1.6} />
      </ActionButton>
      <ActionButton label="Forward" onClick={() => onForward(message)}>
        <Forward size={14} strokeWidth={1.6} />
      </ActionButton>
      <a
        href={attachment.url}
        download={attachment.originalName}
        className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-btn border border-white/[0.14] text-text hover:bg-white/[0.04] text-[12px] transition-colors no-underline"
      >
        <Download size={14} strokeWidth={1.6} />
        Download
      </a>
      <button
        onClick={onClose}
        aria-label="Close preview"
        className="h-8 w-8 inline-flex items-center justify-center rounded-btn border border-white/[0.14] text-text hover:bg-white/[0.04] transition-colors"
      >
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-btn border border-white/[0.14] text-text hover:bg-white/[0.04] text-[12px] transition-colors"
    >
      {children}
      {label}
    </button>
  )
}
