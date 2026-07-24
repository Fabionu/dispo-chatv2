import { useEffect, useState, type ReactNode } from 'react'
import { api, type MessageSearchResult } from '../lib/api'
import { formatTime } from './messages/messageUtils'

type Props = {
  query: string
  groupId: string
  currentUserId: string
  onJump: (result: MessageSearchResult) => void
}

// Full-history conversation search. Requests are debounced so typing does not
// hit the API on every keystroke; the server uses a trigram index and enforces
// membership plus per-user message deletions.
export default function ConversationSearch({ query, groupId, currentUserId, onJump }: Props) {
  const q = query.trim()
  const [results, setResults] = useState<MessageSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (q.length < 2) {
      setResults([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      api.groups
        .searchMessages(groupId, q)
        .then(({ results: next }) => {
          if (!cancelled) setResults(next)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [groupId, q])

  if (!q) return null

  return (
    <div
      data-search-region
      className="absolute right-4 top-[3.625rem] z-30 w-[min(22.5rem,calc(100%-2rem))] rounded-panel bg-surface shadow-[0_16px_40px_rgba(0,0,0,0.55)] overflow-hidden"
    >
      <div className="max-h-[min(50vh,26.25rem)] overflow-y-auto">
        {q.length < 2 ? (
          <div className="px-3 py-4 text-[0.78125rem] text-faint">
            Type at least 2 characters
          </div>
        ) : loading ? (
          <div className="px-3 py-4 text-[0.78125rem] text-faint">Searching…</div>
        ) : results.length === 0 ? (
          <div className="px-3 py-4 text-[0.78125rem] text-faint">No messages found</div>
        ) : (
          <div className="py-1">
            <div className="px-3 pt-1 pb-1 text-[0.65625rem] uppercase tracking-wide text-faint">
              {results.length}
              {results.length === 50 ? '+' : ''} {results.length === 1 ? 'result' : 'results'}
            </div>
            {results.map((message) => (
              <button
                key={message.id}
                type="button"
                onClick={() => onJump(message)}
                className="w-full text-left px-3 py-1.5 hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[0.75rem] font-semibold text-text truncate">
                    {message.authorId === currentUserId
                      ? 'You'
                      : message.authorName || 'Member'}
                  </span>
                  <span
                    className="text-[0.65625rem] text-faint tabular-nums shrink-0"
                    title={new Date(message.createdAt).toLocaleString()}
                  >
                    {resultTimestamp(message.createdAt)}
                  </span>
                </div>
                <div className="text-[0.75rem] text-muted truncate">
                  {highlight(message.body, q.toLowerCase())}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function resultTimestamp(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return formatTime(iso)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

function highlight(body: string, query: string): ReactNode {
  const lower = body.toLowerCase()
  const first = lower.indexOf(query)
  if (first < 0) return body

  const start = Math.max(0, first - 24)
  const slice = body.slice(start)
  const sliceLower = slice.toLowerCase()
  const prefix = start > 0 ? '…' : ''

  const parts: ReactNode[] = []
  let last = 0
  let from = 0
  for (;;) {
    const index = sliceLower.indexOf(query, from)
    if (index < 0) break
    if (index > last) parts.push(slice.slice(last, index))
    parts.push(
      <span key={index} className="rounded-[2px] bg-active/15 px-0.5 font-medium text-text">
        {slice.slice(index, index + query.length)}
      </span>,
    )
    last = index + query.length
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
