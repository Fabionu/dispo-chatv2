import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  CircleUser,
  LogOut,
  Plus,
  Search,
  Settings,
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
} from '../lib/types'
import { groupHasUnread, groupLabel, tractorPlate } from '../lib/types'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useMessageCache } from '../hooks/useMessageCache'
import ChatView from '../components/ChatView'
import ConnectionRequestView from '../components/connections/ConnectionRequestView'
import ConnectionRequestsSection from '../components/connections/ConnectionRequestsSection'
import GroupInvitesSection from '../components/invites/GroupInvitesSection'
import GroupInviteView from '../components/invites/GroupInviteView'
import AppMark from '../components/AppMark'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import CompanyLogo from '../components/CompanyLogo'
import CreateVehicleGroupModal from '../components/CreateVehicleGroupModal'
import NewMessageModal from '../components/NewMessageModal'
import ProfileSidebarPanel from '../components/settings/ProfileSidebarPanel'
import CompanySidebarPanel from '../components/settings/CompanySidebarPanel'
import { useIdle } from '../hooks/useIdle'
import { usePresence } from '../hooks/usePresence'
import { useDensity, SIDEBAR_AVATAR_SIZE } from '../lib/density'
import { preloadAvatar } from '../lib/avatarCache'
import { statusMeta, AWAY, OFFLINE } from '../lib/availability'
import { useAuth } from '../auth/AuthContext'

type Props = {
  user: User
  workspace: WorkspaceT
  onSignOut: () => Promise<void>
}

type NewGroupKind = 'vehicle' | 'direct'

