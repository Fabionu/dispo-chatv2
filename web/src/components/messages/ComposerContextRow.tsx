import { Pencil, Reply, X } from 'lucide-react'

type Props = {
  tone: 'reply' | 'edit'
  label: string
  snippet: string
  onCancel: () => void
}

// A small row that lives above the composer's textarea — used by both the
// reply-context preview and the editing-message indicator. The tone changes
// the accent bar so the two states are distinguishable at a glance.
export default function ComposerContextRow({ tone, label, snippet, onCancel }: Props) {
  const accent = tone === 'reply' ? 'border-active/60' : 'border-white/[0.18]'
  const icon =
    tone === 'reply' ? (
      <Reply size="0.75rem" strokeWidth={1.8} />
    ) : (
      <Pencil size="0.75rem" strokeWidth={1.8} />
    )
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 border-b border-white/[0.06]">
      <div className={`pl-2 border-l-2 ${accent} flex-1 min-w-0`}>
        <div className="flex items-center gap-1.5 text-[0.6875rem] text-muted">
          <span className="text-active">{icon}</span>
          <span>{label}</span>
        </div>
        <div className="text-[0.75rem] text-muted truncate italic mt-0.5">{snippet || '…'}</div>
      </div>
      <button
        onClick={onCancel}
        aria-label={tone === 'reply' ? 'Cancel reply' : 'Cancel edit'}
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
      >
        <X size="0.8125rem" strokeWidth={1.8} />
      </button>
    </div>
  )
}
