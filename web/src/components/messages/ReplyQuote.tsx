import { FileText, Image as ImageIcon } from 'lucide-react'
import type { ReplyToPreview } from '../../lib/types'

function ReplyMedia({ replyTo }: { replyTo: ReplyToPreview }) {
  const attachment = replyTo.attachment
  if (!attachment || replyTo.deleted) return null

  const image = attachment.mimeType.startsWith('image/')
  if (image && !attachment.missing) {
    return (
      <img
        src={attachment.previewUrl ?? attachment.url}
        alt=""
        className="h-11 w-11 shrink-0 object-cover bg-black/30"
        loading="lazy"
      />
    )
  }

  return (
    <span className="h-11 w-11 shrink-0 flex items-center justify-center border text-muted">
      {image ? (
        <ImageIcon size="1rem" strokeWidth={1.8} />
      ) : (
        <FileText size="1rem" strokeWidth={1.8} />
      )}
    </span>
  )
}

export default function ReplyQuote({
  replyTo,
  onJump,
  neutral = false,
}: {
  replyTo: ReplyToPreview
  onJump?: (messageId: string) => void
  neutral?: boolean
}) {
  const attachment = replyTo.attachment
  const snippet = replyTo.deleted
    ? 'Deleted message'
    : replyTo.body ||
      attachment?.originalName ||
      (replyTo.hasAttachments ? 'Attachment' : 'Message')

  // The quote is a message nested inside a message, so it is drawn the same
  // way the outer one is: a left rule, an indent, a mono attribution over the
  // body. No fill and no corner radius — a filled card here would be the only
  // solid block inside a thread built from rules, and it read as heavier than
  // the message actually quoting it.
  const content = (
    <span className="flex min-h-11 min-w-0 items-center gap-2 py-1 pl-2.5 pr-2.5">
      <span className="min-w-0 flex-1">
        <span className={`eyebrow block truncate ${neutral ? '' : 'text-active'}`}>
          {replyTo.authorName}
        </span>
        <span className="mt-1 block truncate text-xs leading-[1.3] text-muted">{snippet}</span>
      </span>
      <ReplyMedia replyTo={replyTo} />
    </span>
  )

  const base = `mb-2 block min-w-[11.5rem] max-w-body overflow-hidden border-l text-left ${
    neutral ? 'border-line-2' : 'border-active/70'
  }`

  if (!onJump) return <span className={base}>{content}</span>

  return (
    <button
      type="button"
      onClick={() => onJump(replyTo.id)}
      className={`${base} transition-colors hover:bg-white/4`}
      title="Jump to message"
    >
      {content}
    </button>
  )
}
