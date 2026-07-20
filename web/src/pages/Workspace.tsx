import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  Building2,
  ChevronDown,
  CircleUser,
  LogOut,
  MailOpen,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
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
import { groupLabel, tractorPlate } from '../lib/types'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useMessageCache } from '../hooks/useMessageCache'
import ChatView from '../components/ChatView'
import type { AttachmentWorkspaceTab } from '../components/messages/types'
import ConnectionRequestView from '../components/connections/ConnectionRequestView'
import ConnectionRequestsSection from '../components/connections/ConnectionRequestsSection'
import GroupInvitesSection from '../components/invites/GroupInvitesSection'
import GroupInviteView from '../components/invites/GroupInviteView'
import Avatar from '../components/Avatar'
import { MENU_CONTAINER, MENU_GLYPH, MENU_SEPARATOR } from '../components/menuStyles'
import Spinner from '../components/Spinner'
import CompanyLogo from '../components/CompanyLogo'
import CreateVehicleGroupModal from '../components/CreateVehicleGroupModal'
import NewMessageModal from '../components/NewMessageModal'
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
import { statusMeta, AWAY } from '../lib/availability'
import { useAuth } from '../auth/AuthContext'
import GroupRow from './SidebarGroupRow'
import ContactRow from './SidebarContactRow'
import { FilterTab, ArchiveToggle, EmptyHint, MenuItem } from './sidebarBits'
import { optimisticDirectGroup } from './workspaceUtils'

type Props = {
  user: User
  workspace: WorkspaceT
  onSignOut: () => Promise<void>
}

type NewGroupKind = 'vehicle' | 'direct'

// Sidebar pill filter — which slice of the single unified list is shown.
//   'all'      → active (non-archived) vehicle rooms + DMs + company contacts
//   'archived' → archived conversations only (no contacts)
//   'groups'   → active vehicle/group rooms only
//   'dms'      → active direct messages + company contacts
// Archive/pin/mute/hide are per-user prefs (see group_members, migration 0023).
type SidebarFilter = 'all' | 'archived' | 'groups' | 'dms'

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

