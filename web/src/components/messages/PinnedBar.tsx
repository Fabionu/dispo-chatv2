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
export default function PinnedBar({ messages, onJump, onUnpin }: Props) {
  const [expanded, setExpanded] = useState(false)
  // Defensive: a pin that gets deleted shouldn't linger in the bar.
  const pins = messages.filter((m) => !m.deletedAt)
  if (pins.length === 0) return null

  const multiple = pins.length > 1
  const visible = expanded ? pins : pins.slice(0, 1)

  return (
    <div className="shrink-0 border-b border-white/[0.06] bg-rail/60">
      <div className="mx-auto w-full xl:max-w-[1280px] 2xl:max-w-[1440px] min-[1700px]:max-w-[1560px] px-5 py-1.5">
        <div className="flex items-start gap-2">
          <div className="flex items-center gap-1.5 text-active shrink-0 pt-1">
            <Pin size={12} strokeWidth={2} className="fill-current" />
            <span className="text-[11px] font-medium">
              Pinned{multiple ? ` · ${pins.length}` : ''}
            </span>
          </div>

          <div className="min-w-0 flex-1 flex flex-col gap-0.5">
            {visible.map((m) => (
              <div key={m.id} className="group/pin flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onJump(m.id)}
                  title="Jump to message"
                  className="min-w-0 flex-1 text-left rounded-[3px] px-1.5 py-0.5 hover:bg-white/[0.04] transition-colors"
                >
                  <span className="text-[11px] text-active">{m.authorName}</span>
                  <span className="text-[12px] text-muted truncate ml-1.5 align-baseline">
                    {snippetFor(m)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onUnpin(m)}
                  aria-label="Unpin message"
                  title="Unpin"
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-faint hover:text-text hover:bg-white/[0.06] transition-colors shrink-0 opacity-0 group-hover/pin:opacity-100 focus:opacity-100"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>

          {multiple && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse pinned' : 'Show all pinned'}
              aria-expanded={expanded}
              className="h-6 w-6 inline-flex items-center justify-center rounded text-muted hover:text-text hover:bg-white/[0.06] transition-colors shrink-0"
            >
              <ChevronDown
                size={14}
                strokeWidth={1.8}
                className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
