import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  FileText,
  Image as ImageIcon,
  Info,
  MapPin,
  MessageSquare,
  Route,
  Search,
  Upload,
  X,
} from 'lucide-react'
import type { Attachment, Group, GroupMember, IncomingMessage, ReplyToPreview } from '../lib/types'
import { groupLabel, trailerPlate } from '../lib/types'
import { fileError } from './attachments/attachmentUtils'
import { resolveMentionIds } from '../lib/mentions'
import { api, ApiError } from '../lib/api'
import { getSocket } from '../lib/socket'
import ChatComposer, { type ChatComposerHandle, type EditContext } from './composer/ChatComposer'
import Avatar from './Avatar'
import GroupAvatar from './GroupAvatar'
import HeaderIconButton from './HeaderIconButton'
import { PaneLoader, ModalLoader, PanelLoader } from './LazyFallback'

// ── Code-split heavy features ──────────────────────────────────────────────
// These load only when actually opened, keeping their bundles (pdf.js image/
// document preview logic, the @here/flexpolyline map stack, the trip + group
// info panels) out of the initial chat bundle. Each render site is wrapped in a
// Suspense with a compact loader (see LazyFallback).
const ImagePreviewModal = lazy(() => import('./attachments/ImagePreviewModal'))
const InlinePdfPreview = lazy(() => import('./attachments/InlinePdfPreview'))
const AttachmentSendPreviewModal = lazy(() => import('./attachments/AttachmentSendPreviewModal'))
const AttachmentTabView = lazy(() => import('./attachments/AttachmentTabView'))
const DocumentPreviewModal = lazy(() => import('./attachments/DocumentPreviewModal'))
const GroupInfoPanel = lazy(() => import('./GroupInfoPanel'))
const AddTripPanel = lazy(() => import('./vehicle/AddTripPanel'))
const StopLocationMap = lazy(() => import('./vehicle/StopLocationMap'))
const TripRouteMap = lazy(() => import('./vehicle/TripRouteMap'))
import TripBar from './vehicle/TripBar'
import type { PanelTab } from './GroupInfoPanel'
import { getOps, tripSummary, type VehicleOps } from '../lib/vehicleOps'
import { canRouteStops, persistOpsWithRoute } from '../lib/tripRoute'
import ConversationSearch from './ConversationSearch'
import UserProfilePanel from './UserProfilePanel'
import MessageRow from './messages/MessageRow'
import SystemMessageRow from './messages/SystemMessageRow'
import PinnedBar from './messages/PinnedBar'
import TypingIndicator from './messages/TypingIndicator'
import ForwardModal from './messages/ForwardModal'
import InviteMembersModal from './invites/InviteMembersModal'
import ConfirmDialog from './ConfirmDialog'
import Spinner from './Spinner'
import type { LocalMessage } from './messages/types'
import { useChatScroll } from '../hooks/useChatScroll'
import { useMessageDrafts } from '../hooks/useMessageDrafts'
import { getDraft } from '../lib/draftStorage'
import { devlog } from '../lib/devlog'
import { useMessageCache } from '../hooks/useMessageCache'
import { preloadImage } from '../lib/attachmentCache'
import ToolTab from './ChatToolTab'
import { toReplyPreview, attachmentTabLabel } from './chatViewUtils'
import { useTypingIndicator } from '../hooks/useTypingIndicator'
import { usePinnedMessages } from '../hooks/usePinnedMessages'

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

