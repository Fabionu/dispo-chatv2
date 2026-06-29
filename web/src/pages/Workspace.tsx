import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Building2,
  ChevronDown,
  CircleUser,
  LogOut,
  MailOpen,
  Pin,
  PinOff,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type { User, Workspace as WorkspaceT } from '../auth/AuthContext'
import type {
  Connection,
  ConnectionsResponse,
  ConnectionUser,
  Group,
  GroupInvite,
  IncomingMessage,
  Profile,
  ReplyToPreview,
  WorkspaceMember,
} from '../lib/types'
import { groupHasUnread, groupLabel, groupPreview, tractorPlate } from '../lib/types'
import { getOps, tripSummary } from '../lib/vehicleOps'
import { StatusChip, StatusDot } from '../components/vehicle/opsControls'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useMessageCache } from '../hooks/useMessageCache'
import ChatView from '../components/ChatView'
import ConnectionRequestView from '../components/connections/ConnectionRequestView'
import ConnectionRequestsSection from '../components/connections/ConnectionRequestsSection'
import GroupInvitesSection from '../components/invites/GroupInvitesSection'
import GroupInviteView from '../components/invites/GroupInviteView'
import Avatar from '../components/Avatar'
import GroupAvatar from '../components/GroupAvatar'
import ConversationRowMenu, { type RowMenuAction } from '../components/ConversationRowMenu'
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
import { useDensity, SIDEBAR_AVATAR_SIZE } from '../lib/density'
import { useViewMode } from '../lib/viewMode'
import { getStoredSidebarCollapsed, setStoredSidebarCollapsed } from '../lib/sidebar'
import { preloadAvatar } from '../lib/avatarCache'
import { statusMeta, AWAY, OFFLINE } from '../lib/availability'
import { useAuth } from '../auth/AuthContext'

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

const EMPTY_CONNECTIONS: ConnectionsResponse = {
  accepted: [],
  pendingReceived: [],
  pendingSent: [],
}

function byRecent(a: Group, b: Group): number {
  const at = a.lastMessageAt ?? a.createdAt
  const bt = b.lastMessageAt ?? b.createdAt
  return bt.localeCompare(at)
}

