import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import type { Attachment, Group, IncomingMessage, ReplyToPreview } from '../lib/types'
import { groupLabel } from '../lib/types'
import { api, ApiError } from '../lib/api'
import { getSocket } from '../lib/socket'
import ImagePreviewModal from './attachments/ImagePreviewModal'
import InlinePdfPreview from './attachments/InlinePdfPreview'
import ChatComposer, { type ChatComposerHandle, type EditContext } from './composer/ChatComposer'
import MessageRow from './messages/MessageRow'
import ForwardModal from './messages/ForwardModal'
import ConfirmDialog from './ConfirmDialog'
import { initials, minuteKey } from './messages/messageUtils'
import type { LocalMessage } from './messages/types'
import { useChatScroll } from '../hooks/useChatScroll'

type Props = {
  group: Group
  currentUserId: string
  onRead: (groupId: string) => void
  // Open (or reuse) a 1:1 DM with another user — used by the "Reply privately"
  // and "Send message in private" actions. The caller has already created the
  // group server-side; this just navigates to it. `reply` (when present)
  // carries the quoted message context into the destination DM's composer.
  onOpenDirectMessage: (
    info: { groupId: string; peerId: string; peerName: string },
    reply?: ReplyToPreview,
  ) => void
  // A reply quote to seed the composer with on mount — set when this view was
  // opened via "Reply privately" from another conversation.
  initialReplyContext?: ReplyToPreview | null
  // Called once after the seeded reply context has been consumed, so the
  // parent can drop it (and not re-seed on a later remount of this group).
  onConsumeInitialReply?: () => void
}

// Build the compact reply snapshot the composer + bubble render from a message.
function toReplyPreview(m: LocalMessage): ReplyToPreview {
  return {
    id: m.id,
    authorName: m.authorName,
    body: m.body,
    hasAttachments: (m.attachments?.length ?? 0) > 0,
    deleted: Boolean(m.deletedAt),
  }
}

