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
      <div className="text-[11px] text-active truncate">{replyTo.authorName}</div>
      <div className="text-[12px] text-muted truncate italic">{snippet || '…'}</div>
    </>
  )

  const base =
    'mb-1.5 pl-2 border-l-2 border-active/60 bg-white/[0.025] rounded-[3px] px-2 py-1 max-w-full'

  if (!onJump) {
    return <div className={base}>{inner}</div>
  }

  return (
    <button
      type="button"
      onClick={() => onJump(replyTo.id)}
      className={`${base} block w-full text-left hover:bg-white/[0.05] transition-colors`}
      title="Jump to message"
    >
      {inner}
    </button>
  )
}
