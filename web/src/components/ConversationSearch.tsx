import { useMemo, type ReactNode } from 'react'
import type { LocalMessage } from './messages/types'
import { formatTime } from './messages/messageUtils'

type Props = {
  // The active search query. Owned by the header search field in ChatView (this
  // component is a pure results view) — trimmed/lowercased internally.
  query: string
  // The messages already loaded for the active thread (DM or vehicle group —
  // same shape either way). Search is local: there's no server message-search
  // endpoint, and the loaded thread is what the user can actually scroll to.
  messages: LocalMessage[]
  currentUserId: string
  // Reuse ChatView's jump-to-message (scroll + transient highlight).
  onJump: (messageId: string) => void
}

const MAX_RESULTS = 50

// In-conversation message search RESULTS, rendered as a compact floating dropdown
// anchored under the header's inline search field (see ChatView). It's absolutely
// positioned so it OVERLAYS the message list and never pushes the chat content
// down — keeping as much vertical space for messages as possible. Filters the
// loaded thread by text (case-insensitive), lists matches newest-first, and jumps
// to a message on click. Works identically for DMs and vehicle groups. Renders
// nothing until there's a non-empty query.
export default function ConversationSearch({ query, messages, currentUserId, onJump }: Props) {
  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!q) return []
    return messages
      .filter(
        (m) => m.kind !== 'system' && !m.deletedAt && m.body && m.body.toLowerCase().includes(q),
      )
      .slice()
      .reverse() // newest first
      .slice(0, MAX_RESULTS)
  }, [messages, q])

  if (!q) return null

  return (
    // Floating, borderless results panel pinned to the top-right of the chat
    // pane, just under the header's search field. z-30 lifts it above the
    // messages + composer; the rounded `surface` fill + shadow define it without
    // a border (matching the app's borderless direction).
    <div
      data-search-region
      className="absolute right-4 top-[3.625rem] z-30 w-[min(22.5rem,calc(100%-2rem))] rounded-[0.75rem] bg-surface shadow-[0_16px_40px_rgba(0,0,0,0.55)] overflow-hidden"
    >
      <div className="max-h-[min(50vh,26.25rem)] overflow-y-auto">
        {results.length === 0 ? (
          <div className="px-3 py-4 text-[0.78125rem] text-faint">No messages found</div>
        ) : (
          <div className="py-1">
            <div className="px-3 pt-1 pb-1 text-[0.65625rem] uppercase tracking-wide text-faint">
              {results.length}
              {results.length === MAX_RESULTS ? '+' : ''}{' '}
              {results.length === 1 ? 'result' : 'results'}
            </div>
            {results.map((m) => (
              <button
                key={m.id}
                onClick={() => onJump(m.id)}
                className="w-full text-left px-3 py-1.5 hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[0.75rem] font-semibold text-text truncate">
                    {m.authorId === currentUserId ? 'You' : m.authorName || 'Member'}
                  </span>
                  <span className="text-[0.65625rem] text-faint tabular-nums shrink-0">
                    {formatTime(m.createdAt)}
                  </span>
                </div>
                <div className="text-[0.75rem] text-muted truncate">{highlight(m.body, q)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Render a one-line snippet around the first match, with every occurrence of the
// query subtly accented so matches are easy to scan.
function highlight(body: string, query: string): ReactNode {
  const lower = body.toLowerCase()
  const first = lower.indexOf(query)
  if (first < 0) return body

  // Trim to a window starting a little before the first match so it's visible.
  const start = Math.max(0, first - 24)
  const slice = body.slice(start)
  const sliceLower = slice.toLowerCase()
  const prefix = start > 0 ? '…' : ''

  const parts: ReactNode[] = []
  let last = 0
  let from = 0
  for (;;) {
    const i = sliceLower.indexOf(query, from)
    if (i < 0) break
    if (i > last) parts.push(slice.slice(last, i))
    parts.push(
      <span key={i} className="rounded-[2px] bg-active/15 px-0.5 font-medium text-text">
        {slice.slice(i, i + query.length)}
      </span>,
    )
    last = i + query.length
    from = last
  }
  parts.push(slice.slice(last))

  return (
    <>
      {prefix}
      {parts}
    </>
  )
}
