import { useEffect, useState } from 'react'
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
/** Long enough to read as the row easing shut, short enough that a fast
 *  Escape-and-type does not fight it. Must match the transition in index.css. */
const CLOSE_MS = 200

/**
 * The reply/edit row's presence, separately from its content.
 *
 * The row cannot simply mount and unmount: an unmounted node has no exit, so
 * cancelling a reply made the composer snap shut a row shorter with nothing to
 * explain it (user, 2026-09-08 — an animation on both). So the slot outlives its
 * own content by CLOSE_MS and plays the close on the way out.
 *
 * It re-adopts content only when `contextKey` changes — the message id, not the
 * props object. The caller builds that object inline on every render, so
 * comparing the object itself would adopt on every pass and never settle.
 */
export function ComposerContextSlot({
  contextKey,
  ...props
}: Props & { contextKey: string | null }) {
  const [shown, setShown] = useState<Props | null>(contextKey ? props : null)
  const [shownKey, setShownKey] = useState<string | null>(contextKey)

  // Adopted during render, like the typing row's: the content and the height it
  // occupies have to land in the same commit, or the composer reserve is a
  // frame stale for the gap.
  if (contextKey && contextKey !== shownKey) {
    setShownKey(contextKey)
    setShown(props)
  }

  useEffect(() => {
    if (contextKey) return
    if (!shown) return
    const timer = window.setTimeout(() => {
      setShown(null)
      setShownKey(null)
    }, CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [contextKey, shown])

  if (!shown) return null
  return (
    // A grid whose single row goes 0fr → 1fr: the composer GROWS into the row
    // rather than jumping a row taller and fading text into the space. No
    // measured height anywhere, which is what keeps it honest when the snippet
    // wraps to a different number of lines than the last one did.
    <div className={`composer-context-slot${contextKey ? ' is-open' : ''}`}>
      <div>
        {/* The LIVE cancel handler, not the adopted one: while closing, the
            props are a snapshot, and a snapshot's onCancel would call back into
            a reply that is already gone. */}
        <ComposerContextRow {...shown} onCancel={props.onCancel} />
      </div>
    </div>
  )
}

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
          <span className="h-9 w-9 shrink-0 rounded-tile border flex items-center justify-center text-muted">
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
        className="rounded-btn h-7 w-7 shrink-0 flex items-center justify-center text-muted hover:text-text hover:bg-white/8 transition-colors"
      >
        <X size="0.875rem" strokeWidth={1.9} />
      </button>
    </div>
  )
}