export default function Workspace({ user, workspace, onSignOut }: Props) {
  const { refresh } = useAuth()
  // Sidebar avatar/logo diameter tracks the display density (these components
  // take a numeric size, so they can't read the CSS density tokens directly).
  const density = useDensity()
  const sidebarAvatar = SIDEBAR_AVATAR_SIZE[density]
  const conversationAvatar = SIDEBAR_CONVERSATION_AVATAR_SIZE[density]
  // The workspace header logo reads larger than the rail's avatar metric, while
  // the header's padding/height (--header-height) stay fixed — it's still
  // vertically centered, just a bigger image. Footer avatar + collapsed rail keep
  // the standard `sidebarAvatar` size.
  const headerLogoSize = sidebarAvatar + 7
  // Auto-away presence: grey "Away" on the footer status dot when idle / tab
  // hidden. Doesn't change the stored (manual) status — presence only.
  const away = useIdle()
  // Live online/offline presence of peers (DM status dots). `resyncPresence`
  // re-requests the server snapshot; we call it whenever the group set changes
  // (below), since a new co-member who's already online won't emit a transition.
  const { online: onlineIds, resync: resyncPresence } = usePresence()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  // Collapsed left rail — frees the main area for wide chats. Persisted
  // so the choice survives reloads; collapsing/expanding never reloads the app or
  // touches the current selection.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed)
  const [modal, setModal] = useState<NewGroupKind | null>(null)
  // "My profile" and "Workspace settings" both open as sidebar drawers that
  // replace the conversation list (the chat stays visible on the right).
  const [profilePanelOpen, setProfilePanelOpen] = useState(false)
  const [companyPanelOpen, setCompanyPanelOpen] = useState(false)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)
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
  const [selection, setSelection] = useState<Selection>(null)
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
  // Shared chat-window attachment tabs. ChatView remounts per conversation, but
  // a PDF/image tab should remain available until the user explicitly closes it.
  const [attachmentTabs, setAttachmentTabs] = useState<AttachmentWorkspaceTab[]>([])

  const userMenuRef = useRef<HTMLDivElement>(null)
  const newMenuRef = useRef<HTMLDivElement>(null)
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

  // Conversation list + live socket sync + per-row pref actions.
  const {
    groups,
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

  const { prefetch } = useMessageCache()

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
    return () => {
      socket.off('workspace:members_changed', onMembersChanged)
    }
  }, [refreshMembers])

  // Close menus on outside click / Esc.
  useEffect(() => {
    if (!userMenuOpen && !newMenuOpen) return
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(t)) {
        setUserMenuOpen(false)
      }
      if (newMenuOpen && newMenuRef.current && !newMenuRef.current.contains(t)) {
        setNewMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setUserMenuOpen(false)
        setNewMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen, newMenuOpen])

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

  const pendingReceived = connections.pendingReceived

  const emptyListCopy =
    filter === 'groups'
      ? 'Create a vehicle chat to coordinate loads, documents, and updates over time.'
      : filter === 'dms'
        ? 'No direct messages or contacts yet.'
        : filter === 'archived'
          ? 'No archived conversations.'
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

  // App shell: navigation sits directly on the workspace background while the
  // main pane owns the raised rail surface. The shared outer gap keeps the two
  // regions distinct without outlining either one.
  return (
    <div className="h-screen w-full flex gap-3 p-2 2xl:p-3 bg-bg text-text overflow-hidden">
      {/* Collapsed left rail — a slim icon strip so the main area (wide
          chats) gets the freed width. Keeps the essentials reachable: expand,
          workspace home, and the account menu (clicking it expands first). All
          list state (search, groups, DMs, requests, panels) is preserved and
          returns intact on expand. */}
      {sidebarCollapsed ? (
        <aside className="w-12 shrink-0 overflow-hidden flex flex-col items-center py-2.5 gap-1">
          <button
            onClick={toggleSidebar}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="h-8 w-8 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.07] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <PanelLeftOpen size="1.0625rem" strokeWidth={1.8} />
          </button>
          <button
            onClick={() => setSelection({ kind: 'inbox' })}
            title={`${workspace.name} — home`}
            aria-label="Workspace home"
            aria-current={inboxActive ? 'page' : undefined}
            // Same split as the expanded header: subtle persistent selected state,
            // separate transient hover.
            className={`flex items-center justify-center rounded-full p-1 transition-colors hover:bg-white/[0.07] ${
              inboxActive ? 'bg-white/[0.095]' : ''
            }`}
          >
            <CompanyLogo size={sidebarAvatar} version={logoVersion} className="!rounded-full" />
          </button>
          <div className="flex-1" />
          <button
            onClick={() => {
              setStoredSidebarCollapsed(false)
              setSidebarCollapsed(false)
              setUserMenuOpen(true)
            }}
            title={user.displayName}
            aria-label="Open account menu"
            className="rounded-full p-0.5 hover:bg-white/[0.07] transition-colors"
          >
            <Avatar userId={user.id} name={user.displayName} size={sidebarAvatar} version={avatarVersion} />
          </button>
        </aside>
      ) : (
      /* Left rail — intentionally flat on the workspace background. It keeps
          overflow clipping for its drawers and menus, but no outer card surface. */
      <aside className="w-[var(--sidebar-width)] shrink-0 overflow-hidden flex flex-col">
        {profilePanelOpen ? (
          <ProfileSidebarPanel
            initialProfile={cachedProfile}
            away={away}
            onBack={() => setProfilePanelOpen(false)}
            onSaved={(p, v) => {
              // Keep the cache fresh, and update the rail footer avatar + global
              // user data immediately.
              setCachedProfile(p)
              setAvatarVersion((n) => Math.max(n, v) + 1)
              void refresh()
            }}
          />
        ) : companyPanelOpen ? (
          <CompanySidebarPanel
            onBack={() => setCompanyPanelOpen(false)}
            onSaved={(_c, v) => {
              setLogoVersion((n) => Math.max(n, v) + 1)
              void refresh()
            }}
          />
        ) : settingsPanelOpen ? (
          <WorkspaceSettingsPanel onBack={() => setSettingsPanelOpen(false)} />
        ) : (
          <>
        {/* Workspace identity = the entry point to the Inbox / workspace home.
            Clicking it deselects any chat/request/invite and opens the tools
            area. The whole row (identity + collapse control) is ONE hover
            surface, and there's no persistent "selected" tint — the header keeps
            the sidebar colour at rest. The collapse control sits to its right.
            (No workspace switcher — actions live in the user menu below.) */}
        <div className="h-[var(--header-height)] flex items-stretch transition-colors hover:bg-white/[0.07]">
          <button
            onClick={() => setSelection({ kind: 'inbox' })}
            title="Workspace home"
            aria-current={inboxActive ? 'page' : undefined}
            // Transparent: the unified row hover (parent) provides the highlight,
            // and there's no persistent active background. Padding/gap mirror the
            // chat header's identity cluster and the rail's own content edge (the
            // search field + footer avatar sit at px-3), so the logo lines up with
            // everything below it instead of being indented on its own.
            className="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 text-left"
          >
            <CompanyLogo size={headerLogoSize} version={logoVersion} className="!rounded-full" />
            <div className="min-w-0 flex-1">
              <div
                className="font-semibold tracking-[-0.2px] leading-tight truncate"
                style={{ fontSize: 'var(--sidebar-title-font-size)' }}
              >
                {workspace.name}
              </div>
            </div>
          </button>
          {/* Integrated icon action (same treatment as the chat header's
              Group info button): borderless ~36px hit area, no own background so
              the unified header hover reads across it too; the icon colour lifts
              for affordance, with an on-theme focus ring. */}
          <button
            onClick={toggleSidebar}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="self-center mr-1 h-8 w-8 flex items-center justify-center rounded-full text-muted hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 shrink-0"
          >
            <PanelLeftClose size="1.0625rem" strokeWidth={1.8} />
          </button>
        </div>

        {/* Quick search + create */}
        <div className="px-2.5 pt-2.5 pb-1.5 flex items-center gap-1.5">
          <label
            htmlFor="rail-search"
            className="flex-1 h-[var(--sidebar-search-height)] flex items-center gap-1.5 px-3 rounded-full border border-transparent bg-white/[0.05] hover:bg-white/[0.08] focus-within:bg-white/[0.08] focus-within:border-white/[0.12] transition-colors cursor-text"
          >
            <Search size="0.8125rem" strokeWidth={1.6} className="text-faint shrink-0" />
            <input
              id="rail-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search…"
              style={{ fontSize: 'var(--sidebar-row-font-size)' }}
              className="bg-transparent flex-1 outline-none placeholder:text-faint min-w-0"
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
                  ? 'bg-white/[0.09] text-text'
                  : 'text-muted hover:bg-white/[0.07] hover:text-text'
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

        {/* Filters — the TYPE segmented control (everything / vehicle rooms /
            direct) sits on the left; the Archived STATE is a separate icon toggle
            on the right, so the two filter axes never read as peers. Opening
            Archived clears the type selection; picking a type leaves Archived. */}
        <div className="px-2.5 pb-1.5 flex items-center gap-1.5">
          <div className="inline-flex items-center gap-1">
            <FilterTab active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </FilterTab>
            <FilterTab active={filter === 'groups'} onClick={() => setFilter('groups')}>
              Groups
            </FilterTab>
            <FilterTab active={filter === 'dms'} onClick={() => setFilter('dms')}>
              Direct
            </FilterTab>
          </div>
          <div className="flex-1" />
          <ArchiveToggle
            active={filter === 'archived'}
            label={filter === 'archived' ? 'Show conversations' : 'Show archived'}
            onClick={() => setFilter((f) => (f === 'archived' ? 'all' : 'archived'))}
          >
            <Archive size="0.8125rem" strokeWidth={1.8} />
          </ArchiveToggle>
        </div>

        {/* Rail list. Pending actionable items keep their OWN separated,
            collapsible sections (Connection requests / Group invites) at the top
            — unchanged from before — followed by ONE pill-filtered, recency-
            ordered conversation + contact stream (no per-type section headers).
            Sections use the larger inter-section gap; the unified list inside its
            wrapper stays tight. */}
        <nav
          className="flex-1 overflow-y-auto px-1.5 pt-1 pb-1.5 flex flex-col"
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
                        online={onlineIds}
                        currentUserId={user.id}
                        size={conversationAvatar}
                        selected={selection?.kind === 'group' && selection.id === item.group.id}
                        onClick={() => setSelection({ kind: 'group', id: item.group.id })}
                        onTogglePin={togglePin}
                        onToggleArchive={toggleArchive}
                        onToggleMute={toggleMute}
                        onMarkRead={handleMarkRead}
                        onMarkUnread={handleMarkUnread}
                        onDelete={handleDeleteConversation}
                      />
                    ) : (
                      <ContactRow
                        key={item.key}
                        member={item.member}
                        size={sidebarAvatar}
                        onClick={() => void openDirectWithMember(item.member)}
                      />
                    ),
                  )
                )}
              </div>
            </>
          )}
        </nav>

        {/* User menu */}
        <div className="relative px-1.5 pb-1.5" ref={userMenuRef}>
          {userMenuOpen && (
            <div className={`absolute bottom-full left-2 w-[15rem] max-w-[calc(100%-1rem)] mb-2 ${MENU_CONTAINER}`}>
              <MenuItem
                icon={<CircleUser {...MENU_GLYPH} />}
                onClick={() => {
                  setUserMenuOpen(false)
                  setProfilePanelOpen(true)
                }}
              >
                My profile
              </MenuItem>
              <MenuItem
                icon={<Building2 {...MENU_GLYPH} />}
                onClick={() => {
                  setUserMenuOpen(false)
                  setCompanyPanelOpen(true)
                }}
              >
                Company profile
              </MenuItem>
              <MenuItem
                icon={<Settings {...MENU_GLYPH} />}
                onClick={() => {
                  setUserMenuOpen(false)
                  setSettingsPanelOpen(true)
                }}
              >
                Workspace settings
              </MenuItem>
              <div className={MENU_SEPARATOR} />
              <MenuItem
                icon={<LogOut {...MENU_GLYPH} />}
                tone="danger"
                onClick={() => {
                  setUserMenuOpen(false)
                  void onSignOut()
                }}
              >
                Sign out
              </MenuItem>
            </div>
          )}

          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className={`w-full flex items-center gap-2 px-2 py-2 rounded-btn transition-colors text-left ${
              userMenuOpen ? 'bg-white/[0.10]' : 'hover:bg-white/[0.07]'
            }`}
          >
            <div className="relative shrink-0">
              <Avatar userId={user.id} name={user.displayName} size={sidebarAvatar} version={avatarVersion} />
              {/* Live status dot: grey "Away" when idle, else the manual status
                  colour. Drivers have no availability, so no dot. */}
              {user.role !== 'driver' && cachedProfile && (
                <span
                  title={away ? AWAY.label : statusMeta(cachedProfile.availabilityStatus).label}
                  className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg"
                  style={{
                    backgroundColor: away
                      ? AWAY.color
                      : statusMeta(cachedProfile.availabilityStatus).color,
                  }}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="font-medium truncate"
                style={{ fontSize: 'var(--sidebar-row-font-size)' }}
              >
                {user.displayName}
              </div>
              <div
                className="text-muted truncate capitalize"
                style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
              >
                {user.role}
              </div>
            </div>
            <ChevronDown
              size="0.875rem"
              strokeWidth={1.6}
              className={`text-muted shrink-0 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
          </>
        )}
      </aside>
      )}

      {/* Main — the single raised workspace card. No white outline: the lighter
          rail tone, rounded clipping and shell gap provide separation. */}
      <main className="flex-1 flex flex-col min-w-0 bg-rail rounded-panel overflow-hidden">
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
          <div className="flex-1 flex flex-col min-w-0 bg-rail">
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
                  <p className="text-[0.8125rem] text-muted">This invitation is no longer pending.</p>
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="mt-3 text-[0.78125rem] text-text font-semibold hover:underline underline-offset-4"
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
    </div>
  )
}
