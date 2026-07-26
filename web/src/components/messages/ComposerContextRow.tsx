import { FileText, Image as ImageIcon, Pencil, Reply, X } from 'lucide-react'
import type { ReplyToPreview } from '../../lib/types'

type Props = {
  tone: 'reply' | 'edit'
  label: string
  snippet: string
  attachment?: ReplyToPreview['attachment']
  onCancel: () => void
}

// A compact inset card above the textarea. Keeping it inside the composer's
// edges (instead of stretching a divider across the entire capsule) makes the
// reply/edit state feel like contextual content rather than a second toolbar.
export default function ComposerContextRow({ tone, label, snippet, attachment, onCancel }: Props) {
  const accent = tone === 'reply' ? 'bg-active/70' : 'bg-white/[0.22]'
  const icon =
    tone === 'reply' ? (
      <Reply size="0.75rem" strokeWidth={1.8} />
    ) : (
      <Pencil size="0.75rem" strokeWidth={1.8} />
    )
  return (
    <div className="mx-2 mt-2 flex items-center gap-2.5 rounded-[1.125rem] bg-white/[0.045] px-2.5 py-2">
      <span className={`h-8 w-0.5 shrink-0 rounded-full ${accent}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-[0.75rem] font-medium leading-tight text-text">
          <span className={tone === 'reply' ? 'text-active' : 'text-muted'}>{icon}</span>
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-1 truncate text-[0.75rem] leading-tight text-muted">
          {snippet || '…'}
        </div>
      </div>
      {tone === 'reply' && attachment && (
        attachment.mimeType.startsWith('image/') && !attachment.missing ? (
          <img
            src={attachment.previewUrl ?? attachment.url}
            alt=""
            className="h-9 w-9 shrink-0 rounded-[0.5rem] object-cover bg-black/30"
          />
        ) : (
          <span className="h-9 w-9 shrink-0 rounded-[0.5rem] bg-white/[0.055] flex items-center justify-center text-muted">
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
        className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.08] transition-colors"
      >
        <X size="0.875rem" strokeWidth={1.9} />
      </button>
    </div>
  )
}
