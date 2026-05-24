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

// A message that may not have hit the server yet. `localId` is the temporary
// id we render under until the API returns the real message; `pending` /
// `failed` drive the bubble's visual state.
type LocalMessage = Message & {
  localId?: string
  pending?: boolean
  failed?: boolean
}

export default function ChatView({ group, currentUserId, onRead }: Props) {
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
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
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        // If this is the server echo of one of our own pending optimistic
        // messages, replace by matching body so the bubble doesn't briefly
        // double up before the POST response arrives.
        if (msg.authorId === currentUserId) {
          const idx = prev.findIndex(
            (m) => m.pending && m.authorId === currentUserId && m.body === msg.body,
          )
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = msg
            return next
          }
        }
        return [...prev, msg]
      })
      markRead()
    }
    socket.on('message:new', onNew)
    return () => {
      socket.off('message:new', onNew)
    }
  }, [group.id, currentUserId, markRead])

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

  // Optimistic send. The bubble appears instantly under a temporary localId
  // and is reconciled when the server returns (or the socket echoes first).
  // The composer never blocks: the user can keep typing the next message.
  async function sendBody(body: string) {
    if (!body) return
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: LocalMessage = {
      id: localId,
      localId,
      authorId: currentUserId,
      authorName: '',
      body,
      createdAt: new Date().toISOString(),
      pending: true,
    }
    setMessages((prev) => [...prev, optimistic])
    nearBottomRef.current = true

    try {
      const res = await api.groups.postMessage(group.id, body)
      setMessages((prev) => {
        // If the socket beat the POST and already added the real message,
        // drop the optimistic. Otherwise swap it in place.
        if (prev.some((m) => m.id === res.message.id)) {
          return prev.filter((m) => m.id !== localId)
        }
        return prev.map((m) => (m.id === localId ? res.message : m))
      })
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === localId ? { ...m, pending: false, failed: true } : m)),
      )
      // Surface the rate-limit case at the top so the user understands why
      // their messages are queueing up as failed. Generic failures are
      // signalled on the bubble itself.
      if (err instanceof ApiError && err.code === 'too_many_requests') {
        setError('Slow down — too many messages.')
      }
    }
  }

  function send() {
    const body = text.trim()
    if (!body) return
    setText('')
    setError(null)
    void sendBody(body)
  }

  function retry(localId: string, body: string) {
    setMessages((prev) => prev.filter((m) => m.id !== localId))
    void sendBody(body)
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
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
        <div className="mx-auto w-full xl:max-w-[960px] 2xl:max-w-[1040px]">
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
                  onRetry={retry}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="px-5 pb-4 pt-1 shrink-0">
        <div className="mx-auto w-full xl:max-w-[960px] 2xl:max-w-[1040px]">
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
              onClick={send}
              disabled={!text.trim()}
              aria-label="Send message"
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-chip bg-text text-bg transition-opacity disabled:opacity-30"
            >
              <ArrowUp size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function MessageRow({
  message,
  mine,
  prev,
  onRetry,
}: {
  message: LocalMessage
  mine: boolean
  prev?: LocalMessage
  onRetry: (localId: string, body: string) => void
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

  const pending = message.pending === true
  const failed = message.failed === true

  const bubbleBase = 'max-w-[78%] px-3 pt-1.5 pb-1 text-[13px] leading-[1.5] flex flex-col text-text'
  const bubbleSkin = mine
    ? failed
      ? 'bg-[#222225] border border-alert/50 rounded-[7px] rounded-br-[2px]'
      : 'bg-[#222225] border border-white/[0.06] rounded-[7px] rounded-br-[2px]'
    : 'bg-surface border border-white/[0.08] rounded-[7px] rounded-bl-[2px]'

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
        <div className={`${bubbleBase} ${bubbleSkin} ${pending ? 'opacity-70' : ''}`}>
          <span className="whitespace-pre-wrap break-words">{message.body}</span>
          <span className="text-[10.5px] text-muted leading-none mt-1 self-end">
            {pending ? 'Sending…' : failed ? 'Failed' : formatTime(message.createdAt)}
          </span>
        </div>
        {failed && mine && message.localId && (
          <button
            onClick={() => onRetry(message.localId!, message.body)}
            className="text-[10.5px] text-alert hover:text-text transition-colors mt-1 px-1"
          >
            Tap to retry
          </button>
        )}
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
