import { FileText, Image as ImageIcon, Pencil, Reply, X } from 'lucide-react'
import type { ReplyToPreview } from '../../lib/types'

type Props = {
  tone: 'reply' | 'edit'
  label: string
  snippet: string
  attachment?: ReplyToPreview['attachment']
  onCancel: () => void
}

// The reply/edit banner above the textarea, drawn like a quoted message: a
// left rule in the tone of the action, then the label over the snippet. It was
// an inset filled card, which only worked while the composer was a capsule with
// an inside to inset from — the composer is a drawn rectangle now, so a second
// filled rectangle inside it read as a box in a box. The bottom hairline is what
// separates it from the input.
export default function ComposerContextRow({ tone, label, snippet, attachment, onCancel }: Props) {
  const accent = tone === 'reply' ? 'border-l-active/70' : 'border-l-line-2'
  const icon =
    tone === 'reply' ? (
      <Reply size="0.75rem" strokeWidth={1.8} />
    ) : (
      <Pencil size="0.75rem" strokeWidth={1.8} />
    )
  return (
    // `composer-context`: the bubble message style rounds the composer, and this
    // row sits at the top of it — see the note in index.css.
    <div
      className={`composer-context flex items-center gap-2.5 border-b border-l-2 border-b-line px-3 py-2 ${accent}`}
    >
      <div className="flex-1 min-w-0">
        <div
          className={`eyebrow flex items-center gap-1.5 leading-tight ${
            tone === 'reply' ? 'text-active' : ''
          }`}
        >
          {icon}
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-1 truncate text-sm leading-tight text-muted">{snippet || '…'}</div>
      </div>
      {tone === 'reply' && attachment && (
        attachment.mimeType.startsWith('image/') && !attachment.missing ? (
          <img
            src={attachment.previewUrl ?? attachment.url}
            alt=""
            className="h-9 w-9 shrink-0 object-cover bg-black/30"
          />
        ) : (
          <span className="h-9 w-9 shrink-0 border flex items-center justify-center text-muted">
            {attachment.mimeType.startsWith('image/') ? (
              <ImageIcon size="0.9375rem" strokeWidth={1.8} />
            ) : (
              <FileText size="0.9375rem" strokeWidth={1.8} />
            )}
          </span>
        )
      )}
      <button
        type="button"
        onClick={onCancel}
        aria-label={tone === 'reply' ? 'Cancel reply' : 'Cancel edit'}
        className="h-7 w-7 shrink-0 flex items-center justify-center text-muted hover:text-text hover:bg-white/8 transition-colors"
      >
        <X size="0.875rem" strokeWidth={1.9} />
      </button>
    </div>
  )
}
