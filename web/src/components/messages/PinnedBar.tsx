import { useState } from 'react'
import { ChevronDown, Pin, X } from 'lucide-react'
import type { LocalMessage } from './types'

type Props = {
  messages: LocalMessage[]
  onJump: (messageId: string) => void
  onUnpin: (m: LocalMessage) => void
}

// A one-line snippet for a pinned message: its text, else a hint of what it
// carries, so attachment-only pins still read as something.
function snippetFor(m: LocalMessage): string {
  if (m.body) return m.body
  const atts = m.attachments ?? []
  if (atts.some((a) => a.mimeType.startsWith('image/'))) return 'Photo'
  if (atts.length > 0) return atts[0].originalName || 'Attachment'
  return '…'
}

// "Pinned" strip shown at the top of a conversation, below the header. Shared
// across the group. Collapsed it shows the most-recent pin as a single tappable
// row; with more than one pin it expands to the full list. Each row jumps to
// the message; the X unpins it for everyone. Renders nothing when empty.
//
// It aligns to the same centred content column as the messages and composer:
// an inner `.chat-column` plus a right pad that mirrors the scroller's reserved
// scrollbar gutter, so the pin text starts and ends on the message column — not
// stretched edge-to-edge across wide screens.
export default function PinnedBar({ messages, onJump, onUnpin }: Props) {
  const [expanded, setExpanded] = useState(false)
  // Defensive: a pin that gets deleted shouldn't linger in the bar.
  const pins = messages.filter((m) => !m.deletedAt)
  if (pins.length === 0) return null

  const multiple = pins.length > 1
  const visible = expanded ? pins : pins.slice(0, 1)

  return (
    <div className="shrink-0 border-b border-white/[0.06] bg-rail/50">
      <div className="pr-[var(--chat-scrollbar-gutter)]">
        <div className="chat-column">
          <div className="flex items-start gap-3 py-2">
            {/* Label — the only accented part. Fixed width, never shrinks, and
                sized to the row height so it centres against the first pin. */}
            <div className="flex h-7 items-center gap-1.5 text-active shrink-0">
              <Pin size={13} strokeWidth={2} className="fill-current" />
              <span className="text-[12px] font-semibold leading-none tracking-[0.01em]">
                Pinned{multiple ? ` · ${pins.length}` : ''}
              </span>
            </div>

            {/* Pin rows. Each is a single clickable line: author, then snippet
                that truncates with an ellipsis — a long message never wraps or
                stretches across the column. */}
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              {visible.map((m) => (
                <div key={m.id} className="group/pin flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onJump(m.id)}
                    title="Jump to message"
                    className="min-w-0 flex-1 flex h-7 items-center rounded-[4px] -ml-1.5 px-1.5 hover:bg-white/[0.05] transition-colors"
                  >
                    <span className="text-[13px] font-medium text-text/90 shrink-0 leading-5">
                      {m.authorName}
                    </span>
                    <span className="text-faint mx-1.5 shrink-0 leading-5">—</span>
                    <span className="text-[13px] text-muted truncate min-w-0 leading-5">
                      {snippetFor(m)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnpin(m)}
                    aria-label="Unpin message"
                    title="Unpin"
                    className="h-6 w-6 inline-flex items-center justify-center rounded text-faint hover:text-text hover:bg-white/[0.06] transition-colors shrink-0 opacity-0 group-hover/pin:opacity-100 focus:opacity-100"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>

            {/* Expand/collapse the full list. Sized to the row height so it
                lines up with the first pin and the label. */}
            {multiple && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Collapse pinned' : 'Show all pinned'}
                aria-expanded={expanded}
                className="h-7 w-7 inline-flex items-center justify-center rounded text-muted hover:text-text hover:bg-white/[0.06] transition-colors shrink-0"
              >
                <ChevronDown
                  size={15}
                  strokeWidth={1.8}
                  className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