export default function ChatView({
  group,
  currentUserId,
  onRead,
  onOpenDirectMessage,
  initialReplyContext = null,
  onConsumeInitialReply,
}: Props) {
  // ── Core state ─────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)
  const [pdfAttachment, setPdfAttachment] = useState<Attachment | null>(null)
  // Reply context: when set, the composer shows the quoted preview and the
  // next outbound message is sent with `replyToMessageId` filled in. Seeded
  // from `initialReplyContext` when this view was opened via "Reply privately".
  const [replyContext, setReplyContext] = useState<ReplyToPreview | null>(initialReplyContext)
  // Edit context: when set, the composer is in "Editing message" mode and
  // pressing send PATCHes the existing message instead of POSTing a new one.
  const [editContext, setEditContext] = useState<EditContext | null>(null)
  // Message currently being forwarded (drives the picker modal).
  const [forwardTarget, setForwardTarget] = useState<LocalMessage | null>(null)
  // Pending delete awaiting confirmation. `scope` picks which delete runs.
  const [pendingDelete, setPendingDelete] = useState<{
    message: LocalMessage
    scope: 'me' | 'everyone'
  } | null>(null)
  // Transient confirmation after a successful forward.
  const [notice, setNotice] = useState<string | null>(null)
  // Row to briefly pulse after a jump-to-original; cleared on a timer.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)

  const composerHandleRef = useRef<ChatComposerHandle>(null)
  const highlightTimer = useRef<number | undefined>(undefined)
  const noticeTimer = useRef<number | undefined>(undefined)

  // ── Scroll / autosize ──────────────────────────────────────────────────
  const {
    scrollRef,
    composerRef,
    onScroll,
    scrollToBottom,
    showScrollDown,
    handleImageLoaded,
    anchorBeforePrepend,
    pinToBottomNext,
  } = useChatScroll(messages, loading)

  useEffect(
    () => () => {
      window.clearTimeout(highlightTimer.current)
      window.clearTimeout(noticeTimer.current)
    },
    [],
  )

  // If opened via "Reply privately", the composer is pre-seeded with the quote
  // (state initializer above). Focus it so the user can type immediately, and
  // tell the parent to drop the seed so a later remount doesn't re-apply it.
  useEffect(() => {
    if (!initialReplyContext) return
    composerHandleRef.current?.focus()
    onConsumeInitialReply?.()
    // Mount-only: the seed is captured once into state; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function flashNotice(msg: string) {
    setNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2200)
  }

  // ── Read receipts ──────────────────────────────────────────────────────
  const markRead = useCallback(() => {
    api.groups
      .markRead(group.id)
      .then(() => onRead(group.id))
      .catch(() => {})
  }, [group.id, onRead])

  // ── Initial history load ───────────────────────────────────────────────
  // `key={group.id}` on the parent remounts this component per group, so
  // this runs fresh each time.
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

  // ── Live socket events ─────────────────────────────────────────────────
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
    function onEdited(p: { id: string; groupId: string; body: string; editedAt: string }) {
      if (p.groupId !== group.id) return
      setMessages((prev) =>
        prev.map((m) => (m.id === p.id ? { ...m, body: p.body, editedAt: p.editedAt } : m)),
      )
    }
    function onDeleted(p: {
      id: string
      groupId: string
      deletedAt: string
      deletedBy: string
    }) {
      if (p.groupId !== group.id) return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === p.id
            ? { ...m, body: '', attachments: [], deletedAt: p.deletedAt, deletedBy: p.deletedBy }
            : m,
        ),
      )
    }
    // Per-user "delete for me" — emitted to the user's room so this user's
    // other tabs/devices hide the message too.
    function onHidden(p: { groupId: string; id: string }) {
      if (p.groupId !== group.id) return
      setMessages((prev) => prev.filter((m) => m.id !== p.id))
    }
    socket.on('message:new', onNew)
    socket.on('message:edited', onEdited)
    socket.on('message:deleted', onDeleted)
    socket.on('message:hidden', onHidden)
    return () => {
      socket.off('message:new', onNew)
      socket.off('message:edited', onEdited)
      socket.off('message:deleted', onDeleted)
      socket.off('message:hidden', onHidden)
    }
  }, [group.id, currentUserId, markRead])

  // ── Older messages (paginated) ─────────────────────────────────────────
  async function loadOlder() {
    if (!nextCursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const res = await api.groups.messages(group.id, nextCursor)
      anchorBeforePrepend()
      setMessages((prev) => [...res.messages, ...prev])
      setNextCursor(res.nextCursor)
    } finally {
      setLoadingOlder(false)
    }
  }

  // ── Attachment activation (image lightbox / PDF inline / file download) ──
  const activateAttachment = useCallback((a: Attachment) => {
    if (!a.url) return
    if (a.mimeType.startsWith('image/')) {
      setPreviewAttachment(a)
    } else if (a.mimeType === 'application/pdf') {
      setPdfAttachment(a)
    } else {
      const link = document.createElement('a')
      link.href = a.url
      link.download = a.originalName
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
    }
  }, [])

  // ── Send / edit / retry ────────────────────────────────────────────────
  async function sendBody(
    body: string,
    attachedFile: File | null,
    replyTo: ReplyToPreview | null,
  ) {
    if (!body && !attachedFile) return
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // For images, show the local blob URL on the optimistic bubble so the
    // user sees their picture immediately. For documents, we still preview
    // a card with name/size — no URL needed until the server returns one.
    const optimisticAttachment: Attachment | null = attachedFile
      ? {
          id: `${localId}-att`,
          originalName: attachedFile.name,
          mimeType: attachedFile.type,
          byteSize: attachedFile.size,
          url: attachedFile.type.startsWith('image/')
            ? URL.createObjectURL(attachedFile)
            : '',
        }
      : null

    const optimistic: LocalMessage = {
      id: localId,
      localId,
      authorId: currentUserId,
      authorName: '',
      body,
      createdAt: new Date().toISOString(),
      pending: true,
      attachments: optimisticAttachment ? [optimisticAttachment] : undefined,
      pendingFile: attachedFile ?? undefined,
      replyTo: replyTo,
    }
    setMessages((prev) => [...prev, optimistic])
    pinToBottomNext()

    try {
      const res = await api.groups.postMessage(
        group.id,
        body,
        attachedFile,
        replyTo?.id ?? null,
      )
      setMessages((prev) => {
        // If the socket beat the POST and already added the real message,
        // drop the optimistic. Otherwise swap it in place.
        if (prev.some((m) => m.id === res.message.id)) {
          return prev.filter((m) => m.id !== localId)
        }
        return prev.map((m) => (m.id === localId ? res.message : m))
      })
      // Revoke the optimistic blob URL — the bubble now uses the server URL.
      if (optimisticAttachment?.url.startsWith('blob:')) {
        URL.revokeObjectURL(optimisticAttachment.url)
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === localId ? { ...m, pending: false, failed: true } : m)),
      )
      if (err instanceof ApiError) {
        if (err.code === 'too_many_requests') {
          setError('Slow down — too many messages.')
        } else if (err.code === 'image_too_large' || err.code === 'file_too_large') {
          setError('That file is too large.')
        }
      }
    }
  }

  // Edit submit: PATCH the message, optimistically reflect locally, revert
  // on failure. The socket message:edited will arrive shortly with the real
  // editedAt — we keep our optimistic stamp until then.
  async function submitEdit(messageId: string, body: string, originalBody: string) {
    if (!body) return
    if (body === originalBody) {
      setEditContext(null)
      setText('')
      return
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, body, editedAt: new Date().toISOString() } : m,
      ),
    )
    setEditContext(null)
    setText('')
    setError(null)
    try {
      await api.groups.editMessage(group.id, messageId, body)
    } catch {
      // Best-effort revert.
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, body: originalBody } : m)),
      )
      setError('Could not save edit.')
    }
  }

  function send() {
    if (editContext) {
      void submitEdit(editContext.id, text.trim(), editContext.originalBody)
      return
    }
    const body = text.trim()
    const f = file
    if (!body && !f) return
    const reply = replyContext
    setText('')
    setFile(null)
    setReplyContext(null)
    setError(null)
    void sendBody(body, f, reply)
  }

  function retry(localId: string, body: string, attachedFile: File | null) {
    setMessages((prev) => prev.filter((m) => m.id !== localId))
    void sendBody(body, attachedFile, null)
  }

  // ── Message action callbacks ───────────────────────────────────────────
  function startReply(m: LocalMessage) {
    setEditContext(null)
    setReplyContext(toReplyPreview(m))
    composerHandleRef.current?.focus()
  }

  function startEdit(m: LocalMessage) {
    setReplyContext(null)
    setEditContext({ id: m.id, originalBody: m.body })
    setText(m.body)
    setFile(null)
    // Defer focus until React applies the new text; without this the cursor
    // can land before the value is set.
    requestAnimationFrame(() => composerHandleRef.current?.focus())
  }

  function cancelEdit() {
    setEditContext(null)
    setText('')
  }

  async function deleteForEveryone(m: LocalMessage) {
    const original = { body: m.body, attachments: m.attachments }
    const now = new Date().toISOString()
    setMessages((prev) =>
      prev.map((row) =>
        row.id === m.id
          ? {
              ...row,
              body: '',
              attachments: [],
              deletedAt: now,
              deletedBy: currentUserId,
            }
          : row,
      ),
    )
    try {
      await api.groups.deleteForEveryone(group.id, m.id)
    } catch {
      setMessages((prev) =>
        prev.map((row) =>
          row.id === m.id
            ? {
                ...row,
                body: original.body,
                attachments: original.attachments,
                deletedAt: null,
                deletedBy: null,
              }
            : row,
        ),
      )
      setError('Could not delete message.')
    }
  }

  // Hide a single message for the current user only. Optimistically remove it
  // and restore at its original position if the request fails.
  async function deleteForMe(m: LocalMessage) {
    let removedIndex = -1
    setMessages((prev) => {
      removedIndex = prev.findIndex((x) => x.id === m.id)
      return prev.filter((x) => x.id !== m.id)
    })
    try {
      await api.groups.deleteForMe(group.id, m.id)
    } catch {
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev
        const next = [...prev]
        next.splice(removedIndex >= 0 ? Math.min(removedIndex, next.length) : next.length, 0, m)
        return next
      })
      setError('Could not delete message.')
    }
  }

  // The menu actions open a confirmation first; the actual delete runs only
  // once the user confirms.
  function confirmPendingDelete() {
    if (!pendingDelete) return
    const { message, scope } = pendingDelete
    setPendingDelete(null)
    if (scope === 'everyone') void deleteForEveryone(message)
    else void deleteForMe(message)
  }

  // Open (or reuse) a private DM with a message's author. Connection rules are
  // enforced server-side by createDirect. When `reply` is passed (from "Reply
  // privately") the quote is carried into the destination DM's composer.
  async function openPrivate(m: LocalMessage, reply?: ReplyToPreview) {
    setError(null)
    try {
      const { group: dm } = await api.groups.createDirect(m.authorId)
      onOpenDirectMessage({ groupId: dm.id, peerId: m.authorId, peerName: m.authorName }, reply)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'connection_required'
          ? 'Connect with this person before messaging.'
          : 'Could not open a private conversation.',
      )
    }
  }

  // "Reply privately": open a DM with the author and carry the quoted message
  // as reply context. If the DM already exists this just navigates to it with
  // the composer pre-seeded.
  function replyPrivately(m: LocalMessage) {
    void openPrivate(m, toReplyPreview(m))
  }

  // "Send message in private": same DM, no quote.
  function sendPrivate(m: LocalMessage) {
    void openPrivate(m)
  }

  // Scroll to (and briefly pulse) the original message a reply points at, if
  // it's currently loaded. Otherwise show a subtle, transient hint.
  const jumpToMessage = useCallback(
    (messageId: string) => {
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(messageId)}"]`,
      )
      if (!el) {
        flashNotice('Original message not loaded.')
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setHighlightedMessageId(messageId)
      window.clearTimeout(highlightTimer.current)
      highlightTimer.current = window.setTimeout(() => setHighlightedMessageId(null), 1800)
    },
    [scrollRef],
  )

  // ── Header subtitle ────────────────────────────────────────────────────
  const subtitle =
    group.type === 'vehicle'
      ? group.meta.trip ?? `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`
      : (group.directPeer?.workspace ?? 'Direct message')

  return (
    <>
      {/* Header */}
      <header className="h-[var(--header-height)] flex items-center justify-between px-5 border-b border-white/[0.06] bg-rail shrink-0">
        <div className="min-w-0 flex items-center gap-2.5">
          {group.type === 'direct' && (
            <div className="h-9 w-9 rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 text-[11.5px] font-semibold uppercase font-mono">
              {initials(groupLabel(group))}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold truncate">{groupLabel(group)}</div>
            <div className="text-[11px] text-muted truncate">{subtitle}</div>
          </div>
        </div>
        {group.type === 'vehicle' && group.meta.plate && (
          <span className="font-mono text-[11px] text-muted border border-white/[0.08] rounded-chip px-2 py-0.5 shrink-0">
            {group.meta.plate}
          </span>
        )}
      </header>

      {pdfAttachment ? (
        <InlinePdfPreview
          attachment={pdfAttachment}
          onClose={() => setPdfAttachment(null)}
        />
      ) : (
        <>
          {/* Messages — wrapped in a relative container so the floating
              scroll-to-latest button can overlay the scroll area without
              scrolling along with the content. */}
          <div className="flex-1 flex flex-col relative min-h-0">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="flex-1 overflow-y-auto px-5 py-4"
            >
              <div className="mx-auto w-full xl:max-w-[1280px] 2xl:max-w-[1440px] min-[1700px]:max-w-[1560px]">
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
                    {messages.map((m, i) => {
                      const next = messages[i + 1]
                      // Hide the timestamp on any message that's immediately
                      // followed by another from the same sender within the
                      // same calendar minute. Only the last message of such a
                      // run keeps its timestamp, like WhatsApp.
                      const lastInMinuteGroup =
                        !next ||
                        next.authorId !== m.authorId ||
                        minuteKey(next.createdAt) !== minuteKey(m.createdAt)
                      return (
                        <MessageRow
                          key={m.id}
                          message={m}
                          mine={m.authorId === currentUserId}
                          prev={messages[i - 1]}
                          groupType={group.type}
                          highlighted={highlightedMessageId === m.id}
                          onRetry={retry}
                          showTimestamp={lastInMinuteGroup}
                          onActivateAttachment={activateAttachment}
                          onImageLoad={handleImageLoaded}
                          onReply={startReply}
                          onEdit={startEdit}
                          onForward={setForwardTarget}
                          onReplyPrivately={replyPrivately}
                          onSendPrivate={sendPrivate}
                          onDeleteForMe={(m) => setPendingDelete({ message: m, scope: 'me' })}
                          onDeleteForEveryone={(m) =>
                            setPendingDelete({ message: m, scope: 'everyone' })
                          }
                          onJumpToMessage={jumpToMessage}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            {showScrollDown && (
              <button
                onClick={scrollToBottom}
                aria-label="Scroll to latest messages"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 h-9 w-9 rounded-full bg-surface border border-white/[0.10] text-text hover:bg-surface-2 hover:border-white/[0.20] flex items-center justify-center transition-colors shadow-[0_4px_14px_rgba(0,0,0,0.55)]"
              >
                <ArrowDown size={16} strokeWidth={1.8} />
              </button>
            )}
            {notice && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-chip bg-surface border border-white/[0.10] text-[11.5px] text-muted px-3 py-1.5 shadow-[0_4px_14px_rgba(0,0,0,0.55)]">
                {notice}
              </div>
            )}
          </div>

          {/* Composer */}
          <div ref={composerRef} className="px-5 pb-4 pt-1 shrink-0">
            <div className="mx-auto w-full xl:max-w-[1280px] 2xl:max-w-[1440px] min-[1700px]:max-w-[1560px]">
              {error && <div className="text-[11.5px] text-alert mb-1.5">{error}</div>}
              <ChatComposer
                ref={composerHandleRef}
                placeholder={`Message ${groupLabel(group)}`}
                text={text}
                onTextChange={setText}
                file={file}
                onFileChange={setFile}
                replyContext={replyContext}
                onCancelReply={() => setReplyContext(null)}
                editContext={editContext}
                onCancelEdit={cancelEdit}
                onSend={send}
                onFileError={setError}
                onClearError={() => setError(null)}
              />
            </div>
          </div>
        </>
      )}

      {previewAttachment && (
        <ImagePreviewModal
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}

      {forwardTarget && (
        <ForwardModal
          fromGroupId={group.id}
          message={forwardTarget}
          onClose={() => setForwardTarget(null)}
          onForwarded={() => flashNotice('Message forwarded.')}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.scope === 'everyone' ? 'Delete for everyone?' : 'Delete for me?'}
          message={
            pendingDelete.scope === 'everyone'
              ? "This message will be removed for everyone in the conversation. This can't be undone."
              : 'This message will be hidden from your view only. Other members will still see it.'
          }
          confirmLabel={
            pendingDelete.scope === 'everyone' ? 'Delete for everyone' : 'Delete for me'
          }
          tone="alert"
          onConfirm={confirmPendingDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}
