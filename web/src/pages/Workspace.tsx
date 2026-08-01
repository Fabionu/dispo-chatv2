import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  MailOpen,
  Menu,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import type { User, Workspace as WorkspaceT } from '../auth/AuthContext'
import type {
  Connection,
  ConnectionUser,
  Group,
  GroupInvite,
  Profile,
  ReplyToPreview,
  WorkspaceMember,
} from '../lib/types'
import { groupLabel, isUnread, tractorPlate } from '../lib/types'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useMessageCacheActions } from '../hooks/useMessageCache'
import ChatView from '../components/ChatView'
import type { AttachmentWorkspaceTab } from '../components/messages/types'
import ConnectionRequestView from '../components/connections/ConnectionRequestView'
import ConnectionRequestsSection from '../components/connections/ConnectionRequestsSection'
import GroupInvitesSection from '../components/invites/GroupInvitesSection'
import GroupInviteView from '../components/invites/GroupInviteView'
import { MENU_CONTAINER, MENU_GLYPH, MENU_SEPARATOR } from '../components/menuStyles'
import Spinner from '../components/Spinner'
import CreateVehicleGroupModal from '../components/CreateVehicleGroupModal'
import NewMessageModal from '../components/NewMessageModal'
import AccountSidebarPanel from '../components/settings/AccountSidebarPanel'
import ProfileSidebarPanel from '../components/settings/ProfileSidebarPanel'
import CompanySidebarPanel from '../components/settings/CompanySidebarPanel'
import WorkspaceSettingsPanel from '../components/settings/WorkspaceSettingsPanel'
import InboxView from '../components/inbox/InboxView'
import { useIdle } from '../hooks/useIdle'
import { usePresence } from '../hooks/usePresence'
import { useConnections } from '../hooks/useConnections'
import { useGroupInvites } from '../hooks/useGroupInvites'
import { useWorkspaceGroups } from '../hooks/useWorkspaceGroups'
import {
  useDensity,
  SIDEBAR_AVATAR_SIZE,
  SIDEBAR_CONVERSATION_AVATAR_SIZE,
} from '../lib/density'
import { getStoredSidebarCollapsed, setStoredSidebarCollapsed } from '../lib/sidebar'
import { preloadAvatar } from '../lib/avatarCache'
import { useAuth } from '../auth/AuthContext'
import GroupRow from './SidebarGroupRow'
import ContactRow from './SidebarContactRow'
import SidebarIdentityBar from './SidebarIdentityBar'
import { FilterTab, ArchiveToggle, EmptyHint, MenuItem } from './sidebarBits'
import { optimisticDirectGroup } from './workspaceUtils'
import ConnectionStatusBanner from '../components/ConnectionStatusBanner'
import { NOTIFICATION_OPEN_EVENT } from '../lib/browserNotifications'
import UserProfilePanel from '../components/UserProfilePanel'
import WorkspaceNavRail from './WorkspaceNavRail'

type Props = {
  user: User
  workspace: WorkspaceT
  onSignOut: () => Promise<void>
}

type NewGroupKind = 'vehicle' | 'direct'

// What the LEFT RAIL is showing. The rail is a small navigation stack, not a set
// of popovers: 'list' is the conversation list (home), and every other value is a
// drill-in view that REPLACES it inside the same panel. Each level's Back goes
// one step left along this chain:
//   list ← account ← profile / settings
//   list ← company
// The list's own state (selection, search text, filter, scroll offset) is held
// here in Workspace and therefore survives every drill-in unchanged.
type SidebarView = 'list' | 'account' | 'profile' | 'company' | 'settings'

// Sidebar pill filter — which slice of the single unified list is shown.
//   'all'      → active (non-archived) vehicle rooms + DMs + company contacts
//   'archived' → archived conversations only (no contacts)
//   'groups'   → active vehicle/group rooms only
//   'dms'      → active direct messages + company contacts
//   'unread'   → everything still unread, rooms and DMs alike (no contacts —
//                a colleague without a thread has nothing to be unread)
// Archive/pin/mute/hide are per-user prefs (see group_members, migration 0023).
type SidebarFilter = 'all' | 'archived' | 'groups' | 'dms' | 'unread'

// One entry in the unified rail list: either a real conversation (vehicle room
// or DM Group) or a company colleague you don't have a DM with yet.
type SidebarRowItem =
  | { kind: 'group'; key: string; group: Group }
  | { kind: 'contact'; key: string; member: WorkspaceMember }

// What the main pane is currently showing. A group chat, a pending request, a
// pending invite, or the Inbox / workspace-home tools area. `null` is treated
// the same as `inbox` — both render the Inbox view (it's the default home).
type Selection =
  | { kind: 'group'; id: string }
  | { kind: 'request'; id: string }
  | { kind: 'invite'; id: string }
  | { kind: 'inbox' }
  | null

function initialSelection(): Selection {
  const params = new URLSearchParams(window.location.search)
  const groupId = params.get('notificationGroup')
  if (!groupId) return null
  params.delete('notificationGroup')
  const query = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  return { kind: 'group', id: groupId }
}

