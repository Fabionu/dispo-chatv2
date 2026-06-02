import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, Info } from 'lucide-react'
import type { Attachment, Group, GroupMember, IncomingMessage, ReplyToPreview } from '../lib/types'
import { groupLabel } from '../lib/types'
import { resolveMentionIds } from '../lib/mentions'
import { api, ApiError } from '../lib/api'
import { getSocket } from '../lib/socket'
import ImagePreviewModal from './attachments/ImagePreviewModal'
import InlinePdfPreview from './attachments/InlinePdfPreview'
import AttachmentSendPreviewModal from './attachments/AttachmentSendPreviewModal'
import DocumentPreviewModal from './attachments/DocumentPreviewModal'
import ChatComposer, { type ChatComposerHandle, type EditContext } from './composer/ChatComposer'
import Avatar from './Avatar'
import GroupAvatar from './GroupAvatar'
import GroupInfoPanel from './GroupInfoPanel'
import MessageRow from './messages/MessageRow'
import SystemMessageRow from './messages/SystemMessageRow'
import PinnedBar from './messages/PinnedBar'
import TypingIndicator, { type TypingUser } from './messages/TypingIndicator'
import ForwardModal from './messages/ForwardModal'
import InviteMembersModal from './invites/InviteMembersModal'
import ConfirmDialog from './ConfirmDialog'
import Spinner from './Spinner'
import { minuteKey } from './messages/messageUtils'
import type { LocalMessage } from './messages/types'
import { useChatScroll } from '../hooks/useChatScroll'
import { devlog } from '../lib/devlog'
import { useMessageCache } from '../hooks/useMessageCache'
import { preloadImage } from '../lib/attachmentCache'

// Stable empty list so a group with no cached thread doesn't hand a fresh
// array to useChatScroll on every render.
const NO_MESSAGES: LocalMessage[] = []

// An attachment paired with the message it belongs to — the context every
// preview surface needs so Reply/Forward operate on the message.
type AttachmentContext = { attachment: Attachment; message: LocalMessage }

// How many of the newest messages get their images treated as "recent": loaded
// eagerly in-bubble and warmed in the browser cache when the thread opens.
// Older messages stay lazy so a huge backlog doesn't fetch everything at once.
const RECENT_IMAGE_WINDOW = 15

