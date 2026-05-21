import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import type { Group, IncomingMessage, Message } from '../lib/types'
import { groupLabel } from '../lib/types'
import { api, ApiError } from '../lib/api'
import { getSocket } from '../lib/socket'

type Props = {
  group: Group
  currentUserId: string
  onRead: (groupId: string) => void
}

export default function ChatView({ group, currentUserId, onRead }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  // When prepending older messages we must keep the viewport anchored — we
  // record scrollHeight before the prepend and restore the delta after.
  const prependAnchorRef = useRef<number | null>(null)

  const markRead = useCallback(() => {
    api.groups
      .markRead(group.id)
      .then(() => onRead(group.id))
      .catch(() => {})
  }, [group.id, onRead])

  // Initial history load. `key={group.id}` on the parent remounts this
  // component per group, so this runs fresh each time.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.groups
      .messages(group.id)
      .then((res) => {
        if (cancelled) return
        setMessages(res.messages)
        setNextCursor(res.nextCursor)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    markRead()
    return () => {
      cancelled = true
    }
  }, [group.id, markRead])

  // Live messages for this group.
  useEffect(() => {
    const socket = getSocket()
    function onNew(msg: IncomingMessage) {
      if (msg.groupId !== group.id) return
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
      markRead()
    }
    socket.on('message:new', onNew)
    return () => {
      socket.off('message:new', onNew)
    }
  }, [group.id, markRead])

  // Scroll management. After the initial load jump to the newest message;
  // after a live message only follow if the user was already at the bottom;
  // after a prepend, restore the prior anchor so the view doesn't jump.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prependAnchorRef.current !== null) {
      el.scrollTop = el.scrollHeight - prependAnchorRef.current
      prependAnchorRef.current = null
      return
    }
    if (loading) return
    if (nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    nearBottomRef.current = distanceFromBottom < 120
  }

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const res = await api.groups.messages(group.id, nextCursor)
      const el = scrollRef.current
      prependAnchorRef.current = el ? el.scrollHeight : null
      setMessages((prev) => [...res.messages, ...prev])
      setNextCursor(res.nextCursor)
    } finally {
      setLoadingOlder(false)
    }
  }

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    nearBottomRef.current = true
    try {
      const res = await api.groups.postMessage(group.id, body)
      setText('')
      // Socket echoes our own message too; dedup by id.
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]))
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'too_many_requests'
          ? 'Slow down — too many messages.'
          : 'Failed to send. Try again.',
      )
    } finally {
      setSending(false)
    }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const subtitle =
    group.type === 'vehicle'
      ? group.meta.trip ?? `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`
      : (group.directPeer?.workspace ?? 'Direct message')

  return (
    <>
      {/* Header */}
      <header className="h-12 flex items-center justify-between px-5 border-b border-white/[0.06] shrink-0">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold truncate">{groupLabel(group)}</div>
          <div className="text-[11px] text-muted truncate">{subtitle}</div>
        </div>
        {group.type === 'vehicle' && group.meta.plate && (
          <span className="font-mono text-[11px] text-muted border border-white/[0.08] rounded-chip px-2 py-0.5 shrink-0">
            {group.meta.plate}
          </span>
        )}
      </header>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="text-[12px] text-faint">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-[12.5px] text-faint">No messages yet. Say something.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {nextCursor && (
              <div className="flex justify-center pb-3">
                <button
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="text-[11.5px] text-muted hover:text-text border border-white/[0.10] rounded-chip px-3 py-1 transition-colors disabled:opacity-50"
                >
                  {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                </button>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageRow
                key={m.id}
                message={m}
                mine={m.authorId === currentUserId}
                prev={messages[i - 1]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="px-5 pb-4 pt-1 shrink-0">
        {error && <div className="text-[11.5px] text-alert mb-1.5">{error}</div>}
        <div className="flex items-end gap-2 rounded-card border border-white/[0.08] bg-white/[0.02] focus-within:border-white/[0.16] transition-colors px-3 py-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onComposerKeyDown}
            rows={1}
            placeholder={`Message ${groupLabel(group)}`}
            className="flex-1 bg-transparent text-[13px] leading-[1.5] outline-none resize-none placeholder:text-faint max-h-32 py-1"
          />
          <button
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            aria-label="Send message"
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded-chip bg-text text-bg transition-opacity disabled:opacity-30"
          >
            <ArrowUp size={15} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </>
  )
}

function MessageRow({
  message,
  mine,
  prev,
}: {
  message: Message
  mine: boolean
  prev?: Message
}) {
  // Collapse the author line when the previous message is from the same
  // author within a couple of minutes — keeps bursts readable.
  const sameAuthorAsPrev =
    prev !== undefined &&
    prev.authorId === message.authorId &&
    new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < 4 * 60 * 1000

  const showDayDivider =
    prev === undefined ||
    new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString()

  return (
    <>
      {showDayDivider && (
        <div className="flex items-center gap-3 py-3">
          <div className="h-px flex-1 bg-white/[0.06]" />
          <span className="eyebrow">{formatDay(message.createdAt)}</span>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>
      )}
      <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'} ${sameAuthorAsPrev ? 'mt-0.5' : 'mt-2.5'}`}>
        {!mine && !sameAuthorAsPrev && (
          <div className="text-[11px] text-muted mb-1 px-1">{message.authorName}</div>
        )}
        <div
          className={`max-w-[78%] px-3 py-1.5 text-[13px] leading-[1.5] whitespace-pre-wrap break-words ${
            mine
              ? 'bg-text text-bg rounded-[7px] rounded-br-[2px]'
              : 'bg-surface border border-white/[0.08] text-text rounded-[7px] rounded-bl-[2px]'
          }`}
        >
          {message.body}
        </div>
        <div className="text-[10px] text-faint mt-0.5 px-1 font-mono">
          {formatTime(message.createdAt)}
        </div>
      </div>
    </>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}
