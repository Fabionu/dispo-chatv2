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
    <span className="h-11 w-11 shrink-0 flex items-center justify-center bg-white/6 text-muted">
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

  const content = (
    <span className="flex min-h-11 min-w-0 items-stretch">
      <span
        className={`w-[3px] shrink-0 ${
          neutral ? 'bg-white/20' : 'bg-active/70'
        }`}
        aria-hidden="true"
      />
      <span
        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2.5 ${
          attachment && !replyTo.deleted ? '' : 'pr-2.5'
        }`}
      >
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-xs font-semibold leading-[1.15] ${
              neutral ? 'text-text' : 'text-active'
            }`}
          >
            {replyTo.authorName}
          </span>
          <span className="mt-1 block truncate text-xs leading-[1.15] text-muted">
            {snippet}
          </span>
        </span>
        <ReplyMedia replyTo={replyTo} />
      </span>
    </span>
  )

  const base =
    'mb-1.5 block min-w-[11.5rem] max-w-full overflow-hidden rounded-[0.625rem] bg-white/6 text-left'

  if (!onJump) return <span className={base}>{content}</span>

  return (
    <button
      type="button"
      onClick={() => onJump(replyTo.id)}
      className={`${base} transition-colors hover:bg-white/8`}
      title="Jump to message"
    >
      {content}
    </button>
  )
}