// Typing indicator cadence. We re-announce "still typing" at most once per
// THROTTLE while keys are flowing, send a stop after STOP_IDLE of silence, and
// each receiver auto-expires a typer after TTL as a backstop if a stop is lost.
const TYPING_THROTTLE_MS = 2500
const TYPING_STOP_IDLE_MS = 3000
const TYPING_TTL_MS = 6000

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
  // Whether the current user may invite members to a vehicle group (admin /
  // dispatcher). Combined with the caller's group-admin role to gate the
  // group-info edit/image/invite controls; the server re-enforces it.
  canInviteMembers?: boolean
  // Patch the parent group's record after an in-panel edit (name / plates /
  // image) so the header and rail reflect the change without a refetch.
  onGroupUpdated?: (groupId: string, partial: Partial<Group>) => void
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
  canInviteMembers = false,
  onGroupUpdated,
}: Props) {
  // ── Cached thread (session-level, instant on revisit) ──────────────────
  const cache = useMessageCache()
  const thread = cache.threads[group.id]
  const messages = thread?.messages ?? NO_MESSAGES
  const nextCursor = thread?.nextCursor ?? null
  // Show the blocking loader only when there's nothing cached yet for this
  // group; otherwise we render cached messages and revalidate silently.
  const loading = !(thread?.loaded ?? false) && messages.length === 0

  // ── Core state ─────────────────────────────────────────────────────────
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  // A picked file awaiting confirmation in the pre-send preview modal. The file
  // is not "staged" in the composer anymore — it lives here until the user
  // sends or cancels from the overlay.
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  // Attachment previews carry their parent message so the in-preview
  // Reply/Forward act on the whole message, not just the raw file. One slot
  // per surface: image lightbox, inline PDF, and the document card modal.
  const [imagePreview, setImagePreview] = useState<AttachmentContext | null>(null)
  const [pdfPreview, setPdfPreview] = useState<AttachmentContext | null>(null)
  const [docPreview, setDocPreview] = useState<AttachmentContext | null>(null)
  // Reply context: when set, the composer shows the quoted preview and the
  // next outbound message is sent with `replyToMessageId` filled in. Seeded
  // from `initialReplyContext` when this view was opened via "Reply privately".
  const [replyContext, setReplyContext] = useState<ReplyToPreview | null>(initialReplyContext)
  // Edit context: when set, the composer is in "Editing message" mode and
  // pressing send PATCHes the existing message instead of POSTing a new one.
  const [editContext, setEditContext] = useState<EditContext | null>(null)
  // Message currently being forwarded (drives the picker modal).
  const [forwardTarget, setForwardTarget] = useState<LocalMessage | null>(null)
  // Whether the "Invite members" picker is open (vehicle groups only).
  const [inviteOpen, setInviteOpen] = useState(false)
  // Whether the group-info drawer is open (vehicle groups only).
  const [groupInfoOpen, setGroupInfoOpen] = useState(false)
  // Cache-buster for the group image, bumped after an upload/remove so the
  // header avatar and the panel both refetch immediately.
  const [groupAvatarVersion, setGroupAvatarVersion] = useState(0)
  // Pending delete awaiting confirmation. `scope` picks which delete runs.
  const [pendingDelete, setPendingDelete] = useState<{
    message: LocalMessage
    scope: 'me' | 'everyone'
  } | null>(null)
  // Transient confirmation after a successful forward.
  const [notice, setNotice] = useState<string | null>(null)
  // Row to briefly pulse after a jump-to-original; cleared on a timer.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  // Group-wide pinned messages, newest pin first. Fetched on open and kept
  // fresh via socket events — independent of the loaded thread page so a pin
  // older than the current page still shows in the bar.
  const [pinned, setPinned] = useState<LocalMessage[]>([])
  // Who else is currently typing in this conversation (excludes self).
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  // Members of this conversation — the source for the @-mention picker and for
  // resolving typed @Names back to user ids at send time.
  const [members, setMembers] = useState<GroupMember[]>([])

  const composerHandleRef = useRef<ChatComposerHandle>(null)
  const highlightTimer = useRef<number | undefined>(undefined)
  const noticeTimer = useRef<number | undefined>(undefined)
  // Typing-emission bookkeeping (outbound).
  const typingActiveRef = useRef(false)
  const typingSentAtRef = useRef(0)
  const typingStopTimer = useRef<number | undefined>(undefined)
  // Per-typer auto-expiry timers (inbound).
  const typingExpiry = useRef<Record<string, number>>({})

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
      // Free the local image blob previews this conversation was holding.
      cache.clearThreadPreviews(group.id)
    },
    // group.id is stable for this mount (keyed remount per group); cache is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Focus the composer on open so the user can start typing immediately —
  // no click needed. (rAF lets the textarea finish mounting/layout first.)
  // Also drop any "Reply privately" seed so a later remount doesn't re-apply it.
  useEffect(() => {
    const raf = requestAnimationFrame(() => composerHandleRef.current?.focus())
    if (initialReplyContext) onConsumeInitialReply?.()
    return () => cancelAnimationFrame(raf)
    // Mount-only: the seed is captured once into state; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function flashNotice(msg: string) {
    setNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2200)
  }

  // ── Conversation members (for @-mentions) ──────────────────────────────
  // Fetched per group; used by the composer's mention picker and to resolve
  // typed @Names to ids when sending. Cleared between groups so a stale list
  // can't leak across conversations.
  useEffect(() => {
    let cancelled = false
    setMembers([])
    api.groups
      .members(group.id)
      .then((r) => {
        if (!cancelled) setMembers(r.members)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [group.id])

  // ── Read receipts ──────────────────────────────────────────────────────
  const markRead = useCallback(() => {
    api.groups
      .markRead(group.id)
      .then(() => onRead(group.id))
      .catch(() => {})
  }, [group.id, onRead])

  // ── Initial load / background revalidate ───────────────────────────────
  // `key={group.id}` on the parent remounts this component per group. If the
  // thread was already loaded (opened earlier, or prefetched) we keep its
  // cached cursor and just fold in the latest page; otherwise this is a first
  // load and we seed the thread (cursor + loaded flag). Either way the cached
  // messages render immediately — only a never-loaded group shows the loader.
  useEffect(() => {
    let cancelled = false
    const hadCache = cache.hasThread(group.id)
    devlog('conversation open', { groupId: group.id, hadCache })
    cache.setRevalidating(group.id, true)
    api.groups
      .messages(group.id)
      .then((res) => {
        if (cancelled) return
        if (hadCache) cache.mergeThreadMessages(group.id, res.messages)
        else cache.setThreadMessages(group.id, res.messages, res.nextCursor)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) cache.setRevalidating(group.id, false)
      })
    markRead()
    return () => {
      cancelled = true
    }
    // Cache methods are stable; re-run only when the open group changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, markRead])

  // ── Preload recent image attachments ───────────────────────────────────
  // When the thread changes (open, revalidate, new arrival), warm the browser
  // cache for images in the newest messages so they're painted by the time
  // their row is on screen. Bounded to the recent window so opening a huge
  // backlog doesn't fetch every picture. Documents/PDFs are skipped — their
  // cards render from metadata and the file only loads on click. Just-sent
  // images (localPreviewUrl) are already decoded, so they're skipped too.
  // preloadImage dedupes against in-flight + already-loaded ids.
  useEffect(() => {
    const recent = messages.slice(-RECENT_IMAGE_WINDOW)
    for (const m of recent) {
      if (m.deletedAt) continue
      for (const a of m.attachments ?? []) {
        // Warm the same lightweight URL the bubble renders (preview when
        // available, else the original); skip just-sent images (already
        // decoded) and known-missing objects (no point re-requesting a 404).
        const src = a.previewUrl ?? a.url
        if (a.mimeType.startsWith('image/') && src && !a.localPreviewUrl && !a.missing) {
          preloadImage(a.id, src)
        }
      }
    }
  }, [messages])

  // ── Pinned messages (fetch + live sync) ────────────────────────────────
  // Load the group's pins on open, then keep the bar in sync with live pin/
  // unpin/delete events. Held separately from the thread cache so a pin older
  // than the loaded page still shows.
  useEffect(() => {
    let cancelled = false
    api.groups
      .pins(group.id)
      .then((res) => {
        if (!cancelled) setPinned(res.messages as LocalMessage[])
      })
      .catch(() => {})

    const socket = getSocket()
    function onPinned(p: { groupId: string; message: LocalMessage }) {
      if (p.groupId !== group.id) return
      // Replace if already present, else prepend (newest pin first).
      setPinned((prev) => [p.message, ...prev.filter((m) => m.id !== p.message.id)])
    }
    function onUnpinned(p: { groupId: string; id: string }) {
      if (p.groupId !== group.id) return
      setPinned((prev) => prev.filter((m) => m.id !== p.id))
    }
    function onDeleted(p: { groupId: string; id: string }) {
      if (p.groupId !== group.id) return
      setPinned((prev) => prev.filter((m) => m.id !== p.id))
    }
    socket.on('message:pinned', onPinned)
    socket.on('message:unpinned', onUnpinned)
    socket.on('message:deleted', onDeleted)
    return () => {
      cancelled = true
      socket.off('message:pinned', onPinned)
      socket.off('message:unpinned', onUnpinned)
      socket.off('message:deleted', onDeleted)
    }
  }, [group.id])

  // ── Typing indicator: emit (outbound) ──────────────────────────────────
  // Driven by the composer text we own. Announce "typing" at most once per
  // throttle window while keys flow; schedule a "stop" after a short idle.
  useEffect(() => {
    const socket = getSocket()
    const sendStop = () => {
      window.clearTimeout(typingStopTimer.current)
      if (typingActiveRef.current) {
        typingActiveRef.current = false
        socket.emit('typing:stop', { groupId: group.id })
      }
    }
    if (text.trim().length === 0) {
      sendStop()
      return
    }
    const now = Date.now()
    if (!typingActiveRef.current || now - typingSentAtRef.current > TYPING_THROTTLE_MS) {
      typingActiveRef.current = true
      typingSentAtRef.current = now
      socket.emit('typing:start', { groupId: group.id })
    }
    window.clearTimeout(typingStopTimer.current)
    typingStopTimer.current = window.setTimeout(sendStop, TYPING_STOP_IDLE_MS)
  }, [text, group.id])

  // Make sure we tell the room we stopped when leaving the conversation.
  useEffect(
    () => () => {
      window.clearTimeout(typingStopTimer.current)
      if (typingActiveRef.current) {
        typingActiveRef.current = false
        getSocket().emit('typing:stop', { groupId: group.id })
      }
    },
    [group.id],
  )

  // ── Typing indicator: receive (inbound) ────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    const expiry = typingExpiry.current
    const remove = (id: string) => {
      window.clearTimeout(expiry[id])
      delete expiry[id]
      setTypingUsers((prev) => prev.filter((u) => u.id !== id))
    }
    function onTyping(p: {
      groupId: string
      userId: string
      name?: string
      typing: boolean
    }) {
      if (p.groupId !== group.id || p.userId === currentUserId) return
      if (!p.typing) return remove(p.userId)
      // Refresh the auto-expiry backstop in case a stop event is dropped.
      window.clearTimeout(expiry[p.userId])
      expiry[p.userId] = window.setTimeout(() => remove(p.userId), TYPING_TTL_MS)
      setTypingUsers((prev) => {
        const name = p.name || 'Someone'
        const existing = prev.find((u) => u.id === p.userId)
        if (existing) {
          return existing.name === name
            ? prev
            : prev.map((u) => (u.id === p.userId ? { ...u, name } : u))
        }
        return [...prev, { id: p.userId, name }]
      })
    }
    socket.on('typing', onTyping)
    return () => {
      socket.off('typing', onTyping)
      for (const id of Object.keys(expiry)) window.clearTimeout(expiry[id])
      typingExpiry.current = {}
      setTypingUsers([])
    }
  }, [group.id, currentUserId])

  // ── Read receipts on live arrivals ─────────────────────────────────────
  // The cache itself is kept fresh by a global socket listener; here we only
  // need to mark the *open* group read as new messages land in it.
  useEffect(() => {
    const socket = getSocket()
    function onNew(msg: IncomingMessage) {
      if (msg.groupId !== group.id) return
      markRead()
    }
    socket.on('message:new', onNew)
    return () => {
      socket.off('message:new', onNew)
    }
  }, [group.id, markRead])

  // ── Older messages (paginated) ─────────────────────────────────────────
  async function loadOlder() {
    if (!nextCursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const res = await api.groups.messages(group.id, nextCursor)
      anchorBeforePrepend()
      cache.prependOlderMessages(group.id, res.messages, res.nextCursor)
    } finally {
      setLoadingOlder(false)
    }
  }

  // ── Attachment activation (image lightbox / PDF inline / document card) ──
  // Each surface keeps the parent message so its Reply/Forward act on the
  // message. Non-previewable docs now open a card modal (with a Download
  // action) rather than downloading straight away.
  const activateAttachment = useCallback((message: LocalMessage, a: Attachment) => {
    if (!a.url && !a.localPreviewUrl) return
    if (a.mimeType.startsWith('image/')) {
      // Prefer the already-decoded local blob so the lightbox is instant for a
      // just-sent image (falls back to the server URL after the blob is freed).
      setImagePreview({
        attachment: a.localPreviewUrl ? { ...a, url: a.localPreviewUrl } : a,
        message,
      })
    } else if (a.mimeType === 'application/pdf') {
      setPdfPreview({ attachment: a, message })
    } else {
      setDocPreview({ attachment: a, message })
    }
  }, [])

  // Shared close so Reply/Forward from any preview dismiss whichever surface
  // is open before handing off to the message-level handler.
  const closeAllPreviews = useCallback(() => {
    setImagePreview(null)
    setPdfPreview(null)
    setDocPreview(null)
  }, [])

  // ── Send / edit / retry ────────────────────────────────────────────────
  async function sendBody(
    body: string,
    attachedFile: File | null,
    replyTo: ReplyToPreview | null,
    mentionUserIds: string[] = [],
  ) {
    if (!body && !attachedFile) return
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Optimistic mentions: highlight the typed @Names immediately, before the
    // server echoes the canonical list back.
    const optimisticMentions = mentionUserIds.length
      ? members
          .filter((m) => mentionUserIds.includes(m.id))
          .map((m) => ({ userId: m.id, displayName: m.displayName }))
      : undefined

    // For images, show the local blob URL on the optimistic bubble so the
    // user sees their picture immediately. For documents, we still preview
    // a card with name/size — no URL needed until the server returns one.
    const isImg = attachedFile?.type.startsWith('image/') ?? false
    // One decoded blob URL, used for BOTH the optimistic bubble (via
    // localPreviewUrl) and carried onto the real message by foldOptimistic (via
    // url). Same src string before/after the optimistic→real swap → the image
    // never refetches from the server, so there's no post-upload reload flicker.
    const blobUrl = attachedFile && isImg ? URL.createObjectURL(attachedFile) : ''
    const optimisticAttachment: Attachment | null = attachedFile
      ? {
          id: `${localId}-att`,
          originalName: attachedFile.name,
          mimeType: attachedFile.type,
          byteSize: attachedFile.size,
          url: blobUrl,
          ...(isImg ? { localPreviewUrl: blobUrl } : {}),
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
      mentions: optimisticMentions,
    }
    // Pin BEFORE inserting so the layout effect for this very insert forces the
    // viewport to the bottom — the user sees their own message (and an image's
    // reserved box) immediately, not after the upload completes. The upsert is
    // synchronous and the upload below is async (fetch), so React paints the
    // optimistic bubble before any network work — no manual defer needed.
    pinToBottomNext()
    cache.upsertMessage(group.id, optimistic)
    devlog('optimistic insert', { localId, hasFile: Boolean(attachedFile) })

    try {
      devlog('upload start', { localId, hasFile: Boolean(attachedFile) })
      const res = await api.groups.postMessage(
        group.id,
        body,
        attachedFile,
        replyTo?.id ?? null,
        mentionUserIds,
      )
      devlog('upload finished → replaceMessage', { localId })
      // replaceMessage swaps the optimistic for the real one (or drops it if
      // the socket already delivered the real message), carrying the local
      // blob preview onto the real attachment so the image doesn't flicker.
      // The blob is revoked later — on conversation unmount or message removal.
      cache.replaceMessage(group.id, localId, res.message)
    } catch (err) {
      cache.patchMessage(group.id, localId, { pending: false, failed: true })
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
    cache.patchMessage(group.id, messageId, { body, editedAt: new Date().toISOString() })
    setEditContext(null)
    setText('')
    setError(null)
    try {
      await api.groups.editMessage(group.id, messageId, body)
    } catch {
      // Best-effort revert.
      cache.patchMessage(group.id, messageId, { body: originalBody })
      setError('Could not save edit.')
    }
  }

  // Composer send: text-only (and edits). Files are sent from the pre-send
  // preview modal via `sendPendingFile` instead.
  function send() {
    if (editContext) {
      void submitEdit(editContext.id, text.trim(), editContext.originalBody)
      return
    }
    const body = text.trim()
    if (!body) return
    devlog('send clicked (text)')
    const reply = replyContext
    // Resolve @Names still present in the final text to member ids — edits or
    // deletions of a mention token before send naturally drop it.
    const mentionIds = resolveMentionIds(body, members)
    setText('')
    setReplyContext(null)
    setError(null)
    void sendBody(body, null, reply, mentionIds)
  }

  // Confirm from the pre-send preview: send the staged file + caption, close
  // the overlay, and clear the composer text (the caption supersedes it). The
  // optimistic bubble appears immediately; a failure leaves the retryable
  // failed bubble in place, same as a text send.
  function sendPendingFile(caption: string) {
    const f = pendingFile
    if (!f) return
    devlog('send clicked (attachment)')
    const reply = replyContext
    // Captions support mentions too: resolve @Names typed into the caption.
    const mentionIds = resolveMentionIds(caption, members)
    setPendingFile(null)
    setText('')
    setReplyContext(null)
    setError(null)
    void sendBody(caption, f, reply, mentionIds)
  }

  function retry(localId: string, body: string, attachedFile: File | null) {
    cache.removeMessage(group.id, localId)
    void sendBody(body, attachedFile, null, resolveMentionIds(body, members))
  }

  // ── Message action callbacks ───────────────────────────────────────────
  function startReply(m: LocalMessage) {
    setEditContext(null)
    setReplyContext(toReplyPreview(m))
    composerHandleRef.current?.focus()
  }

  // Reply/Forward triggered from an attachment preview: dismiss the preview,
  // then reuse the same message-level handlers the bubble menu uses. The
  // forward carries the message's attachment along, exactly like the menu.
  function replyFromPreview(m: LocalMessage) {
    closeAllPreviews()
    startReply(m)
  }

  function forwardFromPreview(m: LocalMessage) {
    closeAllPreviews()
    setForwardTarget(m)
  }

  function startEdit(m: LocalMessage) {
    setReplyContext(null)
    setEditContext({ id: m.id, originalBody: m.body })
    setText(m.body)
    setPendingFile(null)
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
    cache.patchMessage(group.id, m.id, {
      body: '',
      attachments: [],
      deletedAt: new Date().toISOString(),
      deletedBy: currentUserId,
    })
    try {
      await api.groups.deleteForEveryone(group.id, m.id)
    } catch {
      cache.patchMessage(group.id, m.id, {
        body: original.body,
        attachments: original.attachments,
        deletedAt: null,
        deletedBy: null,
      })
      setError('Could not delete message.')
    }
  }

  // Hide a single message for the current user only. Optimistically remove it;
  // re-insert (normalize re-sorts it back into place) if the request fails.
  async function deleteForMe(m: LocalMessage) {
    cache.removeMessage(group.id, m.id)
    try {
      await api.groups.deleteForMe(group.id, m.id)
    } catch {
      cache.upsertMessage(group.id, m)
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

  // ── Copy / pin / unpin ─────────────────────────────────────────────────
  const copyMessage = useCallback(
    (m: LocalMessage) => {
      if (!m.body) return
      navigator.clipboard
        .writeText(m.body)
        .then(() => flashNotice('Copied to clipboard.'))
        .catch(() => setError('Could not copy message.'))
    },
    // flashNotice/setError are stable enough for this handler's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Optimistically reflect the pin (bubble indicator via cache + bar) and
  // reconcile with the server's authoritative message; revert on failure.
  async function pinMessage(m: LocalMessage) {
    const stampedAt = new Date().toISOString()
    cache.patchMessage(group.id, m.id, { pinnedAt: stampedAt, pinnedBy: currentUserId })
    setPinned((prev) => [
      { ...m, pinnedAt: stampedAt, pinnedBy: currentUserId },
      ...prev.filter((p) => p.id !== m.id),
    ])
    try {
      const { message } = await api.groups.pin(group.id, m.id)
      cache.patchMessage(group.id, m.id, {
        pinnedAt: message.pinnedAt,
        pinnedBy: message.pinnedBy,
      })
      setPinned((prev) => [
        message as LocalMessage,
        ...prev.filter((p) => p.id !== m.id),
      ])
    } catch {
      cache.patchMessage(group.id, m.id, { pinnedAt: null, pinnedBy: null })
      setPinned((prev) => prev.filter((p) => p.id !== m.id))
      setError('Could not pin message.')
    }
  }

  async function unpinMessage(m: LocalMessage) {
    cache.patchMessage(group.id, m.id, { pinnedAt: null, pinnedBy: null })
    setPinned((prev) => prev.filter((p) => p.id !== m.id))
    try {
      await api.groups.unpin(group.id, m.id)
    } catch {
      cache.patchMessage(group.id, m.id, { pinnedAt: m.pinnedAt, pinnedBy: m.pinnedBy })
      setPinned((prev) =>
        prev.some((p) => p.id === m.id) ? prev : [m, ...prev],
      )
      setError('Could not unpin message.')
    }
  }

  // ── Header subtitle ────────────────────────────────────────────────────
  // Vehicle groups are permanent threads, so the subtitle describes the channel
  // (member count) rather than any single trip. Registration numbers render as
  // badges on the right.
  const subtitle =
    group.type === 'vehicle'
      ? `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`
      : (group.directPeer?.workspace ?? 'Direct message')

  // Group-info management gate: workspace admins/dispatchers, or the caller's
  // own group-admin role (resolved from the loaded members). The server
  // re-enforces the full rule on every mutating endpoint.
  const myGroupRole = members.find((m) => m.id === currentUserId)?.role
  const canManageGroup = canInviteMembers || myGroupRole === 'admin'

  return (
    <>
      {/* Header */}
      <header className="h-[var(--header-height)] flex items-center justify-between px-5 border-b border-white/[0.06] bg-rail shrink-0">
        <div className="min-w-0 flex items-center gap-2.5">
          {group.type === 'direct' ? (
            <Avatar
              userId={group.directPeer?.id ?? ''}
              name={group.directPeer?.name ?? groupLabel(group)}
              size={40}
            />
          ) : (
            // Vehicle group image — same footprint as the DM avatar, falls back
            // to a themed multi-user icon when no image is set.
            <GroupAvatar groupId={group.id} size={40} version={groupAvatarVersion} />
          )}
          <div className="min-w-0">
            <div className="text-[15px] font-semibold truncate leading-tight">{groupLabel(group)}</div>
            <div className="text-[12px] text-muted truncate leading-tight">{subtitle}</div>
          </div>
        </div>
        {group.type === 'vehicle' && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setGroupInfoOpen(true)}
              aria-label="Group info"
              title="Group info"
              className="h-8 w-8 flex items-center justify-center rounded-chip border border-white/[0.08] text-muted hover:text-text hover:border-white/[0.16] transition-colors"
            >
              <Info size={15} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </header>

      {pdfPreview ? (
        <InlinePdfPreview
          attachment={pdfPreview.attachment}
          message={pdfPreview.message}
          onReply={replyFromPreview}
          onForward={forwardFromPreview}
          onClose={() => setPdfPreview(null)}
        />
      ) : (
        <>
          <PinnedBar messages={pinned} onJump={jumpToMessage} onUnpin={unpinMessage} />
          {/* Messages — wrapped in a relative container so the floating
              scroll-to-latest button can overlay the scroll area without
              scrolling along with the content. */}
          <div className="flex-1 flex flex-col relative min-h-0">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="flex-1 overflow-y-auto px-5 py-4"
            >
              <div className="mx-auto w-full max-w-[var(--chat-max-width)]">
                {loading ? (
                  <Spinner label="Loading" className="h-full" />
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
                      // Persisted activity rows (pin/unpin) render as compact
                      // centered lines, never as bubbles or with an actions menu.
                      if (m.kind === 'system') {
                        return (
                          <SystemMessageRow
                            key={m.id}
                            message={m}
                            prev={messages[i - 1]}
                            onJumpToMessage={jumpToMessage}
                          />
                        )
                      }
                      const next = messages[i + 1]
                      // Hide the timestamp on any message that's immediately
                      // followed by another from the same sender within the
                      // same calendar minute. Only the last message of such a
                      // run keeps its timestamp, like WhatsApp. A system row
                      // following us is a boundary (keep our timestamp).
                      const lastInMinuteGroup =
                        !next ||
                        next.kind === 'system' ||
                        next.authorId !== m.authorId ||
                        minuteKey(next.createdAt) !== minuteKey(m.createdAt)
                      return (
                        <MessageRow
                          // Stable across the optimistic→real reconcile (localId
                          // is preserved on the real message) so the row — and
                          // its image — never remounts/flickers.
                          key={m.localId ?? m.id}
                          message={m}
                          mine={m.authorId === currentUserId}
                          currentUserId={currentUserId}
                          prev={messages[i - 1]}
                          groupType={group.type}
                          highlighted={highlightedMessageId === m.id}
                          onRetry={retry}
                          showTimestamp={lastInMinuteGroup}
                          imagePriority={i >= messages.length - RECENT_IMAGE_WINDOW}
                          onActivateAttachment={activateAttachment}
                          onImageLoad={handleImageLoaded}
                          onCopy={copyMessage}
                          onPin={pinMessage}
                          onUnpin={unpinMessage}
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
              {typingUsers.length > 0 && (
                <div className="mb-1 px-1">
                  <TypingIndicator users={typingUsers} />
                </div>
              )}
              {error && <div className="text-[11.5px] text-alert mb-1.5">{error}</div>}
              <ChatComposer
                ref={composerHandleRef}
                placeholder={`Message ${groupLabel(group)}`}
                text={text}
                onTextChange={setText}
                members={members}
                onFilePicked={setPendingFile}
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

      {pendingFile && (
        <AttachmentSendPreviewModal
          file={pendingFile}
          initialCaption={text}
          onReplace={setPendingFile}
          onCancel={() => setPendingFile(null)}
          onSend={sendPendingFile}
        />
      )}

      {imagePreview && (
        <ImagePreviewModal
          attachment={imagePreview.attachment}
          message={imagePreview.message}
          onReply={replyFromPreview}
          onForward={forwardFromPreview}
          onClose={() => setImagePreview(null)}
        />
      )}

      {docPreview && (
        <DocumentPreviewModal
          attachment={docPreview.attachment}
          message={docPreview.message}
          onReply={replyFromPreview}
          onForward={forwardFromPreview}
          onClose={() => setDocPreview(null)}
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

      {group.type === 'vehicle' && groupInfoOpen && (
        <GroupInfoPanel
          group={group}
          currentUserId={currentUserId}
          members={members}
          membersLoading={members.length === 0}
          canManage={canManageGroup}
          avatarVersion={groupAvatarVersion}
          onClose={() => setGroupInfoOpen(false)}
          onInvite={() => setInviteOpen(true)}
          onAvatarChanged={(hasAvatar) => {
            setGroupAvatarVersion((v) => v + 1)
            onGroupUpdated?.(group.id, { hasAvatar })
          }}
          onGroupUpdated={(partial) => onGroupUpdated?.(group.id, partial)}
        />
      )}

      {inviteOpen && (
        <InviteMembersModal
          groupId={group.id}
          groupName={groupLabel(group)}
          existingMemberIds={members.map((m) => m.id)}
          onClose={() => setInviteOpen(false)}
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
