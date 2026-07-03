import type { ReplyToPreview } from '../../lib/types'

// Quote block rendered above a reply's body. The accent bar on the leading
// side picks up the warm `active` tint so it reads as "from someone" rather
// than as an attached file. When `onJump` is supplied the quote becomes a
// button that scrolls to (and highlights) the original message.
export default function ReplyQuote({
  replyTo,
  onJump,
}: {
  replyTo: ReplyToPreview
  onJump?: (messageId: string) => void
}) {
  const snippet = replyTo.deleted
    ? '(deleted message)'
    : replyTo.body
      ? replyTo.body
      : replyTo.hasAttachments
        ? 'Attachment'
        : ''

  const inner = (
    <>
      <div className="text-[0.6875rem] leading-tight text-active truncate">{replyTo.authorName}</div>
      <div className="text-[0.6875rem] leading-tight text-muted truncate italic">{snippet || '…'}</div>
    </>
  )

  // Compact inline quote, not a card: a thin accent bar on the left, then the
  // author + one-line preview. No background or border box; the block hugs its
  // content (w-fit) and is capped so a long preview truncates instead of
  // stretching across the column.
  const base = 'mb-1 w-fit max-w-[min(100%,27.5rem)] border-l-2 border-active/50 pl-2 pr-2 py-px'

  if (!onJump) {
    return <div className={base}>{inner}</div>
  }

  return (
    <button
      type="button"
      onClick={() => onJump(replyTo.id)}
      className={`${base} block text-left rounded-r-[0.1875rem] hover:bg-white/[0.04] transition-colors`}
      title="Jump to message"
    >
      {inner}
    </button>
  )
}
