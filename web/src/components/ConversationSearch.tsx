import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import type { LocalMessage } from './messages/types'
import { formatTime } from './messages/messageUtils'

type Props = {
  // The messages already loaded for the active thread (DM or vehicle group —
  // same shape either way). Search is local: there's no server message-search
  // endpoint, and the loaded thread is what the user can actually scroll to.
  messages: LocalMessage[]
  currentUserId: string
  // Reuse ChatView's jump-to-message (scroll + transient highlight).
  onJump: (messageId: string) => void
  onClose: () => void
}

const MAX_RESULTS = 50

// In-conversation message search: a compact panel that drops under the chat
// header. Filters the loaded thread by text (case-insensitive), lists matches
// newest-first, and jumps to a message on click. Works identically for DMs and
// vehicle groups.
export default function ConversationSearch({ messages, currentUserId, onJump, onClose }: Props) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the field on open; Escape closes.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const query = q.trim().toLowerCase()
  const results = useMemo(() => {
    if (!query) return []
    return messages
      .filter(
        (m) => m.kind !== 'system' && !m.deletedAt && m.body && m.body.toLowerCase().includes(query),
      )
      .slice()
      .reverse() // newest first
      .slice(0, MAX_RESULTS)
  }, [messages, query])

  return (
    <div className="shrink-0 border-b border-white/[0.06] bg-bg">
      {/* Input row */}
      <div className="flex items-center gap-2 px-3 h-11">
        <Search size={15} strokeWidth={1.8} className="text-faint shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search this conversation…"
          className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        {q && (
          <button
            onClick={() => {
              setQ('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="h-6 w-6 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
        <button
          onClick={onClose}
          className="h-7 px-2.5 flex items-center rounded-md text-[12px] text-muted hover:text-text hover:bg-white/[0.06] transition-colors shrink-0"
        >
          Close
        </button>
      </div>

      {/* Results — only once there's a query. */}
      {query && (
        <div className="max-h-[40vh] overflow-y-auto border-t border-white/[0.05]">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-[12.5px] text-faint">No messages found</div>
          ) : (
            <div className="py-1">
              <div className="px-3 pt-1 pb-1 text-[10.5px] uppercase tracking-wide text-faint">
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
                    <span className="text-[12px] font-semibold text-text truncate">
                      {m.authorId === currentUserId ? 'You' : m.authorName || 'Member'}
                    </span>
                    <span className="text-[10.5px] text-faint tabular-nums shrink-0">
                      {formatTime(m.createdAt)}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted truncate">{highlight(m.body, query)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
