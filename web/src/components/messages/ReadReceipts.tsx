import { CheckCheck, Clock } from 'lucide-react'

// One potential reader of a sent message — a group member other than the
// author. `lastReadAt` is their conversation "read up to" marker; the message
// is considered seen iff lastReadAt >= the message's createdAt.
export type Reader = {
  id: string
  displayName: string
  hasAvatar?: boolean
  lastReadAt?: string | null
}

type Props = {
  others: Reader[]
  createdAt: string
  pending?: boolean
  glyphSize?: string
  /** Opens the chat-level receipts panel. The icon owns no floating UI. */
  onOpen: () => void
}

// Compact delivery/read glyph. Receipt details intentionally live outside the
// message row in ReadReceiptsPanel, so clicking never creates a cramped popover
// over the timeline.
export default function ReadReceipts({
  others,
  createdAt,
  pending,
  glyphSize = '0.875rem',
  onOpen,
}: Props) {
  if (pending) {
    return (
      <span className="inline-flex items-center" aria-label="Sending" title="Sending…">
        <Clock size={glyphSize} strokeWidth={2} className="text-faint" />
      </span>
    )
  }

  const created = new Date(createdAt).getTime()
  const notSeen = others.filter(
    (reader) => !(reader.lastReadAt && new Date(reader.lastReadAt).getTime() >= created),
  )
  const fullyRead = others.length > 0 && notSeen.length === 0

  if (others.length === 0) {
    return (
      <span className="inline-flex items-center" aria-label="Sent" title="Sent">
        <CheckCheck size={glyphSize} strokeWidth={2} className="text-faint" />
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
      aria-label={fullyRead ? 'Read — see who' : 'Delivered — see who has read'}
      aria-haspopup="dialog"
      className={`inline-flex items-center ${fullyRead ? 'text-muted' : 'text-faint'}`}
    >
      <CheckCheck size={glyphSize} strokeWidth={2} />
    </button>
  )
}