// What the main pane is currently showing. A group chat, a pending request,
// or nothing (the empty state).
type Selection =
  | { kind: 'group'; id: string }
  | { kind: 'request'; id: string }
  | { kind: 'invite'; id: string }
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
  // Auto-away presence: grey "Away" on the footer status dot when idle / tab
  // hidden. Doesn't change the stored (manual) status — presence only.
  const away = useIdle()
  // Live online/offline presence of peers (DM status dots). `resyncPresence`
  // re-requests the server snapshot; we call it whenever the group set changes
  // (below), since a new co-member who's already online won't emit a transition.
  const { online: onlineIds, resync: resyncPresence } = usePresence()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [modal, setModal] = useState<NewGroupKind | null>(null)
  // "My profile" and "Workspace settings" both open as sidebar drawers that
  // replace the conversation list (the chat stays visible on the right).
  const [profilePanelOpen, setProfilePanelOpen] = useState(false)
  const [companyPanelOpen, setCompanyPanelOpen] = useState(false)
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
  const [selection, setSelection] = useState<Selection>(null)
  // Sidebar quick-filter text. Filters the conversation lists by name (and a
  // vehicle's tractor plate) so "Jump to…" actually narrows the rail.
  const [query, setQuery] = useState('')
  const [connections, setConnections] = useState<ConnectionsResponse>(EMPTY_CONNECTIONS)
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
    const { groups } = await api.groups.list()
    setGroups([...groups].sort(byRecent))
  }, [])

  useEffect(() => {
    refreshGroups().finally(() => setLoadingGroups(false))
  }, [refreshGroups])

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
        }
        const next = prev.filter((_, i) => i !== idx)
        next.unshift(updated)
        return next
      })
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

    socket.on('message:new', onMessageNew)
    socket.on('group:added', onGroupAdded)
    socket.on('group:removed', onGroupRemoved)
    return () => {
      socket.off('message:new', onMessageNew)
      socket.off('group:added', onGroupAdded)
      socket.off('group:removed', onGroupRemoved)
    }
  }, [refreshGroups, user.id])

  // Connections: load once, then refetch whenever a connection event fires.
  // Refetching (rather than patching) keeps the three buckets consistent.
  const refreshConnections = useCallback(async () => {
    setConnections(await api.connections.list())
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
    await refreshConnections()
    await openDirectFor(otherUser)
  }

  async function handleDeclined() {
    await refreshConnections()
    setSelection(null)
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

  const vehicleGroups = useMemo(() => groups.filter((g) => g.type === 'vehicle'), [groups])
  const directGroups = useMemo(() => groups.filter((g) => g.type === 'direct'), [groups])

  // Apply the quick-filter. Empty query → full lists. A vehicle also matches on
  // its tractor plate so you can jump by registration number.
  const q = query.trim().toLowerCase()
  const matchesQuery = useCallback(
    (g: Group) => {
      if (!q) return true
      if (groupLabel(g).toLowerCase().includes(q)) return true
      const plate = tractorPlate(g)
      return plate ? plate.toLowerCase().includes(q) : false
    },
    [q],
  )
  const filteredVehicles = useMemo(
    () => vehicleGroups.filter(matchesQuery),
    [vehicleGroups, matchesQuery],
  )
  const filteredDirects = useMemo(
    () => directGroups.filter(matchesQuery),
    [directGroups, matchesQuery],
  )
  const searching = q.length > 0

  const pendingReceived = connections.pendingReceived

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

  // Who may invite members from the vehicle chat header. Group admins are also
  // allowed server-side; the header button gates on workspace role for
  // simplicity (the server enforces the full rule on POST).
  const canInviteMembers = user.role === 'admin' || user.role === 'dispatcher'

  return (
    <div className="h-screen w-full flex bg-bg text-text overflow-hidden">
      {/* Left rail */}
      <aside className="w-[var(--sidebar-width)] shrink-0 bg-rail border-r border-white/[0.08] flex flex-col">
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
        ) : (
          <>
        {/* Workspace identity. Not a button: there's no second workspace to
            switch to, and workspace actions live in the user menu below — so we
            don't show a dropdown chevron that leads nowhere. Just the company
            name — the slug was a near-duplicate of it (it's derived from the
            name) and added no information here. */}
        <div className="h-[var(--header-height)] flex items-center gap-2.5 px-4 border-b border-white/[0.05]">
          <CompanyLogo size={sidebarAvatar} version={logoVersion} />
          <div className="min-w-0 flex-1">
            <div
              className="font-semibold tracking-[-0.2px] truncate"
              style={{ fontSize: 'var(--sidebar-title-font-size)' }}
            >
              {workspace.name}
            </div>
          </div>
        </div>

        {/* Quick search + create */}
        <div className="px-3 pt-3 pb-2 flex items-center gap-1.5">
          <label
            htmlFor="rail-search"
            className="flex-1 h-[var(--sidebar-search-height)] flex items-center gap-2 px-2.5 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] hover:border-white/[0.10] transition-colors cursor-text"
          >
            <Search size={12} strokeWidth={1.6} className="text-faint shrink-0" />
            <input
              id="rail-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Jump to…"
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
              className={`h-[var(--sidebar-search-height)] w-[var(--sidebar-search-height)] flex items-center justify-center rounded-chip border transition-colors ${
                newMenuOpen
                  ? 'border-white/[0.16] bg-white/[0.05] text-text'
                  : 'border-white/[0.06] bg-white/[0.02] text-muted hover:text-text hover:border-white/[0.10]'
              }`}
            >
              <Plus size={14} strokeWidth={1.8} />
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

        {/* Group + requests list */}
        <nav
          className="flex-1 overflow-y-auto px-2 pt-2 pb-2 flex flex-col"
          style={{ gap: 'var(--sidebar-section-gap)' }}
        >
          {loadingGroups ? (
            // Centre the loader in the available list area (consistent with the
            // chat pane, one size down) rather than a small top row.
            <div className="h-full flex items-center justify-center">
              <Spinner variant="md" />
            </div>
          ) : searching ? (
            // While searching, show only matching conversations (no requests,
            // no create hints) so the rail reads as pure search results.
            filteredVehicles.length === 0 && filteredDirects.length === 0 ? (
              <EmptyHint>No conversations match “{query.trim()}”.</EmptyHint>
            ) : (
              <>
                {filteredVehicles.length > 0 && (
                  <ChannelGroup label="Vehicles">
                    {filteredVehicles.map((g) => (
                      <GroupRow
                        key={g.id}
                        group={g}
                        online={onlineIds}
                        selected={selection?.kind === 'group' && selection.id === g.id}
                        onClick={() => setSelection({ kind: 'group', id: g.id })}
                      />
                    ))}
                  </ChannelGroup>
                )}
                {filteredDirects.length > 0 && (
                  <ChannelGroup label="Direct messages">
                    {filteredDirects.map((g) => (
                      <GroupRow
                        key={g.id}
                        group={g}
                        online={onlineIds}
                        selected={selection?.kind === 'group' && selection.id === g.id}
                        onClick={() => setSelection({ kind: 'group', id: g.id })}
                      />
                    ))}
                  </ChannelGroup>
                )}
              </>
            )
          ) : (
            <>
              <ConnectionRequestsSection
                pendingReceived={pendingReceived}
                selectedId={selection?.kind === 'request' ? selection.id : null}
                onSelect={(id) => setSelection({ kind: 'request', id })}
              />

              <GroupInvitesSection
                invites={groupInvites}
                selectedId={selection?.kind === 'invite' ? selection.id : null}
                onSelect={(id) => setSelection({ kind: 'invite', id })}
              />

              <ChannelGroup label="Vehicles">
                {vehicleGroups.length === 0 ? (
                  <EmptyHint>
                    Create a vehicle chat to coordinate loads, documents, and updates over time.
                  </EmptyHint>
                ) : (
                  vehicleGroups.map((g) => (
                    <GroupRow
                      key={g.id}
                      group={g}
                        online={onlineIds}
                      selected={selection?.kind === 'group' && selection.id === g.id}
                      onClick={() => setSelection({ kind: 'group', id: g.id })}
                    />
                  ))
                )}
              </ChannelGroup>

              <ChannelGroup label="Direct messages">
                {directGroups.length === 0 ? (
                  <EmptyHint>No direct messages.</EmptyHint>
                ) : (
                  directGroups.map((g) => (
                    <GroupRow
                      key={g.id}
                      group={g}
                        online={onlineIds}
                      selected={selection?.kind === 'group' && selection.id === g.id}
                      onClick={() => setSelection({ kind: 'group', id: g.id })}
                    />
                  ))
                )}
              </ChannelGroup>
            </>
          )}
        </nav>

        {/* User menu */}
        <div className="relative border-t border-white/[0.05]" ref={userMenuRef}>
          {userMenuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-2 rounded-card border border-white/[0.08] bg-surface overflow-hidden">
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
                icon={<Settings size={13} strokeWidth={1.6} />}
                onClick={() => {
                  setUserMenuOpen(false)
                  setCompanyPanelOpen(true)
                }}
              >
                Workspace settings
              </MenuItem>
              <MenuItem
                icon={<LogOut size={13} strokeWidth={1.6} />}
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

      {/* Main */}
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
        ) : selectedRequest ? (
          <ConnectionRequestView
            key={selectedRequest.id}
            connection={selectedRequest}
            onAccepted={handleAccepted}
            onDeclined={handleDeclined}
          />
        ) : selectedInvite ? (
          <GroupInviteView
            key={selectedInvite.id}
            invite={selectedInvite}
            onAccepted={handleInviteAccepted}
            onDeclined={handleInviteDeclined}
          />
        ) : (
          <EmptyState
            firstName={firstName(user.displayName)}
            workspaceName={workspace.name}
            onCreate={() => startCreate('vehicle')}
          />
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

function EmptyState({
  firstName,
  workspaceName,
  onCreate,
}: {
  firstName: string
  workspaceName: string
  onCreate: () => void
}) {
  return (
    <>
      <header className="h-[var(--header-height)] flex items-center px-5 border-b border-white/[0.06] bg-rail shrink-0">
        <span className="eyebrow">Inbox</span>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="h-12 w-12 rounded-card border border-white/[0.08] bg-white/[0.015] flex items-center justify-center mb-5">
          <AppMark size={30} />
        </div>
        <h2 className="text-[18px] font-semibold tracking-[-0.2px] mb-2">Welcome, {firstName}.</h2>
        <p className="text-muted text-[13px] max-w-[420px] mb-6 leading-[1.55]">
          This is your dispatcher workspace for {workspaceName}. Create a group for a vehicle on
          the road, or start a direct message with a teammate.
        </p>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 bg-text text-bg font-semibold text-[12.5px] rounded-btn px-3.5 py-2 hover:bg-text/90 transition-colors"
        >
          <Plus size={13} strokeWidth={2} />
          Create your first group
        </button>
      </div>
    </>
  )
}

function GroupRow({
  group,
  selected,
  online,
  onClick,
}: {
  group: Group
  selected: boolean
  // Live online user-id set (presence). Drives the DM status dot.
  online: Set<string>
  onClick: () => void
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
  // Leading type glyph: a single contact for DMs, a multi-contact group glyph
  // for vehicle conversations. Kept subtle (faint) so the conversation name
  // stays the focus.
  const TypeIcon = group.type === 'direct' ? CircleUser : Users
  return (
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
      <span
        className={`flex-1 truncate ${unread ? 'text-text font-medium' : ''}`}
        style={{ fontSize: 'var(--sidebar-row-font-size)' }}
      >
        {groupLabel(group)}
      </span>
      {hasUnreadMention && (
        <span
          aria-label="You were mentioned"
          title="You were mentioned"
          style={{
            height: 'var(--sidebar-badge-size)',
            width: 'var(--sidebar-badge-size)',
            fontSize: 'var(--sidebar-meta-font-size)',
          }}
          className="shrink-0 rounded-full bg-active/20 text-active font-bold leading-none flex items-center justify-center"
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
          className="shrink-0 px-1.5 rounded-full bg-active text-bg font-semibold leading-none flex items-center justify-center"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}

function ChannelGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 mb-1.5">
        <span className="eyebrow" style={{ fontSize: 'var(--sidebar-section-font-size)' }}>
          {label}
        </span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
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
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] hover:bg-white/[0.03] transition-colors text-left"
    >
      <span className="text-muted">{icon}</span>
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

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}