// Height (px) of the soft fadeout at the very BOTTOM EDGE of the chat window. It
// overlays the bottom of the message list (painted ABOVE the bubbles) so the
// content fades out at the end of the window instead of cutting off — while
// sitting BELOW the floating composer + chips (z-10/z-20) so the input stays
// sharp. Fades to the chat background (`bg`, #181818).
const CHAT_BOTTOM_FADE_HEIGHT = 56

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
  // Composer text, seeded from any saved draft for THIS conversation so an
  // unfinished message is restored when the user returns. ChatView is keyed by
  // group id (remounts per conversation), so this lazy initializer reads the
  // right draft on every open. See useMessageDrafts for the persistence side.
  const [text, setText] = useState<string>(() => getDraft(currentUserId, group.id))
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
  // Draft persistence for the composer text. Writes are debounced and flushed on
  // conversation switch (unmount); disabled while editing so an edit-in-progress
  // (which reuses the composer text) is never saved as a draft. `clearDraft` is
  // called on a successful send below. Purely local — never hits the backend.
  const { clearDraft: clearDraftForConversation } = useMessageDrafts({
    userId: currentUserId,
    conversationId: group.id,
    text,
    enabled: !editContext,
  })
  // Message currently being forwarded (drives the picker modal).
  const [forwardTarget, setForwardTarget] = useState<LocalMessage | null>(null)
  // Whether the "Invite members" picker is open (vehicle groups only).
  const [inviteOpen, setInviteOpen] = useState(false)
  // Whether the group-info drawer is open (vehicle groups only).
  const [groupInfoOpen, setGroupInfoOpen] = useState(false)
  // Which Group-info tab to open on the next open — the header trip bar deep-links
  // to 'trip', the header Info button to 'info'.
  const [groupInfoTab, setGroupInfoTab] = useState<PanelTab>('info')
  // The user whose read-only details panel is open (avatar click on a message
  // row, the DM header, or a group-member row). Null = closed. The name is the
  // display name known at click time, so the panel's hero renders instantly
  // while the profile fetch runs. Purely an overlay — opening it never touches
  // the selection, composer, tabs, or the group-info panel's state.
  const [profileTarget, setProfileTarget] = useState<{ id: string; name: string } | null>(null)
  const openProfile = useCallback((userId: string, name: string) => {
    if (!userId || userId.startsWith('local-')) return
    setProfileTarget({ id: userId, name })
  }, [])
  // Whether the "Add trip" modal is open (vehicle groups only). Opened from the
  // composer's add (+) menu.
  const [addTripOpen, setAddTripOpen] = useState(false)
  // Chat-window tool tabs. Today there's one tool — the stop-location Map, a
  // request from the Add-trip panel to pick a stop's coordinates on a HERE map.
  // `mapPick` carries the seed query + the write-back callback (null = closed);
  // `activeTool` flips the chat-window body between the conversation and the open
  // tool without closing either. Structured so more tools can be added later.
  const [mapPick, setMapPick] = useState<{
    query: string
    onConfirm: (coords: string) => void
  } | null>(null)
  // Whether the read-only "Trip route" map tab is open (vehicle rooms with an
  // active, routable trip). Independent of the stop-pick map above — both are
  // tabs in the same chat-window tool banner.
  const [tripRouteOpen, setTripRouteOpen] = useState(false)
  // Attachment preview tabs: images / PDFs / documents the user pinned via the
  // preview's "Open in tab" (+) action. Each is keyed by attachment id (opening
  // the same attachment again just focuses its existing tab). Cleared on group
  // switch. They live alongside the map/route tools in the same tab banner.
  const [attachmentTabs, setAttachmentTabs] = useState<AttachmentContext[]>([])
  // The active chat-window surface: chat, a tool (map/route), or one of the
  // attachment tabs (`att:<attachmentId>`).
  const [activeTool, setActiveTool] = useState<'chat' | 'map' | 'route' | `att:${string}`>('chat')
  const openMapPick = useCallback(
    (req: { query: string; onConfirm: (coords: string) => void }) => {
      setMapPick(req)
      setActiveTool('map')
    },
    [],
  )
  const closeMapPick = useCallback(() => {
    setMapPick(null)
    setActiveTool((t) => (t === 'map' ? 'chat' : t))
  }, [])
  const openTripRoute = useCallback(() => {
    setTripRouteOpen(true)
    setActiveTool('route')
  }, [])
  const closeTripRoute = useCallback(() => {
    setTripRouteOpen(false)
    setActiveTool((t) => (t === 'route' ? 'chat' : t))
  }, [])
  // Pin an attachment as a chat-window tab (from a preview's "Open in tab" +).
  // Leaves any open modal/inline preview and focuses the tab; a duplicate of the
  // same attachment just re-focuses the existing tab instead of stacking.
  const openAttachmentTab = useCallback((ctx: AttachmentContext) => {
    setImagePreview(null)
    setPdfPreview(null)
    setDocPreview(null)
    setAttachmentTabs((prev) =>
      prev.some((t) => t.attachment.id === ctx.attachment.id) ? prev : [...prev, ctx],
    )
    setActiveTool(`att:${ctx.attachment.id}`)
  }, [])
  const closeAttachmentTab = useCallback((id: string) => {
    setAttachmentTabs((prev) => prev.filter((t) => t.attachment.id !== id))
    setActiveTool((t) => (t === `att:${id}` ? 'chat' : t))
  }, [])
  // In-conversation search (DMs + vehicle groups). The query lives here so the
  // header's inline search field owns it while the results render as a separate
  // floating overlay (ConversationSearch) — no full-width banner that would push
  // the message list down.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [])
  const openSearch = useCallback(() => {
    setSearchOpen(true)
    // Auto-focus once the field has mounted.
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])
  // Close search when switching conversations so it never carries a stale query.
  useEffect(() => {
    closeSearch()
  }, [group.id, closeSearch])
  // The map tool writes back into the Add-trip panel's draft, so it can't outlive
  // that panel or the conversation — close it when either goes away.
  useEffect(() => {
    if (!addTripOpen) closeMapPick()
  }, [addTripOpen, closeMapPick])
  useEffect(() => {
    closeMapPick()
    closeTripRoute()
    // Attachment tabs belong to the conversation — drop them on switch.
    setAttachmentTabs([])
    setActiveTool('chat')
  }, [group.id, closeMapPick, closeTripRoute])
  // Escape closes search from anywhere; a click outside the search UI (the
  // header field, its toggle button, or the results dropdown — all tagged with
  // data-search-region) closes it too. Matches the rest of the app's overlays.
  useEffect(() => {
    if (!searchOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-search-region]')) return
      closeSearch()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [searchOpen, closeSearch])
  // Whether a file is being dragged over the conversation (drives the drop
  // overlay). A depth counter keeps it stable across child enter/leave events.
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
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
  // older than the current page still shows in the bar. (Fetch + live sync live
  // in usePinnedMessages; the optimistic pin/unpin handlers still drive setPinned.)
  const [pinned, setPinned] = usePinnedMessages(group.id)
  // Who else is currently typing in this conversation (excludes self). The whole
  // emit/receive cadence lives in useTypingIndicator, driven by the composer text.
  const typingUsers = useTypingIndicator(group.id, currentUserId, text)
  // Members of this conversation — the source for the @-mention picker, @Name
  // resolution at send time, and the sent-message read receipts. Read from the
  // session cache (not local state) so it's preserved across conversation
  // switches: reopening renders read-state instantly with no recolor flash.
  const members = cache.membersFor(group.id)

  // Read-receipt readers shared by all of MY sent rows: every member except me,
  // each with their lastReadAt marker. Derived once here (not per row) so the
  // reference stays stable across renders unless the roster actually changes —
  // which lets memoized incoming rows skip re-rendering when a peer's read
  // marker advances, while my own rows still update their checkmarks live.
  const readers = useMemo(
    () =>
      members
        .filter((m) => m.id !== currentUserId)
        .map((m) => ({
          id: m.id,
          displayName: m.displayName,
          hasAvatar: m.hasAvatar,
          lastReadAt: m.lastReadAt,
        })),
    [members, currentUserId],
  )

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

  // Floating composer: it OVERLAYS the bottom of the message list (transparent,
  // so bubbles scroll behind it). We measure its live height to (a) pad the
  // bottom of the scroll area so the last message rests above it and (b) lift the
  // scroll-down / notice chips above it. The same node still feeds useChatScroll's
  // re-pin observer via `composerRef`.
  const [composerHeight, setComposerHeight] = useState(0)
  const composerRoRef = useRef<ResizeObserver | null>(null)
  const attachComposer = useCallback(
    (node: HTMLDivElement | null) => {
      composerRef(node)
      composerRoRef.current?.disconnect()
      composerRoRef.current = null
      if (!node) {
        setComposerHeight(0)
        return
      }
      setComposerHeight(node.offsetHeight)
      const ro = new ResizeObserver(() => setComposerHeight(node.offsetHeight))
      ro.observe(node)
      composerRoRef.current = ro
    },
    [composerRef],
  )
  useEffect(() => () => composerRoRef.current?.disconnect(), [])

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

  // ── Conversation members (for @-mentions + the group-info panel) ────────
  // Fetched per group; used by the composer's mention picker, @Name resolution
  // on send, and the group-info members list. Cleared between groups so a stale
  // list can't leak across conversations.
  const refetchMembers = useCallback(() => {
    api.groups
      .members(group.id)
      .then((r) => cache.setGroupMembers(group.id, r.members))
      .catch(() => {})
    // cache is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id])

  // Revalidate members on open. We do NOT clear the cached roster first — the
  // cached members (with lastReadAt) render immediately, and the fetch merges
  // in place (lastReadAt only ever moves forward), so read receipts never flash
  // from coloured back to gray.
  useEffect(() => {
    let cancelled = false
    api.groups
      .members(group.id)
      .then((r) => {
        if (!cancelled) cache.setGroupMembers(group.id, r.members)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // cache is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id])

  // Keep the members list fresh when roles change (here or on another client):
  // the server emits `group:members_changed` to the group room after a PATCH.
  useEffect(() => {
    const socket = getSocket()
    function onMembersChanged(p: { groupId: string }) {
      if (p.groupId === group.id) refetchMembers()
    }
    socket.on('group:members_changed', onMembersChanged)
    return () => {
      socket.off('group:members_changed', onMembersChanged)
    }
  }, [group.id, refetchMembers])

  // Live read receipts: a peer advancing their "read up to" marker is handled
  // GLOBALLY by the message cache's `group:read` listener (it updates the
  // cached roster for any group), so the checkmarks here recompute live without
  // a per-ChatView listener — and stay correct even for conversations that
  // aren't currently open.

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
    // Sending consumes the draft — clear it now so the sidebar preview reverts
    // to the real last message immediately (not after the write debounce).
    clearDraftForConversation()
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
    // The caption (seeded from the draft) is being sent — clear the draft too.
    clearDraftForConversation()
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

  // Open (or reuse) a DM with a group member from the Group-info panel's
  // "Send private message" action. Reuses the same createDirect + navigate flow
  // as the message-level private actions. Rethrows so the panel can show its own
  // themed error (e.g. a missing cross-workspace connection).
  const messageMember = useCallback(
    async (m: GroupMember) => {
      const { group: dm } = await api.groups.createDirect(m.id)
      onOpenDirectMessage({ groupId: dm.id, peerId: m.id, peerName: m.displayName })
    },
    [onOpenDirectMessage],
  )

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
  // Vehicle groups are permanent threads, so the subtitle is compact operational
  // metadata (trailer plate + member count) rather than any single trip — using
  // only data we already have. DMs show the peer's workspace.
  const memberText = `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`
  const subtitle =
    group.type === 'vehicle'
      ? [trailerPlate(group) && `Trailer ${trailerPlate(group)}`, memberText]
          .filter(Boolean)
          .join(' · ')
      : (group.directPeer?.workspace ?? 'Direct message')

  // Group-info management gate: workspace admins/dispatchers, or the caller's
  // own group-admin role (resolved from the loaded members). The server
  // re-enforces the full rule on every mutating endpoint.
  const myGroupRole = members.find((m) => m.id === currentUserId)?.role
  const canManageGroup = canInviteMembers || myGroupRole === 'admin'

  // ── Active trip (header summary) ─────────────────────────────────────────
  // Read straight off the group's manual ops blob. `trip` is null until a
  // dispatcher adds one (no map/GPS — purely manual). When present, the header
  // shows a compact trip line instead of the static vehicle subtitle.
  const ops = group.type === 'vehicle' ? getOps(group) : null
  const trip = ops ? tripSummary(ops) : null
  // The active trip's order reference, when set — enables `#reference` trip
  // mentions (the composer's `#` suggestion + the clickable token in message
  // bodies). Undefined in DMs / rooms without a trip or an order number, which
  // turns the whole feature off.
  const tripMentionRef = trip?.reference?.trim() || undefined
  // The header "Trip route" button shows only for vehicle rooms with an active
  // trip whose stops carry ≥2 valid coordinates (enough to draw a route).
  const routeMapAvailable = Boolean(ops?.trip) && Boolean(ops && canRouteStops(ops.stops))

  // Close the trip-route tab if the trip stops being routable while it's open
  // (trip cleared, or its stops dropped below two valid coordinates).
  useEffect(() => {
    if (tripRouteOpen && !routeMapAvailable) closeTripRoute()
  }, [tripRouteOpen, routeMapAvailable, closeTripRoute])

  // The attachment tab currently shown in the chat-window body (null unless an
  // `att:<id>` surface is active).
  const activeAttachmentTab = activeTool.startsWith('att:')
    ? attachmentTabs.find((t) => `att:${t.attachment.id}` === activeTool) ?? null
    : null

  // Persist the whole ops blob and flow the updated meta back up so the header,
  // sidebar, and group-info panel all re-derive from the same source of truth.
  // Used by the Add-trip modal; the server enforces the manage permission.
  async function saveTripOps(next: VehicleOps) {
    // Persists immediately, then computes route data from the stop coordinates in
    // the background (non-blocking; never fails the create).
    await persistOpsWithRoute(group.id, next, (meta) => onGroupUpdated?.(group.id, { meta }))
  }

  // ── Drag-and-drop attachments ───────────────────────────────────────────
  // Dropping an image/document anywhere over the conversation opens the same
  // pre-send preview as the picker. Suppressed while another overlay is open
  // (a preview/modal) or while editing a message (edits can't carry a file).
  const dropBlocked = Boolean(
    pendingFile ||
      imagePreview ||
      pdfPreview ||
      docPreview ||
      forwardTarget ||
      inviteOpen ||
      groupInfoOpen ||
      pendingDelete ||
      editContext,
  )
  // True only when the drag actually carries files (ignore text/element drags).
  const dragHasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')

  function stageDroppedFile(file: File) {
    const err = fileError(file)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setPendingFile(file)
  }

  function onDragEnter(e: React.DragEvent) {
    if (dropBlocked || !dragHasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }
  function onDragOver(e: React.DragEvent) {
    if (dropBlocked || !dragHasFiles(e)) return
    // preventDefault is required for the drop event to fire.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  function onDragLeave(e: React.DragEvent) {
    if (!dragHasFiles(e)) return
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragActive(false)
    }
  }
  function onDrop(e: React.DragEvent) {
    if (!dragHasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    if (dropBlocked) return
    // One attachment per message — take the first dropped file.
    const file = e.dataTransfer.files?.[0]
    if (file) stageDroppedFile(file)
  }

  return (
    // Root is a horizontal row: [chat pane | group info panel]. The chat pane
    // takes the remaining width and reflows when the panel opens beside it on
    // desktop; the left workspace sidebar lives one level up in Workspace.tsx.
    // xl:gap-3 spaces the in-flow group-info side card from the chat (no effect
    // when it's closed or a narrow-screen overlay — both leave one in-flow child).
    <div className="relative flex-1 flex min-h-0 xl:gap-3">
      {/* Chat pane — the whole conversation column (header, pinned bar,
          messages, composer). `flex-1 min-w-0` lets it shrink naturally to the
          remaining width when the Group info column is open, and keeps the
          drag-drop overlay scoped to the chat (never over the panel). */}
      <div
      className="relative flex-1 min-w-0 flex flex-col"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drag-and-drop overlay. pointer-events-none so the drop still lands on
          the underlying drop zone; purely a visual affordance. */}
      {dragActive && !dropBlocked && (
        <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center bg-bg/80 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2.5 rounded-card border-2 border-dashed border-white/20 px-10 py-8 text-center">
            <Upload size="1.625rem" strokeWidth={1.6} className="text-muted" />
            <div className="text-[0.875rem] font-semibold text-text">Drop to send</div>
            <div className="text-[0.71875rem] text-faint">Images up to 10MB · files up to 25MB</div>
          </div>
        </div>
      )}

      {/* Chat surface — header + pinned bar + message list. No outer card border. */}
      <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* Header — NOT a card. It sits flat on the grey chat surface (no rail
          background, no rounded box, no border), so the conversation identity
          reads as part of the timeline rather than a heavy panel. SLIM by
          design: a fixed compact height
          (smaller than the shared --header-height used by the sidebar seam, which
          we intentionally don't touch) gives the message area more room. The
          identity (avatar + name + trip/subtitle) is LEFT-ALIGNED at the start of
          the header; `pr-24` reserves room for the search / group-info actions
          floated at the right edge so a long title/place never runs under them.
          Same structure for every type (DM + vehicle). The message column's own
          centering (`.chat-column`) is separate and unaffected. */}
      <header className="relative h-16 flex items-center gap-2 px-4 shrink-0 overflow-hidden">
        {/* LEFT spacer — balances the right-edge actions so the identity cluster
            stays centred. The active-trip context (status, route, progress) now
            lives in its OWN bar directly under the header (see TripBar below),
            never crammed into this corner. */}
        <div className="flex-1 min-w-0" />

        {/* CENTER — group identity (avatar + name + subtitle), centered between
            the left banner and the right actions. Unchanged for DMs and vehicles;
            the trip details live in the left banner, never on the title row. */}
        <div className="flex items-center gap-3 min-w-0">
          {group.type === 'direct' ? (
            // The peer's avatar opens their read-only profile panel (DMs show
            // no per-message avatars, so the header is the DM's avatar surface).
            <button
              type="button"
              onClick={() =>
                openProfile(group.directPeer?.id ?? '', group.directPeer?.name ?? groupLabel(group))
              }
              aria-label={`View ${group.directPeer?.name ?? 'user'}'s profile`}
              title={group.directPeer?.name ?? undefined}
              className="block shrink-0 rounded-full cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <Avatar
                userId={group.directPeer?.id ?? ''}
                name={group.directPeer?.name ?? groupLabel(group)}
                size={56}
              />
            </button>
          ) : (
            // Vehicle identity — the group's uploaded image when set, else the
            // generated generic icon. A rounded-square slot (vs the DM circle) so
            // a room reads as a room by shape, matching the sidebar + Group info.
            <GroupAvatar groupId={group.id} hasAvatar={Boolean(group.hasAvatar)} shape="rounded" size={56} />
          )}
          <div className="min-w-0">
            <div className="text-[1rem] font-semibold truncate leading-tight">{groupLabel(group)}</div>
            <div className="text-[0.8125rem] text-muted truncate leading-tight mt-0.5">{subtitle}</div>
          </div>
        </div>

        {/* RIGHT — spacer that balances the centre column; the search / group-info
            actions below float over it (absolute) so the search field can expand
            without shifting the centered identity. */}
        <div className="flex-1 min-w-0" />
        {/* Borderless toolbar-style actions floated at the right edge so the
            identity cluster stays centered. Search is offered in EVERY
            conversation (DM + vehicle); Group info stays vehicle-only. Same
            circular hover wash + on-theme focus ring for both. */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {/* Inline search field — expands to the LEFT of the search button when
              open, so it stays inside the header action area instead of taking a
              full row under the header. Compact borderless pill on the dark
              theme; a leading clear (×) appears only with text typed. */}
          {searchOpen && (
            <div
              data-search-region
              className="flex items-center gap-1 h-9 pl-3 pr-1 mr-0.5 rounded-full bg-white/[0.06]"
            >
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeSearch()
                }}
                placeholder="Search messages…"
                aria-label="Search this conversation"
                className="w-40 sm:w-52 bg-transparent text-[0.8125rem] outline-none placeholder:text-faint"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('')
                    searchInputRef.current?.focus()
                  }}
                  aria-label="Clear search"
                  className="h-6 w-6 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.08] transition-colors shrink-0"
                >
                  <X size="0.875rem" strokeWidth={2} />
                </button>
              )}
            </div>
          )}
          <HeaderIconButton
            searchRegion
            active={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
            label={searchOpen ? 'Close search' : 'Search conversation'}
          >
            <Search size="1.1875rem" strokeWidth={1.8} />
          </HeaderIconButton>
          {routeMapAvailable && (
            <HeaderIconButton
              label="Trip route"
              active={tripRouteOpen && activeTool === 'route'}
              onClick={() =>
                tripRouteOpen && activeTool === 'route' ? closeTripRoute() : openTripRoute()
              }
            >
              <Route size="1.1875rem" strokeWidth={1.8} />
            </HeaderIconButton>
          )}
          {group.type === 'vehicle' && (
            <HeaderIconButton
              label="Group info"
              onClick={() => {
                setGroupInfoTab('info')
                setGroupInfoOpen(true)
              }}
            >
              <Info size="1.25rem" strokeWidth={1.8} />
            </HeaderIconButton>
          )}
        </div>
      </header>

      {/* Active-trip bar — a slim, glanceable strip under the header for vehicle
          rooms with a trip: completion ring + status, the origin → destination
          route, and the order/client. Opens the Group info Trip tab on click. */}
      {group.type === 'vehicle' && trip && (
        <TripBar
          trip={trip}
          onOpen={() => {
            setGroupInfoTab('trip')
            setGroupInfoOpen(true)
          }}
        />
      )}

      {/* Tool tabs — a compact banner under the header, shown ONLY when a chat-
          window tool is open (today: the stop-location Map). Lets the user flip
          between Chat and the tool without losing either; the × closes the tool.
          No banner at all when only chat is open. */}
      {(mapPick || tripRouteOpen || attachmentTabs.length > 0) && (
        <div className="shrink-0 h-9 px-3 flex items-center gap-1 border-b border-white/[0.04] overflow-x-auto [scrollbar-width:none]">
          <ToolTab
            active={activeTool === 'chat'}
            icon={<MessageSquare size="0.75rem" strokeWidth={2} />}
            label="Chat"
            onClick={() => setActiveTool('chat')}
          />
          {mapPick && (
            <ToolTab
              active={activeTool === 'map'}
              icon={<MapPin size="0.75rem" strokeWidth={2} />}
              label="Map"
              onClick={() => setActiveTool('map')}
              onClose={closeMapPick}
            />
          )}
          {tripRouteOpen && (
            <ToolTab
              active={activeTool === 'route'}
              icon={<Route size="0.75rem" strokeWidth={2} />}
              label="Trip route"
              onClick={() => setActiveTool('route')}
              onClose={closeTripRoute}
            />
          )}
          {attachmentTabs.map((t) => (
            <ToolTab
              key={t.attachment.id}
              active={activeTool === `att:${t.attachment.id}`}
              icon={
                t.attachment.mimeType.startsWith('image/') ? (
                  <ImageIcon size="0.75rem" strokeWidth={2} />
                ) : (
                  <FileText size="0.75rem" strokeWidth={2} />
                )
              }
              label={attachmentTabLabel(t.attachment)}
              onClick={() => setActiveTool(`att:${t.attachment.id}`)}
              onClose={() => closeAttachmentTab(t.attachment.id)}
            />
          ))}
        </div>
      )}

      <Suspense fallback={<PaneLoader className="flex-1" />}>
      {mapPick && activeTool === 'map' ? (
        <StopLocationMap
          initialQuery={mapPick.query}
          onConfirm={(coords) => {
            mapPick.onConfirm(coords)
            closeMapPick()
          }}
          onCancel={closeMapPick}
        />
      ) : tripRouteOpen && activeTool === 'route' ? (
        <TripRouteMap
          stops={ops?.stops ?? []}
          route={ops?.trip?.route}
          // Editing the route is a "manage this group" action — the same boundary
          // the server enforces on the PATCH, so a non-manager never sees a save
          // that would 403. Requires an active trip to attach the route to.
          canEdit={group.type === 'vehicle' && canManageGroup && Boolean(ops?.trip)}
          onSaveRoute={async (editedStops, editedRoute) => {
            const currentOps = ops
            if (!currentOps?.trip) return
            // Persist the edited stops + freshly computed route, flagging the save
            // as a deliberate edit so the server logs the "… edited the trip route"
            // system message (deduped server-side when nothing actually changed).
            const nextOps: VehicleOps = {
              ...currentOps,
              stops: editedStops,
              trip: { ...currentOps.trip, route: editedRoute },
            }
            const { group: updated } = await api.groups.update(group.id, {
              ops: nextOps,
              routeEdited: true,
            })
            onGroupUpdated?.(group.id, { meta: updated.meta })
          }}
        />
      ) : activeAttachmentTab ? (
        <AttachmentTabView
          attachment={activeAttachmentTab.attachment}
          message={activeAttachmentTab.message}
          onReply={replyFromPreview}
          onForward={forwardFromPreview}
          onClose={() => closeAttachmentTab(activeAttachmentTab.attachment.id)}
        />
      ) : pdfPreview ? (
        <InlinePdfPreview
          attachment={pdfPreview.attachment}
          message={pdfPreview.message}
          onReply={replyFromPreview}
          onForward={forwardFromPreview}
          onClose={() => setPdfPreview(null)}
          onOpenInTab={() => openAttachmentTab(pdfPreview)}
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
              // Bottom padding == the floating composer's height (+ a small gap),
              // so the last message scrolls fully clear above the overlaid input
              // while older messages scroll BEHIND its transparent body. No fade
              // is applied to the list itself — the only fade is at the window's
              // bottom edge, below the composer (see the chat surface).
              className="flex-1 overflow-y-auto pt-4 [scrollbar-gutter:stable]"
              style={{ paddingBottom: composerHeight + 8 }}
            >
              {loading ? (
                // Centre the loader in the FULL chat pane (the scroller has a
                // definite flex height), so it never reads as a tiny top row.
                <div className="h-full flex items-center justify-center">
                  <Spinner variant="lg" />
                </div>
              ) : (
                <div className="chat-column">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-[0.78125rem] text-faint">No messages yet. Say something.</p>
                  </div>
                ) : (
                  // PERF / TODO (message-list virtualization): every loaded
                  // message currently mounts a real DOM row. That's fine for the
                  // paginated window we keep today, but once a thread can hold a
                  // few hundred+ loaded rows the unrendered ones still cost
                  // layout/paint. When that day comes, virtualize THIS list with
                  // react-virtuoso or @tanstack/react-virtual. Keep the current
                  // scroll behavior intact: useChatScroll's bottom-pinning,
                  // anchorBeforePrepend (load-older jump preservation), the
                  // data-message-id jump-to-original lookup, and per-row
                  // imagePriority all need equivalents (Virtuoso's
                  // followOutput/firstItemIndex map cleanly onto these). It's
                  // intentionally NOT done now — the rows are memoized (see
                  // MessageRow) which removes the immediate re-render pressure,
                  // and virtualization here is a behavioral risk best taken on
                  // its own.
                  <div className="flex flex-col gap-0.5">
                    {nextCursor && (
                      <div className="flex justify-center pb-3">
                        <button
                          onClick={loadOlder}
                          disabled={loadingOlder}
                          className="text-[0.71875rem] text-muted hover:text-text border border-white/[0.10] rounded-btn px-3 py-1 transition-colors disabled:opacity-50"
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
                            // First message of the whole thread (nothing older to
                            // load) → its day pill reads "Conversation started".
                            conversationStart={i === 0 && !nextCursor}
                            onJumpToMessage={jumpToMessage}
                          />
                        )
                      }
                      return (
                        <MessageRow
                          // Stable across the optimistic→real reconcile (localId
                          // is preserved on the real message) so the row — and
                          // its image — never remounts/flickers.
                          key={m.localId ?? m.id}
                          message={m}
                          mine={m.authorId === currentUserId}
                          currentUserId={currentUserId}
                          // Receipts only for my own rows; incoming rows get
                          // undefined so they don't re-render on read updates.
                          readers={m.authorId === currentUserId ? readers : undefined}
                          prev={messages[i - 1]}
                          conversationStart={i === 0 && !nextCursor}
                          groupType={group.type}
                          highlighted={highlightedMessageId === m.id}
                          onRetry={retry}
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
                          onOpenProfile={openProfile}
                          // `#reference` trip mentions — clicking one deep-links
                          // to the Group info Trip tab (opening the panel if
                          // it's closed). Undefined without an active trip.
                          tripRef={tripMentionRef}
                          onOpenTrip={() => {
                            setGroupInfoTab('trip')
                            setGroupInfoOpen(true)
                          }}
                        />
                      )
                    })}
                  </div>
                )}
                </div>
              )}
            </div>
            {/* Bottom-edge fadeout — overlays the bottom of the message list so
                the content dissolves softly at the end of the window. z-0 paints
                it ABOVE the bubbles (so they actually fade) but BELOW the chips
                (z-10) and the composer (z-20), so the input stays fully sharp and
                the scroll-down chip stays visible. pointer-events-none → never
                blocks clicks/scroll (action menus are portaled/fixed, above this
                regardless). The right inset keeps the scrollbar visible. */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 right-[var(--chat-scrollbar-gutter)] bottom-0 z-0"
              style={{
                height: CHAT_BOTTOM_FADE_HEIGHT,
                backgroundImage: 'linear-gradient(to top, #181818 0%, transparent 100%)',
              }}
            />
            {showScrollDown && (
              <button
                onClick={scrollToBottom}
                aria-label="Scroll to latest messages"
                style={{ bottom: composerHeight + 8 }}
                className="absolute left-1/2 -translate-x-1/2 z-10 h-9 w-9 rounded-full bg-surface border border-white/[0.10] text-text hover:bg-surface-2 hover:border-white/[0.20] flex items-center justify-center transition-colors shadow-[0_4px_14px_rgba(0,0,0,0.55)]"
              >
                <ArrowDown size="1rem" strokeWidth={1.8} />
              </button>
            )}
            {notice && (
              <div
                style={{ bottom: composerHeight + 8 }}
                className="absolute left-1/2 -translate-x-1/2 z-10 rounded-chip bg-surface border border-white/[0.10] text-[0.71875rem] text-muted px-3 py-1.5 shadow-[0_4px_14px_rgba(0,0,0,0.55)]"
              >
                {notice}
              </div>
            )}

            {/* Floating composer — OVERLAYS the bottom of the message list, so
                bubbles scroll behind its transparent body. The outer overlay is
                pointer-events-none (scroll/clicks pass through to the messages);
                only the inner lane is interactive. No background, border, or
                footer chrome — just the input controls. .chat-column keeps it on
                the message bubble lane (capped + centred) and it recenters/shrinks
                with the chat when the group-info column opens. Reply/typing/error
                rows sit directly above the input, sharing the same lane. */}
            <div
              ref={attachComposer}
              data-composer
              className="absolute inset-x-0 bottom-0 z-20 pointer-events-none pt-2 pb-3 pr-[var(--chat-scrollbar-gutter)]"
            >
              <div className="chat-column pointer-events-auto">
                {typingUsers.length > 0 && (
                  <div className="mb-1 px-1">
                    <TypingIndicator users={typingUsers} />
                  </div>
                )}
                {error && <div className="text-[0.71875rem] text-alert mb-1.5">{error}</div>}
                <ChatComposer
                  ref={composerHandleRef}
                  placeholder={`Message ${groupLabel(group)}`}
                  text={text}
                  onTextChange={setText}
                  members={members}
                  // Enables the `#` trip-mention suggestion; the subtitle echoes
                  // the client + status so the picker row reads like the trip.
                  activeTrip={
                    tripMentionRef
                      ? {
                          reference: tripMentionRef,
                          subtitle:
                            [trip?.client, trip?.statusLabel].filter(Boolean).join(' · ') ||
                            undefined,
                        }
                      : undefined
                  }
                  onFilePicked={setPendingFile}
                  // Trip creation is a vehicle-room, manage-capable action; the
                  // composer hides the "Trip" menu item when this is undefined
                  // (DMs, or members without manage rights).
                  onAddTrip={
                    group.type === 'vehicle' && canManageGroup
                      ? () => setAddTripOpen(true)
                      : undefined
                  }
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
          </div>
        </>
      )}
      </Suspense>
      </div>
      {/* end chat card */}

      {/* In-conversation search results — a compact floating dropdown anchored
          under the header's inline search field. Absolutely positioned within the
          chat pane so it OVERLAYS the messages (never pushes them down). The query
          is owned by the header field above; clicking a result jumps to that
          message (reusing the reply jump + highlight). */}
      {searchOpen && (
        <ConversationSearch
          query={searchQuery}
          messages={messages}
          currentUserId={currentUserId}
          onJump={jumpToMessage}
        />
      )}
      </div>
      {/* end chat pane */}

      {pendingFile && (
        <Suspense fallback={<ModalLoader />}>
        <AttachmentSendPreviewModal
          file={pendingFile}
          initialCaption={text}
          onReplace={setPendingFile}
          onCancel={() => setPendingFile(null)}
          onSend={sendPendingFile}
        />
        </Suspense>
      )}

      {imagePreview && (
        <Suspense fallback={<ModalLoader />}>
        <ImagePreviewModal
          attachment={imagePreview.attachment}
          message={imagePreview.message}
          onReply={replyFromPreview}
          onForward={forwardFromPreview}
          onClose={() => setImagePreview(null)}
          onOpenInTab={() => openAttachmentTab(imagePreview)}
        />
        </Suspense>
      )}

      {docPreview && (
        <Suspense fallback={<ModalLoader />}>
        <DocumentPreviewModal
          attachment={docPreview.attachment}
          message={docPreview.message}
          onReply={replyFromPreview}
          onForward={forwardFromPreview}
          onClose={() => setDocPreview(null)}
          onOpenInTab={() => openAttachmentTab(docPreview)}
        />
        </Suspense>
      )}

      {forwardTarget && (
        <ForwardModal
          fromGroupId={group.id}
          message={forwardTarget}
          onClose={() => setForwardTarget(null)}
          onForwarded={() => flashNotice('Message forwarded.')}
        />
      )}

      {/* Group info, Add trip and the user profile share the single right-hand
          column slot — Add trip takes precedence over Group info, and the user
          profile takes precedence over both, so they never stack. The hidden
          wrapper (display:none) keeps Group info / Add trip MOUNTED while a
          profile is open, so their state (active tab, form drafts) survives and
          returns intact when the profile closes; `contents` unwraps them back
          into the flex row otherwise. */}
      <div className={profileTarget ? 'hidden' : 'contents'}>
      {group.type === 'vehicle' && groupInfoOpen && !addTripOpen && (
        <Suspense fallback={<PanelLoader />}>
        <GroupInfoPanel
          group={group}
          currentUserId={currentUserId}
          members={members}
          membersLoading={members.length === 0}
          canManage={canManageGroup}
          onClose={() => setGroupInfoOpen(false)}
          onInvite={() => setInviteOpen(true)}
          onMembersChanged={refetchMembers}
          onMessageMember={messageMember}
          onOpenProfile={(m) => openProfile(m.id, m.displayName)}
          onGroupUpdated={(partial) => onGroupUpdated?.(group.id, partial)}
          onOpenRouteMap={routeMapAvailable ? openTripRoute : undefined}
          initialTab={groupInfoTab}
        />
        </Suspense>
      )}

      {group.type === 'vehicle' && addTripOpen && (
        <Suspense fallback={<PanelLoader />}>
        <AddTripPanel
          ops={ops ?? { vehicle: {}, trip: null, stops: [] }}
          onClose={() => setAddTripOpen(false)}
          onCreate={saveTripOps}
          onPickLocation={openMapPick}
        />
        </Suspense>
      )}
      </div>

      {/* Read-only user details — occupies the same right-hand column slot as
          Group info (in-flow card on xl+, overlay drawer below), rendered while
          the panels above are display:none'd. Keyed by user so switching
          targets refetches. */}
      {profileTarget && (
        <UserProfilePanel
          key={profileTarget.id}
          userId={profileTarget.id}
          name={profileTarget.name}
          currentUserId={currentUserId}
          groupRole={
            group.type === 'vehicle'
              ? members.find((m) => m.id === profileTarget.id)?.role
              : undefined
          }
          onClose={() => setProfileTarget(null)}
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
    </div>
  )
}