export default function Workspace({ user, workspace, onSignOut }: Props) {
  const { refresh } = useAuth()
  // Sidebar avatar/logo diameter tracks the display density (these components
  // take a numeric size, so they can't read the CSS density tokens directly).
  const density = useDensity()
  const sidebarAvatar = SIDEBAR_AVATAR_SIZE[density]
  const conversationAvatar = SIDEBAR_CONVERSATION_AVATAR_SIZE[density]
  // Auto-away presence: grey "Away" on the footer status dot when idle / tab
  // hidden. Doesn't change the stored (manual) status — presence only.
  const away = useIdle()
  // Live online/offline presence of peers (DM status dots). `resyncPresence`
  // re-requests the server snapshot; we call it whenever the group set changes
  // (below), since a new co-member who's already online won't emit a transition.
  const { online: onlineIds, resync: resyncPresence } = usePresence()
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  // Collapsed left rail — frees the main area for wide chats. Persisted
  // so the choice survives reloads; collapsing/expanding never reloads the app or
  // touches the current selection.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed)
  const [modal, setModal] = useState<NewGroupKind | null>(null)
  // Which view the rail is on. Account / profile / company / settings all render
  // INSIDE the rail in place of the conversation list (the chat stays visible on
  // the right); the list itself is never unmounted from the app's state, only
  // from the DOM, and comes back exactly as it was (see listScroll below).
  const [sidebarView, setSidebarView] = useState<SidebarView>('list')
  const [profileTarget, setProfileTarget] = useState<{ id: string; name: string } | null>(null)
  // Prefetched once at mount so opening "My profile" is instant (the panel
  // remounts each open, so without this it would refetch every time and flash
  // a "Loading…" state). Kept fresh by the panel's onSaved.
  const [cachedProfile, setCachedProfile] = useState<Profile | null>(null)
  // Bumped after the current user / admin changes their avatar / logo, to bust
  // the browser image cache in the rail.
  const [avatarVersion, setAvatarVersion] = useState(0)
  const [logoVersion, setLogoVersion] = useState(0)
  // Active members of the caller's own company (internal/trusted contacts).
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [selection, setSelection] = useState<Selection>(initialSelection)
  // Which conversation row has its inline action strip expanded. Held here, not
  // per row, so opening one collapses whichever was open.
  const [rowActionsId, setRowActionsId] = useState<string | null>(null)
  // Sidebar quick-filter text. Filters the conversation lists by name (and a
  // vehicle's tractor plate) so "Jump to…" actually narrows the rail.
  const [query, setQuery] = useState('')
  // Sidebar pill filter — the single list below shows everything / only groups /
  // only DMs depending on this. Replaces the old visible section grouping.
  const [filter, setFilter] = useState<SidebarFilter>('all')
  // A quote to seed a DM's composer with, set when a DM is opened via "Reply
  // privately". Scoped to a group id so it only seeds that conversation.
  const [pendingReply, setPendingReply] = useState<{
    groupId: string
    reply: ReplyToPreview
  } | null>(null)
  // One-shot Workspace-home shortcut: selecting a room from the Add trip card
  // navigates there and asks the newly-mounted ChatView to open its existing
  // Add Trip panel immediately.
  const [pendingAddTripGroupId, setPendingAddTripGroupId] = useState<string | null>(null)
  // Same one-shot handshake for the sidebar row action "View user profile" /
  // "View group info": select the conversation, then let its ChatView open the
  // details surface that matches the conversation's type.
  const [pendingDetailsGroupId, setPendingDetailsGroupId] = useState<string | null>(null)
  // Shared chat-window attachment tabs. ChatView remounts per conversation, but
  // a PDF/image tab should remain available until the user explicitly closes it.
  const [attachmentTabs, setAttachmentTabs] = useState<AttachmentWorkspaceTab[]>([])

  const newMenuRef = useRef<HTMLDivElement>(null)
  const sidebarSlotRef = useRef<HTMLDivElement>(null)
  // Where the conversation list was scrolled to. A drill-in view unmounts the
  // scroller, so the offset is read off the live node the moment we navigate away
  // (openSidebarView) and re-applied by the callback ref as soon as the list
  // mounts again — during the commit, before paint, so coming back from
  // Account/Profile/Company never flashes the rail at the top.
  const listRef = useRef<HTMLElement | null>(null)
  const listScrollTop = useRef(0)
  const attachList = useCallback((node: HTMLElement | null) => {
    listRef.current = node
    if (node) node.scrollTop = listScrollTop.current
  }, [])
  // The single entry point for leaving the conversation list: it snapshots the
  // scroll offset first, so restoring never depends on a scroll event having
  // been delivered.
  const openSidebarView = useCallback((view: SidebarView) => {
    if (listRef.current) listScrollTop.current = listRef.current.scrollTop
    setSidebarView(view)
  }, [])

  // Keep the animated-but-mounted sidebar out of keyboard navigation while its
  // grid track is collapsed. React 18's HTML typings do not expose `inert` as a
  // JSX prop yet, although the browser DOM property is supported.
  useEffect(() => {
    if (sidebarSlotRef.current) sidebarSlotRef.current.inert = sidebarCollapsed
  }, [sidebarCollapsed])
  // Mirror the currently-open group id into a ref so the socket handler (set up
  // once) can tell whether an arriving message belongs to the open chat without
  // re-subscribing on every selection change.
  const openGroupId = selection?.kind === 'group' ? selection.id : null
  const openGroupIdRef = useRef(openGroupId)
  openGroupIdRef.current = openGroupId

  // Deselect handler the groups hook calls when the OPEN conversation is
  // removed or hidden (kicked, or delete-for-me on another device).
  const clearSelection = useCallback(() => setSelection(null), [])
  const openNotificationGroup = useCallback(
    (groupId: string) => setSelection({ kind: 'group', id: groupId }),
    [],
  )

  useEffect(() => {
    const open = (event: Event) => {
      const groupId = (event as CustomEvent<{ groupId?: string }>).detail?.groupId
      if (groupId) openNotificationGroup(groupId)
    }
    window.addEventListener(NOTIFICATION_OPEN_EVENT, open)
    return () => window.removeEventListener(NOTIFICATION_OPEN_EVENT, open)
  }, [openNotificationGroup])

  // Conversation list + live socket sync + per-row pref actions.
  const {
    groups,
    typingByGroup,
    loadingGroups,
    refreshGroups,
    insertGroup,
    patchGroup,
    markGroupRead,
    togglePin,
    toggleArchive,
    toggleMute,
    handleMarkRead,
    handleMarkAllRead,
    handleMarkUnread,
    handleDeleteConversation,
  } = useWorkspaceGroups({
    userId: user.id,
    openGroupIdRef,
    onOpenGroupGone: clearSelection,
    onNotificationOpen: openNotificationGroup,
  })

  // Cross-workspace connection requests + pending vehicle-group invitations.
  const { connections, connectionsError, refreshConnections } = useConnections()
  const { groupInvites, refreshGroupInvites } = useGroupInvites()

  // Workspace only issues prefetch commands; it must not subscribe the entire
  // shell/sidebar to every cached message or read-receipt change.
  const { prefetch } = useMessageCacheActions()

  // Warm the profile cache in the background so the "My profile" drawer opens
  // instantly the first time. Cheap, fire-and-forget.
  useEffect(() => {
    api.profile
      .get()
      .then(({ profile }) => setCachedProfile(profile))
      .catch(() => {})
  }, [])

  // Internal company contacts. Same-workspace members are trusted contacts you
  // can DM directly (no connection handshake — that's cross-company only), so we
  // surface the roster in the rail. The endpoint already excludes the caller and
  // deleted/anonymized users. Refetched live when a colleague joins (socket).
  const refreshMembers = useCallback(async () => {
    try {
      const { members } = await api.workspace.members()
      setMembers(members)
    } catch {
      /* leave the previous roster in place; the rail keeps working */
    }
  }, [])

  useEffect(() => {
    void refreshMembers()
  }, [refreshMembers])

  // Warm the cache for the few most-recent conversations once the rail is up,
  // so opening them is instant. Lightweight + idempotent: prefetch skips groups
  // already cached or in flight, and runs in the background without blocking.
  useEffect(() => {
    if (loadingGroups) return
    for (const g of groups.slice(0, 3)) prefetch(g.id)
  }, [loadingGroups, groups, prefetch])

  // Warm avatars for the most-recent conversations so the chat header shows the
  // peer/group image instantly on open. Bounded to the recent 20 (the list is
  // ordered by recency) so we never fan out to hundreds of requests; the session
  // cache (lib/avatarCache) dedupes in-flight warms and remembers loaded/missing
  // so revisits and 404s never re-request. DM peers warm unconditionally; a
  // vehicle group only warms when it actually has an image (avoids needless
  // 404s for the many groups without one).
  useEffect(() => {
    if (loadingGroups) return
    for (const g of groups.slice(0, 20)) {
      if (g.type === 'direct') {
        if (g.directPeer?.id) void preloadAvatar('user', g.directPeer.id)
      } else if (g.hasAvatar) {
        void preloadAvatar('group', g.id)
      }
    }
  }, [loadingGroups, groups])

  // Re-sync presence whenever the set of conversations changes. A new DM or an
  // accepted connection makes a new co-member visible to the presence snapshot;
  // if that peer is already online they never emit a `presence:update`, so a
  // fresh snapshot is the only way to light their dot without a page refresh.
  // Keyed on the sorted group-id signature so it fires on add/remove (initial
  // load, refreshGroups, optimistic DM open) — not on every unrelated re-render.
  const groupIdsKey = useMemo(
    () => groups.map((g) => g.id).sort().join(','),
    [groups],
  )
  useEffect(() => {
    if (loadingGroups) return
    resyncPresence()
  }, [groupIdsKey, loadingGroups, resyncPresence])

  // A colleague joined (or left) the company → refresh the internal contact
  // roster so the new person shows up in the rail without a reload. (The rest
  // of the rail's socket sync lives in useWorkspaceGroups.)
  useEffect(() => {
    const socket = getSocket()
    const onMembersChanged = () => void refreshMembers()
    socket.on('workspace:members_changed', onMembersChanged)
    socket.io.on('reconnect', onMembersChanged)
    return () => {
      socket.off('workspace:members_changed', onMembersChanged)
      socket.io.off('reconnect', onMembersChanged)
    }
  }, [refreshMembers])

  // Close the rail's actions menu on outside click / Esc. It is the only
  // floating menu the rail still raises — the account menu that used to hang off
  // the footer is now the 'account' sidebar view.
  useEffect(() => {
    if (!newMenuOpen) return
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (newMenuRef.current && !newMenuRef.current.contains(t)) setNewMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setNewMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [newMenuOpen])

  function startCreate(kind: NewGroupKind) {
    setNewMenuOpen(false)
    setModal(kind)
  }

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c
      setStoredSidebarCollapsed(next)
      return next
    })
  }, [])

  // Drop the given group into local state immediately, select it, and
  // reconcile against the server in the background. This is what makes new
  // chats appear instantly even on slow connections — the rail and main
  // pane don't wait for the follow-up GET /groups round trip.
  const openGroupOptimistically = useCallback(
    (group: Group) => {
      insertGroup(group)
      setSelection({ kind: 'group', id: group.id })
    },
    [insertGroup],
  )

  function handleCreated(group: Group) {
    setModal(null)
    openGroupOptimistically(group)
  }

  // Open (or create) a DM with an accepted connection. Used after accepting
  // a request, so the natural next step (talk to them) is one click closer.
  const openDirectFor = useCallback(
    async (otherUser: ConnectionUser) => {
      const { group } = await api.groups.createDirect(otherUser.id)
      openGroupOptimistically(
        optimisticDirectGroup(group.id, otherUser),
      )
    },
    [openGroupOptimistically],
  )

  // Open (or create) a DM with a company colleague from the contacts list.
  // Same-workspace DMs need no connection, so this always succeeds; the colleague
  // stays in the "Company" section, just upgraded from a directory row to a full
  // conversation row once the DM exists (refreshGroups reconciles).
  const openDirectWithMember = useCallback(
    async (member: WorkspaceMember) => {
      const { group } = await api.groups.createDirect(member.id)
      openGroupOptimistically(
        optimisticDirectGroup(group.id, {
          id: member.id,
          displayName: member.displayName,
          email: member.email,
          workspace: { id: workspace.id, name: workspace.name },
        }),
      )
    },
    [openGroupOptimistically, workspace.id, workspace.name],
  )

  const messageProfileUser = useCallback(
    async (userId: string, name: string) => {
      const member = members.find((candidate) => candidate.id === userId)
      if (member) {
        await openDirectWithMember(member)
      } else {
        const { group } = await api.groups.createDirect(userId)
        openGroupOptimistically(
          optimisticDirectGroup(group.id, {
            id: userId,
            displayName: name,
            email: '',
            workspace: { id: workspace.id, name: workspace.name },
          }),
        )
      }
      setProfileTarget(null)
    },
    [members, openDirectWithMember, openGroupOptimistically, workspace.id, workspace.name],
  )

  // Navigate to a private DM opened from a message action ("Reply privately"
  // / "Send message in private"). ChatView has already created the group
  // server-side; we drop an optimistic row in and reconcile in the background.
  const openDirectMessage = useCallback(
    (
      info: { groupId: string; peerId: string; peerName: string },
      reply?: ReplyToPreview,
    ) => {
      const now = new Date().toISOString()
      openGroupOptimistically({
        id: info.groupId,
        type: 'direct',
        name: null,
        description: null,
        meta: {},
        lastMessageAt: null,
        lastReadAt: now,
        createdAt: now,
        memberCount: 2,
        unreadCount: 0,
        directPeer: { id: info.peerId, name: info.peerName, workspace: null },
      })
      setPendingReply(reply ? { groupId: info.groupId, reply } : null)
    },
    [openGroupOptimistically],
  )

  async function handleAccepted(otherUser: ConnectionUser) {
    // Navigate to the new DM FIRST, then drop the now-stale pending request.
    // Refreshing first would briefly leave selection on a request that's no
    // longer in pendingReceived, flashing the "no longer pending" state.
    await openDirectFor(otherUser)
    await refreshConnections()
  }

  async function handleDeclined() {
    // Leave the request view before the row disappears from the list, for the
    // same reason as accept above.
    setSelection(null)
    await refreshConnections()
  }

  // Accepting a group invite: the server added us to group_members and emitted
  // group:added, but we also refresh explicitly so the Vehicles list is
  // up-to-date, drop the pending invite, then open the group immediately.
  async function handleInviteAccepted(groupId: string) {
    await refreshGroups()
    await refreshGroupInvites()
    setSelection({ kind: 'group', id: groupId })
  }

  async function handleInviteDeclined() {
    await refreshGroupInvites()
    setSelection(null)
  }

  const directGroups = useMemo(() => groups.filter((g) => g.type === 'direct'), [groups])

  // Company colleagues you don't YET have an open DM with → shown as quiet
  // directory rows. A member who already has a DM renders as a full conversation
  // row instead (their direct Group), so dedup against existing direct-group
  // peers to keep a person in the list exactly once — never duplicated.
  const companyContacts = useMemo(() => {
    const peerIds = new Set(
      directGroups.map((g) => g.directPeer?.id).filter((id): id is string => Boolean(id)),
    )
    return members.filter((m) => !peerIds.has(m.id))
  }, [members, directGroups])

  // Apply the quick-filter. Empty query → full lists. A vehicle also matches on
  // its tractor plate so you can jump by registration number.
  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const matchesQuery = useCallback(
    (g: Group) => {
      if (!q) return true
      if (groupLabel(g).toLowerCase().includes(q)) return true
      const plate = tractorPlate(g)
      return plate ? plate.toLowerCase().includes(q) : false
    },
    [q],
  )

  // Company contacts (no DM yet) matching the search, sorted by name so the
  // directory reads predictably. Surfaced in the All + DMs filters.
  const filteredContacts = useMemo(() => {
    const base = q
      ? companyContacts.filter((m) => m.displayName.toLowerCase().includes(q))
      : companyContacts
    return [...base].sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [companyContacts, q])

  // The unified, recency-ordered rail list for the active pill filter. `groups`
  // is already sorted newest-activity-first (byRecent), so conversation rows
  // inherit that order; photo-less company contacts (no thread yet) trail the
  // live conversations. 'groups' → vehicle rooms; 'dms' → DMs + contacts.
  const conversationItems = useMemo<SidebarRowItem[]>(() => {
    // First collect the groups that belong in the active filter. Archived
    // conversations live ONLY in the Archived filter; every other filter shows
    // active (non-archived) ones. `groups` is already recency-ordered.
    const matched: Group[] = []
    for (const g of groups) {
      const archived = Boolean(g.archivedAt)
      if (filter === 'archived') {
        if (!archived) continue
      } else {
        if (archived) continue
        if (filter === 'groups' && g.type !== 'vehicle') continue
        if (filter === 'dms' && g.type !== 'direct') continue
        // Unread cuts ACROSS the type filters: rooms and DMs alike, whatever is
        // still unread. `groups` carries live unread counts (socket-updated in
        // useWorkspaceGroups), so a conversation leaves this list the moment it
        // is read and re-enters when a new message lands — no refetch. This also
        // applies to the currently open conversation: the chat remains open in
        // the main pane, but its row no longer appears in an unread-only list.
        if (filter === 'unread' && !isUnread(g)) continue
      }
      if (!matchesQuery(g)) continue
      matched.push(g)
    }
    // Pinned conversations float to the top, preserving recency within the pinned
    // and the unpinned groups (Array.sort is stable). Contacts always trail.
    matched.sort((a, b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)))

    const items: SidebarRowItem[] = matched.map((g) => ({ kind: 'group', key: g.id, group: g }))
    // Company contacts (no DM yet) are directory entries, not conversations — so
    // they appear only in the All / Direct filters, never in Groups or Archived.
    if (filter === 'all' || filter === 'dms') {
      for (const m of filteredContacts) {
        items.push({ kind: 'contact', key: `contact:${m.id}`, member: m })
      }
    }
    return items
  }, [groups, filter, matchesQuery, filteredContacts])

  // How many ACTIVE conversations are still unread — the Unread pill's live
  // count. Derived from the same `groups` state the rows read, so it moves the
  // instant a conversation is read, muted-or-not, room or DM.
  const unreadConversationCount = useMemo(
    () => groups.filter((g) => !g.archivedAt && isUnread(g)).length,
    [groups],
  )

  const pendingReceived = connections.pendingReceived

  const emptyListCopy =
    filter === 'groups'
      ? 'Create a vehicle chat to coordinate loads, documents, and updates over time.'
      : filter === 'dms'
        ? 'No direct messages or contacts yet.'
        : filter === 'archived'
          ? 'No archived conversations.'
          : filter === 'unread'
            ? 'Nothing unread — you’re all caught up.'
            : 'No conversations yet.'

  const selectedGroup = useMemo<Group | null>(() => {
    if (selection?.kind !== 'group') return null
    return groups.find((g) => g.id === selection.id) ?? null
  }, [groups, selection])

  const selectedRequest = useMemo<Connection | null>(() => {
    if (selection?.kind !== 'request') return null
    return pendingReceived.find((c) => c.id === selection.id) ?? null
  }, [pendingReceived, selection])

  const selectedInvite = useMemo<GroupInvite | null>(() => {
    if (selection?.kind !== 'invite') return null
    return groupInvites.find((i) => i.id === selection.id) ?? null
  }, [groupInvites, selection])

  // The Inbox / workspace home is showing whenever nothing else is selected —
  // i.e. selection is `inbox` or `null`. Drives the header's active state and
  // the main-pane fallback below.
  const inboxActive = !selectedGroup && !selectedRequest && !selectedInvite

  // Who may invite members from the vehicle chat header. Group admins are also
  // allowed server-side; the header button gates on workspace role for
  // simplicity (the server enforces the full rule on POST).
  const canInviteMembers = user.role === 'admin' || user.role === 'dispatcher'
  const availableVehicleRooms = useMemo(
    () => groups.filter((group) => group.type === 'vehicle' && !group.archivedAt),
    [groups],
  )

  const addTripFromWorkspace = useCallback((groupId: string) => {
    setPendingAddTripGroupId(groupId)
    setSelection({ kind: 'group', id: groupId })
  }, [])

  const openAttachmentTab = useCallback((tab: AttachmentWorkspaceTab) => {
    setAttachmentTabs((current) =>
      current.some((item) => item.attachment.id === tab.attachment.id)
        ? current
        : [...current, tab],
    )
  }, [])

  const closeAttachmentTab = useCallback((attachmentId: string) => {
    setAttachmentTabs((current) =>
      current.filter((item) => item.attachment.id !== attachmentId),
    )
  }, [])

  const replyToAttachmentTab = useCallback((groupId: string, reply: ReplyToPreview) => {
    setPendingReply({ groupId, reply })
    setSelection({ kind: 'group', id: groupId })
  }, [])

  // App shell: the rail reads as one black field with the workspace background,
  // while the main pane carries the raised conversation surface. The shared outer
  // gap plus each panel's hairline keep the two regions distinct.
  return (
    <div
      className={`workspace-shell h-screen w-full p-2 2xl:p-3 bg-bg text-text overflow-hidden ${
        sidebarCollapsed ? 'workspace-shell--collapsed' : ''
      }`}
    >
      <ConnectionStatusBanner />
      {/* Persistent application navigation. Unlike the conversation sidebar,
          this narrow rail never disappears, so Workspace and the main sections
          stay reachable from chats and every sidebar drill-in. */}
      <WorkspaceNavRail
        collapsed={sidebarCollapsed}
        workspaceActive={sidebarView === 'list' && inboxActive}
        settingsActive={sidebarView === 'settings'}
        onToggleSidebar={toggleSidebar}
        onOpenWorkspace={() => {
          setNewMenuOpen(false)
          setSidebarView('list')
          setSelection({ kind: 'inbox' })
        }}
        onOpenSettings={() => {
          if (sidebarCollapsed) {
            setStoredSidebarCollapsed(false)
            setSidebarCollapsed(false)
          }
          openSidebarView('settings')
        }}
      />

      <div
        ref={sidebarSlotRef}
        className="workspace-sidebar-slot min-w-0 overflow-hidden"
        aria-hidden={sidebarCollapsed}
      >
      {/* Left rail — the app's deepest surface: pure black, drawn against the
          shell by its hairline edge rather than by a tone step, so the chat
          window beside it reads as the raised panel. Its content is a small
          navigation stack (see SidebarView): the conversation list, or one
          drill-in view rendered in its place. */}
      <aside className="workspace-sidebar-panel relative h-full min-w-0 overflow-hidden bg-sidebar rounded-panel border border-white/8">
        {/* Keep the conversation list mounted while a sidebar panel covers it.
            Rows therefore retain their image elements, decoded avatars, action
            state and scroll position instead of rebuilding on every Back. */}
        <div
          aria-hidden={sidebarView !== 'list'}
          className={`h-full min-h-0 flex flex-col ${
            sidebarView === 'list' ? '' : 'invisible pointer-events-none'
          }`}
        >
        {/* Top toolbar — ONE compact row: the conversation search takes the
            flexible width, followed by the fixed circular actions control.
            This replaced the old workspace-identity header; the company identity
            now lives in the rail's bottom row, and workspace home is the first
            item of the persistent navigation rail. */}
        <div className="px-2.5 pt-2 pb-0 flex items-center gap-1.5 shrink-0">
          {/* The field is compact VERTICALLY only: its height comes from the
              (reduced) --sidebar-search-height token and it keeps flex-1, so it
              still takes all the width the two fixed controls leave. */}
          <label
            htmlFor="rail-search"
            className="flex-1 min-w-0 h-[var(--sidebar-search-height)] flex items-center gap-2 px-3 rounded-full border border-white/10 bg-surface-2/60 hover:bg-surface-2/80 hover:border-white/16 focus-within:bg-surface-2 focus-within:border-white/20 transition-colors cursor-text"
          >
            <Search size="0.875rem" strokeWidth={1.7} className="text-muted shrink-0" />
            <input
              id="rail-search"
              // The field carries no visible label (the magnifier + placeholder
              // do the work), so it names itself for assistive tech.
              aria-label="Search conversations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search…"
              style={{ fontSize: 'var(--sidebar-row-font-size)' }}
              className="bg-transparent flex-1 outline-none placeholder:text-muted min-w-0"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="text-faint hover:text-text shrink-0 transition-colors"
              >
                <X size="0.8125rem" strokeWidth={1.8} />
              </button>
            )}
          </label>

          <div className="relative shrink-0" ref={newMenuRef}>
            <button
              onClick={() => setNewMenuOpen((v) => !v)}
              aria-label="Sidebar actions"
              aria-haspopup="menu"
              aria-expanded={newMenuOpen}
              className={`h-[var(--sidebar-search-height)] w-[var(--sidebar-search-height)] flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                newMenuOpen
                  ? 'bg-white/10 text-text'
                  : 'text-muted hover:bg-white/8 hover:text-text'
              }`}
            >
              <Menu size="1.0625rem" strokeWidth={1.9} />
            </button>

            {newMenuOpen && (
              <div
                role="menu"
                // Hug the widest label exactly. Inline width:max-content (rather
                // than a utility class) is immune to purge/override and to the
                // abs-positioning shrink-to-fit of the narrow button wrapper.
                style={{ width: 'max-content', maxWidth: '13.75rem' }}
                className={`absolute right-0 top-[calc(100%+6px)] ${MENU_CONTAINER} z-20`}
              >
                <MenuItem icon={<Users {...MENU_GLYPH} />} onClick={() => startCreate('vehicle')}>
                  Vehicle room
                </MenuItem>
                <MenuItem icon={<UserPlus {...MENU_GLYPH} />} onClick={() => startCreate('direct')}>
                  Add connection
                </MenuItem>
                <div className={MENU_SEPARATOR} />
                <MenuItem
                  icon={<MailOpen {...MENU_GLYPH} />}
                  onClick={() => {
                    setNewMenuOpen(false)
                    void handleMarkAllRead()
                  }}
                >
                  Mark all as read
                </MenuItem>
              </div>
            )}
          </div>

        </div>

        {/* Filters — Archived leads the segmented control (everything / vehicle
            rooms / direct / unread) as a compact icon toggle. Opening Archived
            clears the type selection; picking a type leaves Archived.
            Fixed, like the toolbar above it — only the list scrolls. The pills
            wrap rather than overflow at the narrowest rail width. The space
            above comes from --sidebar-toolbar-gap so the search field and this
            row keep ONE agreed distance (see index.css). */}
        <div
          style={{ paddingTop: 'var(--sidebar-toolbar-gap)' }}
          className="px-2.5 pb-1.5 flex items-center gap-1.5 shrink-0"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ArchiveToggle
              active={filter === 'archived'}
              label={filter === 'archived' ? 'Show conversations' : 'Show archived'}
              onClick={() => setFilter((f) => (f === 'archived' ? 'all' : 'archived'))}
            >
              <Archive size="0.8125rem" strokeWidth={1.8} />
            </ArchiveToggle>
            <FilterTab active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </FilterTab>
            <FilterTab active={filter === 'groups'} onClick={() => setFilter('groups')}>
              Groups
            </FilterTab>
            <FilterTab active={filter === 'dms'} onClick={() => setFilter('dms')}>
              Direct
            </FilterTab>
            {/* Unread cuts across the three type pills: every conversation with
                something new, room or DM. Its count is live (socket unread
                updates), so it empties as you read. */}
            <FilterTab
              active={filter === 'unread'}
              onClick={() => setFilter('unread')}
              badge={unreadConversationCount || undefined}
            >
              Unread
            </FilterTab>
          </div>
        </div>

        {/* Rail list. Pending actionable items keep their OWN separated,
            collapsible sections (Connection requests / Group invites) at the top
            — unchanged from before — followed by ONE pill-filtered, recency-
            ordered conversation + contact stream (no per-type section headers).
            Sections use the larger inter-section gap; the unified list inside its
            wrapper stays tight. */}
        <nav
          ref={attachList}
          className="flex-1 min-h-0 overflow-y-auto px-1.5 pt-1 pb-1.5 flex flex-col"
          style={{ gap: 'var(--sidebar-section-gap)' }}
        >
          {loadingGroups ? (
            // Centre the loader in the available list area (consistent with the
            // chat pane, one size down) rather than a small top row.
            <div className="h-full flex items-center justify-center">
              <Spinner variant="md" />
            </div>
          ) : (
            <>
              {/* Separated pending sections — shown above the list regardless of
                  the active pill, hidden while searching so results read as pure
                  matches, and hidden in the Archived view (pure archived list). */}
              {!searching && filter !== 'archived' && (
                <ConnectionRequestsSection
                  pendingReceived={pendingReceived}
                  error={connectionsError}
                  onRetry={() => void refreshConnections()}
                  selectedId={selection?.kind === 'request' ? selection.id : null}
                  onSelect={(id) => setSelection({ kind: 'request', id })}
                  size={sidebarAvatar}
                />
              )}
              {!searching && filter !== 'archived' && (
                <GroupInvitesSection
                  invites={groupInvites}
                  selectedId={selection?.kind === 'invite' ? selection.id : null}
                  onSelect={(id) => setSelection({ kind: 'invite', id })}
                  size={sidebarAvatar}
                />
              )}

              {/* The unified conversation + contact stream for the active filter. */}
              <div className="flex flex-col gap-1">
                {conversationItems.length === 0 ? (
                  searching ? (
                    <EmptyHint>No conversations match “{query.trim()}”.</EmptyHint>
                  ) : (
                    <EmptyHint>{emptyListCopy}</EmptyHint>
                  )
                ) : (
                  conversationItems.map((item) =>
                    item.kind === 'group' ? (
                      <GroupRow
                        key={item.key}
                        group={item.group}
                        typingUsers={typingByGroup[item.group.id] ?? []}
                        online={onlineIds}
                        currentUserId={user.id}
                        size={conversationAvatar}
                        selected={selection?.kind === 'group' && selection.id === item.group.id}
                        actionsOpen={rowActionsId === item.group.id}
                        onActionsOpenChange={(open) =>
                          setRowActionsId(open ? item.group.id : null)
                        }
                        onClick={() => {
                          setRowActionsId(null)
                          setSelection({ kind: 'group', id: item.group.id })
                        }}
                        onTogglePin={togglePin}
                        onToggleArchive={toggleArchive}
                        onToggleMute={toggleMute}
                        onMarkRead={handleMarkRead}
                        onMarkUnread={handleMarkUnread}
                        onDelete={handleDeleteConversation}
                        onViewDetails={(g) => {
                          setRowActionsId(null)
                          setSelection({ kind: 'group', id: g.id })
                          setPendingDetailsGroupId(g.id)
                        }}
                      />
                    ) : (
                      <ContactRow
                        key={item.key}
                        member={item.member}
                        size={sidebarAvatar}
                        onClick={() =>
                          setProfileTarget({ id: item.member.id, name: item.member.displayName })
                        }
                      />
                    ),
                  )
                )}
              </div>
            </>
          )}
        </nav>

        {/* Fixed identity row — me on the left, the company on the right, each
            half a drill-in trigger into a sidebar view. Sits outside the
            scroller, so it stays put while the list moves. */}
        <SidebarIdentityBar
          user={user}
          workspace={workspace}
          profile={cachedProfile}
          away={away}
          size={sidebarAvatar}
          avatarVersion={avatarVersion}
          logoVersion={logoVersion}
          onOpenAccount={() => openSidebarView('account')}
          onOpenCompany={() => openSidebarView('company')}
        />
        </div>

        {/* Drill-in panels occupy the same sidebar surface without replacing
            the mounted conversation layer underneath. Only the active panel is
            mounted; its own form state may reset when intentionally left. */}
        {sidebarView !== 'list' && (
          <div
            key={sidebarView}
            className="panel-fade-in absolute inset-0 z-10 flex min-h-0 flex-col bg-sidebar"
          >
            {sidebarView === 'account' ? (
              <AccountSidebarPanel
                user={user}
                profile={cachedProfile}
                away={away}
                avatarVersion={avatarVersion}
                onBack={() => setSidebarView('list')}
                onOpenProfile={() => setSidebarView('profile')}
                onOpenSettings={() => setSidebarView('settings')}
                onSignOut={() => void onSignOut()}
              />
            ) : sidebarView === 'profile' ? (
              <ProfileSidebarPanel
                initialProfile={cachedProfile}
                away={away}
                onBack={() => setSidebarView('account')}
                backLabel="Back to Account"
                onSaved={(p, v) => {
                  setCachedProfile(p)
                  setAvatarVersion((n) => Math.max(n, v) + 1)
                  void refresh()
                }}
              />
            ) : sidebarView === 'company' ? (
              <CompanySidebarPanel
                onBack={() => setSidebarView('list')}
                backLabel="Back to conversations"
                onSaved={(_c, v) => {
                  setLogoVersion((n) => Math.max(n, v) + 1)
                  void refresh()
                }}
              />
            ) : (
              <WorkspaceSettingsPanel
                onBack={() => setSidebarView('account')}
                backLabel="Back to Account"
              />
            )}
          </div>
        )}
      </aside>
      </div>

      {/* Main — the conversation window, one tone above the black rail. Panels,
          drawers and modals that open over it use `surface`/`rail`, a step
          lighter again, so they always read as a layer ON the chat. The hairline
          outline pairs with the rail's: with the palette this close to black, the
          tone step alone no longer draws the card's edge against the shell gap. */}
      <main className="workspace-main flex flex-col min-w-0 bg-chat rounded-panel overflow-hidden border border-white/8">
        {selectedGroup ? (
          <ChatView
            key={selectedGroup.id}
            group={selectedGroup}
            currentUserId={user.id}
            currentWorkspaceName={workspace.name}
            onRead={markGroupRead}
            onOpenDirectMessage={openDirectMessage}
            initialReplyContext={
              pendingReply?.groupId === selectedGroup.id ? pendingReply.reply : null
            }
            onConsumeInitialReply={() => setPendingReply(null)}
            initialAddTripOpen={pendingAddTripGroupId === selectedGroup.id}
            onConsumeInitialAddTrip={() => setPendingAddTripGroupId(null)}
            initialDetailsOpen={pendingDetailsGroupId === selectedGroup.id}
            onConsumeInitialDetails={() => setPendingDetailsGroupId(null)}
            vehicleRooms={availableVehicleRooms}
            onAddTripInGroup={addTripFromWorkspace}
            attachmentTabs={attachmentTabs}
            onOpenAttachmentTab={openAttachmentTab}
            onCloseAttachmentTab={closeAttachmentTab}
            onReplyToAttachmentTab={replyToAttachmentTab}
            canInviteMembers={canInviteMembers}
            onGroupUpdated={patchGroup}
          />
        ) : (
          <div className="flex-1 flex flex-col min-w-0 bg-chat">
            {selectedRequest ? (
              <ConnectionRequestView
                key={selectedRequest.id}
                connection={selectedRequest}
                onAccepted={handleAccepted}
                onDeclined={handleDeclined}
              />
            ) : selection?.kind === 'request' ? (
              // The selected request vanished from pendingReceived (cancelled by
              // the sender, or accepted/declined on another device). Show an
              // explicit state instead of silently dropping to the Inbox.
              <div className="flex-1 flex items-center justify-center px-6">
                <div className="text-center max-w-[20rem]">
                  <p className="text-base text-muted">This invitation is no longer pending.</p>
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="mt-3 text-base text-text font-semibold hover:underline underline-offset-4"
                  >
                    Back to inbox
                  </button>
                </div>
              </div>
            ) : selectedInvite ? (
              <GroupInviteView
                key={selectedInvite.id}
                invite={selectedInvite}
                onAccepted={handleInviteAccepted}
                onDeclined={handleInviteDeclined}
              />
            ) : (
              <InboxView
                workspaceName={workspace.name}
                vehicleRooms={availableVehicleRooms}
                canAddTrip={canInviteMembers}
                onAddTrip={addTripFromWorkspace}
                onCreateVehicleRoom={() => setModal('vehicle')}
                onAddConnection={() => setModal('direct')}
                onOpenVehicleRoom={(groupId) => setSelection({ kind: 'group', id: groupId })}
              />
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      {modal === 'vehicle' && (
        <CreateVehicleGroupModal onClose={() => setModal(null)} onCreated={handleCreated} />
      )}
      {modal === 'direct' && (
        <NewMessageModal onClose={() => setModal(null)} onOpenGroup={handleCreated} />
      )}
      {profileTarget && (
        <UserProfilePanel
          key={profileTarget.id}
          userId={profileTarget.id}
          name={profileTarget.name}
          currentUserId={user.id}
          currentWorkspaceName={workspace.name}
          onMessage={messageProfileUser}
          onClose={() => setProfileTarget(null)}
        />
      )}
    </div>
  )
}