export default function Workspace({ user, workspace, onSignOut }: Props) {
  const { refresh } = useAuth()
  // Sidebar avatar/logo diameter tracks the display density (these components
  // take a numeric size, so they can't read the CSS density tokens directly).
  const density = useDensity()
  const sidebarAvatar = SIDEBAR_AVATAR_SIZE[density]
  // The workspace header logo reads larger than the rail's avatar metric, while
  // the header's padding/height (--header-height) stay fixed — it's still
  // vertically centered, just a bigger image. Footer avatar + collapsed rail keep
  // the standard `sidebarAvatar` size.
  const headerLogoSize = sidebarAvatar + 9
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
  const [groups, setGroups] = useState<Group[]>([])
  const [loadingGroups, setLoadingGroups] = useState(true)
  // Active members of the caller's own company (internal/trusted contacts).
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  // Sidebar quick-filter text. Filters the conversation lists by name (and a
  // vehicle's tractor plate) so "Jump to…" actually narrows the rail.
  const [query, setQuery] = useState('')
  // Sidebar pill filter — the single list below shows everything / only groups /
  // only DMs depending on this. Replaces the old visible section grouping.
  const [filter, setFilter] = useState<SidebarFilter>('all')
  const [connections, setConnections] = useState<ConnectionsResponse>(EMPTY_CONNECTIONS)
  // Connection-request fetch status, surfaced as compact rail states. `loading`
  // only drives a visible hint on the very first load (no data yet); `error`
  // keeps the existing rows and offers a retry instead of hiding the section.
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [connectionsError, setConnectionsError] = useState(false)
  // Pending vehicle-group invitations addressed to the current user.
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([])
  // A quote to seed a DM's composer with, set when a DM is opened via "Reply
  // privately". Scoped to a group id so it only seeds that conversation.
  const [pendingReply, setPendingReply] = useState<{
    groupId: string
    reply: ReplyToPreview
  } | null>(null)

  const userMenuRef = useRef<HTMLDivElement>(null)
  const newMenuRef = useRef<HTMLDivElement>(null)
  // Mirror the currently-open group id into a ref so the socket handler (set up
  // once) can tell whether an arriving message belongs to the open chat without
  // re-subscribing on every selection change.
  const openGroupId = selection?.kind === 'group' ? selection.id : null
  const openGroupIdRef = useRef(openGroupId)
  openGroupIdRef.current = openGroupId

  const { prefetch } = useMessageCache()

  // Warm the profile cache in the background so the "My profile" drawer opens
  // instantly the first time. Cheap, fire-and-forget.
  useEffect(() => {
    api.profile
      .get()
      .then(({ profile }) => setCachedProfile(profile))
      .catch(() => {})
  }, [])

  const refreshGroups = useCallback(async () => {
    try {
      const { groups } = await api.groups.list()
      setGroups([...groups].sort(byRecent))
    } catch (err) {
      // A failed groups fetch must never silently EMPTY the rail (which would
      // hide every conversation + cross-workspace contact and leave the list
      // looking broken). Keep whatever's already shown and surface the error for
      // diagnosis — same graceful-degradation as the contacts roster above.
      console.error('Failed to refresh conversations', err)
    }
  }, [])

  useEffect(() => {
    refreshGroups().finally(() => setLoadingGroups(false))
  }, [refreshGroups])

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

  // Socket: keep the rail in sync. A new message bumps its group to the top
  // (and marks it unread unless it's the open one). A new group prompts a
  // refetch — cheap, and avoids partial state.
  useEffect(() => {
    const socket = getSocket()

    function onMessageNew(msg: IncomingMessage) {
      setGroups((prev) => {
        const idx = prev.findIndex((g) => g.id === msg.groupId)
        if (idx === -1) {
          void refreshGroups()
          return prev
        }
        // Bump unread only for messages from others landing in a group that
        // isn't the one currently open (the open one gets marked read).
        const bumpUnread =
          msg.authorId !== user.id && openGroupIdRef.current !== msg.groupId
        // A separate bump for the @-badge: only when this message mentions me.
        const bumpMention =
          bumpUnread && (msg.mentions?.some((m) => m.userId === user.id) ?? false)
        const updated: Group = {
          ...prev[idx],
          lastMessageAt: msg.createdAt,
          unreadCount: (prev[idx].unreadCount ?? 0) + (bumpUnread ? 1 : 0),
          unreadMentionCount: (prev[idx].unreadMentionCount ?? 0) + (bumpMention ? 1 : 0),
          // Keep the Normal-view preview live (system rows don't arrive here).
          lastMessage: {
            body: msg.body,
            authorId: msg.authorId,
            authorName: msg.authorName,
            deleted: false,
            hasAttachments: (msg.attachments?.length ?? 0) > 0,
          },
        }
        const next = prev.filter((_, i) => i !== idx)
        next.unshift(updated)
        return next
      })
    }
    // Authoritative unread counters pushed by the server when a delete changed
    // them (delete-for-everyone decrements every member who still had the
    // message unread; delete-for-me decrements just my own, across my devices).
    // We set the exact server values rather than nudging, so the rail badge can
    // never drift. The open conversation shows 0 regardless (selected → 0).
    function onGroupUnread(p: {
      groupId: string
      unreadCount: number
      unreadMentionCount: number
    }) {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === p.groupId
            ? { ...g, unreadCount: p.unreadCount, unreadMentionCount: p.unreadMentionCount }
            : g,
        ),
      )
    }
    function onGroupAdded() {
      void refreshGroups()
    }
    // Removed from a group (kicked by an admin): refresh the rail and, if that
    // group is the one currently open, drop the selection so we don't keep
    // showing a conversation we can no longer access.
    function onGroupRemoved(p: { groupId: string }) {
      if (openGroupIdRef.current === p.groupId) setSelection(null)
      void refreshGroups()
    }
    // A colleague joined (or left) the company → refresh the internal contact
    // roster so the new person shows up in the rail without a reload.
    function onMembersChanged() {
      void refreshMembers()
    }
    // Conversation prefs changed on another tab/device (archive/pin/mute, or a
    // "delete for me"). Keep this client in lockstep: a hide drops + deselects
    // the row; otherwise patch the per-user flags in place.
    function onGroupPrefs(p: {
      groupId: string
      archivedAt: string | null
      pinnedAt: string | null
      muted: boolean
      hiddenAt: string | null
    }) {
      if (p.hiddenAt) {
        if (openGroupIdRef.current === p.groupId) setSelection(null)
        setGroups((prev) => prev.filter((g) => g.id !== p.groupId))
        return
      }
      setGroups((prev) =>
        prev.map((g) =>
          g.id === p.groupId
            ? { ...g, archivedAt: p.archivedAt, pinnedAt: p.pinnedAt, muted: p.muted }
            : g,
        ),
      )
    }

    socket.on('message:new', onMessageNew)
    socket.on('group:unread', onGroupUnread)
    socket.on('group:added', onGroupAdded)
    socket.on('group:removed', onGroupRemoved)
    socket.on('group:prefs', onGroupPrefs)
    socket.on('workspace:members_changed', onMembersChanged)
    return () => {
      socket.off('message:new', onMessageNew)
      socket.off('group:unread', onGroupUnread)
      socket.off('group:added', onGroupAdded)
      socket.off('group:removed', onGroupRemoved)
      socket.off('group:prefs', onGroupPrefs)
      socket.off('workspace:members_changed', onMembersChanged)
    }
  }, [refreshGroups, refreshMembers, user.id])

  // Connections: load once, then refetch whenever a connection event fires.
  // Refetching (rather than patching) keeps the three buckets consistent.
  const refreshConnections = useCallback(async () => {
    setLoadingConnections(true)
    setConnectionsError(false)
    try {
      setConnections(await api.connections.list())
    } catch {
      // Keep whatever buckets we already had so the rail doesn't blank out; the
      // section shows a compact retryable error instead.
      setConnectionsError(true)
    } finally {
      setLoadingConnections(false)
    }
  }, [])

  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  useEffect(() => {
    const socket = getSocket()
    const onChange = () => void refreshConnections()
    socket.on('connection:requested', onChange)
    socket.on('connection:accepted', onChange)
    socket.on('connection:declined', onChange)
    return () => {
      socket.off('connection:requested', onChange)
      socket.off('connection:accepted', onChange)
      socket.off('connection:declined', onChange)
    }
  }, [refreshConnections])

  // Group invitations: load once, then refetch on any invite lifecycle event.
  // Refetching keeps the pending list authoritative (same approach as
  // connections). On accept, the server also emits `group:added`, so the group
  // itself appears via the message/group socket handler above.
  const refreshGroupInvites = useCallback(async () => {
    const { invites } = await api.groupInvites.list()
    setGroupInvites(invites)
  }, [])

  useEffect(() => {
    void refreshGroupInvites()
  }, [refreshGroupInvites])

  useEffect(() => {
    const socket = getSocket()
    const onChange = () => void refreshGroupInvites()
    socket.on('group_invite:created', onChange)
    socket.on('group_invite:accepted', onChange)
    socket.on('group_invite:declined', onChange)
    socket.on('group_invite:cancelled', onChange)
    return () => {
      socket.off('group_invite:created', onChange)
      socket.off('group_invite:accepted', onChange)
      socket.off('group_invite:declined', onChange)
      socket.off('group_invite:cancelled', onChange)
    }
  }, [refreshGroupInvites])

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
      setGroups((prev) => {
        if (prev.some((g) => g.id === group.id)) return prev
        return [group, ...prev].sort(byRecent)
      })
      setSelection({ kind: 'group', id: group.id })
      void refreshGroups()
    },
    [refreshGroups],
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

  // Merge a partial update into a single group's record (name / plates / image
  // flag), so an in-chat group-info edit reflects in the header and rail
  // immediately without a refetch.
  const patchGroup = useCallback((groupId: string, partial: Partial<Group>) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, ...partial } : g)))
  }, [])

  // Patch a single group's lastReadAt + clear its unread counter locally so the
  // badge clears without a full refetch.
  const markGroupRead = useCallback((groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, lastReadAt: new Date().toISOString(), unreadCount: 0, unreadMentionCount: 0 }
          : g,
      ),
    )
  }, [])

  // ── Per-conversation row actions (sidebar ⋮ menu) ─────────────────────────
  // Each applies the change OPTIMISTICALLY (patchGroup) for an instant response,
  // then persists it; on failure we refetch the rail to reconcile rather than
  // leave it drifted. All prefs are per-user (group_members, migration 0023).
  const applyPrefs = useCallback(
    async (
      groupId: string,
      optimistic: Partial<Group>,
      body: Partial<{ archived: boolean; pinned: boolean; muted: boolean }>,
    ) => {
      patchGroup(groupId, optimistic)
      try {
        await api.groups.setPrefs(groupId, body)
      } catch {
        void refreshGroups()
      }
    },
    [patchGroup, refreshGroups],
  )

  const togglePin = useCallback(
    (group: Group, pinned: boolean) =>
      void applyPrefs(group.id, { pinnedAt: pinned ? new Date().toISOString() : null }, { pinned }),
    [applyPrefs],
  )
  const toggleArchive = useCallback(
    (group: Group, archived: boolean) =>
      void applyPrefs(
        group.id,
        { archivedAt: archived ? new Date().toISOString() : null },
        { archived },
      ),
    [applyPrefs],
  )
  const toggleMute = useCallback(
    (group: Group, muted: boolean) => void applyPrefs(group.id, { muted }, { muted }),
    [applyPrefs],
  )

  const handleMarkRead = useCallback(
    async (group: Group) => {
      markGroupRead(group.id)
      try {
        await api.groups.markRead(group.id)
      } catch {
        void refreshGroups()
      }
    },
    [markGroupRead, refreshGroups],
  )
  const handleMarkUnread = useCallback(
    async (group: Group) => {
      patchGroup(group.id, { unreadCount: Math.max(group.unreadCount ?? 0, 1) })
      try {
        await api.groups.markUnread(group.id)
      } catch {
        void refreshGroups()
      }
    },
    [patchGroup, refreshGroups],
  )
  // "Delete conversation" = delete FOR ME (hidden). Never removes the group or
  // touches anyone else's view; it reappears on the next message. Drop + deselect
  // optimistically, then persist.
  const handleDeleteConversation = useCallback(
    async (group: Group) => {
      if (openGroupIdRef.current === group.id) setSelection(null)
      setGroups((prev) => prev.filter((g) => g.id !== group.id))
      try {
        await api.groups.setPrefs(group.id, { hidden: true })
      } catch {
        void refreshGroups()
      }
    },
    [refreshGroups],
  )

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

  // App shell: the near-black sidebar card sits on the slightly lighter grey
  // app background (`bg`), with a consistent gap between them — so the rail
  // reads as the darkest navigation area and the main/chat content as the
  // lighter primary surface. Outer margin is small on laptops and a touch
  // larger on big monitors (2xl) so large screens feel contained.
  return (
    <div className="h-screen w-full flex gap-3 p-2 2xl:p-3 bg-bg text-text overflow-hidden">
      {/* Collapsed left rail — a slim icon strip so the main area (wide
          chats) gets the freed width. Keeps the essentials reachable: expand,
          workspace home, and the account menu (clicking it expands first). All
          list state (search, groups, DMs, requests, panels) is preserved and
          returns intact on expand. */}
      {sidebarCollapsed ? (
        <aside className="w-14 shrink-0 bg-rail rounded-[11px] overflow-hidden flex flex-col items-center py-3 gap-1.5">
          <button
            onClick={toggleSidebar}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="h-9 w-9 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <PanelLeftOpen size={18} strokeWidth={1.8} />
          </button>
          <button
            onClick={() => setSelection({ kind: 'inbox' })}
            title={`${workspace.name} — home`}
            aria-label="Workspace home"
            aria-current={inboxActive ? 'page' : undefined}
            // Same split as the expanded header: subtle persistent selected state,
            // separate transient hover.
            className={`flex items-center justify-center rounded-full p-1 transition-colors hover:bg-white/[0.05] ${
              inboxActive ? 'bg-white/[0.025]' : ''
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
            className="rounded-full p-0.5 hover:bg-white/[0.04] transition-colors"
          >
            <Avatar userId={user.id} name={user.displayName} size={sidebarAvatar} version={avatarVersion} />
          </button>
        </aside>
      ) : (
      /* Left rail — a borderless rounded card. overflow-hidden clips the
          header/list to the rounded corners; separation from the darker chat
          background comes from the panel's own `rail` tone (the same surface as
          the Group Info panel), not a border. */
      <aside className="w-[var(--sidebar-width)] shrink-0 bg-rail rounded-[11px] overflow-hidden flex flex-col">
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
        <div className="h-[var(--header-height)] flex items-stretch transition-colors hover:bg-white/[0.04]">
          <button
            onClick={() => setSelection({ kind: 'inbox' })}
            title="Workspace home"
            aria-current={inboxActive ? 'page' : undefined}
            // Transparent: the unified row hover (parent) provides the highlight,
            // and there's no persistent active background. Padding/gap mirror the
            // chat header's identity cluster and the rail's own content edge (the
            // search field + footer avatar sit at px-3), so the logo lines up with
            // everything below it instead of being indented on its own.
            className="flex-1 min-w-0 flex items-center gap-3 px-3 text-left"
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
            className="self-center mr-1.5 h-9 w-9 flex items-center justify-center rounded-full text-muted hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 shrink-0"
          >
            <PanelLeftClose size={18} strokeWidth={1.8} />
          </button>
        </div>

        {/* Quick search + create */}
        <div className="px-3 pt-3 pb-2 flex items-center gap-1.5">
          <label
            htmlFor="rail-search"
            className="flex-1 h-[var(--sidebar-search-height)] flex items-center gap-2 px-3 rounded-[11px] border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] hover:border-white/[0.10] transition-colors cursor-text"
          >
            <Search size={12} strokeWidth={1.6} className="text-faint shrink-0" />
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
                <X size={12} strokeWidth={1.8} />
              </button>
            )}
          </label>

          <div className="relative shrink-0" ref={newMenuRef}>
            <button
              onClick={() => setNewMenuOpen((v) => !v)}
              aria-label="Create a new conversation"
              aria-haspopup="menu"
              aria-expanded={newMenuOpen}
              className={`h-[var(--sidebar-search-height)] w-[var(--sidebar-search-height)] flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                newMenuOpen
                  ? 'bg-white/[0.08] text-text'
                  : 'text-muted hover:text-text hover:bg-white/[0.05]'
              }`}
            >
              <Plus size={18} strokeWidth={2.25} />
            </button>

            {newMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+6px)] w-[200px] rounded-card border border-white/[0.08] bg-surface overflow-hidden z-20 py-1"
              >
                <CreateMenuItem label="Vehicle chat" onClick={() => startCreate('vehicle')} />
                <CreateMenuItem label="Search for a connection" onClick={() => startCreate('direct')} />
              </div>
            )}
          </div>
        </div>

        {/* Pill filters — compact, theme-native toggles under search that switch
            the single list below between everything / vehicle rooms / direct
            conversations. They replace the old visible section grouping. */}
        <div className="px-3 pb-2 flex items-center gap-1">
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterPill>
          <FilterPill active={filter === 'archived'} onClick={() => setFilter('archived')}>
            Archived
          </FilterPill>
          <FilterPill active={filter === 'groups'} onClick={() => setFilter('groups')}>
            Groups
          </FilterPill>
          <FilterPill active={filter === 'dms'} onClick={() => setFilter('dms')}>
            Direct
          </FilterPill>
        </div>

        {/* Rail list. Pending actionable items keep their OWN separated,
            collapsible sections (Connection requests / Group invites) at the top
            — unchanged from before — followed by ONE pill-filtered, recency-
            ordered conversation + contact stream (no per-type section headers).
            Sections use the larger inter-section gap; the unified list inside its
            wrapper stays tight. */}
        <nav
          className="flex-1 overflow-y-auto px-2 pt-1 pb-2 flex flex-col"
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
                  loading={loadingConnections}
                  error={connectionsError}
                  onRetry={() => void refreshConnections()}
                  selectedId={selection?.kind === 'request' ? selection.id : null}
                  onSelect={(id) => setSelection({ kind: 'request', id })}
                />
              )}
              {!searching && filter !== 'archived' && (
                <GroupInvitesSection
                  invites={groupInvites}
                  selectedId={selection?.kind === 'invite' ? selection.id : null}
                  onSelect={(id) => setSelection({ kind: 'invite', id })}
                />
              )}

              {/* The unified conversation + contact stream for the active filter. */}
              <div className="flex flex-col gap-0.5">
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
        <div className="relative border-t border-white/[0.05]" ref={userMenuRef}>
          {userMenuOpen && (
            <div className="absolute bottom-full left-2 w-[240px] max-w-[calc(100%-1rem)] mb-2 rounded-card border border-white/[0.08] bg-surface overflow-hidden">
              <MenuItem
                icon={<CircleUser size={13} strokeWidth={1.6} />}
                onClick={() => {
                  setUserMenuOpen(false)
                  setProfilePanelOpen(true)
                }}
              >
                My profile
              </MenuItem>
              <MenuItem
                icon={<Building2 size={13} strokeWidth={1.6} />}
                onClick={() => {
                  setUserMenuOpen(false)
                  setCompanyPanelOpen(true)
                }}
              >
                Company profile
              </MenuItem>
              <MenuItem
                icon={<Settings size={13} strokeWidth={1.6} />}
                onClick={() => {
                  setUserMenuOpen(false)
                  setSettingsPanelOpen(true)
                }}
              >
                Workspace settings
              </MenuItem>
              <MenuItem
                icon={<LogOut size={13} strokeWidth={1.6} />}
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
            className="w-full flex items-center gap-2.5 px-3 py-3 hover:bg-white/[0.02] transition-colors text-left"
          >
            <div className="relative shrink-0">
              <Avatar userId={user.id} name={user.displayName} size={sidebarAvatar} version={avatarVersion} />
              {/* Live status dot: grey "Away" when idle, else the manual status
                  colour. Drivers have no availability, so no dot. */}
              {user.role !== 'driver' && cachedProfile && (
                <span
                  title={away ? AWAY.label : statusMeta(cachedProfile.availabilityStatus).label}
                  className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-rail"
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
              size={13}
              strokeWidth={1.6}
              className={`text-muted shrink-0 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
          </>
        )}
      </aside>
      )}

      {/* Main — holds the right-side content region. NOT a card: it has no outer
          border or radius, so the chat / inbox / route / request / invite views
          read as open content on the app background (the sidebar keeps the card
          treatment). Each view supplies its own header + internal dividers. */}
      <main className="flex-1 flex flex-col min-w-0">
        {selectedGroup ? (
          <ChatView
            key={selectedGroup.id}
            group={selectedGroup}
            currentUserId={user.id}
            onRead={markGroupRead}
            onOpenDirectMessage={openDirectMessage}
            initialReplyContext={
              pendingReply?.groupId === selectedGroup.id ? pendingReply.reply : null
            }
            onConsumeInitialReply={() => setPendingReply(null)}
            canInviteMembers={canInviteMembers}
            onGroupUpdated={patchGroup}
          />
        ) : (
          <div className="flex-1 flex flex-col min-w-0 bg-bg">
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
                <div className="text-center max-w-[320px]">
                  <p className="text-[13px] text-muted">This invitation is no longer pending.</p>
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="mt-3 text-[12.5px] text-text font-semibold hover:underline underline-offset-4"
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
              <InboxView workspaceName={workspace.name} />
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

// Compact last-activity stamp for a Normal-view row: today → HH:MM, yesterday →
// "Yesterday", otherwise DD/MM. Empty string when there's no timestamp.
function relTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date()
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  // Explicit DD/MM (locale-independent) so it never renders as MM/DD.
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}`
}

function GroupRow({
  group,
  selected,
  online,
  currentUserId,
  onClick,
  onTogglePin,
  onToggleArchive,
  onToggleMute,
  onMarkRead,
  onMarkUnread,
  onDelete,
}: {
  group: Group
  selected: boolean
  // Live online user-id set (presence). Drives the DM status dot.
  online: Set<string>
  // Viewing user — decides the "You:" / name prefix on the Normal-view preview.
  currentUserId: string
  onClick: () => void
  // Per-conversation row actions (the hover ⋮ menu). Each takes the row's group
  // plus the desired next state where it's a toggle.
  onTogglePin: (group: Group, pinned: boolean) => void
  onToggleArchive: (group: Group, archived: boolean) => void
  onToggleMute: (group: Group, muted: boolean) => void
  onMarkRead: (group: Group) => void
  onMarkUnread: (group: Group) => void
  onDelete: (group: Group) => void
}) {
  // A DM peer's dot: their declared status colour when online, dim grey when
  // offline (signed out / app closed). Live via socket presence.
  const peer = group.type === 'direct' ? group.directPeer : null
  const peerOnline = peer ? online.has(peer.id) : false
  const peerDot = peer
    ? peerOnline
      ? statusMeta(peer.availabilityStatus ?? 'available')
      : OFFLINE
    : null
  // Selecting a group clears its indicator immediately (it's about to be read).
  // Prefer the precise server count; fall back to the timestamp-based flag when
  // the API didn't send a count (older server) so the dot never disappears.
  const hasCount = typeof group.unreadCount === 'number'
  const unreadCount = selected ? 0 : group.unreadCount ?? 0
  const unread = selected ? false : hasCount ? unreadCount > 0 : groupHasUnread(group)
  // Unread @-mentions get their own compact badge, separate from the regular
  // unread dot/count, so being mentioned stands out from ordinary traffic.
  const hasUnreadMention = !selected && (group.unreadMentionCount ?? 0) > 0
  // Leading identity slot depends on the VIEW MODE:
  //  - compact (default): the original small type glyph — CircleUser for a DM,
  //    Users for a vehicle room — kept faint so the name stays the focus. Dense.
  //  - normal: a larger avatar-like slot (DM photo or generic contact icon,
  //    generated vehicle icon), sized to the density tier — preview-ready layout.
  const viewMode = useViewMode()
  const TypeIcon = group.type === 'direct' ? CircleUser : Users

  // Active-trip indicator for vehicle rooms: a compact status line read off the
  // manual ops blob. Null when there's no trip, so the row keeps its existing
  // (non-trip) subtitle/metadata. `full` (status · Next: …) is used on the
  // breathable Normal row; `short` (status only) on the dense Compact row.
  const trip = group.type === 'vehicle' ? tripSummary(getOps(group)) : null
  const tripLineFull = trip
    ? [trip.statusLabel, trip.nextLabel && `Next: ${trip.nextLabel}`].filter(Boolean).join(' · ')
    : null

  // ── Per-conversation row actions (hover ⋮ menu) ────────────────────────────
  const archived = Boolean(group.archivedAt)
  const pinned = Boolean(group.pinnedAt)
  const muted = Boolean(group.muted)
  // The menu's read/unread label reflects the ACTUAL stored unread, not the
  // selected→0 view used for the badge.
  const actuallyUnread = (group.unreadCount ?? 0) > 0
  const ICON = { size: 13, strokeWidth: 1.7 } as const
  const menuActions: RowMenuAction[] = [
    {
      key: 'pin',
      label: pinned ? 'Unpin' : 'Pin',
      icon: pinned ? <PinOff {...ICON} /> : <Pin {...ICON} />,
      onSelect: () => onTogglePin(group, !pinned),
    },
    {
      key: 'read',
      label: actuallyUnread ? 'Mark as read' : 'Mark as unread',
      icon: <MailOpen {...ICON} />,
      onSelect: () => (actuallyUnread ? onMarkRead(group) : onMarkUnread(group)),
    },
    {
      key: 'mute',
      label: muted ? 'Unmute notifications' : 'Mute notifications',
      icon: muted ? <Bell {...ICON} /> : <BellOff {...ICON} />,
      onSelect: () => onToggleMute(group, !muted),
    },
    {
      key: 'archive',
      label: archived ? 'Unarchive' : 'Archive',
      icon: archived ? <ArchiveRestore {...ICON} /> : <Archive {...ICON} />,
      onSelect: () => onToggleArchive(group, !archived),
    },
    {
      key: 'delete',
      label: 'Delete conversation',
      icon: <Trash2 {...ICON} />,
      danger: true,
      confirmLabel: 'Confirm delete',
      onSelect: () => onDelete(group),
    },
  ]
  // On-hover/focus overlay holding the ⋮ menu, anchored to the row's right edge,
  // vertically centred over the WHOLE row. The conflicting right-side metadata
  // (trip badge + timestamp/counts) fades out on hover (see the matching
  // group-hover/row:opacity-0 below) so the button sits cleanly on its own at the
  // far right instead of wedged between the badge and the timestamp. pointer-
  // events stay off until revealed so the hidden trigger never blocks a click on
  // the row beneath it; it stays visible while its menu is open (focus-within).
  const rowActions = (
    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 opacity-0 pointer-events-none transition-opacity group-hover/row:opacity-100 group-hover/row:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
      <ConversationRowMenu actions={menuActions} ariaLabel={`Conversation actions for ${groupLabel(group)}`} />
    </div>
  )
  // Small muted indicator shared by both view densities. Fades with the rest of
  // the right-side metadata on hover so the action button owns the far right.
  const mutedIcon = muted ? (
    <BellOff
      size={11}
      strokeWidth={1.7}
      className="shrink-0 text-faint transition-opacity group-hover/row:opacity-0"
      aria-label="Muted"
    />
  ) : null

  // ── Normal view: breathable two-line rows with a last-message preview ──────
  // Larger avatar, more padding, name on line 1 (+ time), preview on line 2 (+
  // unread/mention badges). Compact view is left exactly as it was below.
  if (viewMode === 'normal') {
    const NORMAL_AVATAR = 40
    const preview = groupPreview(group, currentUserId)
    const time = relTime(group.lastMessageAt)
    return (
      <div className="relative group/row">
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2 min-h-[56px] rounded-chip text-left transition-colors ${
          selected ? 'bg-white/[0.06] text-text' : 'text-muted hover:bg-white/[0.025] hover:text-text'
        }`}
      >
        <span className="relative shrink-0 flex">
          {group.type === 'direct' ? (
            <Avatar
              userId={peer?.id ?? ''}
              name={peer?.name ?? groupLabel(group)}
              size={NORMAL_AVATAR}
            />
          ) : (
            <GroupAvatar groupId={group.id} hasAvatar={Boolean(group.hasAvatar)} size={NORMAL_AVATAR} />
          )}
          {peerDot && (
            <span
              title={peerDot.label}
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-rail"
              style={{ backgroundColor: peerDot.color }}
            />
          )}
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          {/* Line 1 — just the name. No company/timestamp here: the timestamp
              sits with the preview on line 2, keeping the name row clean. The
              vehicle's active-trip status chip is the one small indicator that
              belongs on the title line. */}
          <span className="flex items-center gap-2">
            <span className={`flex-1 truncate text-[13.5px] ${unread ? 'text-text font-semibold' : 'text-text/90'}`}>
              {groupLabel(group)}
            </span>
            {trip && (
              <span
                className="shrink-0 transition-opacity group-hover/row:opacity-0"
                title={tripLineFull ?? trip.statusLabel}
              >
                <StatusChip tone={trip.statusTone} label={trip.statusLabel} />
              </span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {/* Latest-message preview — always shown (incl. vehicle rooms with an
                active trip); the trip status lives in the chip on the title line. */}
            <span className={`flex-1 truncate text-[12px] ${unread ? 'text-muted' : 'text-faint'}`}>
              {preview.prefix && (
                <span className={unread ? 'text-muted font-medium' : 'text-faint'}>{preview.prefix} </span>
              )}
              {preview.text}
            </span>
            {/* Right-side metadata cluster — fades out on row hover so the action
                button can take the far-right slot without crowding it. */}
            <span className="flex items-center gap-2 shrink-0 transition-opacity group-hover/row:opacity-0">
              {hasUnreadMention && (
                <span
                  aria-label="You were mentioned"
                  title="You were mentioned"
                  className="h-4 min-w-4 px-1 rounded-full bg-active/20 text-active text-[10px] font-bold leading-none flex items-center justify-center"
                >
                  @
                </span>
              )}
              {unread && hasCount && unreadCount > 0 && (
                <span
                  aria-label={`${unreadCount} unread`}
                  className="h-4 min-w-4 px-1.5 rounded-full bg-active text-bg text-[10px] font-semibold leading-none flex items-center justify-center"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              {muted && mutedIcon}
              {/* Last-activity stamp — lives on the preview line (right side), not
                  the name line, so all rows share the same metadata baseline. */}
              {time && <span className="text-[10.5px] text-faint tabular-nums">{time}</span>}
            </span>
          </span>
        </span>
      </button>
      {rowActions}
      </div>
    )
  }

  return (
    <div className="relative group/row">
    <button
      onClick={onClick}
      style={{
        minHeight: 'var(--sidebar-row-height)',
        gap: 'var(--sidebar-row-gap)',
        paddingLeft: 'var(--sidebar-row-pad-x)',
        paddingRight: 'var(--sidebar-row-pad-x)',
        paddingTop: 'var(--sidebar-row-pad-y)',
        paddingBottom: 'var(--sidebar-row-pad-y)',
      }}
      className={`w-full flex items-center rounded-chip text-left transition-colors ${
        selected
          ? 'bg-white/[0.06] text-text'
          : 'text-muted hover:bg-white/[0.025] hover:text-text'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${unread ? 'bg-active' : 'bg-transparent'}`}
      />
      <span className="relative shrink-0 flex">
        <TypeIcon
          strokeWidth={1.6}
          style={{ width: 'var(--sidebar-icon-size)', height: 'var(--sidebar-icon-size)' }}
          className={`shrink-0 ${unread ? 'text-muted' : 'text-faint'}`}
        />
        {/* DM peer presence: live online/offline via socket, coloured by the
            peer's declared status when online and dim grey when offline. */}
        {peerDot && (
          <span
            title={peerDot.label}
            className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-rail"
            style={{ backgroundColor: peerDot.color }}
          />
        )}
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span
          className={`min-w-0 truncate ${unread ? 'text-text font-medium' : ''}`}
          style={{ fontSize: 'var(--sidebar-row-font-size)' }}
        >
          {groupLabel(group)}
        </span>
        {/* Vehicle-room active trip → a tiny colored status dot hugging the room
            name. The Compact row is a single dense line, so a dot (not a chip)
            keeps it uncluttered; the full status shows on hover. */}
        {trip && <StatusDot tone={trip.statusTone} title={tripLineFull ?? trip.statusLabel} />}
      </span>
      {/* DM-only: the peer's company/workspace on the right, filling the unused
          Compact-view space so cross-company users are identifiable without a
          full preview row. Muted + capped + truncated; `peer` is null for
          vehicle rooms so they get no right-side metadata. */}
      {peer?.workspace && (
        <span
          title={peer.workspace}
          className="shrink truncate text-right text-faint transition-opacity group-hover/row:opacity-0"
          style={{ fontSize: 'var(--sidebar-meta-font-size)', maxWidth: '46%' }}
        >
          {peer.workspace}
        </span>
      )}
      {muted && mutedIcon}
      {hasUnreadMention && (
        <span
          aria-label="You were mentioned"
          title="You were mentioned"
          style={{
            height: 'var(--sidebar-badge-size)',
            width: 'var(--sidebar-badge-size)',
            fontSize: 'var(--sidebar-meta-font-size)',
          }}
          className="shrink-0 rounded-full bg-active/20 text-active font-bold leading-none flex items-center justify-center transition-opacity group-hover/row:opacity-0"
        >
          @
        </span>
      )}
      {unread && hasCount && unreadCount > 0 && (
        <span
          aria-label={`${unreadCount} unread`}
          style={{
            minWidth: 'var(--sidebar-badge-size)',
            height: 'var(--sidebar-badge-size)',
            fontSize: 'var(--sidebar-meta-font-size)',
          }}
          className="shrink-0 px-1.5 rounded-full bg-active text-bg font-semibold leading-none flex items-center justify-center transition-opacity group-hover/row:opacity-0"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
    {rowActions}
    </div>
  )
}

// One company colleague who has no open DM yet, shown inline in the unified rail
// list (All + DMs filters). Visually a quiet people-row (avatar + name) matching
// the rail's row metrics; clicking it opens or creates a DM. No unread/presence
// affordances — it's a directory entry. Once a DM exists the colleague renders as
// a full conversation row (GroupRow) instead, so they never appear twice.
function ContactRow({
  member,
  size,
  onClick,
}: {
  member: WorkspaceMember
  size: number
  onClick: () => void
}) {
  const viewMode = useViewMode()

  // ── Normal view: the same breathable row as a DM/GroupRow ──────────────────
  // 40px avatar, clean name on line 1, a quiet role subtitle on line 2. No
  // company name and no timestamp (a contact has no thread yet), so the name
  // row stays clean and the preview line's right side is simply empty.
  if (viewMode === 'normal') {
    const NORMAL_AVATAR = 40
    const role = member.role ? member.role.charAt(0).toUpperCase() + member.role.slice(1) : ''
    return (
      <button
        onClick={onClick}
        title={`Message ${member.displayName}`}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 min-h-[56px] rounded-chip text-left text-muted hover:bg-white/[0.025] hover:text-text transition-colors"
      >
        <Avatar userId={member.id} name={member.displayName} size={NORMAL_AVATAR} />
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="flex-1 truncate text-[13.5px] text-text/90">{member.displayName}</span>
          </span>
          {role && (
            <span className="flex items-center gap-2">
              <span className="flex-1 truncate text-[12px] text-faint">{role}</span>
            </span>
          )}
        </span>
      </button>
    )
  }

  // ── Compact view: the original quiet single-line directory entry ───────────
  return (
    <button
      onClick={onClick}
      title={`Message ${member.displayName}`}
      style={{
        minHeight: 'var(--sidebar-row-height)',
        gap: 'var(--sidebar-row-gap)',
        paddingLeft: 'var(--sidebar-row-pad-x)',
        paddingRight: 'var(--sidebar-row-pad-x)',
        paddingTop: 'var(--sidebar-row-pad-y)',
        paddingBottom: 'var(--sidebar-row-pad-y)',
      }}
      className="w-full flex items-center rounded-chip text-left text-muted hover:bg-white/[0.025] hover:text-text transition-colors"
    >
      <Avatar userId={member.id} name={member.displayName} size={size} />
      <span className="min-w-0 flex-1 truncate" style={{ fontSize: 'var(--sidebar-row-font-size)' }}>
        {member.displayName}
      </span>
    </button>
  )
}

// Compact pill toggle for the rail's unified-list filter. Theme-native: no
// border, a subtle filled state when active, quiet hover otherwise. Sized off
// the rail's meta-font token so it scales with display density.
function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
      className={`h-7 px-3 rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'bg-white/[0.08] text-text' : 'text-muted hover:text-text hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-faint px-2 py-1 leading-[1.45]"
      style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
    >
      {children}
    </div>
  )
}

function MenuItem({
  icon,
  onClick,
  children,
  tone = 'default',
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  // 'danger' renders the row (icon + label) in the alert colour, with a subtle
  // red hover — used for destructive actions like Sign out.
  tone?: 'default' | 'danger'
}) {
  const danger = tone === 'danger'
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] transition-colors text-left ${
        danger ? 'text-alert hover:bg-alert/10' : 'hover:bg-white/[0.03]'
      }`}
    >
      <span className={danger ? 'text-alert' : 'text-muted'}>{icon}</span>
      {children}
    </button>
  )
}

function CreateMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className="w-full px-3 py-2 text-[12.5px] hover:bg-white/[0.03] transition-colors text-left"
    >
      {label}
    </button>
  )
}

// Shape an optimistic direct-message Group from what we already know about
// the other user, so the rail can render the row before the server confirms.
// `refreshGroups()` will replace this with the canonical record.
function optimisticDirectGroup(id: string, other: ConnectionUser): Group {
  const now = new Date().toISOString()
  return {
    id,
    type: 'direct',
    name: null,
    description: null,
    meta: {},
    lastMessageAt: null,
    lastReadAt: now,
    createdAt: now,
    memberCount: 2,
    unreadCount: 0,
    directPeer: { id: other.id, name: other.displayName, workspace: other.workspace.name },
  }
}
