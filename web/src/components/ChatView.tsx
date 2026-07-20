import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ArrowDown,
  FileText,
  Image as ImageIcon,
  MapPin,
  MessageSquare,
  Route,
  Upload,
} from 'lucide-react'
import type { Attachment, Group, GroupMember, IncomingMessage, ReplyToPreview } from '../lib/types'
import { groupLabel, trailerPlate } from '../lib/types'
import { fileError } from './attachments/attachmentUtils'
import { resolveMentionIds } from '../lib/mentions'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import ChatComposer, { type ChatComposerHandle, type EditContext } from './composer/ChatComposer'
import ChatHeader from './chat/ChatHeader'
import ChatModals from './chat/ChatModals'
import type { AttachmentContext } from './chat/chatTypes'
import { PaneLoader, PanelLoader } from './LazyFallback'

// ── Code-split heavy features ──────────────────────────────────────────────
// These load only when actually opened, keeping their bundles (pdf.js image/
// document preview logic, the @here/flexpolyline map stack, the trip + group
// info panels) out of the initial chat bundle. Each render site is wrapped in a
// Suspense with a compact loader (see LazyFallback).
const InlinePdfPreview = lazy(() => import('./attachments/InlinePdfPreview'))
const AttachmentTabView = lazy(() => import('./attachments/AttachmentTabView'))
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
import ReadReceiptsPanel from './messages/ReadReceiptsPanel'
import SystemMessageRow from './messages/SystemMessageRow'
import PinnedBar from './messages/PinnedBar'
import TypingIndicator from './messages/TypingIndicator'
import Spinner from './Spinner'
import type { AttachmentWorkspaceTab, LocalMessage } from './messages/types'
import { useChatScroll } from '../hooks/useChatScroll'
import { useFileDrop } from '../hooks/useFileDrop'
import { useMessageActions } from '../hooks/useMessageActions'
import { useSendMessage } from '../hooks/useSendMessage'
import { useMessageDrafts } from '../hooks/useMessageDrafts'
import { getDraft } from '../lib/draftStorage'
import { devlog } from '../lib/devlog'
import { useMessageCache } from '../hooks/useMessageCache'
import { preloadImage } from '../lib/attachmentCache'
import ToolTab from './ChatToolTab'
import { VehicleRoomPicker } from './inbox/InboxView'
import { toReplyPreview, attachmentTabLabel } from './chatViewUtils'
import { useTypingIndicator } from '../hooks/useTypingIndicator'
import { usePinnedMessages } from '../hooks/usePinnedMessages'

// Stable empty list so a group with no cached thread doesn't hand a fresh
// array to useChatScroll on every render.
const NO_MESSAGES: LocalMessage[] = []

// How many of the newest messages get their images treated as "recent": loaded
// eagerly in-bubble and warmed in the browser cache when the thread opens.
// Older messages stay lazy so a huge backlog doesn't fetch everything at once.
const RECENT_IMAGE_WINDOW = 15

// Height (px) of the soft fadeout at the very BOTTOM EDGE of the chat window. It
// overlays the bottom of the message list (painted ABOVE the bubbles) so the
// content fades out at the end of the window instead of cutting off — while
// sitting BELOW the floating composer + chips (z-10/z-20) so the input stays
// sharp. Fades to the dedicated chat-card surface (`chat`, #202020).
const CHAT_BOTTOM_FADE_HEIGHT = 56

type Props = {
  group: Group
  currentUserId: string
  currentWorkspaceName: string
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
  // Workspace-home shortcut: mount this vehicle room with its existing Add Trip
  // panel already open, then let the parent clear the one-shot request.
  initialAddTripOpen?: boolean
  onConsumeInitialAddTrip?: () => void
  // Used when Add trip is opened from a conversation that is not itself a
  // vehicle room. Workspace owns the room list and the cross-chat navigation.
  vehicleRooms: Group[]
  onAddTripInGroup: (groupId: string) => void
  // Attachment tabs live at Workspace level so PDFs/images remain open while
  // the single Chat tab is replaced by another conversation.
  attachmentTabs: AttachmentWorkspaceTab[]
  onOpenAttachmentTab: (tab: AttachmentWorkspaceTab) => void
  onCloseAttachmentTab: (attachmentId: string) => void
  onReplyToAttachmentTab: (groupId: string, reply: ReplyToPreview) => void
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
  currentWorkspaceName,
  onRead,
  onOpenDirectMessage,
  initialReplyContext = null,
  onConsumeInitialReply,
  initialAddTripOpen = false,
  onConsumeInitialAddTrip,
  vehicleRooms,
  onAddTripInGroup,
  attachmentTabs,
  onOpenAttachmentTab,
  onCloseAttachmentTab,
  onReplyToAttachmentTab,
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
  const [forwardTarget, setForwardTarget] = useState<{
    message: LocalMessage
    groupId: string
  } | null>(null)
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
  // Sent message whose live read roster is open in the shared right-side panel
  // slot. Unlike the old per-row popover, this is chat-level state so the panel
  // can reflow the conversation and show comfortable member rows.
  const [receiptTarget, setReceiptTarget] = useState<LocalMessage | null>(null)
  const openProfile = useCallback((userId: string, name: string) => {
    if (!userId || userId.startsWith('local-')) return
    setReceiptTarget(null)
    setProfileTarget({ id: userId, name })
  }, [])
  const openReadReceipts = useCallback((message: LocalMessage) => {
    setProfileTarget(null)
    setReceiptTarget(message)
  }, [])
  // Whether the "Add trip" modal is open (vehicle groups only). Opened from the
  // composer's add (+) menu.
  const [addTripOpen, setAddTripOpen] = useState(
    () => group.type === 'vehicle' && canInviteMembers && initialAddTripOpen,
  )
  const [tripPickerOpen, setTripPickerOpen] = useState(false)
  useEffect(() => {
    if (initialAddTripOpen) onConsumeInitialAddTrip?.()
  }, [initialAddTripOpen, onConsumeInitialAddTrip])
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
  // Attachment preview tabs are owned by Workspace rather than this keyed chat
  // view, so changing conversation replaces only the Chat surface and leaves
  // PDFs/images available in this shared strip.
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
    onOpenAttachmentTab({ ...ctx, groupId: group.id })
    setActiveTool(`att:${ctx.attachment.id}`)
  }, [group.id, onOpenAttachmentTab])
  const closeAttachmentTab = useCallback((id: string) => {
    onCloseAttachmentTab(id)
    setActiveTool((t) => (t === `att:${id}` ? 'chat' : t))
  }, [onCloseAttachmentTab])
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
    // A conversation switch replaces only the Chat tab. Workspace-owned
    // attachment tabs remain in the strip until the user closes them.
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
    syncBottomAfterComposerLayout,
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
  // composerHeight is also the message scroller's bottom padding. Re-pin only
  // after React has applied that padding, avoiding a cross-browser race where
  // ResizeObserver sees the typing row before the new scrollHeight exists.
  useLayoutEffect(() => {
    if (composerHeight > 0) syncBottomAfterComposerLayout()
  }, [composerHeight, syncBottomAfterComposerLayout])
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
  // The optimistic send pipeline (bubble insert → POST → reconcile/fail) lives
  // in useSendMessage; the thin wrappers below own composer state.
  const { sendBody, retry } = useSendMessage({
    groupId: group.id,
    currentUserId,
    members,
    pinToBottomNext,
    onError: setError,
  })

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
    setForwardTarget({ message: m, groupId: group.id })
  }

  const startForward = useCallback(
    (m: LocalMessage) => setForwardTarget({ message: m, groupId: group.id }),
    [group.id],
  )

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

  // The menu actions open a confirmation first; the actual delete runs only
  // once the user confirms.
  function confirmPendingDelete() {
    if (!pendingDelete) return
    const { message, scope } = pendingDelete
    setPendingDelete(null)
    if (scope === 'everyone') void deleteForEveryone(message)
    else void deleteForMe(message)
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

  const messageProfileUser = useCallback(
    async (userId: string, name: string) => {
      const { group: dm } = await api.groups.createDirect(userId)
      onOpenDirectMessage({ groupId: dm.id, peerId: userId, peerName: name })
      setProfileTarget(null)
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

  // ── Copy / pin / unpin / delete / private-DM actions ───────────────────
  // Optimistic cache patches + reverts live in the hook; error/notice chips
  // stay owned here via the callbacks.
  const {
    copyMessage,
    pinMessage,
    unpinMessage,
    deleteForEveryone,
    deleteForMe,
    replyPrivately,
    sendPrivate,
  } = useMessageActions({
    groupId: group.id,
    currentUserId,
    setPinned,
    onError: setError,
    onClearError: () => setError(null),
    onNotice: flashNotice,
    onOpenDirectMessage,
  })

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
  const canAddTrip = group.type === 'vehicle' ? canManageGroup : canInviteMembers
  const openAddTrip = useCallback(() => {
    setReceiptTarget(null)
    if (group.type === 'vehicle' && canManageGroup) {
      setAddTripOpen(true)
      return
    }
    setTripPickerOpen(true)
  }, [group.type, canManageGroup])

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
      tripPickerOpen ||
      editContext,
  )
  // Validate the dropped file the same way the picker does, then stage it in
  // the pre-send preview modal.
  function stageDroppedFile(file: File) {
    const err = fileError(file)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setPendingFile(file)
  }

  const { dragActive, dropHandlers } = useFileDrop({
    blocked: dropBlocked,
    onFile: stageDroppedFile,
  })

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
      <div className="relative flex-1 min-w-0 flex flex-col" {...dropHandlers}>
      {/* Drag-and-drop overlay. pointer-events-none so the drop still lands on
          the underlying drop zone; purely a visual affordance. */}
      {dragActive && !dropBlocked && (
        <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center bg-chat/80 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2.5 rounded-card border-2 border-dashed border-white/20 px-10 py-8 text-center">
            <Upload size="1.625rem" strokeWidth={1.6} className="text-muted" />
            <div className="text-[0.875rem] font-semibold text-text">Drop to send</div>
            <div className="text-[0.71875rem] text-faint">Images up to 10MB · files up to 25MB</div>
          </div>
        </div>
      )}

      {/* Chat surface — header + pinned bar + message list. The outer card and
          rounded clipping live in Workspace; this surface inherits its tone. */}
      <div className="flex-1 flex flex-col min-h-0 bg-chat">
      <ChatHeader
        group={group}
        subtitle={subtitle}
        onOpenProfile={openProfile}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        searchInputRef={searchInputRef}
        onSearchQueryChange={setSearchQuery}
        onOpenSearch={openSearch}
        onCloseSearch={closeSearch}
        routeMapAvailable={routeMapAvailable}
        tripRouteActive={tripRouteOpen && activeTool === 'route'}
        onOpenTripRoute={openTripRoute}
        onCloseTripRoute={closeTripRoute}
        onOpenGroupInfo={() => {
          setGroupInfoTab('info')
          setReceiptTarget(null)
          setGroupInfoOpen(true)
        }}
      />

      {/* Active-trip bar — a slim, glanceable strip under the header for vehicle
          rooms with a trip: completion ring + status, the origin → destination
          route, and the order/client. Opens the Group info Trip tab on click. */}
      {group.type === 'vehicle' && trip && (
        <TripBar
          trip={trip}
          onOpen={() => {
            setGroupInfoTab('trip')
            setReceiptTarget(null)
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
          // Live driver positions: subscribe to this room's driver:location
          // events, scoped to the active trip (canonical id = trip.id, falling
          // back to the room id exactly like the server's buildDriverTrip),
          // seeded from the stored last-known blob on the group meta.
          groupId={group.id}
          tripId={ops?.trip ? (ops.trip.id ?? group.id) : undefined}
          driverLocationsSeed={group.meta.driverLocations}
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
          onReply={(message) => {
            if (activeAttachmentTab.groupId === group.id) {
              replyFromPreview(message)
              return
            }
            setActiveTool('chat')
            onReplyToAttachmentTab(activeAttachmentTab.groupId, toReplyPreview(message))
          }}
          onForward={(message) =>
            setForwardTarget({ message, groupId: activeAttachmentTab.groupId })
          }
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
                <div className="chat-column min-h-full flex flex-col">
                {messages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
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
                  <div className="mt-auto flex flex-col gap-0.5">
                    {nextCursor && (
                      <div className="flex justify-center pb-3">
                        <button
                          onClick={loadOlder}
                          disabled={loadingOlder}
                          className="text-[0.71875rem] text-muted hover:text-text border border-white/[0.10] rounded-full px-3 py-1 transition-colors disabled:opacity-50"
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
                          onForward={startForward}
                          onReplyPrivately={replyPrivately}
                          onSendPrivate={sendPrivate}
                          onDeleteForMe={(m) => setPendingDelete({ message: m, scope: 'me' })}
                          onDeleteForEveryone={(m) =>
                            setPendingDelete({ message: m, scope: 'everyone' })
                          }
                          onJumpToMessage={jumpToMessage}
                          onOpenReadReceipts={openReadReceipts}
                          onOpenProfile={openProfile}
                          // `#reference` trip mentions — clicking one deep-links
                          // to the Group info Trip tab (opening the panel if
                          // it's closed). Undefined without an active trip.
                          tripRef={tripMentionRef}
                          onOpenTrip={() => {
                            setGroupInfoTab('trip')
                            setReceiptTarget(null)
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
                backgroundImage:
                  'linear-gradient(to top, rgb(var(--color-chat)) 0%, rgb(var(--color-chat) / 0) 100%)',
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
                {/* Temporary incoming-style bubble directly ABOVE the input.
                    It is part of the measured composer wrapper, so its animated
                    height increases/decreases the message-list bottom reserve;
                    the conversation visibly lifts and settles with it. */}
                <TypingIndicator users={typingUsers} />
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
                  // In a manageable vehicle room this opens the editor directly;
                  // from a DM it opens the workspace vehicle-room chooser.
                  onAddTrip={canAddTrip ? openAddTrip : undefined}
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

      <ChatModals
        group={group}
        members={members}
        pendingFile={pendingFile}
        pendingCaption={text}
        onReplacePendingFile={setPendingFile}
        onCancelPendingFile={() => setPendingFile(null)}
        onSendPendingFile={sendPendingFile}
        imagePreview={imagePreview}
        onCloseImagePreview={() => setImagePreview(null)}
        docPreview={docPreview}
        onCloseDocPreview={() => setDocPreview(null)}
        onReplyFromPreview={replyFromPreview}
        onForwardFromPreview={forwardFromPreview}
        onOpenAttachmentTab={openAttachmentTab}
        forwardTarget={forwardTarget}
        onCloseForward={() => setForwardTarget(null)}
        onForwarded={() => flashNotice('Message forwarded.')}
        inviteOpen={inviteOpen}
        onCloseInvite={() => setInviteOpen(false)}
        pendingDelete={pendingDelete}
        onConfirmDelete={confirmPendingDelete}
        onCancelDelete={() => setPendingDelete(null)}
      />

      {tripPickerOpen && (
        <VehicleRoomPicker
          rooms={vehicleRooms}
          onSelect={(groupId) => {
            setTripPickerOpen(false)
            onAddTripInGroup(groupId)
          }}
          onClose={() => setTripPickerOpen(false)}
        />
      )}

      {/* Group info, Add trip and the user profile share the single right-hand
          column slot — Add trip takes precedence over Group info, and the user
          profile takes precedence over both, so they never stack. The hidden
          wrapper (display:none) keeps Group info / Add trip MOUNTED while a
          profile is open, so their state (active tab, form drafts) survives and
          returns intact when the profile closes; `contents` unwraps them back
          into the flex row otherwise. */}
      <div className={profileTarget || receiptTarget ? 'hidden' : 'contents'}>
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
          currentWorkspaceName={currentWorkspaceName}
          groupRole={
            group.type === 'vehicle'
              ? members.find((m) => m.id === profileTarget.id)?.role
              : undefined
          }
          onMessage={messageProfileUser}
          onClose={() => setProfileTarget(null)}
        />
      )}

      {receiptTarget && !profileTarget && (
        <ReadReceiptsPanel
          message={receiptTarget}
          others={readers}
          onOpenProfile={openProfile}
          onClose={() => setReceiptTarget(null)}
        />
      )}

    </div>
  )
}
